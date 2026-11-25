import { safeFetch } from "@/lib/safe-fetch";
import { parse as parseYaml } from "yaml";
import type { MusicTrack } from "./types";
import { backingTrackVersion } from "./source-version";

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

const NATIVE_SCRIPT =
  /\p{Script=Arabic}|\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Devanagari}/u;
const LATIN_SCRIPT = /\p{Script=Latin}/u;
const VERSION_LABEL =
  /\b(?:live|remix|acoustic|instrumental|karaoke|cover|edit|remaster|version|ver\.?|slowed|sped\s*up)\b/i;

/** Only explicit bilingual labels are aliases, never two unrelated Latin words
 * separated by a dash (or a recording/version qualifier). */
function bilingualAliases(value: string): string[] {
  const pair =
    /^(.+?)\s*[\(\[\uFF08\u3010]([^\)\]\uFF09\u3011]+)[\)\]\uFF09\u3011]\s*$/u.exec(value) ??
    /^(.+?)\s+[-\u2013\u2014]\s+(.+)$/u.exec(value);
  if (!pair) return [];
  const [a, b] = [pair[1].trim(), pair[2].trim()];
  const nativeOnly = (s: string) => NATIVE_SCRIPT.test(s) && !LATIN_SCRIPT.test(s);
  const latinOnly = (s: string) => LATIN_SCRIPT.test(s) && !NATIVE_SCRIPT.test(s);
  return !VERSION_LABEL.test(a) &&
    !VERSION_LABEL.test(b) &&
    ((nativeOnly(a) && latinOnly(b)) || (latinOnly(a) && nativeOnly(b)))
    ? [a, b]
    : [];
}

/** Soundtrack release labels are not recording versions. Only remove an
 * explicit, delimited soundtrack descriptor, never an arbitrary subtitle. */
function soundtrackTitle(value: string): { base: string; role: string } | null {
  const raw = value.normalize("NFKC").trim();
  const pair =
    /^(.+?)\s*(?:\s+[-\u2013\u2014]\s+|\|)\s*(.+)$/u.exec(raw) ??
    /^(.+?)\s*[\(\[]([^\)\]]+)[\)\]]$/u.exec(raw);
  if (!pair) return null;
  const base = pair[1].trim();
  const descriptor = normalizeMatch(pair[2]);
  // Keep explicit alternative recordings out of the soundtrack alias path.
  if (!base || VERSION_LABEL.test(base) || VERSION_LABEL.test(descriptor)) return null;
  const release =
    /^(?:(?:music|song|theme) from (?:the )?(?:original )?(?:(?:tv|television) (?:series|show)|(?:motion picture|film|movie))|(?:original )?(?:(?:tv|television) (?:series|show)|motion picture|film|movie) soundtrack|original soundtrack)$/i;
  if (release.test(descriptor)) return { base, role: "" };
  if (/^opening (?:theme|credits)$/i.test(descriptor)) return { base, role: "opening" };
  if (/^(?:ending|closing) (?:theme|credits)$/i.test(descriptor)) return { base, role: "ending" };
  // Arabic opening/closing credits may include the name of the TV series.
  const arabic =
    /^\u062a\u062a\u0631 (\u0627\u0644\u0628\u062f\u0627\u064a\u0629|\u0627\u0644\u0646\u0647\u0627\u064a\u0629)(?: \u0645\u0633\u0644\u0633\u0644 .+)?$/u.exec(
      descriptor,
    );
  if (arabic)
    return {
      base,
      role: arabic[1] === "\u0627\u0644\u0628\u062f\u0627\u064a\u0629" ? "opening" : "ending",
    };
  return null;
}

function soundtrackBase(value: string): string {
  return normalizeMatch(soundtrackTitle(value)?.base ?? value);
}

