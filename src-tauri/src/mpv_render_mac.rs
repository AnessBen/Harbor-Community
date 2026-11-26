#![cfg(target_os = "macos")]

use std::ffi::{c_char, c_void};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use libmpv2_sys::{self as mpv, mpv_handle};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{msg_send, AnyThread, ClassType, MainThreadOnly, Message};
use objc2_app_kit::{NSOpenGLPixelFormat, NSOpenGLView, NSView, NSWindow, NSWindowOrderingMode};
use objc2_foundation::{MainThreadMarker, NSNumber, NSString};

use crate::mpv::{map_css_geometry, MpvGeometry};

const NSOPENGLPFA_OPENGL_PROFILE: u32 = 99;
const NSOPENGLPFA_DOUBLEBUFFER: u32 = 5;
const NSOPENGLPFA_COLOR_SIZE: u32 = 8;
const NSOPENGLPFA_COLOR_FLOAT: u32 = 58;
const NSOPENGLPFA_DEPTH_SIZE: u32 = 12;
const NSOPENGLPFA_ACCELERATED: u32 = 73;
const NSOPENGLPFA_NO_RECOVERY: u32 = 72;
const NSOPENGL_PROFILE_VERSION_3_2_CORE: u32 = 0x3200;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    static kCGColorSpaceITUR_2100_PQ: *const c_void;
    static kCGColorSpaceDisplayP3_PQ: *const c_void;
    fn CGColorSpaceCreateWithName(name: *const c_void) -> *mut c_void;
    fn CGColorSpaceRelease(space: *mut c_void);
}

const NS_VIEW_AUTORESIZE_WIDTH: usize = 2;
const NS_VIEW_AUTORESIZE_HEIGHT: usize = 16;
const NS_WINDOW_STYLE_BORDERLESS: usize = 0;
const NS_BACKING_STORE_BUFFERED: usize = 2;
const NS_WINDOW_BELOW: isize = -1;
const WINDOW_CORNER_RADIUS: f64 = 14.0;

const NSOPENGL_CONTEXT_PARAM_SURFACE_OPACITY: i32 = 236;

extern "C" {
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    fn dispatch_async_f(queue: *mut c_void, ctx: *mut c_void, work: extern "C" fn(*mut c_void));
    static _dispatch_main_q: c_void;
}
const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

unsafe fn content_rect_to_screen(
    parent: &NSWindow,
    rect: objc2_foundation::NSRect,
) -> objc2_foundation::NSRect {
    let Some(content_view) = parent.contentView() else {
        return rect;
    };
    let nil_view: *const AnyObject = std::ptr::null();
    let in_window: objc2_foundation::NSRect =
        msg_send![&*content_view, convertRect: rect, toView: nil_view];
    msg_send![parent, convertRectToScreen: in_window]
}

fn same_rect(a: objc2_foundation::NSRect, b: objc2_foundation::NSRect) -> bool {
    (a.origin.x - b.origin.x).abs() < 0.5
        && (a.origin.y - b.origin.y).abs() < 0.5
        && (a.size.width - b.size.width).abs() < 0.5
        && (a.size.height - b.size.height).abs() < 0.5
}

unsafe fn make_video_window(
    mtm: MainThreadMarker,
    parent: &NSWindow,
    content_rect: objc2_foundation::NSRect,
) -> Result<Retained<NSWindow>, String> {
    let screen_rect = content_rect_to_screen(parent, content_rect);
    let alloc = NSWindow::alloc(mtm);
    let window: Option<Retained<NSWindow>> = msg_send![
        alloc,
        initWithContentRect: screen_rect,
        styleMask: NS_WINDOW_STYLE_BORDERLESS,
        backing: NS_BACKING_STORE_BUFFERED,
        defer: false,
    ];
    let window = window.ok_or_else(|| "video NSWindow init failed".to_string())?;
    let clear: *mut AnyObject = msg_send![objc2::class!(NSColor), clearColor];
    let _: () = msg_send![&*window, setOpaque: false];
    let _: () = msg_send![&*window, setBackgroundColor: clear];
    let _: () = msg_send![&*window, setHasShadow: false];
    let _: () = msg_send![&*window, setIgnoresMouseEvents: true];
    let _: () = msg_send![&*window, setReleasedWhenClosed: false];
    Ok(window)
}

