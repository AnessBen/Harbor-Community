import { useEffect, useMemo, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import { resolveTrailerCandidates } from "@/lib/trailer-resolver";
import {
  fetchFirstTrailer,
  prefetchTrailer,
  resolveTrailerQuality,
  trailerSrc,
  type TrailerInfo,
} from "@/lib/trailer";
import { usePageVisible } from "@/lib/visibility";
import { useSettings } from "@/lib/settings";

const DWELL_MS = 2200;
const WARM_MS = 300;

export function useBpTrailer(meta: Meta | null): { src: string | null } {
  const { settings } = useSettings();
  const pageVisible = usePageVisible();
  const id = meta?.id ?? "";
  const type = meta?.type;
  const name = meta?.name ?? "";
  const releaseInfo = meta?.releaseInfo;
  const enabled = Boolean(id) && settings.heroTrailers !== false;
  const quality = resolveTrailerQuality(settings.autoplayTrailerQuality);
  const request = useMemo(
    () => ({ id, type, name, releaseInfo, quality, enabled, tmdbKey: settings.tmdbKey }),
    [id, type, name, releaseInfo, quality, enabled, settings.tmdbKey],
  );
  const [result, setResult] = useState<{ request: typeof request; info: TrailerInfo } | null>(null);

  useEffect(() => {
    if (!request.enabled) return;
    let cancelled = false;
    let dwellElapsed = false;
    let ready: TrailerInfo | null = null;
    let dwellTimer: number | null = null;
    let warmTimer: number | null = null;
    const reveal = () => {
      if (!cancelled && dwellElapsed && ready) setResult({ request, info: ready });
    };
    // The reveal waits for the dwell, while resolution runs underneath it.
    dwellTimer = window.setTimeout(() => {
      dwellElapsed = true;
      reveal();
    }, DWELL_MS);

    // A short settle keeps fast focus changes from starting an extraction.
    const resolve = () => {
      if (!request.type) return;
      const lookup = resolveTrailerCandidates(
        {
          id: request.id,
          type: request.type,
          name: request.name,
          releaseInfo: request.releaseInfo,
        },
        request.tmdbKey,
      );

      lookup
        .then((ids) => {
          if (cancelled || !ids[0]) return;
          prefetchTrailer(ids[0], request.quality);
          return fetchFirstTrailer(ids, request.quality, () => !cancelled).then((info) => {
            if (cancelled || !info) return;
            ready = info;
            reveal();
          });
        })
        .catch(() => {});
    };
    warmTimer = window.setTimeout(resolve, WARM_MS);

    return () => {
      cancelled = true;
      if (dwellTimer != null) window.clearTimeout(dwellTimer);
      if (warmTimer != null) window.clearTimeout(warmTimer);
    };
  }, [request]);

  // A settings/focus change must hide the old trailer on the very first render,
  // before effects run or a previous native request finishes.
  return {
    src: result?.request === request && pageVisible ? trailerSrc(result.info) : null,
  };
}
