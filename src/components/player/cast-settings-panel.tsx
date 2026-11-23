import {
  ArrowLeft,
  ArrowRight,
  Captions,
  Cpu,
  Gauge,
  HelpCircle,
  Info,
  LifeBuoy,
  Loader2,
  Minus,
  MonitorPlay,
  Plus,
  RotateCcw,
  Sparkles,
  Tv,
  Volume2,
} from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  CastCapabilities,
  CastDeviceInfo,
  CastPlanSummary,
  CastPreview,
  CastTranscodeStats,
} from "@/lib/cast";
import {
  CAST_DELAY_LIMIT_MS,
  DEFAULT_CAST_LOOK,
  castOptionsFor,
  deviceHasOverrides,
  panelDevice,
  resetCastPreferences,
  resetDeviceCastOptions,
  setCastOptions,
  updateCastPreferences,
  useCastPreferences,
  type CastSubtitleLook,
} from "@/lib/cast/cast-preferences";
import { pictureClass } from "@/lib/cast/cast-source";
import { automaticDeviceOptions, automaticStreamFormat } from "@/lib/cast/device-settings";
import { useT } from "@/lib/i18n";
import type { TrackInfo } from "@/lib/player/bridge";
import { languageName } from "@/lib/subtitles/language";
import { Tooltip } from "./transport/tooltip";

/** "auto" follows the player, "off" sends no subtitles, "file" is a picked file, else a track id. */
export type CastSubtitleChoice = string;

export type CastSettingsPanelProps = {
  audioTracks: TrackInfo[];
  subtitleTracks: TrackInfo[];
  audioChoice: string;
  subtitleChoice: CastSubtitleChoice;
  subtitleFileName: string | null;
  burnSubs: boolean;
  onAudioChoice: (choice: string) => void;
  onSubtitleChoice: (choice: CastSubtitleChoice) => void;
  onAddSubtitleFile: () => void;
  onBurnSubs: (on: boolean) => void;
  preview: CastPreview | null;
  previewBusy: boolean;
  caps: CastCapabilities | null;
  device: CastDeviceInfo | null;
  casting: boolean;
  applying: boolean;
  stats: CastTranscodeStats | null;
  /** What the running cast actually does; while casting it replaces the preview. */
  summary?: CastPlanSummary | null;
};

const SIZE_STEPS = [75, 100, 125, 150, 175, 200, 250, 300];
/** Labels without letters (+25%, 2.4×) keep their reading order inside right-to-left text. */
const LETTER = /\p{L}/u;

const KIND_LABEL: Record<string, string> = {
  dlna: "DLNA",
  chromecast: "Chromecast",
  airplay: "AirPlay",
  roku: "Roku",
};

/** The usual speaker layout for a channel count: 6 is 5.1, but 4 is quad 4.0 and 5 is 5.0. */
const CHANNEL_LAYOUTS: Record<number, string> = {
  1: "1.0",
  2: "2.0",
  3: "2.1",
  4: "4.0",
  5: "5.0",
  6: "5.1",
  7: "6.1",
  8: "7.1",
};

export function channelLayout(count: number): string {
  return CHANNEL_LAYOUTS[count] ?? `${count}ch`;
}

function trackName(track: TrackInfo, fallback: string): string {
  const lang = track.lang ? languageName(track.lang) : "";
  const title = track.title && track.title !== track.lang ? track.title : "";
  const base = [lang, title].filter(Boolean).join(" · ") || track.label || fallback;
  const channels = track.channelCount ? ` (${channelLayout(track.channelCount)})` : "";
  return `${base}${track.kind === "audio" ? channels : ""}`;
}

function Help({ text }: { text: string }) {
  return (
    <Tooltip label={text} align="end">
      <span
        tabIndex={0}
        aria-label={text}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-subtle outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
      >
        <HelpCircle size={13} strokeWidth={2.2} />
      </span>
    </Tooltip>
  );
}