function soundtrackAliasMatch(
  row: LrcRow,
  originals: string[],
  artists: string[],
  duration: number,
  album: string,
): boolean {
  const name = text(row.trackName ?? row.name);
  const artist = text(row.artistName);
  const time = seconds(row.duration);
  if (!name || !artist || !time || !duration || Math.abs(time - duration) > 3) return false;
  if (!compatible(artist, artists)) return false;
  const candidateAlbum = text(row.albumName);
  // If both providers identify the release, require the same release after
  // removing explicit soundtrack labels, not merely similar album names.
  if (album && candidateAlbum && soundtrackBase(album) !== soundtrackBase(candidateAlbum))
    return false;
  const candidate = soundtrackTitle(name);
  return originals.some((original) => {
    const source = soundtrackTitle(original);
    if (!source && !candidate) return false;
    if (source?.role && candidate?.role && source.role !== candidate.role) return false;
    const left = soundtrackBase(original);
    const right = soundtrackBase(name);
    return !!left && left === right;
  });
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
    ...bilingualAliases(raw),
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

/** A fuzzy match is only attempted with explicit metadata and a close duration.
 * Compact forms allow word-boundary differences; vowel changes are common in
 * Latin transliterations, but require independent album corroboration. */
function compact(value: string): string {
  return normalizeMatch(value).replace(/\s+/g, "");
}

function latinSkeleton(value: string): string {
  return /^[a-z]+$/.test(value) ? value.replace(/[aeiou]/g, "") : "";
}

function withinEdits(left: string, right: string, limit: number): boolean {
  if (Math.abs(left.length - right.length) > limit || left.length > 160 || right.length > 160)
    return false;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + Number(left[i - 1] !== right[j - 1]),
      );
    }
    previous = current;
  }
  return previous[right.length] <= limit;
}

/** Compare a complete Arabic credit with a Latin romanization, not merely a
 * shared surname. Long vowels and doubled consonants vary across romanizations.
 * This is deliberately not a general-purpose translator. */
const ARABIC_CONSONANTS: Record<string, string> = {
  "\u0627": "",
  "\u0623": "",
  "\u0625": "",
  "\u0622": "",
  "\u0671": "",
  "\u0628": "b",
  "\u062a": "t",
  "\u062b": "th",
  "\u062c": "j",
  "\u062d": "h",
  "\u062e": "kh",
  "\u062f": "d",
  "\u0630": "dh",
  "\u0631": "r",
  "\u0632": "z",
  "\u0633": "s",
  "\u0634": "sh",
  "\u0635": "s",
  "\u0636": "d",
  "\u0637": "t",
  "\u0638": "z",
  "\u0639": "",
  "\u063a": "gh",
  "\u0641": "f",
  "\u0642": "q",
  "\u0643": "k",
  "\u0644": "l",
  "\u0645": "m",
  "\u0646": "n",
  "\u0647": "h",
  "\u0648": "",
  "\u064a": "",
  "\u0649": "",
  "\u0629": "t",
  "\u0621": "",
  "\u0624": "",
  "\u0626": "",
  "\u067e": "p",
  "\u0686": "ch",
  "\u06a9": "k",
  "\u06af": "g",
  "\u06cc": "",
};

function arabicCreditKey(value: string): string {
  const normalized = normalizeMatch(value);
  if (!normalized) return "";
  let key = "";
  if (/\p{Script=Arabic}/u.test(normalized)) {
    if (!/^[\p{Script=Arabic}\s]+$/u.test(normalized)) return "";
    for (const ch of normalized) {
      if (ch === " ") continue;
      if (!(ch in ARABIC_CONSONANTS)) return "";
      key += ARABIC_CONSONANTS[ch];
    }
  } else {
    if (!/^[a-z ]+$/.test(normalized)) return "";
    key = normalized.replace(/[aeiouyw ]/g, "");
  }
  return key.replace(/(.)\1+/g, "$1");
}

function sameArabicRomanization(a: string, b: string): boolean {
  const nativeA = /\p{Script=Arabic}/u.test(a);
  if (nativeA === /\p{Script=Arabic}/u.test(b)) return false;
  const left = arabicCreditKey(a);
  const right = arabicCreditKey(b);
  if (left.length < 6 || left !== right) return false;
  // A consonant skeleton alone confuses, for example, names with different
  // long vowels. Require written ya/waw to have corresponding vowel evidence
  // in the romanization, instead of treating them as completely interchangeable.
  const native = normalizeMatch(nativeA ? a : b).replace(/\s+/g, "");
  const latin = normalizeMatch(nativeA ? b : a)
    .replace(/\s+/g, "")
    .replace(/([b-df-hj-np-tv-z])\1+/g, "$1");
  const vowel = "[aeiouyw]*";
  let pattern = "^" + vowel;
  let previous = "";
  for (const ch of native) {
    if (ch === "\u064a" || ch === "\u0649" || ch === "\u06cc") {
      pattern += "[iey]" + vowel;
      previous = "";
    } else if (ch === "\u0648") {
      pattern += "[ouw]" + vowel;
      previous = "";
    } else {
      const consonant = ARABIC_CONSONANTS[ch];
      if (consonant && consonant !== previous) pattern += consonant + vowel;
      if (consonant) previous = consonant;
    }
  }
  return new RegExp(pattern + "$").test(latin);
}

