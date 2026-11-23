import { useEffect, useMemo, useState } from "react";
import { airedOnly } from "@/lib/aired";
import type { KitsuEpisode } from "@/lib/providers/kitsu";
import { useAnilist } from "@/lib/anilist/provider";
import { fetchListEntry as fetchAnilistEntry } from "@/lib/anilist/mutations";
import { resolveAnilistMediaId } from "@/lib/anilist/sync";
import { useMal } from "@/lib/mal/provider";
import { fetchListEntry as fetchMalEntry, resolveMalMediaId } from "@/lib/mal/mutations";
import { useTrackerStatusVersion } from "@/lib/tracker-status-events";

/** Convert an entry-relative tracker count into only that entry's episode keys.
 * A catalog season can span two distinct native cours, both starting at E1. */
export function watchedKeysForNativeEntry(
  episodes: readonly KitsuEpisode[],
  progress: number,
  completed: boolean,
  total: number | null,
): Set<string> {
  const aired = airedOnly(
    [...episodes].sort(
      (a, b) => (a.seasonNumber ?? 1) - (b.seasonNumber ?? 1) || a.number - b.number,
    ),
    (ep) => ep.airdate,
  );
  const cap = total != null && total > 0 ? Math.min(aired.length, total) : aired.length;
  const count = completed ? cap : Math.max(0, Math.min(progress, cap));
  return new Set(
    aired.slice(0, count).map((ep) => String(ep.seasonNumber ?? 1) + ":" + ep.number),
  );
}

type EntrySets = {
  key: string;
  anilist: ReadonlyMap<string, Set<string>>;
  mal: ReadonlyMap<string, Set<string>>;
};

/**
 * For a multi-cour provider season, load progress for each *verified* native
 * source entry independently. Never apply the selected hero's first-cour
 * watched count to all episodes in the TVDB season.
 */
export function useEntryTrackerWatched(episodes: KitsuEpisode[]): EntrySets {
  const { isConnected: anilistConnected } = useAnilist();
  const { isConnected: malConnected } = useMal();
  const trackerVersion = useTrackerStatusVersion();
  const [snapshot, setSnapshot] = useState<EntrySets | null>(null);

  const groups = useMemo(() => {
    const byId = new Map<string, KitsuEpisode[]>();
    for (const ep of episodes) {
      if (!ep.sourceMetaId) continue;
      const group = byId.get(ep.sourceMetaId) ?? [];
      group.push(ep);
      byId.set(ep.sourceMetaId, group);
    }
    return [...byId].map(([id, rows]) => ({ id, rows }));
  }, [episodes]);

  const key = groups.map(({ id, rows }) =>
    id + "=" + rows.map((ep) =>
      [ep.id, ep.seasonNumber, ep.number, ep.airdate].join(":")
    ).join(",")
  ).join("|");

  useEffect(() => {
    if (groups.length < 2 || (!anilistConnected && !malConnected)) return;
    let cancelled = false;
    void Promise.all(
      groups.map(async ({ id, rows }) => {
        const [anilist, mal] = await Promise.all([
          anilistConnected
            ? resolveAnilistMediaId(id)
              .then((mediaId) => mediaId == null ? null : fetchAnilistEntry(mediaId))
              .then((entry) => entry?.entry
                ? watchedKeysForNativeEntry(
                    rows, entry.entry.progress,
                    entry.entry.status === "COMPLETED", entry.episodes,
                  )
                : null)
              .catch(() => null)
            : Promise.resolve(null),
          malConnected
            ? resolveMalMediaId(id)
              .then((malId) => malId == null ? null : fetchMalEntry(malId))
              .then((entry) => entry?.entry
                ? watchedKeysForNativeEntry(
                    rows, entry.entry.numEpisodesWatched,
                    entry.entry.status === "completed", entry.numEpisodes,
                  )
                : null)
              .catch(() => null)
            : Promise.resolve(null),
        ]);
        return { id, anilist, mal };
      }),
    ).then((results) => {
      if (cancelled) return;
      const anilist = new Map<string, Set<string>>();
      const mal = new Map<string, Set<string>>();
      for (const result of results) {
        if (result.anilist) anilist.set(result.id, result.anilist);
        if (result.mal) mal.set(result.id, result.mal);
      }
      setSnapshot({ key, anilist, mal });
    });
    return () => {
      cancelled = true;
    };
  }, [key, anilistConnected, malConnected, trackerVersion]);

  // Previously selected seasons must not leak their watched state while
  // the selected season's own entries are still loading.
  if (groups.length < 2 || snapshot?.key !== key)
    return { key, anilist: new Map(), mal: new Map() };
  return snapshot;
}
