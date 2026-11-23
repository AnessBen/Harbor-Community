import { Check, ChevronDown, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import anilistLogo from "@/assets/anilist.png";
import malLogo from "@/assets/mal.png";
import simklLogo from "@/assets/simkl.png";
import { deleteListEntry, fetchListEntry, saveListEntry } from "@/lib/anilist/mutations";
import { useAnilist } from "@/lib/anilist/provider";
import { resolveAnilistMediaId } from "@/lib/anilist/sync";
import {
  deleteListEntry as deleteMalListEntry,
  fetchListEntry as fetchMalListEntry,
  resolveMalMediaId,
  saveListEntry as saveMalListEntry,
} from "@/lib/mal/mutations";
import { useMal } from "@/lib/mal/provider";
import type { MalListStatus } from "@/lib/mal/types";
import type { MediaListStatus } from "@/lib/anilist/types";
import { resolveSimklTarget } from "@/lib/simkl/ids";
import {
  clearSimklStatus,
  loadSimklStatusMap,
  MOVIE_STATUS_ORDER,
  setSimklStatus,
  SHOW_STATUS_ORDER,
  SIMKL_STATUS_LABELS,
  statusForId,
  type WatchlistStatus,
} from "@/lib/simkl/list-status";
import { useSimkl } from "@/lib/simkl/provider";
import type { SimklTarget } from "@/lib/simkl/types";
import traktLogo from "@/assets/trakt.png";
import publicmetadbLogo from "@/assets/publicmetadb.svg";
import { useTrakt } from "@/lib/trakt/provider";
import { pushWatched } from "@/lib/trakt/history";
import { useT } from "@/lib/i18n";
import { usePmdbWatchlist } from "./add-to-publicmetadb-button";
import { notifyTrackerStatusChanged, useTrackerStatusVersion } from "@/lib/tracker-status-events";

const MAL_LABELS: Record<MalListStatus, string> = {
  watching: "Watching",
  plan_to_watch: "Plan to Watch",
  completed: "Completed",
  on_hold: "On Hold",
  dropped: "Dropped",
};

const MAL_ORDER: MalListStatus[] = [
  "watching",
  "plan_to_watch",
  "completed",
  "on_hold",
  "dropped",
];

const ANILIST_LABELS: Record<MediaListStatus, string> = {
  CURRENT: "Watching",
  PLANNING: "Plan to Watch",
  COMPLETED: "Completed",
  REPEATING: "Rewatching",
  PAUSED: "On Hold",
  DROPPED: "Dropped",
};

const ANILIST_ORDER: MediaListStatus[] = [
  "CURRENT",
  "PLANNING",
  "COMPLETED",
  "REPEATING",
  "PAUSED",
  "DROPPED",
];

function GroupRow({
  logo,
  label,
  open,
  onClick,
}: {
  logo: string;
  label: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-start text-[13px] text-ink transition-colors hover:bg-raised"
    >
      <img src={logo} alt="" className="h-[14px] w-[14px] rounded-[3px] object-contain" />
      <span className="flex-1 truncate">{label}</span>
      <ChevronDown
        size={13}
        className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

function StatusRow({
  label,
  active,
  danger,
  onClick,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex h-8 items-center justify-between gap-2 rounded-lg py-1 ps-9 pe-3 text-start text-[12.5px] transition-colors ${
        danger
          ? "text-ink-muted hover:bg-danger/15 hover:text-danger"
          : active
            ? "text-ink"
            : "text-ink-muted hover:bg-raised hover:text-ink"
      }`}
    >
      <span className="flex items-center gap-2">
        {danger && <Trash2 size={12} />}
        {label}
      </span>
      {active && <Check size={13} className="text-ink" />}
    </button>
  );
}

export function SimklMenuItems({
  harborId,
  type,
  onAction,
}: {
  harborId: string;
  type: "movie" | "series";
  onAction: () => void;
}) {
  const t = useT();
  const { isConnected } = useSimkl();
  const trackerStatusVersion = useTrackerStatusVersion();
  const [target, setTarget] = useState<SimklTarget | null>(null);
  const [status, setStatus] = useState<WatchlistStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    void (async () => {
      const t = await resolveSimklTarget(harborId, type);
      if (cancelled || !t) return;
      setTarget(t);
      const malKey = "ids" in t && t.ids.mal != null ? `mal:${t.ids.mal}` : null;
      try {
        const m = await loadSimklStatusMap();
        if (cancelled) return;
        setStatus(statusForId(m, harborId) ?? (malKey ? statusForId(m, malKey) : null));
        setReady(true);
      } catch {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [harborId, isConnected, type, trackerStatusVersion]);

  if (!isConnected || !target || !ready) return null;
  const order = target.kind === "movie" ? MOVIE_STATUS_ORDER : SHOW_STATUS_ORDER;

  if (status == null) {
    return (
      <GroupRow
        logo={simklLogo}
        label={t("Add to Simkl")}
        open={false}
        onClick={() => {
          void setSimklStatus(target, "plantowatch").catch(() => {});
          onAction();
        }}
      />
    );
  }
  return (
    <>
      <GroupRow
        logo={simklLogo}
        label={`Simkl  ·  ${t(SIMKL_STATUS_LABELS[status])}`}
        open={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <>
          {order.map((s) => (
            <StatusRow
              key={s}
              label={t(SIMKL_STATUS_LABELS[s])}
              active={s === status}
              onClick={() => {
                void setSimklStatus(target, s).catch(() => {});
                onAction();
              }}
            />
          ))}
          <StatusRow
            label={t("Remove from list")}
            danger
            onClick={() => {
              void clearSimklStatus(target).catch(() => {});
              onAction();
            }}
          />
        </>
      )}
    </>
  );
}

/** Keep the MyAnimeList actions reachable when the detail hero moves into overflow. */
export function MalMenuItems({
  harborId,
  onAction,
}: {
  harborId: string;
  onAction: () => void;
}) {
  const t = useT();
  const { isConnected } = useMal();
  const trackerStatusVersion = useTrackerStatusVersion();
  const [malId, setMalId] = useState<number | null>(null);
  const [status, setStatus] = useState<MalListStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setAttempt(0);
    setMalId(null);
    setReady(false);
    setOpen(false);
  }, [harborId]);

  useEffect(() => {
    if (!isConnected) {
      setReady(false);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    void (async () => {
      const id = await resolveMalMediaId(harborId).catch(() => null);
      if (cancelled) return;
      if (id == null) {
        setMalId(null);
        setReady(false);
        if (attempt < 2) timer = window.setTimeout(() => setAttempt((a) => a + 1), 15_000);
        return;
      }
      const info = await fetchMalListEntry(id).catch(() => null);
      if (cancelled) return;
      setMalId(id);
      setStatus(info?.entry?.status ?? null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [harborId, isConnected, attempt, trackerStatusVersion]);

  if (!isConnected || !ready || malId == null) return null;

  const setTo = async (next: MalListStatus) => {
    if (busy) return;
    setBusy(true);
    const previous = status;
    setStatus(next);
    try {
      const saved = await saveMalListEntry({ malId, status: next });
      setStatus(saved.status);
      notifyTrackerStatusChanged();
      onAction();
    } catch {
      setStatus(previous);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const previous = status;
    setStatus(null);
    try {
      if (!(await deleteMalListEntry(malId))) {
        throw new Error("MyAnimeList did not confirm removal.");
      }
      notifyTrackerStatusChanged();
      onAction();
    } catch {
      setStatus(previous);
    } finally {
      setBusy(false);
    }
  };

  if (status == null) {
    return (
      <GroupRow
        logo={malLogo}
        label={t("Add to MAL")}
        open={false}
        onClick={() => void setTo("plan_to_watch")}
      />
    );
  }

  return (
    <>
      <GroupRow
        logo={malLogo}
        label={`MAL · ${t(MAL_LABELS[status])}`}
        open={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open && (
        <>
          {MAL_ORDER.map((entryStatus) => (
            <StatusRow
              key={entryStatus}
              label={t(MAL_LABELS[entryStatus])}
              active={entryStatus === status}
              onClick={() => void setTo(entryStatus)}
            />
          ))}
          <StatusRow
            label={t("Remove from list")}
            danger
            onClick={() => void remove()}
          />
        </>
      )}
    </>
  );
}

export function AnilistMenuItems({
  harborId,
  onAction,
}: {
  harborId: string;
  onAction: () => void;
}) {
  const t = useT();
  const { isConnected } = useAnilist();
  const trackerStatusVersion = useTrackerStatusVersion();
  const [mediaId, setMediaId] = useState<number | null>(null);
  const [entryId, setEntryId] = useState<number | null>(null);
  const [status, setStatus] = useState<MediaListStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setMediaId(null);
    setEntryId(null);
    setStatus(null);
    setReady(false);
    setOpen(false);
    setRetry(0);
  }, [harborId]);

  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    void (async () => {
      const id = await resolveAnilistMediaId(harborId).catch(() => null);
      if (cancelled) return;
      if (id == null) {
        setError("Unable to resolve AniList entry. Retry.");
        return;
      }
      const info = await fetchListEntry(id).catch(() => null);
      if (cancelled) return;
      if (!info) {
        setError("Unable to load AniList status. Retry.");
        return;
      }
      setMediaId(id);
      setEntryId(info.entry?.id ?? null);
      setStatus(info.entry?.status ?? null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [harborId, isConnected, retry, trackerStatusVersion]);

  if (!isConnected) return null;
  if (!ready || mediaId == null) {
    return error ? (
      <button
        role="menuitem"
        type="button"
        onClick={() => setRetry((value) => value + 1)}
        className="flex min-h-9 items-center px-3 text-start text-xs text-ink-muted hover:text-ink"
      >
        {t(error)}
      </button>
    ) : (
      <div role="status" className="flex min-h-9 items-center px-3 text-xs text-ink-muted">
        {t("Loading AniList...")}
      </div>
    );
  }

  const setTo = async (next: MediaListStatus) => {
    if (busy) return;
    const before = status;
    setBusy(true);
    setError(null);
    setStatus(next);
    try {
      const saved = await saveListEntry({ mediaId, status: next });
      setEntryId(saved.id);
      setStatus(saved.status);
      notifyTrackerStatusChanged();
      onAction();
    } catch {
      setStatus(before);
      setError(t("AniList update failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || entryId == null) return;
    const before = status;
    const removedEntryId = entryId;
    setBusy(true);
    setError(null);
    setStatus(null);
    setEntryId(null);
    try {
      if (!(await deleteListEntry(removedEntryId)))
        throw new Error("AniList did not confirm removal.");
      notifyTrackerStatusChanged();
      onAction();
    } catch {
      setStatus(before);
      setEntryId(removedEntryId);
      setError(t("AniList update failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <GroupRow
        logo={anilistLogo}
        label={status == null ? t("Add to AniList") : "AniList · " + t(ANILIST_LABELS[status])}
        open={open}
        onClick={() => {
          if (status == null) void setTo("PLANNING");
          else setOpen((value) => !value);
        }}
      />
      {status != null && open && (
        <>
          {ANILIST_ORDER.map((item) => (
            <StatusRow
              key={item}
              label={t(ANILIST_LABELS[item])}
              active={item === status}
              onClick={() => void setTo(item)}
            />
          ))}
          {entryId != null && (
            <StatusRow
              label={t("Remove from list")}
              danger
              onClick={() => void remove()}
            />
          )}
        </>
      )}
      {error && <p role="alert" className="px-3 py-1 text-xs text-danger">{error}</p>}
    </>
  );
}

export function PmdbMenuItems({
  harborId,
  type,
  onAction,
}: {
  harborId: string;
  type: "movie" | "series";
  onAction: () => void;
}) {
  const t = useT();
  const { isConnected, target, inList, ready, busy, toggle, listName, error } = usePmdbWatchlist(
    harborId,
    type,
  );
  if (!isConnected || !target || !ready) return null;
  return (
    <>
      <button
        role="menuitem"
        title={error ? t(error) : listName}
        disabled={busy}
        onClick={() => {
          void toggle().then((ok) => {
            if (ok) onAction();
          });
        }}
        className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-start text-[13px] text-ink transition-colors hover:bg-raised disabled:opacity-60"
      >
        <img
          src={publicmetadbLogo}
          alt=""
          className="h-[14px] w-[14px] rounded-[3px] object-contain"
        />
        <span className="flex-1 truncate">
          {inList
            ? t("Remove from {list} on PMDB", { list: listName })
            : t("Add to {list} on PMDB", { list: listName })}
        </span>
        {inList && <Check size={13} className="text-ink" />}
      </button>
      {error && (
        <p role="alert" className="max-w-xs px-3 py-1 text-[12px] text-danger">
          {t(error)}
        </p>
      )}
    </>
  );
}

export function TraktMenuItems({
  harborId,
  type,
  onAction,
}: {
  harborId: string;
  type: "movie" | "series";
  onAction: () => void;
}) {
  const t = useT();
  const { isConnected, resolveTarget } = useTrakt();
  if (!isConnected || type !== "movie") return null;
  const target = resolveTarget(harborId);
  if (!target || target.kind !== "movie") return null;
  return (
    <button
      role="menuitem"
      onClick={() => {
        void pushWatched(target).catch(() => {});
        onAction();
      }}
      className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-start text-[13px] text-ink transition-colors hover:bg-raised"
    >
      <img src={traktLogo} alt="" className="h-[14px] w-[14px] rounded-[3px] object-contain" />
      <span className="flex-1 truncate">{t("Mark watched on Trakt")}</span>
    </button>
  );
}
