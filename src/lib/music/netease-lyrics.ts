/** Optional NetEase lyrics provider. Unofficial endpoints; review terms before distribution. */
import { safeFetch } from "@/lib/safe-fetch";
import { parseLrc, type LyricLine, type LyricWord } from "./lyrics";
import { backingTrackVersion } from "./source-version";
import type { MusicTrack } from "./types";

export type NetEaseRecording = {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
};
type Song = {
  id?: number;
  name?: string;
  ar?: { name?: string }[];
  al?: { name?: string };
  dt?: number;
};
const BASE = "https://music.163.com";
const MAX_BODY = 512_000;
let retryUntil = 0;
const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();

async function request(path: string, query: Record<string, string>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (Date.now() < retryUntil) throw new Error("NetEase backoff");
  const response = await safeFetch(BASE + path + "?" + new URLSearchParams(query), {
    headers: { Accept: "application/json" },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8_000)])
      : AbortSignal.timeout(8_000),
  });
  if (response.status === 429 || response.status === 403) {
    const retry = response.headers?.get("Retry-After");
    retryUntil =
      Date.now() + Math.max(60_000, retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : 0);
  }
  if (!response.ok) throw new Error("NetEase HTTP " + response.status);
  const body = await response.text();
  if (body.length > MAX_BODY) throw new Error("NetEase response too large");
  const value = JSON.parse(body);
  if (value?.code !== 200) throw new Error("NetEase API rejected request");
  return value;
}

export async function searchNetEase(
  query: string,
  signal?: AbortSignal,
): Promise<NetEaseRecording[]> {
  const value = await request(
    "/api/cloudsearch/pc",
    { s: query, type: "1", limit: "8", offset: "0" },
    signal,
  );
  const rows = Array.isArray(value.result?.songs) ? (value.result.songs as Song[]) : [];
  return rows.flatMap((row) => {
    if (
      !row ||
      !Number.isSafeInteger(row.id) ||
      row.id! <= 0 ||
      typeof row.name !== "string" ||
      typeof row.al?.name !== "string" ||
      typeof row.dt !== "number" ||
      !Number.isFinite(row.dt) ||
      row.dt <= 0 ||
      !Array.isArray(row.ar) ||
      row.ar.some((a) => typeof a?.name !== "string")
    )
      return [];
    return [
      {
        id: row.id!,
        title: row.name,
        artist: row.ar.map((a) => a.name).join(", "),
        album: row.al.name,
        duration: row.dt / 1000,
      },
    ];
  });
}

/** Manual recording approval for the experiment; not a global artist alias. */
export type ReviewedRecording = {
  id: number;
  harborTitle: string;
  harborArtist: string;
  harborAlbum: string;
  providerTitle: string;
  providerArtist: string;
  providerAlbum: string;
};

export function matchesReviewedRecording(
  track: MusicTrack,
  candidate: NetEaseRecording,
  reviewed: ReviewedRecording,
): boolean {
  return (
    !backingTrackVersion(track) &&
    !backingTrackVersion({ title: candidate.title }) &&
    track.mediaKind !== "video" &&
    candidate.id === reviewed.id &&
    !!norm(track.title) &&
    !!norm(track.artist) &&
    !!norm(track.album ?? "") &&
    !!norm(candidate.title) &&
    !!norm(candidate.artist) &&
    !!norm(candidate.album) &&
    norm(track.title) === norm(reviewed.harborTitle) &&
    norm(track.artist) === norm(reviewed.harborArtist) &&
    norm(track.album ?? "") === norm(reviewed.harborAlbum) &&
    norm(candidate.title) === norm(reviewed.providerTitle) &&
    norm(candidate.artist) === norm(reviewed.providerArtist) &&
    norm(candidate.album) === norm(reviewed.providerAlbum) &&
    Number.isFinite(track.durationSeconds) &&
    track.durationSeconds > 0 &&
    Number.isFinite(candidate.duration) &&
    candidate.duration > 0 &&
    Math.abs(track.durationSeconds - candidate.duration) <= 2
  );
}

