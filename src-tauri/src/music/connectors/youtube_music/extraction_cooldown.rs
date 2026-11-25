//! Shared across YouTube audio and video extraction, including speculative work.
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

pub(crate) fn restriction(error: &str) -> Option<&'static str> {
    let e = error.to_ascii_lowercase();
    if e.contains("limiting requests or requires a browser verification")
        || e.contains("rate limit or browser verification")
    {
        Some("YouTube rate limit or browser verification")
    } else if e.contains("http 429")
        || e.contains("http error 429")
        || e.contains("too many requests")
        || e.contains("rate limit")
        || e.contains("limiting requests")
    {
        Some("YouTube rate limit")
    } else if e.contains("not a bot") || e.contains("browser verification") {
        Some("YouTube requires browser verification")
    } else {
        None
    }
}

#[derive(Default)]
struct Cooldown {
    until: Option<Instant>,
    strikes: u32,
    epoch: u64,
    probing: bool,
    reason: Option<&'static str>,
}
#[derive(Clone, Copy)]
struct Attempt {
    epoch: u64,
    probe: bool,
}

impl Cooldown {
    fn message(&self, now: Instant) -> String {
        let seconds = self
            .until
            .map(|t| t.saturating_duration_since(now).as_secs() + 1)
            .unwrap_or(0)
            .max(if self.probing { 5 } else { 1 });
        format!(
            "{}. Wait {seconds} seconds before retrying, or open this track on YouTube.",
            self.reason
                .unwrap_or("YouTube rate limit or browser verification")
        )
    }
    fn begin(&mut self, now: Instant) -> Result<Attempt, String> {
        if self.until.is_some_and(|t| now < t) || self.probing {
            return Err(self.message(now));
        }
        let probe = self.strikes > 0;
        self.probing = probe;
        Ok(Attempt {
            epoch: self.epoch,
            probe,
        })
    }
    fn finish(&mut self, a: Attempt, now: Instant, result: Result<(), Option<&'static str>>) {
        // Late concurrent completions cannot clear or repeatedly extend a restriction.
        if a.epoch != self.epoch {
            return;
        }
        self.probing = false;
        match result {
            Err(Some(reason)) => {
                self.strikes = self.strikes.saturating_add(1);
                let secs = (120_u64 << self.strikes.saturating_sub(1).min(3)).min(900);
                self.until = Some(now + Duration::from_secs(secs));
                self.reason = Some(reason);
                self.epoch = self.epoch.wrapping_add(1);
            }
            Ok(()) if a.probe => {
                self.strikes = 0;
                self.until = None;
                self.reason = None;
                self.epoch = self.epoch.wrapping_add(1);
            }
            Err(None) if a.probe => self.until = Some(now + Duration::from_secs(60)),
            _ => {}
        }
    }
}
static STATE: LazyLock<Mutex<Cooldown>> = LazyLock::new(|| Mutex::new(Cooldown::default()));

pub(crate) fn prewarm_blocked() -> Option<String> {
    let s = STATE.lock().ok()?;
    if s.strikes == 0 {
        return None;
    }
    let now = Instant::now();
    if s.until.is_some_and(|t| t > now) || s.probing {
        Some(s.message(now))
    } else {
        Some(format!(
            "{}. Wait 60 seconds; playback must verify recovery before prewarming.",
            s.reason
                .unwrap_or("YouTube rate limit or browser verification")
        ))
    }
}

pub(crate) struct Extraction {
    attempt: Attempt,
    finished: bool,
}
impl Extraction {
    pub(crate) fn begin() -> Result<Self, String> {
        let attempt = STATE
            .lock()
            .map_err(|_| "YouTube extraction unavailable".to_string())?
            .begin(Instant::now())?;
        Ok(Self {
            attempt,
            finished: false,
        })
    }
    /// Do not start an account-specific fallback if another extraction has
    /// observed a restriction in the meantime.
    pub(crate) fn check_followup(&self) -> Result<(), String> {
        let state = STATE
            .lock()
            .map_err(|_| "YouTube extraction unavailable".to_string())?;
        if state.epoch != self.attempt.epoch && state.strikes > 0 {
            return Err(state.message(Instant::now()));
        }
        Ok(())
    }

    pub(crate) fn finish<T>(mut self, result: Result<T, String>) -> Result<T, String> {
        self.finished = true;
        let kind = result.as_ref().err().and_then(|e| restriction(e));
        if let Ok(mut s) = STATE.lock() {
            s.finish(
                self.attempt,
                Instant::now(),
                result.as_ref().map(|_| ()).map_err(|_| kind),
            );
            if kind.is_some() {
                return Err(s.message(Instant::now()));
            }
        }
        result
    }
}
impl Drop for Extraction {
    fn drop(&mut self) {
        if !self.finished && self.attempt.probe {
            if let Ok(mut s) = STATE.lock() {
                s.finish(self.attempt, Instant::now(), Err(None));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backoff_and_single_recovery_probe() {
        let mut now = Instant::now();
        let mut s = Cooldown::default();
        for seconds in [120, 240, 480, 900, 900] {
            let a = s.begin(now).unwrap();
            s.finish(a, now, Err(Some("YouTube rate limit")));
            assert!(s.begin(now + Duration::from_secs(seconds - 1)).is_err());
            now += Duration::from_secs(seconds);
        }
        let a = s.begin(now).unwrap();
        assert!(a.probe);
        assert!(s.begin(now).is_err());
        s.finish(a, now, Ok(()));
        assert_eq!(s.strikes, 0);
    }
    #[test]
    fn stale_concurrent_completions_do_not_extend_or_clear() {
        let now = Instant::now();
        let mut s = Cooldown::default();
        let a = s.begin(now).unwrap();
        let b = s.begin(now).unwrap();
        let c = s.begin(now).unwrap();
        s.finish(a, now, Err(Some("YouTube rate limit")));
        let until = s.until;
        s.finish(b, now, Ok(()));
        s.finish(c, now, Err(Some("YouTube requires browser verification")));
        assert_eq!(s.until, until);
        assert_eq!(s.strikes, 1);
    }
    #[test]
    fn inconclusive_recovery_does_not_clear_restriction() {
        let now = Instant::now();
        let mut s = Cooldown::default();
        let a = s.begin(now).unwrap();
        s.finish(a, now, Err(Some("YouTube rate limit")));
        let retry = now + Duration::from_secs(120);
        let a = s.begin(retry).unwrap();
        s.finish(a, retry, Err(None));
        assert_eq!(s.strikes, 1);
        assert!(s.begin(retry).is_err());
    }
    #[test]
    fn ordinary_failures_are_not_restrictions() {
        assert!(restriction("HTTP Error 429").is_some());
        assert!(restriction("not a bot").is_some());
        assert!(restriction("HTTP 403").is_none());
        assert!(restriction("Private video").is_none());
        let now = Instant::now();
        let mut s = Cooldown::default();
        let a = s.begin(now).unwrap();
        s.finish(a, now, Err(None));
        assert!(s.begin(now).is_ok());
    }
}
