//! Opt-in playback trace for stalls the interface can only show as "loading".
//! Enable with `HARBOR_MUSIC_TRACE=1`; lines land in `music-trace.log` beside the app logs.

use std::collections::VecDeque;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
// Keep a bounded, session-only history even without opt-in disk tracing.
static RECENT: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();
const RECENT_LIMIT: usize = 80;

fn remember(line: String) {
    if let Ok(mut recent) = RECENT.get_or_init(|| Mutex::new(VecDeque::new())).lock() {
        if recent.len() == RECENT_LIMIT {
            recent.pop_front();
        }
        recent.push_back(line);
    }
}

fn safe_text(value: &str) -> String {
    crate::log_privacy::scrub(value)
        .chars()
        .take(1500)
        .collect()
}

#[tauri::command]
pub fn music_playback_startup_timeout(connector: Option<String>) {
    log(format!(
        "frontend startup timeout connector={} after 35 seconds; no file-loaded event",
        source_label(connector.as_deref())
    ));
}

/// Provider identifiers only, never track titles, URLs or arbitrary user input.
pub(super) fn source_label(connector: Option<&str>) -> &str {
    match connector {
        Some(id)
            if !id.is_empty()
                && id.len() <= 40
                && id.bytes().all(|c| {
                    c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'_'
                }) =>
        {
            id
        }
        _ => "direct",
    }
}

pub(super) fn outcome<T>(
    source: &str,
    stage: &str,
    start: std::time::Instant,
    result: &Result<T, String>,
) {
    let outcome = match result {
        Ok(_) => "ok",
        Err(error) => process_category(error),
    };
    log(format!(
        "source={source} stage={stage} result={} category={outcome} {} ms",
        if result.is_ok() { "ok" } else { "error" },
        start.elapsed().as_millis()
    ));
}

/// A fixed label for each MPV subsystem; only error/warning messages are retained.
pub(super) fn mpv_diagnostic(
    engine: &str,
    deck: u64,
    source: Option<&str>,
    level: &str,
    prefix: &str,
    text: &str,
) {
    let severity = match level {
        "fatal" | "error" | "warn" => level,
        _ => return,
    };
    let component = if prefix.starts_with("ao") {
        "audio-output"
    } else if prefix.starts_with("ffmpeg") {
        "ffmpeg"
    } else if prefix.starts_with("demux") {
        "demuxer"
    } else if prefix.starts_with("ad") {
        "decoder"
    } else if prefix.starts_with("stream") {
        "stream"
    } else {
        "player"
    };
    log(format!(
        "{engine} deck={deck} source={} severity={severity} component={component} category={}",
        source_label(source),
        process_category(text)
    ));
}

#[tauri::command]
pub async fn music_playback_diagnostics(
    app: tauri::AppHandle,
    failure: String,
    connector: Option<String>,
) -> Result<String, String> {
    use tauri::Manager;
    let state = app.state::<super::MusicState>();
    let active = match state.active_engine() {
        super::ACTIVE_SOLOIST => "soloist",
        super::ACTIVE_MODULE_SPOTIFY => "librespot-module",
        super::ACTIVE_SPOTIFY if state.spotify.remote_device().is_some() => "spotify-connect",
        super::ACTIVE_SPOTIFY if cfg!(feature = "music-sidecar") => "librespot-module",
        super::ACTIVE_SPOTIFY => "librespot",
        super::ACTIVE_MODULE => "mpv-module",
        super::ACTIVE_STREAM if cfg!(feature = "music-sidecar") => "mpv-module",
        super::ACTIVE_STREAM => "mpv",
        _ => "none",
    };
    let recent = RECENT
        .get()
        .and_then(|history| {
            history
                .lock()
                .ok()
                .map(|h| h.iter().cloned().collect::<Vec<_>>())
        })
        .unwrap_or_default();
    let snapshot = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        super::music_engine_state(state),
    )
    .await
    .ok()
    .and_then(Result::ok);
    let playback = snapshot.map(|s| {
        serde_json::json!({
            "liveReported": s.live,
            "paused": s.paused,
            "positionSeconds": s.position_seconds,
            "durationSeconds": s.duration_seconds,
        })
    });
    let report = serde_json::json!({
        "schema": 1,
        "harborVersion": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "architecture": std::env::consts::ARCH,
        "connector": connector.as_deref().map(safe_text),
        "failure": safe_text(&super::mpv_errors::describe(&failure)),
        "failureCategory": process_category(&failure),
        "activeEngine": active,
        "spotifyPreferredEngine": super::spotify::soloist::engine(&app),
        "musicSidecarBuild": cfg!(feature = "music-sidecar"),
        "diskTraceEnabled": enabled(),
        "playback": playback,
        "recentEvents": recent,
    });
    serde_json::to_string_pretty(&report).map_err(|e| e.to_string())
}

