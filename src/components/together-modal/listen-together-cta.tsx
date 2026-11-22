import { Check, Headphones, Plus } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * The entry point for a listening room, sitting in the watch modal because that is where
 * people already go to get friends into something. Presentational only: it takes what to
 * show and what to do, so it carries no session logic of its own and cannot disturb the
 * watch room it sits beside.
 */
export function ListenTogetherCta({
  room,
  listeners,
  nowPlaying,
  artwork,
  busy,
  onStart,
  onLeave,
  isHost,
  allowGuestQueue,
  onGuestQueueChange,
}: {
  room: string | null;
  listeners: number;
  nowPlaying?: { title: string; artist: string } | null;
  artwork?: string | null;
  busy?: boolean;
  onStart: () => void;
  onLeave: () => void;
  isHost: boolean;
  allowGuestQueue?: boolean;
  onGuestQueueChange: (allowed: boolean) => void;
}) {
  const t = useT();
  const live = !!room;

  return (
    <div className="min-w-0 rounded-xl border border-accent/40 bg-accent/10">
      <div className="flex w-full items-center gap-3 p-2 text-start">
        <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-canvas/60 text-accent ring-1 ring-edge-soft/60">
          {artwork ? (
            <img
              src={artwork}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <Headphones size={18} strokeWidth={2.1} aria-hidden="true" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
            {t("Listen together")}
          </span>
          <span className="truncate text-[13px] font-semibold text-ink">
            {live
              ? nowPlaying?.title || t("Nothing playing yet")
              : t("Play music in sync with friends")}
          </span>
          {live ? (
            <>
              {nowPlaying?.artist && (
                <span className="truncate text-[10.5px] text-ink-subtle" title={nowPlaying.artist}>
                  {nowPlaying.artist}
                </span>
              )}
              <span className="text-[10.5px] text-ink-muted">
                {t("{n} listening", { n: listeners })}
              </span>
            </>
          ) : (
            <span className="truncate text-[10.5px] text-ink-subtle">
              {t("Same relay, separate room from your watch party")}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={live ? onLeave : onStart}
          disabled={!live && busy}
          aria-label={live ? undefined : t("Start sharing")}
          className="me-1 flex h-9 shrink-0 items-center justify-center rounded-full bg-ink px-3 text-canvas transition-transform enabled:hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 motion-reduce:transition-none"
        >
          {live ? (
            t(isHost ? "Stop sharing" : "Leave room")
          ) : (
            <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
          )}
        </button>
      </div>
      {live && isHost && (
        <div className="space-y-1 border-t border-accent/20 px-3 py-2">
          <label className="flex min-h-8 cursor-pointer items-center justify-between gap-3 rounded-md text-xs font-medium text-ink-muted hover:text-ink has-disabled:cursor-not-allowed has-disabled:opacity-60">
            <span>{t("Let listeners add songs to the queue")}</span>
            <input
              type="checkbox"
              className="peer sr-only"
              checked={allowGuestQueue === true}
              disabled={allowGuestQueue === undefined}
              onChange={(event) => onGuestQueueChange(event.target.checked)}
            />
            <span
              aria-hidden="true"
              className="grid size-5 shrink-0 place-items-center rounded-md border border-ink-subtle bg-canvas text-transparent transition-colors peer-checked:border-accent peer-checked:bg-accent peer-checked:text-canvas peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent motion-reduce:transition-none"
            >
              <Check size={14} strokeWidth={3} />
            </span>
          </label>
          {allowGuestQueue === undefined && (
            <p className="text-[11px] text-ink-muted">
              {t("Queue additions are unavailable in this session.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