function albumCorroborates(left: string, right: string): boolean {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return false;
  if (a === b || sameArabicRomanization(left, right)) return true;
  const x = latinSkeleton(a);
  const y = latinSkeleton(b);
  // Longer album names can tolerate small transliteration differences (including
  // a missing h), but not arbitrary similarly spelled or unrelated albums.
  return (
    Math.min(x.length, y.length) >= 6 &&
    withinEdits(x, y, 1) &&
    withinEdits(a, b, Math.min(4, Math.floor(Math.min(a.length, b.length) / 3)))
  );
}

function titleMatchRank(name: string, titles: string[], albumMatch: boolean): number {
  if (!name) return 0;
  // Do not let the generic alias cleaner erase an explicit recording qualifier.
  const suffix = /(?:[\(\[]([^\)\]]+)[\)\]]|\s+[-\u2013\u2014]\s+([^\n]+))\s*$/u.exec(name);
  if (
    suffix &&
    VERSION_LABEL.test(suffix[1] ?? suffix[2] ?? "") &&
    !titles.some((title) => normalizeMatch(title) === normalizeMatch(name))
  )
    return 0;
  if (compatible(name, titles)) return 3;
  const a = compact(name);
  for (const title of titles) {
    const b = compact(title);
    if (a.length >= 4 && a === b) return 2;
  }
  if (!albumMatch) return 0;
  if (titles.some((title) => sameArabicRomanization(name, title))) return 1;
  const x = latinSkeleton(a);
  if (x.length < 4) return 0;
  return titles.some((title) => {
    const b = compact(title);
    return x === latinSkeleton(b) && withinEdits(a, b, 2);
  })
    ? 1
    : 0;
}

function artistNameRank(
  name: string,
  artists: string[],
  credits: string[],
  albumMatch: boolean,
): number {
  if (!name) return 0;
  if (compatible(name, artists)) return 4;
  const creditRank = Math.max(0, ...credits.map((credit) => creditSetMatch(credit, name)));
  if (creditRank) return creditRank + 1;
  if (
    creditParts(name).length === 1 &&
    artists.some(
      (artist) => creditParts(artist).length === 1 && sameArabicRomanization(name, artist),
    )
  )
    return 1;
  // Only allow a whole, distinctive name at an edge of a longer single credit.
  // Sharing a token in two different full names is not an artist match.
  if (!albumMatch || creditParts(name).length !== 1) return 0;
  const a = normalizeMatch(name);
  return artists.some((artist) => {
    if (creditParts(artist).length !== 1) return false;
    const b = normalizeMatch(artist);
    const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
    return (
      shorter.length >= 5 &&
      longer.split(" ").length - shorter.split(" ").length <= 2 &&
      (longer.startsWith(shorter + " ") || longer.endsWith(" " + shorter))
    );
  })
    ? 1
    : 0;
}

function chooseFallbackLyrics(
  rows: LrcRow[],
  duration: number,
  titles: string[],
  artists: string[],
  credits: string[],
  album: string,
): LyricLine[] | null {
  if (duration <= 0) return null;
  const ranked = rows
    .flatMap((row) => {
      const time = seconds(row.duration);
      const gap = Math.abs(time - duration);
      if (!time || gap > 3) return [];
      const albumMatch = albumCorroborates(album, text(row.albumName));
      const titleRank = titleMatchRank(text(row.trackName ?? row.name), titles, albumMatch);
      const artistRank = artistNameRank(text(row.artistName), artists, credits, albumMatch);
      if (!titleRank || !artistRank) return [];
      // Do not stack two weak matches without corroboration from the album.
      const crossScriptCredit = artists.some((artist) =>
        sameArabicRomanization(text(row.artistName), artist),
      );
      if (titleRank === 1 && !albumMatch) return [];
      if (artistRank === 1 && !albumMatch && !(crossScriptCredit && titleRank === 3 && gap <= 2))
        return [];
      return [{ row, titleRank, artistRank, albumMatch, gap }];
    })
    .sort(
      (a, b) =>
        b.titleRank - a.titleRank ||
        b.artistRank - a.artistRank ||
        Number(b.albumMatch) - Number(a.albumMatch) ||
        a.gap - b.gap,
    );
  const best = ranked[0];
  if (!best || (best.row.instrumental === true && best.gap <= 2)) return null;
  // Don't trade recording confidence for a timed result on a weaker candidate.
  return readRankedLyrics(
    ranked
      .filter(
        (match) =>
          match.titleRank === best.titleRank &&
          match.artistRank === best.artistRank &&
          match.albumMatch === best.albumMatch,
      )
      .map((match) => match.row),
    duration,
  );
}