/** YRC starts are absolute milliseconds, not relative offsets. */
export function parseYrc(raw: string, duration: number): LyricLine[] {
  if (!raw || raw.length > MAX_BODY || !Number.isFinite(duration) || duration <= 0) return [];
  const lines: LyricLine[] = [];
  for (const row of raw.split(/\r?\n/).slice(0, 5000)) {
    const header = /^\[(\d+),(\d+)\]/.exec(row);
    if (!header) continue;
    const at = Number(header[1]) / 1000;
    const end = at + Number(header[2]) / 1000;
    if (at > duration || end > duration + 0.25 || end <= at) continue;
    const body = row.slice(header[0].length);
    const tokens = [...body.matchAll(/\((\d+),(\d+),\d+\)([^]*?)(?=\(\d+,\d+,\d+\)|$)/g)];
    if (!tokens.length || tokens.length > 1000 || tokens[0].index !== 0) continue;
    const words: LyricWord[] = [];
    let previousEnd = at;
    let valid = true;
    for (const token of tokens) {
      const start = Number(token[1]) / 1000;
      const stop = start + Number(token[2]) / 1000;
      if (
        start < previousEnd - 0.005 ||
        stop < start ||
        stop > end + 0.05 ||
        stop > duration + 0.25
      ) {
        valid = false;
        break;
      }
      words.push({ at: start, end: stop, text: token[3] });
      previousEnd = stop;
    }
    if (!valid) continue;
    const text = words.map((w) => w.text).join("");
    if (text.trim()) lines.push({ at, text, words });
  }
  return lines.sort((a, b) => a.at - b.at);
}