fn main_queue() -> *mut c_void {
    unsafe { (&_dispatch_main_q as *const c_void) as *mut c_void }
}

// The rounded main window normally needs a painted backing so that a
// transparent WKWebView never exposes the desktop. During libmpv playback the
// backing must instead be clear: an NSOpenGLView can be composited behind the
// contentView's layer on macOS, hiding the video behind a solid black surface.
// Restore the painted backing as soon as the embed is torn down.
fn set_content_backing(window: &NSWindow, video_active: bool) {
    unsafe {
        let Some(content_view) = window.contentView() else {
            return;
        };
        let _: () = msg_send![&*content_view, setWantsLayer: true];
        if let Some(layer) = content_view.layer() {
            let color: *mut AnyObject = if video_active {
                msg_send![objc2::class!(NSColor), clearColor]
            } else {
                msg_send![objc2::class!(NSColor), blackColor]
            };
            let cg_color: *mut AnyObject = msg_send![color, CGColor];
            let _: () = msg_send![&*layer, setBackgroundColor: cg_color];
        }
    }
}

pub struct Embed {
    view: Retained<NSOpenGLView>,
    web_view: Option<Retained<NSView>>,
    web_view_was_opaque: bool,
    ns_window: Retained<NSWindow>,
    video_window: Option<Retained<NSWindow>>,
    css: Option<MpvGeometry>,
    render: Mutex<MacRenderContext>,
    float_surface: bool,
}

// macOS can rebuild the content-view layers when entering or leaving native
// fullscreen. Keep the video backing clear and its sibling below the webview.
fn refresh_compositing(embed: &Embed) {
    set_content_backing(&embed.ns_window, true);
    if embed.video_window.is_none() {
        if let (Some(parent), Some(web_view)) =
            (embed.ns_window.contentView(), embed.web_view.as_deref())
        {
            let view_as_view: &NSView = embed.view.as_super();
            unsafe {
                parent.addSubview_positioned_relativeTo(
                    view_as_view,
                    NSWindowOrderingMode::Below,
                    Some(web_view),
                );
            }
        }
    }
}

// SAFETY: the mutex moves ownership into a process-global slot, but every path
// that touches or drops AppKit state first verifies it is on the main thread.
unsafe impl Send for Embed {}

static EMBED: OnceLock<Mutex<Option<Embed>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<Embed>> {
    EMBED.get_or_init(|| Mutex::new(None))
}