/** At most two broad searches, using distinctive title tokens and a full artist
 * credit (or a distinctive last name). Search results still have to pass the
 * recording checks above; this only widens discovery, never acceptance. */
function expandJoinedTitle(title: string): string {
  const camel = title.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
  if (camel !== title) return camel;
  // Without case information, try just one plausible boundary in a long Latin
  // token. This only widens discovery: full title, artist and duration still agree.
  if (!/^[a-z]{8,40}$/i.test(title)) return title;
  const lower = title.toLowerCase();
  const vowel = /[aeiouy]/;
  const boundaries: number[] = [];
  for (let i = 3; i <= lower.length - 3; i++) {
    if (
      !vowel.test(lower[i - 1]) &&
      !vowel.test(lower[i]) &&
      vowel.test(lower[i + 1]) &&
      vowel.test(lower.slice(0, i)) &&
      vowel.test(lower.slice(i))
    )
      boundaries.push(i);
  }
  boundaries.sort((a, b) => Math.abs(a - lower.length / 2) - Math.abs(b - lower.length / 2));
  const at = boundaries[0];
  return at === undefined ? title : title.slice(0, at) + " " + title.slice(at);
}

function broadQueries(title: string, artist: string, album: string): string[] {
  const expanded = expandJoinedTitle(title);
  const normalized = normalizeMatch(expanded);
  const words = unique(normalized.split(" ").filter((word) => word.length >= 3));
  const name = normalizeMatch(artist);
  if (!normalized || !name) return [];
  const original = normalizeMatch(title);
  const native = NATIVE_SCRIPT.test(title) || NATIVE_SCRIPT.test(artist);
  // A title-only query can discover a native title paired with a romanized
  // artist. Acceptance still requires independently validated artist metadata.
  if (native) return unique([normalized + " " + name, normalized]).slice(0, 2);
  if (!words.length || name.length < 3) return [];
  const first = words[0],
    last = words.at(-1)!;
  const artistWords = name.split(" ");
  const lastName = artistWords.at(-1)!;
  const albumName = normalizeMatch(album);
  // Prefer the expanded title, then one bounded alternate discovery path.
  return unique([
    original !== normalized ? normalized + " " + name : "",
    last + " " + name,
    first !== last
      ? first + " " + name
      : albumName && albumName !== original
        ? albumName + " " + name
        : artistWords.length > 1 && lastName.length >= 5
          ? last + " " + lastName
          : "",
  ]).slice(0, 2);
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
  return readRankedLyrics(ranked, target);
}

