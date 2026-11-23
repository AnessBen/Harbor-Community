import { Cast, ChevronDown, Loader2, Square, Subtitles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { discoverCastDevices, type CastDeviceInfo } from "@/lib/cast";
import { updateCastPreferences, useCastPreferences } from "@/lib/cast/cast-preferences";
import { isRtl, useT, useUiLanguage } from "@/lib/i18n";
import { CastIcon } from "./cast-icon";
import { CastSettingsPanel, type CastSettingsPanelProps } from "./cast-settings-panel";
import { noteOverlayDismiss } from "@/lib/player/overlay-dismiss";

const FOCUSABLE = "button:not(:disabled), select:not(:disabled), input:not(:disabled)";

export function CastMenu({
  open,
  anchor,
  onClose,
  onPick,
  hasActiveSub,
  burnSubsOnTv,
  setBurnSubsOnTv,
  panel,
  openWithSettings = false,
  activeDevice,
  onStop,
}: {
  open: boolean;
  anchor: { right: number; bottom: number } | null;
  onClose: () => void;
  onPick: (device: CastDeviceInfo) => void;
  hasActiveSub: boolean;
  burnSubsOnTv: boolean;
  setBurnSubsOnTv: (next: boolean) => void;
  /** The cast settings panel; omitted where the menu only picks a device. */
  panel?: CastSettingsPanelProps;
  /** Opened from the session bar's settings button: the settings start unfolded. */
  openWithSettings?: boolean;
  /** The receiver currently playing this film, if any. */
  activeDevice?: CastDeviceInfo | null;
  onStop?: () => void;
}) {
  const t = useT();
  const dir = isRtl(useUiLanguage()) ? "rtl" : "ltr";
  const prefs = useCastPreferences();
  const [devices, setDevices] = useState<CastDeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const expanded = Boolean(panel) && prefs.panelOpen;

  // The menu opens on the device list and the settings unfold only when asked for, either here or
  // with the session bar's settings button. Done before paint so the panel never flashes.
  useLayoutEffect(() => {
    if (open) updateCastPreferences({ panelOpen: openWithSettings });
  }, [open, openWithSettings]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setDevices([]);
    void discoverCastDevices()
      .then((rows) => {
        if (cancelled) return;
        setDevices(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, scanCount]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      noteOverlayDismiss();
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        noteOverlayDismiss();
        onClose();
      }
      if (e.key === "Tab") {
        const items = [...(wrapRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        const target = e.shiftKey ? items.at(-1) : items[0];
        if (
          (e.shiftKey && document.activeElement === items[0]) ||
          (!e.shiftKey && document.activeElement === items.at(-1))
        ) {
          e.preventDefault();
          target?.focus();
        }
      }
    };
    const origin = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() =>
      (
        wrapRef.current?.querySelector<HTMLButtonElement>("[data-cast-device]") ??
        wrapRef.current?.querySelector<HTMLButtonElement>("button")
      )?.focus(),
    );
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      if (origin?.isConnected) origin.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || loading || !devices.length) return;
    wrapRef.current?.querySelector<HTMLButtonElement>("[data-cast-device]")?.focus();
  }, [open, loading, devices]);

  if (!open) return null;

  return (
    <div
      ref={wrapRef}
      dir={dir}
      role="dialog"
      aria-label={t("Cast to TV or speaker")}
      onMouseDown={(e) => e.stopPropagation()}
      className={`animate-menu-pop fixed z-[140] flex max-h-[calc(100vh-120px)] flex-col overflow-y-auto rounded-md bg-elevated p-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] transition-[width] duration-300 ease-[var(--ease-out)] ${
        expanded ? "w-[760px] max-w-[calc(100vw-32px)]" : "w-[340px] max-w-[calc(100vw-32px)]"
      }`}
      style={{
        right: anchor ? Math.max(16, window.innerWidth - anchor.right) : 24,
        bottom: anchor ? window.innerHeight - anchor.bottom + 82 : 150,
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
          <span className="relative flex h-[13px] w-[13px] items-center justify-center">
            {loading ? (
              <span
                aria-hidden
                className="absolute inset-[-4px] animate-ping rounded-full bg-accent/25"
              />
            ) : null}
            <Cast size={13} strokeWidth={2.4} className={loading ? "text-accent" : undefined} />
          </span>
          {t("Cast to TV or speaker")}
        </span>
        <button
          onClick={onClose}
          aria-label={t("Close")}
          className="flex h-6 w-6 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-raised hover:text-ink"
        >
          <X size={13} />
        </button>
      </div>
      {activeDevice && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center">
            <CastIcon device={activeDevice} size={28} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
              {t("Casting to")}
            </span>
            <span className="truncate text-[13px] font-semibold text-ink">{activeDevice.name}</span>
          </span>
          {onStop && (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1.5 rounded-full bg-rose-400/20 px-3 py-1 text-[11px] font-semibold text-rose-100 transition-colors hover:bg-rose-400/30"
            >
              <Square size={10} />
              {t("Stop")}
            </button>
          )}
        </div>
      )}
      {panel ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-edge-soft bg-canvas/40 px-3 py-2">
          <Subtitles
            size={13}
            strokeWidth={2.4}
            className={
              panel.burnSubs && panel.subtitleChoice !== "off" ? "text-accent" : "text-ink-subtle"
            }
          />
          <span className="shrink-0 text-[12px] font-semibold text-ink">
            {t("Subtitles on TV")}
          </span>
          <select
            aria-label={t("Subtitles on TV")}
            value={panel.burnSubs ? panel.subtitleChoice : "off"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "add-file") {
                panel.onAddSubtitleFile();
                return;
              }
              if (v === "off") {
                panel.onBurnSubs(false);
                return;
              }
              panel.onBurnSubs(true);
              panel.onSubtitleChoice(v);
            }}
            className="h-[28px] min-w-0 flex-1 truncate rounded-md border border-edge-soft bg-canvas/60 px-2 text-[12px] text-ink outline-none hover:border-edge focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="auto">{t("Same as the player")}</option>
            <option value="off">{t("Off")}</option>
            {panel.subtitleTracks.map((track, i) => (
              <option key={track.id} value={track.id}>
                {track.title || track.lang || track.label || t("Track {number}", { number: i + 1 })}
              </option>
            ))}
            {panel.subtitleFileName && <option value="file">{panel.subtitleFileName}</option>}
            <option value="add-file">{t("Add subtitle file…")}</option>
          </select>
        </div>
      ) : (
        hasActiveSub && (
          <>
            <button
              type="button"
              role="switch"
              aria-checked={burnSubsOnTv}
              onClick={() => setBurnSubsOnTv(!burnSubsOnTv)}
              className="group mb-2 flex w-full items-start gap-3 rounded-xl border border-edge-soft bg-canvas/40 px-3 py-2.5 text-start transition-colors hover:border-edge hover:bg-canvas/55"
            >
              <span
                className={`mt-0.5 flex h-[18px] w-8 shrink-0 items-center rounded-full px-[3px] transition-colors duration-200 ${
                  burnSubsOnTv ? "bg-accent" : "bg-raised"
                }`}
              >
                <span
                  className={`h-3 w-3 rounded-full bg-canvas shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    burnSubsOnTv ? "translate-x-[14px] rtl:-translate-x-[14px]" : "translate-x-0"
                  }`}
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                  <Subtitles
                    size={12.5}
                    strokeWidth={2.4}
                    className={burnSubsOnTv ? "text-accent" : "text-ink-subtle"}
                  />
                  {t("Burn in subtitles")}
                </span>
                <span className="text-[11px] leading-snug text-ink-subtle">
                  {burnSubsOnTv
                    ? t(
                        "Subtitles are baked into the picture so they always show. Re-encodes the video.",
                      )
                    : t("Subtitles may not appear on the TV.")}
                </span>
              </span>
            </button>
            <div className="mb-2 h-px bg-edge-soft" />
          </>
        )
      )}
      {loading ? (
        <div role="status" className="flex flex-col gap-1">
          <div className="flex items-center gap-2 px-1 pb-1 pt-0.5 text-[12px] text-ink-muted">
            <Loader2 size={12} strokeWidth={2.2} className="animate-spin" />
            {t("Scanning your network…")}
          </div>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              aria-hidden
              className="flex animate-pulse items-center gap-3 rounded-lg px-2.5 py-2"
              style={{ animationDelay: `${row * 150}ms` }}
            >
              <span className="h-8 w-8 shrink-0 rounded-lg bg-canvas/70" />
              <span className="flex flex-1 flex-col gap-1.5">
                <span
                  className="h-2.5 rounded-full bg-canvas/70"
                  style={{ width: `${62 - row * 12}%` }}
                />
                <span className="h-2 w-1/3 rounded-full bg-canvas/50" />
              </span>
            </div>
          ))}
        </div>
      ) : devices.length === 0 ? (
        <div className="flex flex-col gap-2 px-1 py-3">
          <p className="text-[12.5px] text-ink-muted">
            {t(
              "No Chromecast, DLNA, or Roku devices found. Make sure your TV is on, woken up, and on the same Wi-Fi.",
            )}
          </p>
          <button
            onClick={() => setScanCount((c) => c + 1)}
            className="self-start rounded-md border border-edge-soft px-2 py-1 text-[11.5px] font-semibold text-ink-muted transition-colors hover:border-edge hover:text-ink"
          >
            {t("Scan again")}
          </button>
        </div>
      ) : (
        <div className={`grid gap-1 ${expanded ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
          {devices.map((d, index) => {
            const current = activeDevice?.host === d.host && activeDevice?.kind === d.kind;
            return (
              <button
                key={d.id}
                data-cast-device
                onClick={() => onPick(d)}
                style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                className={`group flex animate-row-in items-center gap-3 rounded-lg px-2.5 py-2 text-start outline-none transition-colors hover:bg-canvas/65 focus-visible:ring-2 focus-visible:ring-accent ${
                  current ? "bg-accent/5 ring-1 ring-accent/50" : ""
                }`}
              >
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-canvas/55 p-1 transition-transform duration-200 group-hover:scale-105">
                  <CastIcon device={d} size={28} />
                  {current ? (
                    <span aria-hidden className="absolute -end-0.5 -top-0.5 flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-success ring-2 ring-elevated" />
                    </span>
                  ) : null}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5 truncate text-[13px] font-medium text-ink">
                    <span className="truncate">{d.name}</span>
                    {d.audio_only && (
                      <span className="shrink-0 rounded-md bg-accent/20 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-accent">
                        {t("Audio")}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[11px] text-ink-subtle">
                    {d.audio_only
                      ? t("video.cast.localPicture")
                      : d.kind === "dlna"
                        ? (d.model ?? t("DLNA TV"))
                        : d.model || `${d.host}:${d.port}`}
                  </span>
                </div>
              </button>
            );
          })}
          <button
            onClick={() => setScanCount((c) => c + 1)}
            className="mt-1 self-start justify-self-start rounded-md px-2 py-1 text-[11px] font-medium text-ink-subtle transition-colors hover:bg-raised hover:text-ink"
          >
            {t("Rescan")}
          </button>
        </div>
      )}
      {panel && (
        <div className="mt-2 border-t border-edge-soft pt-2">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => updateCastPreferences({ panelOpen: !prefs.panelOpen })}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-start transition-colors hover:bg-canvas/55"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Cast size={15} strokeWidth={2.3} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[12.5px] font-semibold text-ink">{t("Cast settings")}</span>
              <span className="truncate text-[11px] text-ink-subtle">
                {t("Audio, subtitles, quality and acceleration")}
              </span>
            </span>
            <ChevronDown
              size={15}
              className={`shrink-0 text-ink-subtle transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            />
          </button>
          {expanded && (
            <div className="mt-2 animate-panel-in">
              <CastSettingsPanel {...panel} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