pub fn install(
    mpv_ctx: NonNull<mpv_handle>,
    ns_window_ptr: i64,
    edr: bool,
    prefer_legacy: bool,
) -> Result<&'static str, String> {
    let mtm = MainThreadMarker::new()
        .ok_or_else(|| "mpv_render_mac::install must run on main thread".to_string())?;
    if ns_window_ptr == 0 {
        return Err("ns_window_ptr is zero".into());
    }

    let stale = {
        slot()
            .lock()
            .map_err(|e| format!("slot lock: {}", e))?
            .take()
    };
    if let Some(stale) = stale {
        eprintln!("[harbor::mpv_mac] replacing stale embed on the main thread");
        teardown_embed(stale);
    }

    unsafe {
        let raw_window: *mut AnyObject = ns_window_ptr as *mut AnyObject;
        let ns_window: &NSWindow = &*(raw_window as *const NSWindow);
        let content_view = ns_window
            .contentView()
            .ok_or_else(|| "NSWindow has no contentView".to_string())?;
        let bounds = content_view.bounds();
        eprintln!(
            "[harbor::mpv_mac] contentView bounds: {}x{}",
            bounds.size.width, bounds.size.height
        );

        let make_pf = |float: bool| -> Option<Retained<NSOpenGLPixelFormat>> {
            let attrs: [u32; 15] = if float {
                [
                    NSOPENGLPFA_OPENGL_PROFILE,
                    NSOPENGL_PROFILE_VERSION_3_2_CORE,
                    NSOPENGLPFA_DOUBLEBUFFER,
                    1,
                    NSOPENGLPFA_ACCELERATED,
                    1,
                    NSOPENGLPFA_NO_RECOVERY,
                    1,
                    NSOPENGLPFA_COLOR_FLOAT,
                    1,
                    NSOPENGLPFA_COLOR_SIZE,
                    64,
                    NSOPENGLPFA_DEPTH_SIZE,
                    16,
                    0,
                ]
            } else {
                [
                    NSOPENGLPFA_OPENGL_PROFILE,
                    NSOPENGL_PROFILE_VERSION_3_2_CORE,
                    NSOPENGLPFA_DOUBLEBUFFER,
                    1,
                    NSOPENGLPFA_ACCELERATED,
                    1,
                    NSOPENGLPFA_NO_RECOVERY,
                    1,
                    NSOPENGLPFA_COLOR_SIZE,
                    24,
                    NSOPENGLPFA_DEPTH_SIZE,
                    16,
                    0,
                    0,
                    0,
                ]
            };
            let pf_alloc = NSOpenGLPixelFormat::alloc();
            msg_send![pf_alloc, initWithAttributes: attrs.as_ptr()]
        };

        let float_pf = if edr { make_pf(true) } else { None };
        let float_surface = float_pf.is_some();
        let pf = float_pf
            .or_else(|| make_pf(false))
            .ok_or_else(|| "NSOpenGLPixelFormat init failed".to_string())?;

        let view_alloc = NSOpenGLView::alloc(mtm);
        let view: Option<Retained<NSOpenGLView>> = msg_send![
            view_alloc,
            initWithFrame: bounds,
            pixelFormat: &*pf,
        ];
        let view = view.ok_or_else(|| "NSOpenGLView init failed".to_string())?;
        let _: () = msg_send![&*view, setWantsBestResolutionOpenGLSurface: true];
        if edr {
            let _: () = msg_send![&*view, setWantsExtendedDynamicRangeOpenGLSurface: true];
        }
        let view_as_view: &NSView = view.as_super();

        let subviews = content_view.subviews();
        let first_subview: Option<Retained<NSView>> = subviews.firstObject();
        let video_window = if edr {
            let window = make_video_window(mtm, ns_window, bounds)?;
            let _: () = msg_send![&*window, setContentView: view_as_view];
            let _: () = msg_send![
                ns_window,
                addChildWindow: &*window,
                ordered: NS_WINDOW_BELOW,
            ];
            Some(window)
        } else {
            if let Some(reference) = first_subview.as_deref() {
                content_view.addSubview_positioned_relativeTo(
                    view_as_view,
                    NSWindowOrderingMode::Below,
                    Some(reference),
                );
            } else {
                content_view.addSubview(view_as_view);
            }
            None
        };
        let mask = NS_VIEW_AUTORESIZE_WIDTH | NS_VIEW_AUTORESIZE_HEIGHT;
        let _: () = msg_send![view_as_view, setAutoresizingMask: mask];

        let _: () = msg_send![view_as_view, setWantsLayer: true];
        if let Some(layer) = view_as_view.layer() {
            let black: *mut AnyObject = msg_send![objc2::class!(NSColor), blackColor];
            let cg_black: *mut AnyObject = msg_send![&*black, CGColor];
            let _: () = msg_send![&*layer, setBackgroundColor: cg_black];
            let _: () = msg_send![&*layer, setOpaque: true];
            if video_window.is_some() {
                let _: () = msg_send![&*layer, setCornerRadius: WINDOW_CORNER_RADIUS];
                let _: () = msg_send![&*layer, setMasksToBounds: true];
            }
        }

        let gl_ctx = view
            .openGLContext()
            .ok_or_else(|| "openGLContext was nil".to_string())?;
        gl_ctx.makeCurrentContext();
        let _: () = msg_send![&*gl_ctx, update];
        let opaque_value: i32 = 1;
        let _: () = msg_send![
            &*gl_ctx,
            setValues: (&opaque_value) as *const i32,
            forParameter: NSOPENGL_CONTEXT_PARAM_SURFACE_OPACITY,
        ];

        // Initialize before making WebKit transparent, and undo attachment on failure.
        let (render, backend) = match MacRenderContext::new(mpv_ctx, prefer_legacy) {
            Ok(value) => value,
            Err(error) => {
                view_as_view.removeFromSuperview();
                if let Some(window) = video_window.as_deref() {
                    let _: () = msg_send![ns_window, removeChildWindow: window];
                    let _: () = msg_send![window, orderOut: std::ptr::null::<AnyObject>()];
                }
                return Err(error);
            }
        };
        render.set_update_callback();

        let mut web_view_was_opaque = true;
        if let Some(wv) = first_subview.as_deref() {
            let was_opaque: bool = msg_send![wv, isOpaque];
            web_view_was_opaque = was_opaque;
            let _: () = msg_send![wv, setWantsLayer: true];
            let no_num = NSNumber::new_bool(false);
            let key = NSString::from_str("drawsBackground");
            let _: () = msg_send![wv, setValue: &*no_num, forKey: &*key];
            if let Some(layer) = wv.layer() {
                let _: () = msg_send![&*layer, setOpaque: false];
            }
        }

        let embed = Embed {
            view,
            web_view: first_subview,
            web_view_was_opaque,
            ns_window: ns_window.retain(),
            video_window,
            css: None,
            render: Mutex::new(render),
            float_surface,
        };
        refresh_compositing(&embed);
        eprintln!(
            "[harbor::mpv_mac] video backing clear, child window={}",
            edr
        );
        *slot().lock().map_err(|e| format!("slot lock: {}", e))? = Some(embed);

        schedule_redraw();
        eprintln!("[harbor::mpv_mac] installed renderer={backend} float_surface={float_surface}");
        Ok(backend)
    }
}

