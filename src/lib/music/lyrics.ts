import { safeFetch } from "@/lib/safe-fetch";
import { parse as parseYaml } from "yaml";
import type { MusicTrack } from "./types";

export type LyricWord = { at: number; end?: number; text: string };
export type LyricLine = { at: number; text: string; unsynced?: true; words?: LyricWord[] };

export function hasTimedLyrics(lines: LyricLine[] | null): boolean {
  return !!lines?.some((line) => !line.unsynced && line.text.trim());
}

type LrcRow = {
  instrumental?: unknown;
  trackName?: unknown;
  name?: unknown;
  artistName?: unknown;
  albumName?: unknown;
  hasWordSync?: unknown;
  lyricsfile?: unknown;
  duration?: unknown;
  syncedLyrics?: unknown;
  plainLyrics?: unknown;
};

const API = "https://lrclib.net/api";
const CACHE_MAX = 160;
const CLIENT =
  "Harbor/" +
  (typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev") +
  " (https://github.com/HarborCommunity/Harbor)";
let rateLimitedUntil = 0;
const STAMP = /^\s*\[(\d{1,4}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/;

const CACHE_MISS_TTL_MS = 60_000;
type LyricsRequest = {
  promise: Promise<LyricLine[] | null>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
  expiresAt: number;
};
const cache = new Map<string, LyricsRequest>();

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const seconds = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

function stampSeconds(minutes: string, secs: string, fraction: string | undefined): number {
  const base = Number(minutes) * 60 + Number(secs);
  if (!fraction) return base;
  const digits =
    fraction.length === 1 ? `${fraction}00` : fraction.length === 2 ? `${fraction}0` : fraction;
  return base + Number(digits) / 1000;
}

export function parseLrc(lrc: string): LyricLine[] {
  if (typeof lrc !== "string" || lrc.length === 0) return [];
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    let rest = raw;
    const stamps: number[] = [];
    for (;;) {
      const match = STAMP.exec(rest);
      if (!match) break;
      stamps.push(stampSeconds(match[1], match[2], match[3]));
      rest = rest.slice(match[0].length);
    }
    if (stamps.length === 0) continue;
    const body = rest.trim();
    for (const at of stamps) lines.push({ at, text: body });
  }
  lines.sort((a, b) => a.at - b.at);
  return lines;
}

export function lyricIndexAt(lines: LyricLine[], seconds: number): number {
  if (!Array.isArray(lines) || lines.length === 0 || lines[0].unsynced) return -1;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return -1;
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].at <= seconds) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

function identity(track: MusicTrack): string {
  const source = `${track.connectorId ?? ""}:${track.id ?? ""}`;
  const named = `${track.artist ?? ""}|${track.title ?? ""}|${Math.round(seconds(track.durationSeconds))}`;
  return [
    source,
    named,
    track.album ?? "",
    track.collectionOrigin?.title ?? "",
    track.collectionOrigin?.artist ?? "",
  ]
    .join("|")
    .toLowerCase();
}

async function json(url: string, signal?: AbortSignal): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new Error("Lyrics lookup cancelled");
    if (Date.now() < rateLimitedUntil) throw new LyricsRequestError();
    try {
      const response = await safeFetch(url, {
        headers: { Accept: "application/json", "Lrclib-Client": CLIENT },
        // Skipped tracks should not occupy connections needed for the new song.
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
      });
      if (response.status === 404) return null;
      if (response.status === 429) {
        const retryAfter = response.headers?.get("Retry-After");
        const seconds = retryAfter == null ? NaN : Number(retryAfter);
        const until =
          Number.isFinite(seconds) && seconds >= 0
            ? Date.now() + seconds * 1000
            : retryAfter
              ? Date.parse(retryAfter)
              : NaN;
        rateLimitedUntil = Math.max(
          Date.now(),
          Number.isFinite(until) ? until : Date.now() + 60_000,
        );
        throw new LyricsRequestError();
      }
      if (!response.ok) {
        // Do not turn throttling or permission failures into an immediate retry storm.
        if (response.status < 500) throw new LyricsRequestError();
        throw new Error("Lyrics service unavailable");
      }
      return await response.json();
    } catch (error) {
      if (signal?.aborted || attempt === 1 || error instanceof LyricsRequestError) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return null;
}

class LyricsRequestError extends Error {}

function rowsOf(value: unknown): LrcRow[] {
  if (Array.isArray(value))
    return value.filter((entry) => entry && typeof entry === "object") as LrcRow[];
  if (value && typeof value === "object") return [value as LrcRow];
  return [];
}

function plainLines(value: string): LyricLine[] {
  return value
    .trim()
    .split(/\r?\n/)
    .map((line) => ({
      at: 0,
      text: line.trim(),
      unsynced: true as const,
    }))
    .filter((line, index, all) => line.text || (index > 0 && all[index - 1].text));
}

function milliseconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value / 1000
    : undefined;
}