// Never retain raw subprocess output: it may contain arbitrary secrets.
pub(super) fn process_category(line: &str) -> &'static str {
    if let Some(category) = super::mpv_errors::category(line) {
        return category;
    }
    let s = line.to_ascii_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| s.contains(n));
    // Only interpret status codes in explicit HTTP/status contexts, not track IDs,
    // port numbers, filenames or strings such as "Server returned 4XX Client Error".
    static STATUS: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?i)\b(?:http(?:/\d(?:\.\d)?)?(?:\s+error|\s+status(?:\s+code)?)?|server\s+returned|status(?:\s+code)?|response\s+code)\s*[:=(]?\s*([45]\d{2})\b").expect("HTTP status pattern")
    });
    if let Some(status) = STATUS
        .captures(&s)
        .and_then(|m| m.get(1))
        .and_then(|m| m.as_str().parse::<u16>().ok())
    {
        match status {
            401 => return "authentication",
            403 => return "forbidden",
            404 => return "unavailable",
            408 | 504 => return "timeout",
            410 => return "expired",
            429 => return "rate-limited",
            500..=599 => return "server-error",
            _ => return "http-error",
        }
    }
    if has(&["audio key", "audio-key", "audio_key", "audiokey", "decrypt"]) {
        "audio-key/decryption"
    } else if has(&[
        "no longer on disk",
        "not in your music folder",
        "no such file",
        "file not found",
        "os error 2",
    ]) {
        "missing-file"
    } else if has(&["expired", "expiration"]) {
        "expired"
    } else if has(&[
        "limiting requests or requires a browser verification",
        "rate limit or browser verification",
    ]) {
        "rate-limited-or-verification"
    } else if has(&["browser verification", "not a bot"]) {
        "browser-verification"
    } else if has(&["rate limit", "too many requests", "limiting requests"]) {
        "rate-limited"
    } else if has(&["forbidden", "permission denied"]) {
        "forbidden"
    } else if has(&["4xx client error", "http client error"]) {
        "http-error"
    } else if has(&[
        "unauthorized",
        "authentication",
        "login",
        "credential",
        "api key",
        "api-key",
    ]) {
        "authentication"
    } else if has(&[
        "only offers a preview",
        "does not allow playback",
        "not playable",
        "geo-restricted",
        "region restricted",
        "age-restricted",
        "sign in to confirm",
    ]) {
        "content-restricted"
    } else if has(&[
        "invalid uri",
        "valid uri",
        "invalid url",
        "invalid stream",
        "invalid header",
        "invalid request headers",
        "invalid music video id",
        "invalid soundcloud track url",
        "invalid video id",
        "invalid track id",
        "invalid music catalog id",
        "unknown music connector",
    ]) {
        "invalid-source"
    } else if has(&[
        "not installed",
        "executable not found",
        "failed to start",
        "component missing",
    ]) {
        "component-unavailable"
    } else if has(&[
        "invalid data found",
        "unknown format",
        "unrecognized file format",
        "corrupted media",
        "corrupt file",
        "error parsing",
        "failed to recognize file format",
        "could not detect file format",
    ]) {
        "invalid-media-format"
    } else if has(&[
        "unsupported format",
        "no audio",
        "no suitable",
        "no playable stream",
        "did not offer a playable stream",
        "did not return a stream",
    ]) {
        "unsupported-media"
    } else if has(&["5xx server error", "server error"]) {
        "server-error"
    } else if has(&[
        "audio sink",
        "audio output",
        "audio backend",
        "wasapi",
        "cpal",
        "alsa",
        "pulseaudio",
        "device unavailable",
        "sink error",
        "failed to initialize audio output",
        "could not open audio device",
    ]) {
        "audio-output"
    } else if has(&[
        "not found",
        "could not find this track",
        "unavailable",
        "not playable",
        "restricted",
    ]) {
        "unavailable"
    } else if has(&["timed out", "timeout", "deadline"]) {
        "timeout"
    } else if has(&["dns", "resolve host", "name resolution"]) {
        "dns"
    } else if has(&["tls", "certificate", "ssl"]) {
        "tls"
    } else if has(&["cdn", "audio download", "download audio", "audio file"]) {
        "audio-download"
    } else if has(&[
        "connection",
        "network",
        "socket",
        "transport",
        "http",
        "broken pipe",
        "reset by peer",
    ]) {
        "network"
    } else if has(&[
        "failed to load media",
        "loading failed",
        "failed to open",
        "cannot open file",
    ]) {
        "media-load"
    } else if has(&["decode", "decoder", "vorbis", "codec"]) {
        "decoder"
    } else if has(&["panic", "crash", "fatal"]) {
        "process-crash"
    } else {
        "other"
    }
}