pub fn set_hdr_active(active: bool, bt2020: bool) {
    if MainThreadMarker::new().is_none() {
        eprintln!("[harbor::mpv_mac] ignored HDR update off the main thread");
        return;
    }
    let Ok(guard) = slot().lock() else {
        return;
    };
    let Some(embed) = guard.as_ref() else {
        return;
    };
    let Some(video_window) = embed.video_window.as_deref() else {
        return;
    };
    unsafe {
        let view_as_view: &NSView = embed.view.as_super();
        let _: () = msg_send![view_as_view, setWantsExtendedDynamicRangeOpenGLSurface: active];
        if active {
            let space_name = if bt2020 {
                kCGColorSpaceITUR_2100_PQ
            } else {
                kCGColorSpaceDisplayP3_PQ
            };
            let cg = CGColorSpaceCreateWithName(space_name);
            if !cg.is_null() {
                let nscs_alloc: *mut AnyObject = msg_send![objc2::class!(NSColorSpace), alloc];
                let nscs: *mut AnyObject = msg_send![nscs_alloc, initWithCGColorSpace: cg];
                if !nscs.is_null() {
                    let _: () = msg_send![video_window, setColorSpace: nscs];
                }
                CGColorSpaceRelease(cg);
            }
        } else {
            let nil: *mut AnyObject = std::ptr::null_mut();
            let _: () = msg_send![video_window, setColorSpace: nil];
        }
    }
    schedule_redraw();
}

pub fn install_window_rounding(ns_window_ptr: i64) -> Result<(), String> {
    let _mtm = MainThreadMarker::new().ok_or_else(|| "must run on main thread".to_string())?;
    if ns_window_ptr == 0 {
        return Err("ns_window_ptr is zero".into());
    }
    unsafe {
        use objc2::class;
        let raw_window: *mut AnyObject = ns_window_ptr as *mut AnyObject;
        let ns_window: &NSWindow = &*(raw_window as *const NSWindow);
        let _: () = msg_send![ns_window, setOpaque: false];
        let _: () = msg_send![ns_window, setHasShadow: true];
        let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setBackgroundColor: clear];
        if let Some(content_view) = ns_window.contentView() {
            let _: () = msg_send![&*content_view, setWantsLayer: true];
            if let Some(layer) = content_view.layer() {
                let _: () = msg_send![&*layer, setCornerRadius: WINDOW_CORNER_RADIUS];
                let _: () = msg_send![&*layer, setMasksToBounds: true];
                // The window stays clear so the rounded corners show the desktop.
                // Outside embedded playback the content layer needs a solid
                // backing: the webview does not draw a background, so a clear
                // backing can expose the desktop when macOS recomposites it.
                // The mpv embed temporarily clears this backing while active.
                let black: *mut AnyObject = msg_send![class!(NSColor), blackColor];
                let cg_black: *mut AnyObject = msg_send![&*black, CGColor];
                let _: () = msg_send![&*layer, setBackgroundColor: cg_black];
            }
        }
    }
    Ok(())
}