/** LRCLIB stores word timing in Lyricsfile YAML, not in legacy LRC. */
export function parseLyricsfile(raw: string): LyricLine[] {
  if (!raw || raw.length > 512_000) return [];
  try {
    const doc = parseYaml(raw, { maxAliasCount: 0 }) as {
      lines?: {
        text?: unknown;
        start_ms?: unknown;
        words?: { text?: unknown; start_ms?: unknown; end_ms?: unknown }[];
      }[];
    } | null;
    if (!Array.isArray(doc?.lines)) return [];
    const result: LyricLine[] = [];
    for (const line of doc.lines.slice(0, 5000)) {
      if (!line || typeof line.text !== "string") continue;
      const at = milliseconds(line.start_ms);
      if (at === undefined) continue;
      const words: LyricWord[] = [];
      let last = at;
      let valid = Array.isArray(line.words) && line.words.length <= 1000;
      if (valid)
        for (const word of line.words!) {
          const start = milliseconds(word?.start_ms);
          const end = milliseconds(word?.end_ms);
          if (
            start === undefined ||
            start < last ||
            typeof word?.text !== "string" ||
            (end !== undefined && end < start)
          ) {
            valid = false;
            break;
          }
          words.push({ at: start, text: word.text, ...(end === undefined ? {} : { end }) });
          last = start;
        }
      if (
        valid &&
        words.length &&
        words
          .map((word) => word.text)
          .join("")
          .trim() === line.text.trim()
      )
        result.push({ at, text: line.text, words });
      else result.push({ at, text: line.text });
    }
    return result.sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}

function normalizeMatch(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function aliases(value: string): string[] {
  const raw = value.normalize("NFKC").trim();
  const unmarked = raw.replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  const parts = [...raw.matchAll(/[\(\[\uFF08\u3010]([^\)\]\uFF09\u3011]+)[\)\]\uFF09\u3011]/gu)]
    .map((match) => match[1])
    .filter((part) =>
      /\p{Script=Arabic}|\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Devanagari}/u.test(
        part,
      ),
    );
  return unique([
    raw,
    ...parts,
    unmarked,
    raw.replace(/[\(\[\uFF08\u3010][^\)\]\uFF09\u3011]+[\)\]\uFF09\u3011]/gu, "").trim(),
  ]);
}

function compatible(value: unknown, variants: string[]): boolean {
  const name = text(value);
  return (
    !name ||
    aliases(name).some((candidate) =>
      variants.some((variant) => normalizeMatch(candidate) === normalizeMatch(variant)),
    )
  );
}

/** Credit lists are unordered. Keep intact names for the exact match path,
 * including band names that happen to contain an ampersand or slash. */