pub(super) fn native_spotify_error(level: &str, target: &str, message: &str) {
    let severity = if level == "ERROR" { "error" } else { "warn" };
    // Fixed component names, not arbitrary logging targets.
    let component = if target.starts_with("librespot_core::audio_key") {
        "audio-key"
    } else if target.starts_with("librespot_audio") {
        "audio"
    } else if target.starts_with("librespot_playback") {
        "player"
    } else if target.starts_with("librespot_metadata") {
        "metadata"
    } else if target.starts_with("librespot_core") {
        "core"
    } else {
        "other"
    };
    let category = process_category(message);
    log(format!(
        "librespot-module severity={severity} component={component} category={category}"
    ));
}

pub(super) fn process_output(engine: &'static str, line: &str) {
    let category = process_category(line);
    let lower = line.to_ascii_lowercase();
    if category != "other" || lower.contains("error") || lower.contains("warn") {
        log(format!("{engine} process diagnostic category={category}"));
    }
}

pub(crate) fn enabled() -> bool {
    std::env::var("HARBOR_MUSIC_TRACE").as_deref() == Ok("1")
}

pub(crate) fn configure(app: &tauri::AppHandle) {
    use tauri::Manager;
    if !enabled() {
        return;
    }
    let _ = PATH.set(app.path().app_log_dir().ok().map(|directory| {
        let _ = std::fs::create_dir_all(&directory);
        directory.join("music-trace.log")
    }));
}

/// Bounded in-memory diagnostics; disk output remains opt-in.
pub(crate) fn log(line: impl AsRef<str>) {
    let line = line.as_ref();
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0);
    // Successful polling is noisy and does not help diagnose a failed load.
    if ![
        "module spotify_state ok",
        "module mpv_state ok",
        "module mpv_volume ok",
        "module spotify_volume ok",
        "module mpv_broadcast_status ok",
        "module mpv_meter_set ok",
    ]
    .iter()
    .any(|prefix| line.starts_with(prefix))
    {
        remember(format!("{millis} {}", safe_text(line)));
    }
    let Some(Some(path)) = PATH.get() else {
        return;
    };
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    else {
        return;
    };
    let _ = writeln!(file, "{millis} {}", safe_text(line));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_categories_do_not_expose_raw_text() {
        assert_eq!(
            process_category("audio key failed: secret=abc"),
            "audio-key/decryption"
        );
        assert_eq!(process_category("HTTP 403 forbidden"), "forbidden");
        assert_eq!(
            process_category("fixture is no longer on disk"),
            "missing-file"
        );
        assert_eq!(process_category("HTTP 503"), "server-error");
        assert_eq!(process_category("YouTube rate limit. Wait 120 seconds"), "rate-limited");
        assert_eq!(process_category("YouTube requires browser verification"), "browser-verification");
        assert_eq!(process_category("YouTube is limiting requests or requires a browser verification"), "rate-limited-or-verification");
        assert_eq!(process_category("HTTP error 403"), "forbidden");
        assert_eq!(
            process_category("Server returned 4XX Client Error"),
            "http-error"
        );
        assert_eq!(process_category("track 500123 or port 40300"), "other");
        assert_eq!(process_category("Invalid music video id"), "invalid-source");
        assert_eq!(
            process_category("Invalid SoundCloud track URL"),
            "invalid-source"
        );
        assert_eq!(process_category("Raw(-13)"), "media-load");
        assert_eq!(
            process_category("MPV error -17: Unknown or corrupted media format"),
            "invalid-media-format"
        );
        assert_eq!(process_category("HTTP 504"), "timeout");
        assert_eq!(
            process_category("SoundCloud only offers a preview"),
            "content-restricted"
        );
        assert_eq!(
            process_category("Invalid data found when processing input"),
            "invalid-media-format"
        );
        assert_eq!(source_label(Some("https://private.example/key")), "direct");
        assert_eq!(source_label(Some("youtube")), "youtube");
        assert_eq!(process_category("WASAPI sink error"), "audio-output");
        assert_eq!(process_category("Soloist build expired"), "expired");
        assert_eq!(process_category("connection timed out"), "timeout");
        assert_eq!(process_category("unrecognized private content"), "other");
    }

    #[test]
    fn diagnostic_text_redacts_secrets_and_bounds_output() {
        let value = safe_text("api_key=secret-value password=hunter123 user@example.com");
        assert!(!value.contains("secret-value"));
        assert!(!value.contains("hunter123"));
        assert!(!value.contains("user@example.com"));
        assert_eq!(safe_text(&"word ".repeat(1000)).chars().count(), 1500);
    }
}
