import { invoke } from "@tauri-apps/api/core";
import { createRequestScheduler } from "@/lib/request-scheduler";
import { meta as fetchMeta, narrowMediaType, type Meta } from "@/lib/cinemeta";
import { readMetadataSettings } from "@/lib/metadata-policy";
import { tmdbIdFromImdb } from "@/lib/providers/tmdb/tmdb-imdb-resolve";
import { tmdbTrailerVideos } from "@/lib/providers/tmdb/tmdb-trailers";
import { effectiveTmdbLanguage } from "@/lib/providers/tmdb/tmdb-client";
import { mergeTrailerCandidates } from "@/lib/trailer-candidates";
import {
  isYoutubeVideoId,
  isNonTrailerTitle,
  rankTrailerSearch,
  trailerMatch,
  preferTrailerEditions,
  type TrailerEdition,
  type TrailerIdentity,
  type TrailerSearchVideo,
} from "@/lib/trailer-matching";

type ResolverOptions = {
  candidateIds?: readonly string[];
  excludedIds?: readonly string[];
  aliases?: readonly string[];
  year?: string;
};
type Cached = { expires: number; promise: Promise<string[]> };
const cache = new Map<string, Cached>();
const searchCache = new Map<string, Cached>();
const searchScheduler = createRequestScheduler({ concurrency: 2 });
const editionScheduler = createRequestScheduler({ concurrency: 2 });
const editionCache = new Map<
  string,
  { expires: number; promise: Promise<TrailerEdition | null> }
>();
const MAX_CACHE = 500;
const SUCCESS_TTL = 30 * 60_000;
const MISS_TTL = 60_000;
const native = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function metaCandidates(meta?: Meta | null): string[] {
  if (!meta) return [];
  return mergeTrailerCandidates(
    meta.trailerStreams?.map((v) => v.ytId ?? ""),
    meta.trailers
      ?.filter((v) => !v.type || /^(trailer|teaser)$/i.test(v.type))
      .map((v) => v.source),
  ).filter(isYoutubeVideoId);
}

async function inspect(id: string): Promise<TrailerSearchVideo | null> {
  try {
    if (native()) return await invoke<TrailerSearchVideo>("inspect_trailer_video", { videoId: id });
    const url = new URL("https://www.youtube.com/oembed");
    url.searchParams.set("url", "https://www.youtube.com/watch?v=" + id);
    url.searchParams.set("format", "json");
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) return null;
    const data = await response.json();
    return { id, title: data.title, channel: data.author_name };
  } catch {
    return null;
  }
}

async function preferEditions(ids: string[]): Promise<string[]> {
  if (!native() || ids.length < 2) return ids;
  // Probe only the first four candidates; bounded work and coalesced across views.
  const editions = await Promise.all(
    ids.slice(0, 4).map((id) => {
      const cached = editionCache.get(id);
      if (cached && cached.expires > Date.now()) return cached.promise;
      const entry = {
        expires: Date.now() + SUCCESS_TTL,
        promise: editionScheduler.schedule(id, () =>
          invoke<TrailerEdition>("probe_trailer_edition", { videoId: id }).catch(() => null),
        ),
      };
      editionCache.set(id, entry);
      while (editionCache.size > MAX_CACHE) editionCache.delete(editionCache.keys().next().value!);
      void entry.promise.then((value) => {
        if (!value || !value.envelope?.length) entry.expires = Date.now() + MISS_TTL;
      });
      return entry.promise;
    }),
  );
  return preferTrailerEditions(
    ids,
    editions.filter((edition): edition is TrailerEdition => !!edition),
  );
}

function search(identity: TrailerIdentity, excluded: ReadonlySet<string>): Promise<string[]> {
  if (!native()) return Promise.resolve([]);
  const media = identity.type === "series" ? "TV series" : "movie";
  const cleanTitle = identity.title.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  // The initial search can be dominated by a related film or newer adaptation.
  // Retry once with promotional terminology, without weakening the matcher.
  const queries = [
    [identity.title, identity.year, media, "official trailer"],
    [cleanTitle, identity.year, identity.type === "series" ? "series promo" : "teaser trailer"],
  ].map((parts) => parts.filter(Boolean).join(" ").slice(0, 300));
  const key = JSON.stringify([identity, [...excluded].sort()]);
  const hit = searchCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const entry: Cached = { expires: Date.now() + SUCCESS_TTL, promise: Promise.resolve([]) };
  entry.promise = searchScheduler
    .schedule(key, async () => {
      for (const query of new Set(queries)) {
        try {
          const videos = await invoke<TrailerSearchVideo[]>("search_trailer_videos", { query });
          const ids = rankTrailerSearch(identity, videos).filter((id) => !excluded.has(id));
          if (ids.length) return ids;
        } catch {
          // A failed search is not evidence that this title has no trailer.
        }
      }
      return [];
    })
    .then((ids) => {
      entry.expires = Date.now() + (ids.length ? SUCCESS_TTL : MISS_TTL);
      return ids;
    });
  searchCache.set(key, entry);
  while (searchCache.size > MAX_CACHE) searchCache.delete(searchCache.keys().next().value!);
  return entry.promise;
}

