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
        super::ACTIVE_MODULE => "music-module",
        super::ACTIVE_STREAM => "stream",
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
        "failure": safe_text(&failure),
        "activeEngine": active,
        "spotifyPreferredEngine": super::spotify::soloist::engine(&app),
        "musicSidecarBuild": cfg!(feature = "music-sidecar"),
        "diskTraceEnabled": enabled(),
        "playback": playback,
        "recentEvents": recent,
    });
    serde_json::to_string_pretty(&report).map_err(|e| e.to_string())
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
    if !line.starts_with("module spotify_state ok") && !line.starts_with("module mpv_state ok") {
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
    let _ = writeln!(file, "{millis} {}", line);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_text_redacts_secrets_and_bounds_output() {
        let value = safe_text("api_key=secret-value password=hunter123 user@example.com");
        assert!(!value.contains("secret-value"));
        assert!(!value.contains("hunter123"));
        assert!(!value.contains("user@example.com"));
        assert_eq!(safe_text(&"word ".repeat(1000)).chars().count(), 1500);
    }
}