pub fn make_resizable(ns_window_ptr: i64) -> Result<(), String> {
    let _mtm = MainThreadMarker::new().ok_or_else(|| "must run on main thread".to_string())?;
    if ns_window_ptr == 0 {
        return Err("ns_window_ptr is zero".into());
    }
    unsafe {
        let raw_window: *mut AnyObject = ns_window_ptr as *mut AnyObject;
        let ns_window: &NSWindow = &*(raw_window as *const NSWindow);
        let current: usize = msg_send![ns_window, styleMask];
        let resizable = 1usize << 3;
        let miniaturizable = 1usize << 2;
        let _: () = msg_send![ns_window, setStyleMask: current | resizable | miniaturizable];
    }
    Ok(())
}

unsafe fn sync_frame(embed: &Embed) -> bool {
    let Some(css) = embed.css else {
        return false;
    };
    let Some(parent) = embed.ns_window.contentView() else {
        return false;
    };
    let parent_bounds = parent.bounds();
    let native = map_css_geometry(&css, parent_bounds.size.width, parent_bounds.size.height);
    let native_y = if parent.isFlipped() {
        native.y
    } else {
        parent_bounds.size.height - native.y - native.height
    };
    let next = objc2_foundation::NSRect {
        origin: objc2_foundation::NSPoint {
            x: native.x,
            y: native_y,
        },
        size: objc2_foundation::NSSize {
            width: native.width,
            height: native.height,
        },
    };
    match embed.video_window.as_deref() {
        Some(video_window) => {
            let screen_rect = content_rect_to_screen(&embed.ns_window, next);
            let current: objc2_foundation::NSRect = msg_send![video_window, frame];
            if same_rect(current, screen_rect) {
                return false;
            }
            let _: () = msg_send![video_window, setFrame: screen_rect, display: true];
        }
        None => {
            let view_as_view: &NSView = embed.view.as_super();
            if same_rect(view_as_view.frame(), next) {
                return false;
            }
            view_as_view.setFrame(next);
        }
    }
    true
}

pub fn resize_to(css: MpvGeometry) -> Result<(), String> {
    let _mtm =
        MainThreadMarker::new().ok_or_else(|| "resize_to must run on main thread".to_string())?;
    {
        let mut guard = slot().lock().map_err(|e| format!("slot lock: {}", e))?;
        let Some(embed) = guard.as_mut() else {
            return Ok(());
        };
        embed.css = Some(css);
        if unsafe { sync_frame(embed) } {
            refresh_compositing(embed);
        }
    }
    schedule_redraw();
    Ok(())
}

pub fn render_now() -> Result<(), String> {
    let _mtm =
        MainThreadMarker::new().ok_or_else(|| "render_now must run on main thread".to_string())?;
    let guard = slot().lock().map_err(|e| format!("slot lock: {}", e))?;
    let Some(embed) = guard.as_ref() else {
        return Ok(());
    };
    unsafe {
        let moved = sync_frame(embed);
        let gl_ctx = embed
            .view
            .openGLContext()
            .ok_or_else(|| "openGLContext nil".to_string())?;
        gl_ctx.makeCurrentContext();
        let view_as_view: &NSView = embed.view.as_super();
        let bounds = view_as_view.bounds();
        let backing: objc2_foundation::NSRect =
            msg_send![view_as_view, convertRectToBacking: bounds];
        let mut w = backing.size.width as i32;
        let mut h = backing.size.height as i32;
        if w <= 0 || h <= 0 {
            let scale = view_as_view
                .window()
                .map(|win| win.backingScaleFactor())
                .filter(|s| *s > 0.0)
                .unwrap_or(1.0);
            w = (bounds.size.width * scale) as i32;
            h = (bounds.size.height * scale) as i32;
        }
        if w <= 0 || h <= 0 {
            return Ok(());
        }
        let packed = ((w as u64) << 32) | (h as u32 as u64);
        let resized = LAST_SURFACE.swap(packed, Ordering::Relaxed) != packed;
        if moved || resized {
            refresh_compositing(embed);
        }
        if resized {
            eprintln!(
                "[harbor::mpv_mac] render surface {}x{} px (bounds {}x{} pt)",
                w, h, bounds.size.width as i32, bounds.size.height as i32
            );
        }
        if moved || resized {
            let _: () = msg_send![&*gl_ctx, update];
        }
        let render = embed
            .render
            .lock()
            .map_err(|e| format!("render lock: {}", e))?;
        render.render(w, h, embed.float_surface)?;
        gl_ctx.flushBuffer();
    }
    Ok(())
}