export function parseNetEaseLyrics(
  payload: {
    code?: number;
    nolyric?: boolean;
    uncollected?: boolean;
    lrc?: { lyric?: string };
    yrc?: { lyric?: string };
  },
  duration: number,
): LyricLine[] {
  if (
    payload.code !== 200 ||
    payload.nolyric ||
    payload.uncollected ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    return [];
  const raw = payload.lrc?.lyric ?? "";
  if (typeof raw !== "string" || raw.length > MAX_BODY) return [];
  const lrc = parseLrc(raw).filter((line) => line.at <= duration + 0.25);
  const word = parseYrc(typeof payload.yrc?.lyric === "string" ? payload.yrc.lyric : "", duration);
  const compact = (s: string) => norm(s).replace(/\s/g, "");
  const joined = (lines: LyricLine[]) => compact(lines.map((l) => l.text).join(" "));
  const a = joined(lrc),
    b = joined(word);
  if (word.length && (!a || a === b)) return word;
  // Retain the complete line-level payload if YRC is partial or differently segmented.
  return lrc
    .map((line) => {
      const matches = word.filter(
        (w) => Math.abs(w.at - line.at) <= 1.5 && compact(w.text) === compact(line.text),
      );
      return matches.length === 1 && matches[0].words?.length ? { ...matches[0] } : line;
    })
    .sort((a, b) => a.at - b.at);
}

export async function loadReviewedNetEaseLyrics(
  track: MusicTrack,
  candidate: NetEaseRecording,
  reviewed: ReviewedRecording,
  signal?: AbortSignal,
): Promise<LyricLine[]> {
  if (!matchesReviewedRecording(track, candidate, reviewed)) return [];
  const payload = await request(
    "/api/song/lyric/v1",
    { id: String(candidate.id), lv: "-1", kv: "-1", tv: "-1", rv: "-1", yv: "-1" },
    signal,
  );
  return parseNetEaseLyrics(payload, Math.min(track.durationSeconds, candidate.duration));
}

/** A manually corroborated recording, not a global composer/vocalist alias.
 * Both provider IDs and full release metadata were verified in the prototype. */
const MY_STAR: ReviewedRecording = {
  id: 2077790381,
  harborTitle: "My Star",
  harborArtist: "Masayoshi Soken",
  harborAlbum: "FINAL FANTASY XVI Original Soundtrack",
  providerTitle: "My Star",
  providerArtist: "Amanda Achen-Keenan",
  providerAlbum: "FINAL FANTASY XVI Original Soundtrack Ultimate Edition [Limited Edition]",
};
function reviewedTrack(track: MusicTrack): MusicTrack | null {
  const id = track.collectionOrigin?.id ?? track.id;
  const artist = track.collectionOrigin?.artist ?? track.artist;
  if (
    !["spotify:track:76Nqs1GHACm5O7Yue6Bb2y", "F7-bBVIKCnE"].includes(id) ||
    norm(track.title) !== "my star" ||
    norm(track.album ?? "") !== norm(MY_STAR.harborAlbum) ||
    !["masayoshi soken", "\u7956\u5805 \u6b63\u6176"].includes(norm(artist)) ||
    Math.abs(track.durationSeconds - 289) > 2
  )
    return null;
  return { ...track, artist: MY_STAR.harborArtist };
}
const versions =
  /\b(?:live|remix|acoustic|instrumental|karaoke|cover|edit|remaster(?:ed)?|version|slowed|sped\s*up|nightcore|demo|reprise)\b/i;
function songTitle(title: string): string {
  return norm(
    title
      .replace(
        /\s+[-\u2013\u2014]\s+from\s+"[^"]+"\s*(?:music from the video game|soundtrack|original score)?\s*$/i,
        "",
      )
      .replace(/\s*\((?:feat\.?|ft\.?|featuring)\s+[^)]+\)\s*$/i, "")
      .replace(
        /\s*(?:[-\u2013\u2014]\s*|\()(?:(?:music|song|theme) from the original (?:tv series|motion picture)|original (?:tv series|motion picture|video game) soundtrack)\)?\s*$/i,
        "",
      ),
  );
}
const credits = (artist: string) => [
  ...new Set(
    artist
      .split(/\s*(?:[,;/\u3001\uFF0C]|\s+&\s+)\s*/)
      .map(norm)
      .filter(Boolean),
  ),
];
export function matchNetEaseRecording(track: MusicTrack, candidate: NetEaseRecording): boolean {
  if (
    backingTrackVersion(track) ||
    backingTrackVersion({ title: candidate.title }) ||
    track.mediaKind === "video" ||
    (track.collectionOrigin?.title &&
      backingTrackVersion({ title: track.collectionOrigin.title })) ||
    !Number.isFinite(track.durationSeconds) ||
    track.durationSeconds <= 0 ||
    !Number.isFinite(candidate.duration) ||
    candidate.duration <= 0 ||
    Math.abs(track.durationSeconds - candidate.duration) > 2
  )
    return false;
  const reviewed = reviewedTrack(track);
  if (reviewed && !track.version && matchesReviewedRecording(reviewed, candidate, MY_STAR))
    return true;
  const album = norm(track.album ?? ""),
    title = songTitle(track.title);
  if (!title || !album || album !== norm(candidate.album) || title !== songTitle(candidate.title))
    return false;
  if (versions.test(track.title + " " + (track.version ?? "")) || versions.test(candidate.title)) {
    if (norm(track.title) !== norm(candidate.title) || track.version) return false;
  }
  const left = credits(track.collectionOrigin?.artist ?? track.artist),
    right = credits(candidate.artist);
  return (
    left.length > 0 &&
    right.length > 0 &&
    (left.every((a) => right.includes(a)) || right.every((a) => left.includes(a)))
  );
}
export async function loadNetEaseFallback(
  track: MusicTrack,
  signal: AbortSignal,
): Promise<LyricLine[] | null> {
  if (
    signal.aborted ||
    backingTrackVersion(track) ||
    track.mediaKind === "video" ||
    !track.album ||
    !track.durationSeconds ||
    track.connectorId === "local"
  )
    return null;
  const review = reviewedTrack(track);
  const title = review?.title ?? songTitle(track.title);
  const artist = review?.artist ?? track.collectionOrigin?.artist ?? track.artist;
  const queries = [title + " " + artist, title + " " + (artist.split(",")[0]?.trim() || artist)];
  let candidates: NetEaseRecording[] = [];
  for (const query of new Set(queries)) {
    candidates = (await searchNetEase(query, signal)).filter((c) =>
      matchNetEaseRecording(track, c),
    );
    if (candidates.length) break;
  }
  if (!candidates.length) return null;
  const sorted = candidates.sort(
    (a, b) =>
      Math.abs(a.duration - track.durationSeconds) - Math.abs(b.duration - track.durationSeconds),
  );
  const first = sorted[0];
  if (
    sorted.some(
      (c) =>
        norm(c.artist) !== norm(first.artist) ||
        norm(c.album) !== norm(first.album) ||
        Math.abs(c.duration - first.duration) > 0.5,
    )
  )
    return null;
  signal.throwIfAborted();
  const payload = await request(
    "/api/song/lyric/v1",
    { id: String(first.id), lv: "-1", kv: "-1", tv: "-1", rv: "-1", yv: "-1" },
    signal,
  );
  const lines = parseNetEaseLyrics(payload, Math.min(track.durationSeconds, first.duration));
  const sung = lines.filter(
    (l) =>
      l.text.trim() &&
      !/^(?:\u4f5c\u8bcd|\u4f5c\u66f2|\u7f16\u66f2|\u6df7\u97f3|\u5236\u4f5c|\u6b4c\u624b|lyrics by|written by|composer|lyricist|arranger|produced by)\s*[:\uff1a]/i.test(
        l.text,
      ) &&
      !/\u7eaf\u97f3\u4e50|\u7d14\u97f3\u6a02|\u65e0\u6b4c\u8bcd|no lyrics|instrumental only/i.test(
        l.text,
      ),
  );
  return sung.length ? lines : null;
}