function creditParts(artist: string): string[] {
  return unique(
    artist
      .split(
        /\s*(?:[,;/\u3001\uFF0C\u061B]|\s+&\s+|\s+\(?feat\.?\s+|\s+\(?ft\.?\s+|\s+\(?featuring\s+)\s*/i,
      )
      .map((part) => part.replace(/\)\s*$/, "").trim()),
  );
}

function individualCredits(artist: string): string[] {
  const parts = creditParts(artist);
  return parts.length > 1 ? parts : [];
}

/** Accept complete containment in either direction, never just a shared singer
 * between two otherwise different collaborations. All non-exact credit matches
 * must also pass independent recording checks in chooseLyrics. */
function creditSetMatch(requested: string, candidate: string): number {
  const left = [...new Set(creditParts(requested).map(normalizeMatch).filter(Boolean))];
  const right = [...new Set(creditParts(candidate).map(normalizeMatch).filter(Boolean))];
  if (!left.length || !right.length) return 0;
  const leftInRight = left.every((part) => right.includes(part));
  const rightInLeft = right.every((part) => left.includes(part));
  if (leftInRight && rightInLeft) return 2;
  return leftInRight || rightInLeft ? 1 : 0;
}

function chooseLyrics(
  rows: LrcRow[],
  target: number,
  titles: string[],
  artists: string[],
  requestedCredits: string[],
  album: string,
): LyricLine[] | null {
  const artistRank = (row: LrcRow): number => {
    if (compatible(row.artistName, artists)) return 3;
    const name = text(row.artistName);
    if (
      !name ||
      !text(row.trackName ?? row.name) ||
      target <= 0 ||
      seconds(row.duration) <= 0 ||
      Math.abs(seconds(row.duration) - target) > 6
    )
      return 0;
    return Math.max(0, ...requestedCredits.map((credit) => creditSetMatch(credit, name)));
  };
  const matching = rows.filter(
    (row) => compatible(row.trackName ?? row.name, titles) && artistRank(row) > 0,
  );
  const gap = (row: LrcRow) =>
    target && seconds(row.duration) ? Math.abs(seconds(row.duration) - target) : 0;
  const ranked = matching.sort(
    (a, b) =>
      gap(a) - gap(b) ||
      artistRank(b) - artistRank(a) ||
      Number(normalizeMatch(text(b.albumName)) === normalizeMatch(album)) -
        Number(normalizeMatch(text(a.albumName)) === normalizeMatch(album)),
  );
  if (
    !requestedCredits.some((credit) => individualCredits(credit).length) &&
    ranked[0]?.instrumental === true &&
    gap(ranked[0]) <= 2
  )
    return null;
  let plain: LyricLine[] | null = null;
  for (const row of ranked) {
    if (row.instrumental === true) continue;
    if (target && seconds(row.duration) && gap(row) > Math.max(6, target * 0.04)) continue;
    const timed = row.hasWordSync === true ? parseLyricsfile(text(row.lyricsfile)) : [];
    if (timed.some((line) => line.words?.length)) return timed;
    const synced = parseLrc(text(row.syncedLyrics));
    if (synced.some((line) => line.text.trim())) return synced;
    if (timed.some((line) => line.text.trim())) return timed;
    const lines = plainLines(text(row.plainLyrics));
    if (!plain && lines.some((line) => line.text)) plain = lines;
  }
  return plain;
}

/**
 * YouTube titles carry marketing chrome and often repeat the act, and LRCLIB rejects both.
 * "LE SSERAFIM (르세라핌) 'Smart' OFFICIAL MV" has to become "Smart" before it is asked for.
 */
export function lyricTitle(title: string, artist: string): string {
  let value = text(title).normalize("NFKC").trim();
  const lead = text(artist).normalize("NFKC").trim();
  if (
    lead &&
    value.toLowerCase().startsWith(lead.toLowerCase()) &&
    /^[\s\-\u2013\u2014:|(\["'\u201c\u2018]/u.test(value.slice(lead.length, lead.length + 1))
  ) {
    value = value.slice(lead.length);
  }
  const cleaned = value
    .replace(
      /[\(\[]\s*(?:official[^\)\]]*|lyrics?[^\)\]]*|visuali[sz]er[^\)\]]*|audio|video|m\/v|mv)\s*[\)\]]/gi,
      " ",
    )
    .replace(
      /\b(?:official(?:\s+music)?(?:\s+(?:video|audio|mv|m\/v))?|lyrics?(?:\s+video)?|visuali[sz]er|m\/v|mv|color\s+coded)\b/gi,
      " ",
    )
    // A performance label describes the take, not the words.
    .replace(
      /[\(\[]\s*(?:slowed|reverb|sped\s*up|remix|live|acoustic|instrumental|karaoke|cover|performance)[^\)\]]*[\)\]]/gi,
      " ",
    )
    // Anything still bracketed is a translation or a reading, not part of the title.
    .replace(/[\(\[]\s*[^\)\]]*[\)\]]/g, " ")
    .replace(/["'“”‘’]/g, " ")
    .replace(/^[\s\-–—:|]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || text(title).trim();
}

async function fetchLyrics(track: MusicTrack, signal?: AbortSignal): Promise<LyricLine[] | null> {
  const artist = text(track.artist).trim();
  const title = lyricTitle(track.title, artist);
  if (!artist || !title) return null;
  const duration = seconds(track.durationSeconds);
  const album = text(track.album).trim();
  const origin = track.collectionOrigin;
  const titles = unique([
    title,
    ...aliases(track.title),
    ...(origin?.title
      ? [lyricTitle(origin.title, origin.artist ?? artist), ...aliases(origin.title)]
      : []),
  ]);
  const artists = unique([...aliases(artist), ...(origin?.artist ? aliases(origin.artist) : [])]);
  const requestedCredits = unique([artist, origin?.artist ?? ""]);
  const individualArtists =
    duration > 0
      ? unique(requestedCredits.flatMap(individualCredits).flatMap(aliases))
          .filter((candidate) => !artists.includes(candidate))
          .slice(0, 4)
      : [];
  const queryFor = (t: string, a: string) =>
    "artist_name=" + encodeURIComponent(a) + "&track_name=" + encodeURIComponent(t);
  const query = queryFor(title, artist);
  const alternateTitle = titles.find(
    (candidate) =>
      candidate !== title &&
      /\p{Script=Arabic}|\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Devanagari}/u.test(
        candidate,
      ) &&
      !candidate.includes("("),
  );
  const alternateArtist = artists.find(
    (candidate) =>
      candidate !== artist &&
      /\p{Script=Arabic}|\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Devanagari}/u.test(
        candidate,
      ) &&
      !candidate.includes("("),
  );
  const attempts = unique([
    album && duration > 0
      ? API +
        "/get?" +
        query +
        "&album_name=" +
        encodeURIComponent(album) +
        "&duration=" +
        Math.round(duration)
      : "",
    duration > 0
      ? API + "/get?" + query + "&duration=" + Math.round(duration)
      : API + "/get?" + query,
    API + "/get?" + query,
    API + "/search?" + query,
    ...individualArtists.map((candidate) => API + "/search?" + queryFor(title, candidate)),
    alternateTitle && alternateArtist
      ? API + "/search?" + queryFor(alternateTitle, alternateArtist)
      : "",
    ...titles
      .filter((candidate) => candidate !== title)
      .slice(0, 3)
      .map((candidate) => API + "/search?" + queryFor(candidate, artist)),
    ...artists
      .filter((candidate) => candidate !== artist)
      .slice(0, 2)
      .map((candidate) => API + "/search?" + queryFor(title, candidate)),
  ]);
  let plain: LyricLine[] | null = null;
  const budget = AbortSignal.timeout(18_000);
  const lookup = signal ? AbortSignal.any([signal, budget]) : budget;
  for (const url of attempts) {
    try {
      const rows = rowsOf(await json(url, lookup));
      const found = chooseLyrics(rows, duration, titles, artists, requestedCredits, album);
      if (hasTimedLyrics(found)) return found;
      if (found && !plain) plain = found;
      if (
        !plain &&
        !individualArtists.length &&
        rows.some(
          (row) =>
            row.instrumental === true &&
            compatible(row.trackName ?? row.name, titles) &&
            compatible(row.artistName, artists) &&
            duration > 0 &&
            seconds(row.duration) > 0 &&
            Math.abs(seconds(row.duration) - duration) <= 2,
        )
      )
        return null;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (plain) return plain;
      throw error;
    }
  }
  return plain;
}

