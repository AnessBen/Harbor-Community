import { useEffect, useRef, useState } from "react";
import { noteOverlayDismiss } from "@/lib/player/overlay-dismiss";
import {
  castVolume,
  type CastDeviceInfo,
  type CastPlanSummary,
  type CastTranscodeStats,
} from "@/lib/cast";
import { isRtl, useT, useUiLanguage } from "@/lib/i18n";
import { CastIcon } from "@/components/player/cast-icon";
import type { CastTrouble } from "./hooks/use-cast-session";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { VideoAudioCastState } from "@/lib/player/video-audio-cast";

export function SpeakerAudioBar({
  device,
  phase,
  error,
  onTogglePlay,
  onStop,
  onReturn,
  anchor,
  onClose,
}: {
  device: CastDeviceInfo;
  anchor: { right: number; bottom: number } | null;
  onClose: () => void;
  phase: VideoAudioCastState["phase"];
  error: string | null;
  onTogglePlay: () => Promise<void>;
  onStop: () => Promise<void>;
  onReturn: () => Promise<void>;
}) {
  const t = useT();
  const dir = isRtl(useUiLanguage()) ? "rtl" : "ltr";
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const dismiss = () => {
      noteOverlayDismiss();
      onClose();
    };
    const pointer = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) dismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismiss();
      }
    };
    document.addEventListener("mousedown", pointer);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", pointer);
      document.removeEventListener("keydown", key, true);
      if (origin?.isConnected && panel.current?.contains(document.activeElement))
        origin.focus({ preventScroll: true });
    };
  }, [onClose]);
  const busy = phase === "connecting" || phase === "stopping";
  return (
    <section
      ref={panel}
      dir={dir}
      role="dialog"
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        right: Math.max(
          16,
          Math.min(window.innerWidth - 336, anchor ? window.innerWidth - anchor.right : 24),
        ),
        bottom: anchor ? window.innerHeight - anchor.bottom + 82 : 100,
      }}
      aria-label={t("video.cast.audioRoute")}
      className="video-speaker-bar pointer-events-auto fixed z-[140] w-80 max-w-[calc(100vw-32px)] rounded-md bg-elevated p-3 text-ink"
    >
      <div className="mb-2 flex items-center justify-between text-xs font-semibold">
        <span>{t("video.cast.audioRoute")}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("Close")}
          className="flex size-8 items-center justify-center rounded-md hover:bg-raised"
        >
          <X size={15} />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center">
          <CastIcon device={device} size={36} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            {busy && <Loader2 size={14} className="shrink-0 animate-spin" />}
            <span className="truncate">{device.name}</span>
          </div>
          <p className="text-[12px] text-ink-muted" role="status">
            {t(
              phase === "connecting"
                ? "music.cast.loading"
                : phase === "stopping"
                  ? "video.cast.stopping"
                  : phase === "error"
                    ? "video.cast.retryReturn"
                    : "video.cast.localPicture",
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={busy || phase === "error"}
          onClick={() => void onTogglePlay()}
          aria-label={phase === "playing" ? t("Pause") : t("Play")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-raised hover:bg-canvas disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {phase === "playing" ? <Pause size={17} /> : <Play size={17} />}
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
        {t("video.cast.speakerHelp")}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-amber-200">
          {t(error)}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={phase === "stopping"}
          onClick={() => void onReturn()}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-raised px-3 text-[12px] font-semibold hover:bg-canvas disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ArrowLeft size={14} className="rtl:rotate-180" />
          {t("video.cast.return")}
        </button>
        <button
          type="button"
          disabled={phase === "stopping"}
          onClick={() => void onStop().catch(() => {})}
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-[12px] text-ink-muted hover:bg-raised disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Square size={12} />
          {t("music.cast.stop")}
        </button>
      </div>
    </section>
  );
}

/** The TV's own volume, for receivers that report it (DLNA, Chromecast). */
function CastVolumeControl() {
  const t = useT();
  const [volume, setVolume] = useState<{ level: number; muted: boolean } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void castVolume()
      .then((v) => {
        if (!cancelled && v.supported) setVolume({ level: v.level, muted: v.muted });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (pending.current) clearTimeout(pending.current);
    };
  }, []);
  if (!volume) return null;
  const change = (level: number, muted = false) => {
    const next = { level: Math.max(0, Math.min(100, level)), muted };
    setVolume(next);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      void castVolume(next.level, next.muted).catch(() => {});
    }, 250);
  };
  return (
    <div className="flex items-center gap-1 rounded-full bg-canvas/60 px-1.5 py-0.5">
      <button
        type="button"
        onClick={() => change(volume.level, !volume.muted)}
        aria-label={volume.muted ? t("Unmute") : t("Mute")}
        className="flex h-6 w-6 items-center justify-center rounded-full text-ink hover:bg-canvas/85"
      >
        {volume.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={2}
        value={volume.muted ? 0 : volume.level}
        aria-label={t("TV volume")}
        onChange={(e) => change(Number(e.target.value))}
        className="h-1 w-20 accent-accent"
      />
      <span className="w-7 text-end font-mono text-[10.5px] tabular-nums text-ink-subtle">
        {volume.muted ? 0 : volume.level}
      </span>
    </div>
  );
}