function readRankedLyrics(ranked: LrcRow[], target: number): LyricLine[] | null {
  const gap = (row: LrcRow) =>
    target && seconds(row.duration) ? Math.abs(seconds(row.duration) - target) : 0;
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

/** Only catalog-proven recording credits, never guessed transliterations. */
function creditScript(value: string): "latin" | "native" | null {
  const letters = value.match(/\p{L}/gu) ?? [];
  if (!letters.length) return null;
  const latin = letters.filter((letter) => LATIN_SCRIPT.test(letter)).length;
  return latin === letters.length ? "latin" : latin === 0 ? "native" : null;
}

const LYRICS_CATALOG_SOURCES = ["spotify", "youtube"] as const;
const CATALOG_LOOKUP_MS = 5_000;

function lyricsCatalogSource(value?: string): string | undefined {
  if (value && ["youtube_music", "youtubemusic", "youtube-music"].includes(value)) return "youtube";
  return value;
}

async function verifiedCatalogArtist(
  track: MusicTrack,
  signal: AbortSignal,
): Promise<string | null> {
  const origin = track.collectionOrigin;
  const from = lyricsCatalogSource(origin?.connectorId ?? track.connectorId);
  const to = LYRICS_CATALOG_SOURCES.find((id) => id !== from);
  const title = origin?.title || track.title;
  const artist = origin?.artist || track.artist;
  const album = text(track.album).trim();
  const duration = seconds(track.durationSeconds);
  const script = creditScript(artist);
  // A private/local file or a single-title release does not provide sufficiently
  // independent catalog corroboration. Do not send it to another service.
  if (
    !from ||
    !LYRICS_CATALOG_SOURCES.some((id) => id === from) ||
    !to ||
    !script ||
    !duration ||
    !normalizeMatch(title) ||
    !normalizeMatch(album) ||
    normalizeMatch(title) === normalizeMatch(album) ||
    track.mediaKind === "video" ||
    signal.aborted
  )
    return null;
  const { musicSourceAllowed } = await import("./source-consent");
  if (!musicSourceAllowed(from) || !musicSourceAllowed(to) || signal.aborted) return null;
  const { getMusicSourceCandidates } = await import("./sources");
  const target: MusicTrack = {
    ...track,
    id: origin?.id ?? track.id,
    connectorId: from,
    title,
    artist,
    collectionOrigin: undefined,
  };
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(CATALOG_LOOKUP_MS)]);
  if (deadline.aborted) return null;
  let cancel: (() => void) | undefined;
  try {
    const candidates = await Promise.race([
      getMusicSourceCandidates(target, to),
      new Promise<never>((_, reject) => {
        cancel = () => reject(new Error("Lyrics catalog lookup cancelled"));
        deadline.addEventListener("abort", cancel, { once: true });
        if (deadline.aborted) cancel();
      }),
    ]);
    if (deadline.aborted || !musicSourceAllowed(from) || !musicSourceAllowed(to)) return null;
    const selectedSource = lyricsCatalogSource(track.connectorId);
    const matches = candidates.filter((candidate) => {
      const item = candidate.track;
      const otherScript = creditScript(text(item.artist));
      // The native matcher supplies candidates, not proof of artist identity.
      // Require an exact independent album, full title and a two-second window.
      // If playback already selected this other source, verify that exact item.
      return (
        candidate.connectorId === to &&
        lyricsCatalogSource(item.connectorId) === to &&
        candidate.health !== "offline" &&
        !!item.id &&
        item.mediaKind !== "video" &&
        !item.collectionOrigin &&
        (!origin || selectedSource !== to || item.id === track.id) &&
        normalizeMatch(item.title) === normalizeMatch(title) &&
        normalizeMatch(text(item.album)) === normalizeMatch(album) &&
        seconds(item.durationSeconds) > 0 &&
        Math.abs(item.durationSeconds - duration) <= 2 &&
        normalizeMatch(text(item.version)) === normalizeMatch(text(track.version)) &&
        otherScript !== null &&
        otherScript !== script &&
        creditParts(item.artist).length === creditParts(artist).length
      );
    });
    // Do not promote conflicting catalog credits or learn a global artist alias.
    const names = unique(matches.map(({ track: item }) => item.artist));
    if (new Set(names.map(normalizeMatch)).size !== 1) return null;
    return names[0] ?? null;
  } finally {
    if (cancel) deadline.removeEventListener("abort", cancel);
  }
}

