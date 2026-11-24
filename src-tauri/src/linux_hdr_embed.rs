//! Opt-in native Wayland HDR backend. The optional renderer is discovered
//! through an explicit developer override.
use gtk::glib::translate::ToGlibPtr;
use gtk::prelude::*;
use libmpv2::Mpv;
use std::{
    cell::RefCell,
    ffi::{c_void, CString},
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::Arc,
};

type Abi = unsafe extern "C" fn() -> u32;
type Attach = unsafe extern "C" fn(
    *mut gtk::ffi::GtkWidget,
    *mut gtk::ffi::GtkWidget,
    *mut libmpv2_sys::mpv_handle,
) -> *mut c_void;
type Detach = unsafe extern "C" fn(*mut c_void) -> libc::c_int;

struct Native {
    library: *mut c_void,
    token: *mut c_void,
    detach: Detach,
    // Pin the exact core for as long as the native render context borrows it.
    _mpv: Arc<Mpv>,
}

thread_local! {
    static NATIVE: RefCell<Option<Native>> = const { RefCell::new(None) };
}

pub(super) fn active() -> bool {
    NATIVE.with(|slot| slot.borrow().is_some())
}

pub(crate) fn configured_library() -> Option<PathBuf> {
    if unsafe { libmpv2_sys::mpv_client_api_version() } < ((2 << 16) | 7) {
        return None;
    }
    std::env::var_os("HARBOR_LINUX_EMBEDDED_HDR_LIBRARY")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_file())
}

/// Probe the compositor on GTK's main thread, without attaching a renderer.
/// A missing or mismatched library never changes the existing player mode.
pub(crate) async fn available(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    let Some(path) = configured_library() else {
        return false;
    };
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    if app
        .run_on_main_thread(move || {
            let supported = (|| {
                let gtk_window = window.gtk_window().ok()?;
                let path = CString::new(path.as_os_str().as_bytes()).ok()?;
                unsafe {
                    let library = libc::dlopen(path.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
                    if library.is_null() {
                        return None;
                    }
                    let abi = libc::dlsym(library, c"harbor_hdr_abi".as_ptr());
                    let supported = libc::dlsym(library, c"harbor_hdr_supported".as_ptr());
                    let version = libc::dlsym(library, c"mpv_client_api_version".as_ptr());
                    let ok = !abi.is_null()
                        && !supported.is_null()
                        && version
                            == libmpv2_sys::mpv_client_api_version as *const () as *mut c_void
                        && std::mem::transmute::<_, Abi>(abi)() == 1
                        && std::mem::transmute::<
                            _,
                            unsafe extern "C" fn(*mut gtk::ffi::GtkWidget) -> libc::c_int,
                        >(supported)(
                            gtk_window.upcast_ref::<gtk::Widget>().to_glib_none().0
                        ) != 0;
                    libc::dlclose(library);
                    Some(ok)
                }
            })()
            .unwrap_or(false);
            let _ = tx.send(supported);
        })
        .is_err()
    {
        return false;
    }
    tokio::time::timeout(std::time::Duration::from_secs(3), rx)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(false)
}

pub(crate) fn requested(
    explicit: bool,
    embed: bool,
    hdr_to_sdr: Option<bool>,
) -> Result<Option<PathBuf>, String> {
    if !explicit {
        return Ok(None);
    }
    if !embed || hdr_to_sdr != Some(false) {
        return Err(
            "native embedded HDR requires embedded playback and tonemapping disabled".into(),
        );
    }
    configured_library()
        .map(Some)
        .ok_or_else(|| "experimental native HDR library or libmpv 2.7+ unavailable".into())
}

pub(crate) fn install(
    path: &Path,
    mpv: Arc<Mpv>,
    window: &gtk::ApplicationWindow,
    vbox: &gtk::Box,
) -> Result<(), String> {
    if active() {
        return Err("native HDR renderer already attached".into());
    }
    if !path.is_absolute() {
        return Err("HARBOR_LINUX_EMBEDDED_HDR_LIBRARY must be an absolute path".into());
    }
    let web = vbox
        .children()
        .into_iter()
        .next()
        .ok_or_else(|| "no WebKit child for HDR surface".to_string())?;
    let path = CString::new(path.as_os_str().as_bytes()).map_err(|_| "invalid HDR library path")?;
    unsafe {
        let library = libc::dlopen(path.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
        if library.is_null() {
            return Err("could not load optional native HDR library".into());
        }
        let result = (|| {
            let abi = libc::dlsym(library, c"harbor_hdr_abi".as_ptr());
            let attach = libc::dlsym(library, c"harbor_hdr_attach".as_ptr());
            let detach = libc::dlsym(library, c"harbor_hdr_detach".as_ptr());
            let version = libc::dlsym(library, c"mpv_client_api_version".as_ptr());
            // Both renderer and Harbor must call the same loaded libmpv.
            if abi.is_null()
                || attach.is_null()
                || detach.is_null()
                || version != libmpv2_sys::mpv_client_api_version as *const () as *mut c_void
                || libmpv2_sys::mpv_client_api_version() < ((2 << 16) | 7)
            {
                return Err("incompatible HDR library or libmpv (API 2.7+ required)".to_string());
            }
            let abi: Abi = std::mem::transmute(abi);
            if abi() != 1 {
                return Err("unsupported native HDR library ABI".into());
            }
            let attach: Attach = std::mem::transmute(attach);
            let detach: Detach = std::mem::transmute(detach);
            let widget: &gtk::Widget = window.upcast_ref();
            let token = attach(
                widget.to_glib_none().0,
                web.to_glib_none().0,
                mpv.ctx.as_ptr(),
            );
            if token.is_null() {
                return Err("native Wayland HDR surface initialization failed; select standard embedded or separate-window playback".into());
            }
            NATIVE.with(|slot| {
                *slot.borrow_mut() = Some(Native {
                    library,
                    token,
                    detach,
                    _mpv: mpv,
                })
            });
            Ok(())
        })();
        if result.is_err() {
            libc::dlclose(library);
        }
        result
    }
}

pub(super) fn uninstall() -> Result<(), String> {
    NATIVE.with(|slot| {
        let mut slot = slot.borrow_mut();
        if let Some(native) = slot.as_ref() {
            unsafe {
                if (native.detach)(native.token) == 0 {
                    return Err("native HDR EGL context lost; restart Harbor before starting another player".into());
                }
            }
        }
        if let Some(native) = slot.take() {
            unsafe { libc::dlclose(native.library); }
        }
        Ok(())
    })
}

pub(crate) fn protected_output_property(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let name = name
        .strip_prefix("options/")
        .or_else(|| name.strip_prefix("file-local-options/"))
        .unwrap_or(&name);
    matches!(
        name,
        "vo" | "hwdec"
            | "target-trc"
            | "target-prim"
            | "target-colorspace-hint"
            | "target-colorspace-hint-mode"
            | "target-peak"
            | "video-output-levels"
            | "dither-depth"
            | "video-timing-offset"
            | "target-contrast"
    )
}