export function CastSessionBar({
  device,
  playing,
  positionSec,
  durationSec,
  onTogglePlay,
  onStop,
  onSeek,
  transcoding,
  stats,
  summary,
  trouble,
  applying,
  onRestart,
  onOpenSettings,
}: {
  device: CastDeviceInfo;
  playing: boolean;
  positionSec: number;
  durationSec: number;
  onTogglePlay: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onSeek: (sec: number) => void | Promise<void>;
  transcoding?: boolean;
  stats?: CastTranscodeStats | null;
  summary?: CastPlanSummary | null;
  trouble?: CastTrouble;
  applying?: boolean;
  onRestart?: () => void;
  onOpenSettings?: () => void;
}) {
  const t = useT();
  const converting = summary
    ? !["copy", "none"].includes(summary.video) || !summary.audio.includes("original")
    : transcoding;
  const speed = stats?.running && stats.speed > 0 ? stats.speed : null;
  // Below 1× the conversion falls behind the film and the TV ends up waiting for picture.
  const slow = !applying && converting && speed != null && speed < 1;
  const badge = applying
    ? t("Applying…")
    : converting
      ? speed
        ? t("Converting {speed}×", { speed: speed.toFixed(1) })
        : t("Transcoding")
      : summary
        ? t("Direct")
        : null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-6 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
      <div className="flex animate-[cast-bar-in_360ms_var(--ease-out)_both] items-center gap-3 rounded-full border border-edge bg-elevated/95 px-4 py-2.5 shadow-[0_18px_40px_-14px_rgba(0,0,0,0.7)] backdrop-blur-md">
        <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-accent/20 text-accent">
          {playing && !trouble ? (
            <span
              aria-hidden
              className="absolute inset-0 animate-[cast-bar-signal_2.2s_ease-out_infinite] rounded-full ring-1 ring-accent/50"
            />
          ) : null}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
            <path d="M2 12a8 8 0 0 1 8 8" />
            <path d="M2 16a4 4 0 0 1 4 4" />
            <line x1="2" y1="20" x2="2" y2="20" />
          </svg>
        </span>
        <div className="flex flex-col">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
            {t("Casting to")}
          </span>
          <span className="text-[12.5px] font-semibold text-ink">{device.name}</span>
        </div>
        {badge && (
          <span
            title={
              slow
                ? t(
                    "The computer converts slower than the film plays. Turn on the graphics card or lower the quality.",
                  )
                : (summary?.hardware ?? undefined)
            }
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] transition-colors duration-500 ${
              slow ? "bg-rose-400/20 text-rose-100" : "bg-amber-400/15 text-amber-200"
            }`}
          >
            {slow && <AlertTriangle size={10} className="shrink-0" />}
            {applying && <Loader2 size={10} className="animate-spin" />}
            {badge}
            {!applying && summary?.hardware && converting
              ? ` · ${summary.hardware.split(" ")[0]}`
              : ""}
          </span>
        )}
        <div className="ms-2 flex items-center gap-1.5">
          <button
            onClick={() => void onTogglePlay()}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-canvas/60 text-ink transition-[background-color,transform] duration-150 hover:bg-canvas/85 active:scale-90"
            aria-label={playing ? t("Pause") : t("Play")}
          >
            {playing ? (
              <svg
                key="pause"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="animate-[cast-bar-icon_220ms_var(--ease-out)]"
              >
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg
                key="play"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="animate-[cast-bar-icon_220ms_var(--ease-out)]"
              >
                <path d="M7 5v14l12-7z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => void onSeek(Math.max(0, positionSec - 15))}
            className="rounded-full bg-canvas/60 px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-canvas/85"
          >
            {t("−15s")}
          </button>
          <button
            onClick={() =>
              void onSeek(Math.min(durationSec || Number.POSITIVE_INFINITY, positionSec + 15))
            }
            className="rounded-full bg-canvas/60 px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-canvas/85"
          >
            {t("+15s")}
          </button>
          <CastVolumeControl />
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label={t("Cast settings")}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-canvas/60 text-ink transition-colors hover:bg-canvas/85"
            >
              <Settings2 size={14} />
            </button>
          )}
          <button
            onClick={() => void onStop()}
            className="rounded-full bg-rose-400/20 px-3 py-1 text-[11px] font-semibold text-rose-100 transition-colors hover:bg-rose-400/30"
          >
            {t("Stop")}
          </button>
        </div>
      </div>
      {trouble && (
        <div
          role="alert"
          className="flex animate-[cast-bar-in_320ms_var(--ease-out)_both] items-center gap-3 rounded-full border border-amber-300/40 bg-amber-400/15 px-4 py-2 text-[12px] text-amber-50 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] backdrop-blur-md"
        >
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            {trouble === "unreachable"
              ? t("The TV stopped answering. Harbor keeps looking for it.")
              : t("Playback stopped on the TV.")}
          </span>
          {onRestart && (
            <button
              type="button"
              onClick={onRestart}
              className="flex items-center gap-1.5 rounded-full bg-amber-300/30 px-3 py-1 text-[11.5px] font-semibold hover:bg-amber-300/50"
            >
              <RotateCcw size={12} />
              {t("Resume on TV")}
            </button>
          )}
        </div>
      )}
      {stats?.error && !trouble && converting && (
        <div className="max-w-[560px] animate-[cast-bar-in_320ms_var(--ease-out)_both] truncate rounded-full border border-rose-300/30 bg-rose-400/10 px-4 py-1.5 text-[11px] text-rose-100">
          {stats.error}
        </div>
      )}
      <style>{`
        @keyframes cast-bar-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to { opacity: 1; transform: none; }
        }
        @keyframes cast-bar-signal {
          0% { opacity: 0.8; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.7); }
        }
        @keyframes cast-bar-icon {
          from { opacity: 0; transform: scale(0.6) rotate(-12deg); }
          to { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}