export function loadTrackLyrics(
  track: MusicTrack,
  signal?: AbortSignal,
): Promise<LyricLine[] | null> {
  if (!track || typeof track !== "object" || signal?.aborted) return Promise.resolve(null);
  const key = identity(track);
  let request = cache.get(key);
  if (request && request.expiresAt <= Date.now()) {
    cache.delete(key);
    request = undefined;
  }
  if (!request) {
    const entry: LyricsRequest = {
      promise: Promise.resolve(null),
      controller: new AbortController(),
      consumers: 0,
      settled: false,
      expiresAt: Infinity,
    };
    entry.promise = fetchLyrics(track, entry.controller.signal)
      .then((lines) => {
        // A transient miss must not become a permanent "no lyrics" result.
        if (!lines) entry.expiresAt = Date.now() + CACHE_MISS_TTL_MS;
        return lines;
      })
      .catch(() => {
        // Errors and cancelled requests are not evidence of missing lyrics.
        if (cache.get(key) === entry) cache.delete(key);
        return null;
      })
      .finally(() => {
        entry.settled = true;
      });
    cache.set(key, entry);
    request = entry;
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
  }

  const active = request;
  active.consumers += 1;
  // Callers without an abort signal also own their share of the lookup. A
  // different panel closing must not cancel the request they are awaiting.
  if (!signal) {
    return active.promise.finally(() => {
      active.consumers -= 1;
    });
  }
  return new Promise((resolve) => {
    let finished = false;
    const done = (lines: LyricLine[] | null) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", cancel);
      active.consumers -= 1;
      if (active.consumers === 0 && !active.settled) {
        if (cache.get(key) === active) cache.delete(key);
        active.controller.abort();
      }
      resolve(lines);
    };
    const cancel = () => done(null);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    else void active.promise.then(done);
  });
}