pub fn uninstall() -> Result<(), String> {
    let _mtm =
        MainThreadMarker::new().ok_or_else(|| "uninstall must run on main thread".to_string())?;
    let embed = {
        slot()
            .lock()
            .map_err(|e| format!("slot lock: {}", e))?
            .take()
    };
    let Some(embed) = embed else {
        return Ok(());
    };
    teardown_embed(embed);
    eprintln!("[harbor::mpv_mac] uninstalled");
    Ok(())
}

fn teardown_embed(embed: Embed) {
    unsafe {
        // Free the renderer while its original OpenGL context is current.
        if let Some(gl_ctx) = embed.view.openGLContext() {
            gl_ctx.makeCurrentContext();
        }
        drop(
            embed
                .render
                .into_inner()
                .unwrap_or_else(|error| error.into_inner()),
        );
        let view_as_view: &NSView = embed.view.as_super();
        view_as_view.removeFromSuperview();
        if let Some(video_window) = embed.video_window.as_deref() {
            let nil: *mut AnyObject = std::ptr::null_mut();
            let _: () = msg_send![video_window, setColorSpace: nil];
            let _: () = msg_send![&*embed.ns_window, removeChildWindow: video_window];
            let _: () = msg_send![video_window, orderOut: std::ptr::null::<AnyObject>()];
        }
        if let Some(wv) = embed.web_view.as_deref() {
            let restored = embed.web_view_was_opaque;
            let restored_num = NSNumber::new_bool(restored);
            let key = NSString::from_str("drawsBackground");
            let _: () = msg_send![wv, setValue: &*restored_num, forKey: &*key];
            if let Some(layer) = wv.layer() {
                let _: () = msg_send![&*layer, setOpaque: restored];
            }
        }
        set_content_backing(&embed.ns_window, false);
        eprintln!("[harbor::mpv_mac] video backing restored");
    }
}

// Upstream libmpv API 2.7. The current Rust bindings predate this enum.
const MPV_RENDER_PARAM_RENDERER: mpv::mpv_render_param_type = 23;
const RENDERER_API_VERSION: u64 = (2 << 16) | 7;

struct MacRenderContext(NonNull<mpv::mpv_render_context>);

fn renderer_attempts(
    version: u64,
    prefer_legacy: bool,
) -> &'static [Option<&'static std::ffi::CStr>] {
    if version < RENDERER_API_VERSION {
        &[None]
    } else if prefer_legacy {
        &[Some(c"gpu")]
    } else {
        &[Some(c"gpu-next"), Some(c"gpu")]
    }
}

fn param(kind: mpv::mpv_render_param_type, data: *mut c_void) -> mpv::mpv_render_param {
    mpv::mpv_render_param { type_: kind, data }
}

fn end_param() -> mpv::mpv_render_param {
    param(
        mpv::mpv_render_param_type_MPV_RENDER_PARAM_INVALID,
        std::ptr::null_mut(),
    )
}

