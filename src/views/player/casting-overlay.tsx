import { CastIcon } from "@/components/player/cast-icon";
import type { CastDeviceInfo, CastPlanSummary } from "@/lib/cast";
import { pictureClass } from "@/lib/cast/cast-source";
import { useT } from "@/lib/i18n";
import type { CastTrouble } from "./hooks/use-cast-session";

export function CastingOverlay({
  device,
  title,
  poster,
  playing,
  connecting,
  trouble,
  summary,
}: {
  device: CastDeviceInfo;
  title?: string;
  poster?: string | null;
  playing: boolean;
  connecting?: boolean;
  trouble?: CastTrouble;
  summary?: CastPlanSummary | null;
}) {
  const t = useT();
  // The TV is playing the film right now (not connecting, paused, or in trouble).
  const streaming = playing && !connecting && !trouble;
  const label = connecting
    ? t("Connecting to")
    : trouble === "unreachable"
      ? t("Not responding")
      : trouble === "stopped"
        ? t("Stopped on")
        : playing
          ? t("Casting to")
          : t("Paused on");
  const sent = summary
    ? [
        summary.video === "copy" || summary.video === "none"
          ? null
          : `H.264 ${pictureClass(summary.outputWidth ?? 0, summary.outputHeight)}p`,
        summary.audio,
        summary.tonemap ? "HDR → SDR" : null,
        summary.burnedSubtitles ? t("Subtitles") : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex animate-[harbor-cast-in_240ms_ease-out] items-center justify-center bg-canvas">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-canvas via-canvas to-canvas/95" />
      {poster && (
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage: `url(${poster})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(60px) saturate(1.4)",
          }}
        />
      )}
      <div className="relative z-10 flex flex-col items-center gap-10 px-10 text-center">
        <div className="relative flex h-32 w-32 items-center justify-center">
          {/* The glow breathes while the TV plays, rests while it is paused, and turns red when
              the TV stops answering. */}
          <span
            className={`absolute inset-0 rounded-2xl blur-2xl transition-colors duration-500 ${
              trouble ? "bg-danger/25" : "bg-accent/20"
            }`}
            style={{
              animation:
                streaming || connecting ? "harbor-cast-pulse 2.6s ease-in-out infinite" : undefined,
              opacity: streaming || connecting ? undefined : 0.45,
            }}
          />
          {streaming &&
            [0, 1, 2].map((ring) => (
              <span
                key={ring}
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-[22px] border border-accent/40"
                style={{ animation: `harbor-cast-wave 2.4s ease-out ${ring * 0.8}s infinite both` }}
              />
            ))}
          <span
            className={`relative flex h-32 w-32 items-center justify-center rounded-2xl border bg-elevated/85 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-[border-color,transform] duration-500 ${
              trouble ? "border-danger/50" : "border-edge"
            } ${!playing && !connecting && !trouble ? "scale-[0.97]" : ""}`}
          >
            <CastIcon device={device} size={64} />
          </span>
          {connecting && (
            <span className="absolute -bottom-5 left-1/2 -translate-x-1/2">
              <span className="flex gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-accent"
                  style={{ animation: "harbor-cast-dot 1.2s ease-in-out 0s infinite" }}
                />
                <span
                  className="h-1.5 w-1.5 rounded-full bg-accent"
                  style={{ animation: "harbor-cast-dot 1.2s ease-in-out 0.18s infinite" }}
                />
                <span
                  className="h-1.5 w-1.5 rounded-full bg-accent"
                  style={{ animation: "harbor-cast-dot 1.2s ease-in-out 0.36s infinite" }}
                />
              </span>
            </span>
          )}
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <span
            key={label}
            className={`inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em] ${
              trouble ? "text-danger" : "text-ink-subtle"
            }`}
            style={{ animation: "harbor-cast-rise 320ms var(--ease-out) both" }}
          >
            {streaming && (
              <span aria-hidden className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
              </span>
            )}
            {label}
          </span>
          <span
            className="text-[28px] font-semibold leading-tight text-ink"
            style={{
              fontFamily: "Fraunces, serif",
              animation: "harbor-cast-rise 420ms var(--ease-out) 60ms both",
            }}
          >
            {device.name}
          </span>
          {title && !connecting && (
            <span
              className="mt-3 max-w-[28rem] truncate text-[14px] font-medium text-ink-muted"
              style={{ animation: "harbor-cast-rise 420ms var(--ease-out) 140ms both" }}
            >
              {title}
            </span>
          )}
          {sent && !connecting && (
            <span
              key={sent}
              className="mt-1 max-w-[32rem] truncate text-[11.5px] text-ink-subtle"
              style={{ animation: "harbor-cast-rise 420ms var(--ease-out) 200ms both" }}
            >
              {sent}
            </span>
          )}
        </div>
      </div>
      <style>{`
        @keyframes harbor-cast-pulse {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.08); }
        }
        @keyframes harbor-cast-dot {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
          40% { opacity: 1; transform: scale(1); }
        }
        @keyframes harbor-cast-in {
          from { opacity: 0; transform: scale(0.985); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes harbor-cast-wave {
          0% { opacity: 0.55; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.55); }
        }
        @keyframes harbor-cast-rise {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}