/** Typed TMDB trailers are scoped to the exact title. Untyped addon IDs
 * require independently verified YouTube metadata. Search only on a miss. */
export function resolveTrailerCandidates(
  meta: Meta,
  tmdbKey: string,
  options: ResolverOptions = {},
): Promise<string[]> {
  if (!meta.id || !meta.name || !["movie", "series", "anime"].includes(meta.type))
    return Promise.resolve([]);
  const identity: TrailerIdentity = {
    title: meta.name,
    aliases: [
      ...new Set(
        [...(meta.alternateTitles ?? []), ...(options.aliases ?? [])].filter(
          (title) => !!title && title !== meta.name,
        ),
      ),
    ].sort(),
    year: options.year ?? (meta.releaseDate ?? meta.releaseInfo)?.match(/(?:19|20)\d{2}/)?.[0],
    type: meta.type === "movie" ? "movie" : "series",
  };
  const policy = readMetadataSettings();
  const seeds = mergeTrailerCandidates(options.candidateIds, metaCandidates(meta)).filter(
    isYoutubeVideoId,
  );
  const excluded = new Set(options.excludedIds ?? []);
  const key = JSON.stringify([
    meta.id,
    identity,
    meta.imdb_id,
    meta.moviedb_id,
    tmdbKey,
    effectiveTmdbLanguage(),
    policy.addonOnlyMetadata,
    policy.metadataSources?.trailers,
    seeds,
    [...excluded],
  ]);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const run = async () => {
    const [full, typed] = await Promise.all([
      fetchMeta(narrowMediaType(meta.type), meta.id).catch(() => null),
      (async () => {
        if (!tmdbKey || policy.addonOnlyMetadata) return [];
        const id = meta.id.startsWith("tmdb:")
          ? meta.id
          : meta.moviedb_id
            ? "tmdb:" + (identity.type === "series" ? "tv:" : "movie:") + meta.moviedb_id
            : await tmdbIdFromImdb(tmdbKey, meta.imdb_id ?? meta.id, identity.type);
        return id ? tmdbTrailerVideos(tmdbKey, id) : [];
      })().catch(() => []),
    ]);
    const trusted = typed
      .filter(
        (video) =>
          isYoutubeVideoId(video.key) &&
          !excluded.has(video.key) &&
          !isNonTrailerTitle(video.name ?? "") &&
          (video.type === "Trailer" || video.type === "Teaser"),
      )
      .map((video) => ({
        id: video.key,
        score: (video.type === "Trailer" ? 100 : 60) + (video.official ? 20 : 0),
      }));
    const trustedIds = new Set(trusted.map((video) => video.id));
    const untyped = mergeTrailerCandidates(seeds, metaCandidates(full))
      .filter((id) => !excluded.has(id) && !trustedIds.has(id))
      .slice(0, 8);
    const verified = (await Promise.all(untyped.map(inspect)))
      .filter((v): v is TrailerSearchVideo => !!v)
      .map((video) => ({ id: video.id, score: trailerMatch(identity, video) }))
      .filter((video) => video.score >= 0);
    const preferAddon = policy.metadataSources?.trailers?.[0]?.startsWith("addon:");
    const ordered = mergeTrailerCandidates(
      (preferAddon ? [...verified, ...trusted] : [...trusted, ...verified])
        .sort((a, b) => b.score - a.score)
        .map((video) => video.id),
    );
    if (ordered.length) return preferEditions(ordered);
    return preferEditions(await search(identity, excluded));
  };
  const entry: Cached = { expires: Date.now() + SUCCESS_TTL, promise: Promise.resolve([]) };
  entry.promise = run()
    .catch(() => [])
    .then((ids) => {
      entry.expires = Date.now() + (ids.length ? SUCCESS_TTL : MISS_TTL);
      return ids;
    });
  cache.set(key, entry);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return entry.promise;
}