impl MacRenderContext {
    fn new(
        handle: NonNull<mpv_handle>,
        prefer_legacy: bool,
    ) -> Result<(Self, &'static str), String> {
        let version = unsafe { mpv::mpv_client_api_version() } as u64;
        let mut errors = Vec::new();
        for renderer in renderer_attempts(version, prefer_legacy) {
            let name = if *renderer == Some(c"gpu-next") {
                "gpu-next"
            } else {
                "gpu"
            };
            let mut init = mpv::mpv_opengl_init_params {
                get_proc_address: Some(get_proc_address),
                get_proc_address_ctx: std::ptr::null_mut(),
            };
            let mut params = vec![
                param(
                    mpv::mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE,
                    c"opengl".as_ptr().cast_mut().cast(),
                ),
                param(
                    mpv::mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
                    (&mut init as *mut mpv::mpv_opengl_init_params).cast(),
                ),
            ];
            if let Some(renderer) = renderer {
                params.push(param(
                    MPV_RENDER_PARAM_RENDERER,
                    renderer.as_ptr().cast_mut().cast(),
                ));
            }
            params.push(end_param());
            let mut raw = std::ptr::null_mut();
            let status = unsafe {
                mpv::mpv_render_context_create(&mut raw, handle.as_ptr(), params.as_mut_ptr())
            };
            if status >= 0 {
                let context = NonNull::new(raw)
                    .ok_or_else(|| "libmpv returned a null render context".to_string())?;
                eprintln!(
                    "[harbor::mpv_mac] renderer={name} client_api={}.{}",
                    version >> 16,
                    version & 0xffff
                );
                return Ok((Self(context), name));
            }
            eprintln!("[harbor::mpv_mac] renderer={name} init failed ({status})");
            errors.push(format!("{name}: {status}"));
        }
        Err(format!("render init: {}", errors.join(", ")))
    }

    fn set_update_callback(&self) {
        unsafe {
            mpv::mpv_render_context_set_update_callback(
                self.0.as_ptr(),
                Some(render_update),
                std::ptr::null_mut(),
            );
        }
    }

    fn render(&self, w: i32, h: i32, float_surface: bool) -> Result<(), String> {
        let mut fbo = mpv::mpv_opengl_fbo {
            fbo: 0,
            w,
            h,
            internal_format: if float_surface { 0x881A } else { 0 }, // GL_RGBA16F
        };
        let mut flip: i32 = 1;
        let mut depth: i32 = if float_surface { 16 } else { 8 };
        let mut params = [
            param(
                mpv::mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_FBO,
                (&mut fbo as *mut mpv::mpv_opengl_fbo).cast(),
            ),
            param(
                mpv::mpv_render_param_type_MPV_RENDER_PARAM_FLIP_Y,
                (&mut flip as *mut i32).cast(),
            ),
            param(
                mpv::mpv_render_param_type_MPV_RENDER_PARAM_DEPTH,
                (&mut depth as *mut i32).cast(),
            ),
            end_param(),
        ];
        let status =
            unsafe { mpv::mpv_render_context_render(self.0.as_ptr(), params.as_mut_ptr()) };
        if status < 0 {
            Err(format!("render: {status}"))
        } else {
            Ok(())
        }
    }
}

impl Drop for MacRenderContext {
    fn drop(&mut self) {
        unsafe {
            mpv::mpv_render_context_set_update_callback(
                self.0.as_ptr(),
                None,
                std::ptr::null_mut(),
            );
            mpv::mpv_render_context_free(self.0.as_ptr());
        }
    }
}

unsafe extern "C" fn get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    if name.is_null() {
        return std::ptr::null_mut();
    }
    unsafe { dlsym(RTLD_DEFAULT, name) }
}

unsafe extern "C" fn render_update(_ctx: *mut c_void) {
    schedule_redraw();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_api_never_receives_unknown_renderer_param() {
        assert_eq!(renderer_attempts((2 << 16) | 6, false), &[None]);
        assert_eq!(renderer_attempts((2 << 16) | 6, true), &[None]);
    }

    #[test]
    fn new_api_prefers_gpu_next_and_can_fall_back_or_force_gpu() {
        assert_eq!(
            renderer_attempts(RENDERER_API_VERSION, false),
            &[Some(c"gpu-next"), Some(c"gpu")]
        );
        assert_eq!(
            renderer_attempts(RENDERER_API_VERSION, true),
            &[Some(c"gpu")]
        );
    }
}

static REDRAW_PENDING: AtomicBool = AtomicBool::new(false);
static LAST_SURFACE: AtomicU64 = AtomicU64::new(0);

fn schedule_redraw() {
    if REDRAW_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    extern "C" fn redraw_cb(_ctx: *mut c_void) {
        REDRAW_PENDING.store(false, Ordering::Release);
        let _ = render_now();
    }
    unsafe {
        dispatch_async_f(main_queue(), std::ptr::null_mut(), redraw_cb);
    }
}