/** A titled card holding one group of settings. */
function Section({
  icon,
  title,
  aside,
  children,
  order = 0,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  /** Its place among the cards, so they come in one after another when the panel opens. */
  order?: number;
}) {
  return (
    <section
      className="flex animate-row-in flex-col gap-1 rounded-lg border border-edge-soft bg-surface/60 p-3 transition-colors duration-200 hover:border-edge"
      style={{ animationDelay: `${order * 45}ms` }}
    >
      <header className="mb-1 flex min-h-[24px] items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          {icon}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-ink">{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Row({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  const id = useId();
  return (
    <div className="flex min-h-[30px] items-center gap-2">
      <span id={id} className="w-[96px] shrink-0 text-[12px] leading-tight text-ink-muted">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5" aria-labelledby={id}>
        {children}
      </div>
      {help ? <Help text={help} /> : <span className="w-5 shrink-0" />}
    </div>
  );
}

function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={label}
      disabled={disabled}
      value={String(value)}
      onChange={(e) => {
        const hit = options.find(([v]) => String(v) === e.target.value);
        if (hit) onChange(hit[0]);
      }}
      className="h-[28px] min-w-0 flex-1 truncate rounded-md border border-edge-soft bg-canvas/60 px-2 text-[12px] text-ink outline-none transition-colors hover:border-edge focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
    >
      {options.map(([v, text]) => (
        <option key={String(v)} value={String(v)}>
          {text}
        </option>
      ))}
    </select>
  );
}

/** A row of mutually exclusive choices, for settings with a few short options. */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const selected = options.findIndex(([v]) => v === value);
  // The highlight slides to the chosen option instead of jumping; it follows the option's own
  // size and place, so long translations and right-to-left layouts keep it aligned.
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const option = el.querySelectorAll<HTMLElement>("[role=radio]")[selected];
      setThumb((previous) => {
        if (!option) return null;
        const next = { left: option.offsetLeft, width: option.offsetWidth };
        return previous?.left === next.left && previous.width === next.width ? previous : next;
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // The options themselves too: another language changes their widths, not the row's.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.querySelectorAll<HTMLElement>("[role=radio]").forEach((option) => observer.observe(option));
    return () => observer.disconnect();
  }, [selected, options.length]);
  return (
    <div
      ref={box}
      role="radiogroup"
      aria-label={label}
      className={`relative flex h-[28px] min-w-0 flex-1 rounded-md border border-edge-soft bg-canvas/60 p-0.5 ${disabled ? "opacity-40" : ""}`}
    >
      {thumb ? (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0.5 top-0.5 rounded-[5px] bg-accent-soft ring-1 ring-inset ring-accent/25 transition-[left,width] duration-300 ease-[var(--ease-out)]"
          style={{ left: thumb.left, width: thumb.width }}
        />
      ) : null}
      {options.map(([v, text]) => {
        const on = v === value;
        return (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            title={text}
            onClick={() => onChange(v)}
            className={`relative min-w-0 flex-auto truncate rounded-[5px] px-1.5 text-[11.5px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent ${
              on
                ? `font-semibold text-accent ${thumb ? "" : "bg-accent-soft"}`
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <span dir={LETTER.test(text) ? undefined : "ltr"}>{text}</span>
          </button>
        );
      })}
    </div>
  );
}

/** An on/off switch with its label. */
function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-[28px] min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-start text-[12px] text-ink outline-none transition-colors hover:bg-raised/50 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
    >
      <span className="min-w-0 flex-1 leading-tight">{label}</span>
      <span
        aria-hidden
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors duration-200 ${
          checked ? "bg-accent" : "bg-raised ring-1 ring-inset ring-edge"
        }`}
      >
        <span
          className={`absolute start-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
            checked ? "translate-x-3 rtl:-translate-x-3" : ""
          }`}
        />
      </span>
    </button>
  );
}

/** A pill that turns one effect on or off. */
function Chip({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`h-[26px] min-w-0 truncate rounded-full px-3 text-[11.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
        on
          ? "bg-accent-soft font-semibold text-accent ring-1 ring-inset ring-accent/40"
          : "border border-edge-soft text-ink-muted hover:border-edge hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

/** − value + with a reset, for delays and sizes. */
function Nudge({
  value,
  onDecrease,
  onIncrease,
  onReset,
  label,
  changed,
}: {
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  onReset?: () => void;
  label: string;
  changed: boolean;
}) {
  const t = useT();
  const step =
    "flex h-full w-[26px] items-center justify-center text-ink outline-none transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30";
  return (
    <div className="flex flex-1 items-center gap-1.5">
      <div className="flex h-[28px] items-center overflow-hidden rounded-md border border-edge-soft bg-canvas/60">
        <button type="button" aria-label={`${label} −`} onClick={onDecrease} className={step}>
          <Minus size={12} />
        </button>
        <span
          dir="ltr"
          className={`min-w-[62px] border-x border-edge-soft px-1.5 text-center font-mono text-[12px] tabular-nums ${
            changed ? "text-accent" : "text-ink-muted"
          }`}
        >
          {value}
        </span>
        <button type="button" aria-label={`${label} +`} onClick={onIncrease} className={step}>
          <Plus size={12} />
        </button>
      </div>
      {changed && onReset ? (
        <button
          type="button"
          aria-label={t("Reset sync")}
          title={t("Reset sync")}
          onClick={onReset}
          className="flex h-[24px] w-[24px] items-center justify-center rounded-md text-ink-subtle outline-none hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RotateCcw size={11} />
        </button>
      ) : null}
    </div>
  );
}

function DelayNudge({
  valueMs,
  onChange,
  label,
}: {
  valueMs: number;
  onChange: (ms: number) => void;
  label: string;
}) {
  return (
    <Nudge
      value={`${valueMs > 0 ? "+" : ""}${(valueMs / 1000).toFixed(2)}s`}
      onDecrease={() => onChange(Math.max(-CAST_DELAY_LIMIT_MS, valueMs - 50))}
      onIncrease={() => onChange(Math.min(CAST_DELAY_LIMIT_MS, valueMs + 50))}
      onReset={() => onChange(0)}
      label={label}
      changed={valueMs !== 0}
    />
  );
}

/** A small screen showing the burned-in subtitle with the chosen look. */
function SubtitlePreview({ look, off }: { look: CastSubtitleLook; off: boolean }) {
  const t = useT();
  const fontSize = Math.min(22, Math.max(8, Math.round((10.5 * look.sizePercent) / 100)));
  return (
    <div
      aria-hidden
      className={`relative h-[68px] overflow-hidden rounded-md bg-[radial-gradient(ellipse_at_28%_18%,#3a4a5f_0%,#141a23_58%,#06080b_100%)] ring-1 ring-inset ring-white/10 transition-opacity ${
        off ? "opacity-35" : ""
      }`}
    >
      <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.06] to-transparent" />
      <span
        className="absolute inset-x-2 text-center font-semibold leading-tight transition-all"
        style={{
          bottom: 5 + look.lift / 6,
          fontSize,
          color: look.color,
          textShadow: look.background ? "none" : "0 0 2px #000, 0 0 2px #000, 0 1px 3px #000",
        }}
      >
        <span className={look.background ? "rounded-[3px] bg-black/60 px-1.5 py-px" : ""}>
          {t("Subtitles will look like this on the TV.")}
        </span>
      </span>
    </div>
  );
}

/** Marks the choice the device would make by itself. */
function withAuto<T extends string | number>(
  options: Array<[T, string]>,
  automatic: T | undefined,
  autoLabel: string,
): Array<[T, string]> {
  return options.map(([value, text]) => [
    value,
    value === automatic ? `${text} · ${autoLabel}` : text,
  ]);
}

/** Plain-language account of what the converter does with this film. */
export function describePlan(
  s: CastPlanSummary | null,
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  if (!s) return null;
  // "none": an audio-only source, so there is no picture to describe.
  const video =
    s.video === "none"
      ? null
      : s.video === "copy"
        ? t("Video sent as is")
        : t("Video converted to H.264 {height}p", {
            height: pictureClass(s.outputWidth ?? 0, s.outputHeight),
          });
  const audio = s.audio.includes("original")
    ? t("Audio sent as is")
    : t("Audio as {codec}", { codec: s.audio });
  return { video, audio, from: [s.sourceVideo, s.sourceAudio].filter(Boolean).join(" · ") };
}

function Pill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "accent" }) {
  return (
    <span
      className={`inline-flex h-[20px] max-w-full shrink-0 items-center gap-1 truncate rounded-full px-2 text-[10.5px] font-semibold ${
        tone === "accent"
          ? "bg-accent-soft text-accent"
          : "bg-raised/70 text-ink-muted ring-1 ring-inset ring-edge-soft"
      }`}
    >
      {children}
    </span>
  );
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** The source and what the TV receives, as pills that come in one after another. */
function PlanPills({
  summary,
  plan,
  t,
}: {
  summary: CastPlanSummary;
  plan: NonNullable<ReturnType<typeof describePlan>>;
  t: Translate;
}) {
  const pills: ReactNode[] = [
    summary.sourceVideo ? <Pill>{summary.sourceVideo}</Pill> : null,
    summary.sourceAudio ? <Pill>{summary.sourceAudio}</Pill> : null,
    <ArrowRight size={13} className="shrink-0 text-accent rtl:rotate-180" />,
    plan.video ? <Pill tone="accent">{plan.video}</Pill> : null,
    <Pill tone="accent">{plan.audio}</Pill>,
    summary.tonemap ? <Pill>{t("HDR tone-mapped")}</Pill> : null,
    summary.hardware ? (
      <Pill>
        <Cpu size={10} className="shrink-0" />
        {summary.hardware}
      </Pill>
    ) : null,
  ].filter(Boolean);
  return (
    <>
      {pills.map((pill, i) => (
        <span
          key={i}
          className="inline-flex max-w-full"
          style={{ animation: `cast-pill-in 260ms var(--ease-out) ${i * 35}ms both` }}
        >
          {pill}
        </span>
      ))}
      <style>{`
        @keyframes cast-pill-in {
          from { opacity: 0; transform: translateY(3px) scale(0.96); }
          to { opacity: 1; transform: none; }
        }
      `}</style>
    </>
  );
}

/**
 * How fast the converter runs against the film. Below 1× the TV runs out of picture and waits,
 * so it turns red and says what helps; a full bar is twice real time.
 */
function SpeedMeter({ speed }: { speed: number }) {
  const t = useT();
  const slow = speed < 1;
  return (
    <span
      dir="ltr"
      title={
        slow
          ? t(
              "The computer converts slower than the film plays. Turn on the graphics card or lower the quality.",
            )
          : t("Conversion speed")
      }
      className={`ms-auto inline-flex shrink-0 items-center gap-1.5 font-mono font-semibold tabular-nums transition-colors duration-500 ${
        slow ? "text-danger" : "text-success"
      }`}
    >
      <Gauge size={12} className={slow ? "animate-pulse" : undefined} />
      <span aria-hidden className="relative h-1 w-10 overflow-hidden rounded-full bg-raised">
        <span
          className={`absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-700 ease-[var(--ease-out)] ${
            slow ? "bg-danger" : "bg-success"
          }`}
          style={{ width: `${Math.min(1, speed / 2) * 100}%` }}
        />
        <span className="absolute inset-y-0 left-1/2 w-px bg-ink/40" />
      </span>
      {speed.toFixed(1)}×
    </span>
  );
}

const footerButton =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold text-ink-muted outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent";

export function CastSettingsPanel(props: CastSettingsPanelProps) {
  const t = useT();
  const prefs = useCastPreferences();
  // Device settings belong to the device casting, or the last one cast to; the rest are shared.
  const target = panelDevice(prefs, props.device);
  const o = castOptionsFor(target, prefs);
  const auto = target ? automaticDeviceOptions(target) : undefined;
  const customised = deviceHasOverrides(target, prefs);
  const noDevice = !target;
  const look = prefs.look;
  const [view, setView] = useState<"settings" | "about" | "troubleshoot">("settings");
  const setOption = (patch: Partial<typeof o>) => setCastOptions(target, patch);
  const setLook = (patch: Partial<typeof look>) => updateCastPreferences({ look: patch });
  const autoLabel = t("Auto");
  const autoStream = target ? (automaticStreamFormat(target) === "ts" ? "TS" : "HLS") : null;

  const audioOptions = useMemo<Array<[string, string]>>(
    () => [
      ["auto", t("Same as the player")],
      // Only the film's own tracks: the converter reads them from the source it sends.
      ...props.audioTracks
        .filter((track) => !track.external)
        .map((track, i): [string, string] => [
          track.id,
          trackName(track, t("Track {number}", { number: i + 1 })),
        ]),
    ],
    [props.audioTracks, t],
  );
  const subtitleOptions = useMemo<Array<[string, string]>>(() => {
    const rows: Array<[string, string]> = [
      ["auto", t("Same as the player")],
      ["off", t("Off")],
    ];
    props.subtitleTracks.forEach((track, i) => {
      rows.push([track.id, trackName(track, t("Track {number}", { number: i + 1 }))]);
    });
    if (props.subtitleFileName) rows.push(["file", props.subtitleFileName]);
    rows.push(["add-file", t("Add subtitle file…")]);
    return rows;
  }, [props.subtitleTracks, props.subtitleFileName, t]);

  // A running cast reports what it really does (receiver limits, a swapped stream); the preview
  // only describes the player's own source.
  const summary = props.summary ?? props.preview?.summary ?? null;
  const plan = describePlan(summary, t);
  const hardware =
    props.preview?.hardware ??
    (props.caps?.nvenc
      ? "NVIDIA NVENC"
      : props.caps?.qsv
        ? "Intel Quick Sync"
        : props.caps?.amf
          ? "AMD AMF"
          : props.caps?.videotoolbox
            ? "Apple VideoToolbox"
            : null);
  const live = props.casting && props.stats?.running ? props.stats : null;
  const sizeAt = Math.max(0, SIZE_STEPS.indexOf(look.sizePercent));
  const subtitlesShown = props.burnSubs && props.subtitleChoice !== "off";

  if (view !== "settings") {
    return (
      <div key={view} className="flex animate-panel-in flex-col gap-2.5 text-[12px] text-ink">
        <button
          type="button"
          onClick={() => setView("settings")}
          className={`${footerButton} self-start`}
        >
          <ArrowLeft size={13} className="rtl:rotate-180" />
          {t("Back")}
        </button>
        {view === "about" ? (
          <Section icon={<Info size={13} />} title={t("About this cast")}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-ink-muted">{t("Device")}</dt>
              <dd className="font-semibold">{props.device?.name ?? "—"}</dd>
              <dt className="text-ink-muted">{t("Connection")}</dt>
              <dd className="font-mono text-[11.5px]">
                {props.device
                  ? `${props.device.kind.toUpperCase()} · ${props.device.host}${props.device.port ? `:${props.device.port}` : ""}`
                  : "—"}
              </dd>
              <dt className="text-ink-muted">{t("Device model")}</dt>
              <dd>{props.device?.model ?? "—"}</dd>
              <dt className="text-ink-muted">{t("Source")}</dt>
              <dd>{plan?.from || "—"}</dd>
              <dt className="text-ink-muted">{t("Sent to the TV")}</dt>
              <dd>{plan ? [plan.video, plan.audio].filter(Boolean).join(" · ") : "—"}</dd>
              {summary && summary.video !== "none" && summary.outputWidth > 0 ? (
                <>
                  <dt className="text-ink-muted">{t("Picture")}</dt>
                  <dd>
                    <span dir="ltr" className="font-mono text-[11.5px] tabular-nums">
                      {summary.outputWidth}×{summary.outputHeight}
                    </span>
                  </dd>
                </>
              ) : null}
              <dt className="text-ink-muted">{t("Hardware")}</dt>
              <dd>{hardware ?? t("Processor only")}</dd>
            </dl>
          </Section>
        ) : (
          <Section icon={<LifeBuoy size={13} />} title={t("Troubleshooting")}>
            <div className="flex flex-col gap-2 leading-relaxed text-ink-muted">
              <p>{t("If the TV shows nothing or stops:")}</p>
              <ul className="list-disc ps-5">
                <li>{t("Keep the TV and this computer on the same Wi-Fi or router.")}</li>
                <li>{t("Allow Harbor through the Windows firewall on private networks.")}</li>
                <li>{t("Set Streaming to MPEG-TS for older TVs, or HLS for TV boxes.")}</li>
                <li>{t("Turn on Force conversion if the picture or sound is missing.")}</li>
                <li>{t("Lower the quality to 720p on a slow Wi-Fi.")}</li>
              </ul>
              {props.stats?.error && (
                <p role="alert" className="rounded-md bg-danger/15 px-2 py-1.5 text-ink">
                  {props.stats.error}
                </p>
              )}
              <p className="flex items-center gap-1.5">
                <Cpu size={12} className="shrink-0 text-accent" />
                {props.caps?.available
                  ? t("Converter ready. Hardware: {hardware}", {
                      hardware: hardware ?? t("Processor only"),
                    })
                  : t("ffmpeg was not found, so videos that need converting cannot be cast.")}
              </p>
            </div>
          </Section>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The device these settings are for, and whether they are its automatic ones. */}
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-edge-soft bg-gradient-to-br from-accent-soft via-surface/60 to-surface/30 p-3"
      >
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/30">
          <Tv size={20} />
          {props.casting ? (
            <span className="absolute -end-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success ring-2 ring-elevated" />
            </span>
          ) : null}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {target ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="min-w-0 truncate text-[13.5px] font-bold text-ink">
                {target.name}
              </span>
              <Pill>{KIND_LABEL[target.kind] ?? target.kind.toUpperCase()}</Pill>
              {autoStream ? (
                <Pill>{o.streamFormat === "auto" ? autoStream : o.streamFormat.toUpperCase()}</Pill>
              ) : null}
            </div>
          ) : null}
          <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-muted">
            <Sparkles size={12} className="shrink-0 text-accent" />
            <span className="min-w-0">
              {target
                ? customised
                  ? t("Settings for {device}, with your changes", { device: target.name })
                  : t("Set automatically for {device}", { device: target.name })
                : t("These settings set themselves for the device you pick.")}
            </span>
          </span>
        </div>
        {target && customised ? (
          <button
            type="button"
            onClick={() => resetDeviceCastOptions(target)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-1 text-[11.5px] font-semibold text-accent outline-none ring-1 ring-inset ring-accent/30 transition-colors hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RotateCcw size={12} />
            {t("Back to automatic")}
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Section icon={<Volume2 size={13} />} title={t("Audio")} order={1}>
            <div className="mb-1 flex">
              <Select
                label={t("Audio")}
                value={props.audioChoice}
                options={audioOptions}
                onChange={props.onAudioChoice}
              />
            </div>
            <Row
              label={t("Surround")}
              help={t(
                "Stereo works on every TV. Dolby Digital 5.1 needs a TV or receiver that decodes it.",
              )}
            >
              <Select
                label={t("Surround")}
                value={o.audioMode}
                disabled={noDevice}
                options={withAuto(
                  [
                    ["stereo", t("Stereo downmix")],
                    ["surround", t("Dolby Digital 5.1")],
                    ["original", t("Original (passthrough)")],
                  ],
                  auto?.audioMode,
                  autoLabel,
                )}
                onChange={(audioMode) => setOption({ audioMode })}
              />
            </Row>
            <Row label={t("Volume")} help={t("Raises quiet films on the TV without clipping.")}>
              <Segmented
                label={t("Volume")}
                value={o.volumeBoost}
                options={[
                  [0, t("Normal")],
                  [25, "+25%"],
                  [50, "+50%"],
                  [100, "+100%"],
                ]}
                onChange={(volumeBoost) => setOption({ volumeBoost })}
              />
            </Row>
            <Row label="">
              <Chip
                on={o.nightMode}
                onChange={(nightMode) => setOption({ nightMode })}
                label={t("Night mode")}
              />
              <Chip
                on={o.dialogueBoost}
                onChange={(dialogueBoost) => setOption({ dialogueBoost })}
                label={t("Clear dialogue")}
              />
            </Row>
            <Row label={t("Delay")}>
              <DelayNudge
                valueMs={o.audioDelayMs}
                onChange={(audioDelayMs) => setOption({ audioDelayMs })}
                label={t("Audio delay")}
              />
            </Row>
          </Section>

          <Section icon={<MonitorPlay size={13} />} title={t("Picture")} order={2}>
            <Row
              label={t("Quality")}
              help={t("Higher quality needs a faster Wi-Fi. 4K needs a 4K TV.")}
            >
              <Select
                label={t("Quality")}
                value={o.quality}
                disabled={noDevice}
                options={withAuto(
                  [
                    ["720p", "720p"],
                    ["1080p", "1080p"],
                    ["1080p-hq", t("1080p HQ")],
                    ["4k", "4K"],
                    ["original", t("Original")],
                  ],
                  auto?.quality,
                  autoLabel,
                )}
                onChange={(quality) => setOption({ quality })}
              />
            </Row>
            <Row label={t("Aspect")}>
              <Select
                label={t("Aspect")}
                value={o.aspect}
                disabled={noDevice}
                options={withAuto(
                  [
                    ["default", t("Default")],
                    ["16:9", "16:9"],
                    ["4:3", "4:3"],
                    ["21:9", "21:9"],
                    ["fill", t("Fill screen")],
                  ],
                  auto?.aspect,
                  autoLabel,
                )}
                onChange={(aspect) => setOption({ aspect })}
              />
            </Row>
            <Row label={t("Deinterlace")}>
              <Segmented
                label={t("Deinterlace")}
                value={o.deinterlace}
                options={[
                  ["auto", t("Auto")],
                  ["none", t("None")],
                  ["always", t("Always")],
                ]}
                onChange={(deinterlace) => setOption({ deinterlace })}
              />
            </Row>
            <Row
              label="HDR"
              help={t(
                "Converts HDR and Dolby Vision colours for TVs that would show them washed out.",
              )}
            >
              <Select
                label="HDR"
                value={o.tonemap}
                disabled={noDevice}
                options={withAuto(
                  [
                    ["auto", t("Tone-map to SDR")],
                    ["off", t("Off")],
                  ],
                  auto?.tonemap,
                  autoLabel,
                )}
                onChange={(tonemap) => setOption({ tonemap })}
              />
            </Row>
            <Row
              label="H.265 (HEVC)"
              help={t(
                "Only if your TV plays H.265 itself: the film is sent untouched, HDR included.",
              )}
            >
              <Switch
                checked={o.hevcNative}
                disabled={noDevice}
                onChange={(hevcNative) => setOption({ hevcNative })}
                label={t("Native playback")}
              />
            </Row>
            <Row label="">
              <Switch
                checked={o.forceConversion}
                disabled={noDevice}
                onChange={(forceConversion) => setOption({ forceConversion })}
                label={t("Force conversion")}
              />
            </Row>
          </Section>
        </div>

        <div className="flex flex-col gap-3">
          <Section icon={<Captions size={13} />} title={t("Subtitles")} order={2}>
            <div className="mb-1 flex">
              <Select
                label={t("Subtitles")}
                value={props.subtitleChoice}
                options={subtitleOptions}
                onChange={(choice) =>
                  choice === "add-file" ? props.onAddSubtitleFile() : props.onSubtitleChoice(choice)
                }
              />
            </div>
            <Row label={t("Rendering")} help={t("Burned-in subtitles always show, on any TV.")}>
              <Segmented
                label={t("Rendering")}
                value={props.burnSubs ? "burn" : "off"}
                options={[
                  ["burn", t("Burn in video")],
                  ["off", t("Off")],
                ]}
                onChange={(v) => props.onBurnSubs(v === "burn")}
              />
            </Row>
            <Row
              label={t("Character set")}
              help={t(
                "For subtitle files that show strange symbols. Arabic files are usually Windows-1256.",
              )}
            >
              <Select
                label={t("Character set")}
                value={o.subEncoding}
                options={[
                  ["auto", t("Auto")],
                  ["utf-8", "UTF-8"],
                  ["windows-1256", t("Arabic (Windows-1256)")],
                  ["windows-1252", t("Western (Windows-1252)")],
                  ["windows-1251", t("Cyrillic (Windows-1251)")],
                  ["windows-1253", t("Greek (Windows-1253)")],
                  ["windows-1254", t("Turkish (Windows-1254)")],
                  ["windows-1255", t("Hebrew (Windows-1255)")],
                ]}
                onChange={(subEncoding) => setOption({ subEncoding })}
              />
            </Row>
            <div className="my-1">
              <SubtitlePreview look={look} off={!subtitlesShown} />
            </div>
            <Row label={t("Size")}>
              <Nudge
                value={`${look.sizePercent}%`}
                label={t("Size")}
                changed={look.sizePercent !== DEFAULT_CAST_LOOK.sizePercent}
                onDecrease={() => setLook({ sizePercent: SIZE_STEPS[Math.max(0, sizeAt - 1)] })}
                onIncrease={() =>
                  setLook({ sizePercent: SIZE_STEPS[Math.min(SIZE_STEPS.length - 1, sizeAt + 1)] })
                }
              />
            </Row>
            <Row label={t("Color")}>
              <div
                role="radiogroup"
                aria-label={t("Color")}
                className="flex flex-1 items-center gap-2"
              >
                {(
                  [
                    ["#FFFFFF", t("White")],
                    ["#FFE14D", t("Yellow")],
                    ["#7CFC8A", t("Green")],
                    ["#7FE7FF", t("Cyan")],
                    ["#FFB3D9", t("Pink")],
                  ] as const
                ).map(([hex, name]) => {
                  const on = look.color.toUpperCase() === hex;
                  return (
                    <button
                      key={hex}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={name}
                      title={name}
                      onClick={() => setLook({ color: hex })}
                      style={{ backgroundColor: hex }}
                      className={`h-[18px] w-[18px] shrink-0 rounded-full ring-1 ring-inset ring-black/30 outline-offset-2 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-accent ${
                        on ? "scale-110 outline-2 outline-accent" : ""
                      }`}
                    />
                  );
                })}
                <span className="ms-auto">
                  <Chip
                    on={look.background}
                    onChange={(background) => setLook({ background })}
                    label={t("Background")}
                  />
                </span>
              </div>
            </Row>
            <Row label={t("Position")}>
              <Select
                label={t("Position")}
                value={look.lift}
                options={[
                  [0, t("Bottom edge")],
                  [40, t("Slightly higher")],
                  [90, t("Higher up")],
                ]}
                onChange={(lift) => setLook({ lift })}
              />
            </Row>
            <Row label={t("Delay")}>
              <DelayNudge
                valueMs={o.subDelayMs}
                onChange={(subDelayMs) => setOption({ subDelayMs })}
                label={t("Subtitle delay")}
              />
            </Row>
          </Section>

          <Section
            icon={<Cpu size={13} />}
            title={t("Accelerate")}
            order={3}
            aside={
              <>
                <Pill tone={hardware ? "accent" : "plain"}>{hardware ?? t("Processor only")}</Pill>
                <Help
                  text={
                    hardware
                      ? t("Uses {hardware} so the computer stays cool and the TV starts sooner.", {
                          hardware,
                        })
                      : t("No supported graphics card was found; the processor converts instead.")
                  }
                />
              </>
            }
          >
            <div className="grid grid-cols-1 gap-x-2 sm:grid-cols-3">
              <Switch
                checked={o.hardwareDecoding}
                onChange={(hardwareDecoding) => setOption({ hardwareDecoding })}
                label={t("Decoding")}
              />
              <Switch
                checked={o.hardwareEncoding}
                onChange={(hardwareEncoding) => setOption({ hardwareEncoding })}
                label={t("Encoding")}
              />
              <Switch
                checked={o.fastSeek}
                onChange={(fastSeek) => setOption({ fastSeek })}
                label={t("Scrubbing")}
              />
            </div>
            <Row
              label={t("Streaming")}
              help={t("Auto picks MPEG-TS for DLNA TVs and HLS for everything else.")}
            >
              <Segmented
                label={t("Streaming")}
                value={o.streamFormat}
                disabled={noDevice}
                options={[
                  ["auto", autoStream ? `${autoLabel} · ${autoStream}` : autoLabel],
                  ["ts", "MPEG-TS"],
                  ["hls", "HLS"],
                ]}
                onChange={(streamFormat) => setOption({ streamFormat })}
              />
            </Row>
          </Section>
        </div>
      </div>

      {/* Where the film goes: what it is, what the TV receives, and how fast the conversion runs. */}
      <div
        className="relative flex animate-row-in flex-wrap items-center gap-x-2 gap-y-1.5 overflow-hidden rounded-lg border border-edge-soft bg-canvas/50 px-3 py-2 text-[11px] text-ink-muted"
        style={{ animationDelay: "180ms" }}
      >
        {props.applying ? (
          // An indeterminate bar along the edge while the TV restarts with the new settings.
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-accent/10"
          >
            <span className="absolute inset-y-0 w-1/3 animate-[cast-apply-sweep_1.1s_var(--ease-in-out)_infinite] rounded-full bg-accent" />
          </span>
        ) : null}
        {props.applying || props.previewBusy ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
        ) : null}
        {props.applying ? (
          <span className="font-semibold text-ink">{t("Applying to the TV…")}</span>
        ) : plan && summary ? (
          <span key={plan.video + plan.audio} className="contents">
            <PlanPills summary={summary} plan={plan} t={t} />
          </span>
        ) : (
          <span>
            {props.casting
              ? t("Changes apply to the TV right away.")
              : t("These settings apply when you pick a device.")}
          </span>
        )}
        {live && live.speed > 0 ? <SpeedMeter speed={live.speed} /> : null}
      </div>
      <style>{`
        @keyframes cast-apply-sweep {
          from { left: -33%; }
          to { left: 100%; }
        }
      `}</style>

      <div className="-mt-1 flex flex-wrap items-center justify-end gap-1">
        <button type="button" onClick={() => setView("about")} className={footerButton}>
          <Info size={12} />
          {t("About this cast")}
        </button>
        <button type="button" onClick={() => setView("troubleshoot")} className={footerButton}>
          <LifeBuoy size={12} />
          {t("Troubleshooting")}
        </button>
        <button type="button" onClick={() => resetCastPreferences(target)} className={footerButton}>
          <RotateCcw size={12} />
          {t("Reset")}
        </button>
      </div>
    </div>
  );
}
