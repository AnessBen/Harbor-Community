//! Native Linux HDR is negotiated by mpv's own Wayland GPU output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LinuxHdrOutput {
    Unchanged,
    WaylandAuto,
    SdrFallback,
}

pub(crate) fn output(embedded: bool, hdr_to_sdr: Option<bool>, wayland: bool) -> LinuxHdrOutput {
    if embedded || hdr_to_sdr != Some(false) {
        LinuxHdrOutput::Unchanged
    } else if wayland {
        LinuxHdrOutput::WaylandAuto
    } else {
        LinuxHdrOutput::SdrFallback
    }
}

pub(crate) fn wayland_available(
    display: Option<&str>,
    socket: Option<&str>,
    session: Option<&str>,
) -> bool {
    display.is_some_and(|value| !value.is_empty())
        || socket.is_some_and(|value| !value.is_empty())
        || session.is_some_and(|value| value.eq_ignore_ascii_case("wayland"))
}

#[cfg(target_os = "linux")]
pub(crate) fn current_output(embedded: bool, hdr_to_sdr: Option<bool>) -> LinuxHdrOutput {
    output(
        embedded,
        hdr_to_sdr,
        wayland_available(
            std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
            std::env::var("WAYLAND_SOCKET").ok().as_deref(),
            std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_explicit_native_hdr_changes_the_output() {
        assert_eq!(output(true, Some(false), true), LinuxHdrOutput::Unchanged);
        assert_eq!(output(false, Some(true), true), LinuxHdrOutput::Unchanged);
        assert_eq!(output(false, None, true), LinuxHdrOutput::Unchanged);
        assert_eq!(output(false, Some(false), true), LinuxHdrOutput::WaylandAuto);
        assert_eq!(output(false, Some(false), false), LinuxHdrOutput::SdrFallback);
    }

    #[test]
    fn wayland_session_or_socket_is_required() {
        assert!(!wayland_available(None, None, Some("x11")));
        assert!(!wayland_available(Some(""), Some(""), None));
        assert!(wayland_available(Some("wayland-0"), None, Some("x11")));
        assert!(wayland_available(None, Some("12"), None));
        assert!(wayland_available(None, None, Some("Wayland")));
    }
}
