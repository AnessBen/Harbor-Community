//! Shared libmpv client error descriptions for the in-process and sidecar engines.
//! Codes follow the bundled libmpv client.h, not operating-system errno values.

fn details(code: i32) -> (&'static str, &'static str) {
    match code {
        -1 => ("Event queue is full", "event-queue"),
        -2 => ("Memory allocation failed", "resource-exhausted"),
        -3 => ("Player is not initialized", "engine-initialization"),
        -4 => ("Invalid player parameter", "invalid-parameter"),
        -5 => ("Player option not found", "engine-configuration"),
        -6 => ("Unsupported player option format", "engine-configuration"),
        -7 => ("Failed to set player option", "engine-configuration"),
        -8 => ("Player property not found", "engine-property"),
        -9 => ("Unsupported player property format", "engine-property"),
        -10 => ("Player property unavailable", "engine-property"),
        -11 => ("Failed to access player property", "engine-property"),
        -12 => ("Player command failed", "engine-command"),
        -13 => ("Failed to load media", "media-load"),
        -14 => ("Failed to initialize audio output", "audio-output"),
        -15 => ("Failed to initialize video output", "video-output"),
        -16 => ("No playable audio or video streams", "unsupported-media"),
        -17 => ("Unknown or corrupted media format", "invalid-media-format"),
        -18 => ("Unsupported player operation", "unsupported-operation"),
        -19 => ("Player operation not implemented", "unsupported-operation"),
        -20 => ("Unspecified player error", "engine-error"),
        _ => ("Unknown player error", "engine-error"),
    }
}

/// Only parse a complete native error or a native error at the end of a
/// contextual command message. Never mistake a URL, ID or errno for an MPV code.
fn native_error(message: &str) -> Option<(&str, i32)> {
    let message = message.trim();
    for (marker, suffix) in [
        ("Raw(", ")"),
        ("mpv_command rc=", ""),
        ("Music mpv command failed: ", ""),
    ] {
        if let Some((prefix, tail)) = message.rsplit_once(marker) {
            if !prefix.is_empty() && !prefix.ends_with(": ") {
                continue;
            }
            if let Some(code) = tail
                .strip_suffix(suffix)
                .and_then(|n| n.parse::<i32>().ok())
            {
                if code < 0 {
                    return Some((prefix, code));
                }
            }
        }
    }
    None
}

pub(crate) fn describe(message: &str) -> String {
    let Some((prefix, code)) = native_error(message) else {
        return message.to_owned();
    };
    let (description, _) = details(code);
    format!("{prefix}MPV error {code}: {description}")
}

/// Recognize both the old wrapper and the new, human-readable form.
pub(crate) fn category(message: &str) -> Option<&'static str> {
    let code = native_error(message).map(|(_, code)| code).or_else(|| {
        let (prefix, tail) = message.trim().rsplit_once("MPV error ")?;
        if !prefix.is_empty() && !prefix.ends_with(": ") {
            return None;
        }
        let (code, description) = tail.split_once(": ")?;
        let code = code.parse::<i32>().ok()?;
        (code < 0 && description == details(code).0).then_some(code)
    })?;
    Some(details(code).1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_codes_are_readable_and_keep_the_code() {
        for (code, description, kind) in [
            (-13, "Failed to load media", "media-load"),
            (-14, "Failed to initialize audio output", "audio-output"),
            (
                -16,
                "No playable audio or video streams",
                "unsupported-media",
            ),
            (
                -17,
                "Unknown or corrupted media format",
                "invalid-media-format",
            ),
            (-999, "Unknown player error", "engine-error"),
        ] {
            let raw = format!("Raw({code})");
            let human = describe(&raw);
            assert_eq!(human, format!("MPV error {code}: {description}"));
            assert_eq!(category(&raw), Some(kind));
            assert_eq!(category(&human), Some(kind));
            assert_eq!(describe(&human), human);
        }
    }

    #[test]
    fn contextual_and_non_mpv_errors() {
        assert_eq!(
            describe("music loadfile: Raw(-13)"),
            "music loadfile: MPV error -13: Failed to load media"
        );
        assert_eq!(
            describe("music loadfile: mpv_command rc=-12"),
            "music loadfile: MPV error -12: Player command failed"
        );
        assert_eq!(
            describe("Music mpv command failed: -14"),
            "MPV error -14: Failed to initialize audio output"
        );
        for input in [
            "HTTP 403",
            "os error 13",
            "https://example.test/Raw(-13)",
            "Raw(0)",
            "Raw(-17) trailing text",
        ] {
            assert_eq!(describe(input), input);
            assert_eq!(category(input), None);
        }
    }
}