function verifiedCatalogLyrics(
  rows: LrcRow[],
  title: string,
  artist: string,
  album: string,
  duration: number,
): LyricLine[] | null {
  const ranked = rows
    .filter(
      (row) =>
        normalizeMatch(text(row.trackName ?? row.name)) === normalizeMatch(title) &&
        normalizeMatch(text(row.artistName)) === normalizeMatch(artist) &&
        normalizeMatch(text(row.albumName)) === normalizeMatch(album) &&
        seconds(row.duration) > 0 &&
        Math.abs(seconds(row.duration) - duration) <= 2,
    )
    .sort(
      (a, b) => Math.abs(seconds(a.duration) - duration) - Math.abs(seconds(b.duration) - duration),
    );
  return readRankedLyrics(ranked, duration);
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
  const originals = unique([track.title, origin?.title ?? ""]);
  const soundtrackSearch = originals
    .map((original) => soundtrackTitle(original)?.base)
    .find((base) => base && normalizeMatch(base) !== normalizeMatch(title));
  // Keep soundtrack variants out of the permissive general alias path.
  // Exact original titles still use the existing matcher; shortened labels
  // require explicit artist metadata and a tightly matching duration.
  const isSoundtrackAlias = (row: LrcRow) => {
    const name = text(row.trackName ?? row.name);
    return (
      !originals.some((original) => normalizeMatch(original) === normalizeMatch(name)) &&
      (originals.some((original) => soundtrackTitle(original) !== null) ||
        soundtrackTitle(name) !== null)
    );
  };
  const splitRows = (rows: LrcRow[]) => ({
    ordinary: rows.filter((row) => !isSoundtrackAlias(row)),
    soundtrack: rows
      .filter(
        (row) =>
          isSoundtrackAlias(row) && soundtrackAliasMatch(row, originals, artists, duration, album),
      )
      .sort(
        (a, b) =>
          Math.abs(seconds(a.duration) - duration) - Math.abs(seconds(b.duration) - duration),
      ),
  });
  const bilingualTitle = unique([
    ...bilingualAliases(track.title),
    ...bilingualAliases(origin?.title ?? ""),
  ]).find((candidate) => LATIN_SCRIPT.test(candidate) && !NATIVE_SCRIPT.test(candidate));
  const bilingualArtist = unique([
    ...bilingualAliases(artist),
    ...bilingualAliases(origin?.artist ?? ""),
  ]).find((candidate) => LATIN_SCRIPT.test(candidate) && !NATIVE_SCRIPT.test(candidate));
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
    origin?.title && origin.artist
      ? API + "/search?" + queryFor(lyricTitle(origin.title, origin.artist), origin.artist)
      : "",
    alternateTitle && alternateArtist
      ? API + "/search?" + queryFor(alternateTitle, alternateArtist)
      : "",
    bilingualTitle && bilingualArtist
      ? API + "/search?" + queryFor(bilingualTitle, bilingualArtist)
      : "",
    ...titles
      .filter((candidate) => candidate !== title)
      .slice(0, 3)
      .map((candidate) => API + "/search?" + queryFor(candidate, artist)),
    soundtrackSearch ? API + "/search?" + queryFor(soundtrackSearch, artist) : "",
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
      const { ordinary: rows, soundtrack } = splitRows(rowsOf(await json(url, lookup)));
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
      if (soundtrack[0]?.instrumental !== true) {
        const matched = readRankedLyrics(soundtrack, duration);
        if (hasTimedLyrics(matched)) return matched;
        if (matched && !plain) plain = matched;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      if (plain) return plain;
      throw error;
    }
  }
  // Keep exact/alias lookups on the fast path. Only widen a genuine miss or
  // unsynced result, with the same timeout, cancellation and throttling budget.
  if (duration > 0) {
    const expanded = expandJoinedTitle(title);
    const joinedQuery =
      normalizeMatch(expanded) !== normalizeMatch(title)
        ? API +
          "/get?" +
          queryFor(expanded, artist) +
          (album ? "&album_name=" + encodeURIComponent(album) : "") +
          "&duration=" +
          Math.round(duration)
        : "";
    const broadAttempts = unique([
      joinedQuery,
      ...broadQueries(title, artist, album).map(
        (query) => API + "/search?q=" + encodeURIComponent(query),
      ),
    ]);
    for (const url of broadAttempts) {
      try {
        const { ordinary: rows, soundtrack } = splitRows(rowsOf(await json(url, lookup)));
        const found = chooseFallbackLyrics(
          rows,
          duration,
          titles,
          artists,
          requestedCredits,
          album,
        );
        if (hasTimedLyrics(found)) return found;
        if (found && !plain) plain = found;
        if (soundtrack[0]?.instrumental !== true) {
          const matched = readRankedLyrics(soundtrack, duration);
          if (hasTimedLyrics(matched)) return matched;
          if (matched && !plain) plain = matched;
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        if (plain) return plain;
        throw error;
      }
    }
  }
  // Only after existing exact, bilingual, soundtrack and broad lookups miss.
  // The alias is scoped to this recording and never alters the displayed track.
  if (!lookup.aborted) {
    try {
      const alias = await verifiedCatalogArtist(track, lookup);
      if (alias && !lookup.aborted) {
        const originalTitle = origin?.title || track.title;
        const aliasQuery = queryFor(originalTitle, alias);
        for (const url of [
          API +
            "/get?" +
            aliasQuery +
            "&album_name=" +
            encodeURIComponent(album) +
            "&duration=" +
            Math.round(duration),
          API + "/search?" + aliasQuery,
        ]) {
          const rows = rowsOf(await json(url, lookup));
          const matched = verifiedCatalogLyrics(rows, originalTitle, alias, album, duration);
          if (hasTimedLyrics(matched)) return matched;
          if (matched && !plain) plain = matched;
        }
      }
    } catch (error) {
      if (!plain) throw error;
    }
  }
  return plain;
}

export function loadTrackLyrics(
  track: MusicTrack,
  signal?: AbortSignal,
): Promise<LyricLine[] | null> {
  if (!track || typeof track !== "object" || signal?.aborted) return Promise.resolve(null);
  if (
    backingTrackVersion(track) ||
    (track.collectionOrigin?.title && backingTrackVersion({ title: track.collectionOrigin.title }))
  )
    return Promise.resolve(null);
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
