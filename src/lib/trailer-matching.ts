export type TrailerIdentity = {
  title: string;
  aliases?: readonly string[];
  year?: string;
  type: "movie" | "series";
};

export type TrailerSearchVideo = {
  id: string;
  title: string;
  channel?: string | null;
  duration?: number | null;
};

export const isYoutubeVideoId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(id);

const normalized = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const nonTrailer = /\b(reaction|reacts|review|breakdown|explained|fan[ -]?(made|edit|trailer)|concept|parody|spoof|compilation|ranked|ranking|full (movie|episode)|gameplay|behind the scenes|featurette|clip|tribute|music video|theme song|opening credits|soundtrack|comparison|recap|ai generated|bandicam|screen record(?:ed|ing)?|camrip|watermark(?:ed)?)\b/i;

/** A search result is untrusted: a franchise name and an official channel alone
 * are not sufficient. Require the actual title next to a promotional marker. */
export function isNonTrailerTitle(title: string): boolean {
  return nonTrailer.test(title);
}

export function trailerMatch(identity: TrailerIdentity, video: TrailerSearchVideo): number {
  if (!isYoutubeVideoId(video.id) || !video.title || isNonTrailerTitle(video.title)) return -1;
  if (video.duration != null && (video.duration < 15 || video.duration > 360)) return -1;
  const text = normalized(video.title);
  const marker = /\b(trailer|teaser|promo|pv)\b/;
  if (!marker.test(text)) return -1;
  if (identity.type === "series" && /\b(movie|film|cinema|theatrical)\b/.test(text) &&
      !/\b(tv series|tv show)\b/.test(text)) return -1;
  // A season-specific upload is not a trailer for the series itself.
  if (/\b(?:season\s*\d+|s\d{1,2}|episode\s*\d+)\b/.test(text)) return -1;
  if (identity.type === "movie" && /\b(tv series|tv show)\b/.test(text)) return -1;
  const aliases = [identity.title, ...(identity.aliases ?? [])].map(normalized).filter(Boolean);
  const allowed = /^(?:(?:19|20)\d{2}|official|international|original|final|first|second|new|hd|uhd|4k|tv|series|show|season|s\d+|\d+|announcement|premiere|launch|release|extended|red|band|theatrical|trailer|teaser|promo|pv)$/;
  const match = aliases.some((alias) => {
    const at = (" " + text + " ").indexOf(" " + alias + " ");
    if (at < 0) return false;
    const before = text.slice(0, at).trim();
    const after = text.slice(at + alias.length).trim();
    // Reject sequel numbers and subtitles inserted between the title and marker.
    const prefix = after.split(marker)[0].trim();
    const pre = before.replace(marker, "").trim();
    if (prefix.split(" ").some((w) => w && !allowed.test(w))) return false;
    if (pre.split(" ").some((w) => w && !allowed.test(w))) return false;
    if (/^\d+\b/.test(prefix) && !/^(19|20)\d{2}\b/.test(prefix)) return false;
    if (identity.type === "movie" && /\b(?:season|s\d+)\b/.test(prefix)) return false;
    const years = [...text.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => m[0]);
    return !identity.year || years.every((year) => year === identity.year);
  });
  if (!match) return -1;
  return (/\btrailer\b/.test(text) ? 100 : /\bteaser\b/.test(text) ? 60 : 30)
    + (identity.year && text.includes(identity.year) ? 5 : 0);
}

export function rankTrailerSearch(identity: TrailerIdentity, videos: readonly TrailerSearchVideo[]): string[] {
  return [...new Set(videos.map((video) => ({ id: video.id, score: trailerMatch(identity, video) }))
    .filter((video) => video.score >= 0).sort((a, b) => b.score - a.score).map((video) => video.id))];
}

export type TrailerEdition = {
  id: string;
  height?: number | null;
  duration?: number | null;
  envelope?: readonly number[];
};

function correlation(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length < 40) return 0;
  const avg = (v: readonly number[]) => v.reduce((sum, x) => sum + x, 0) / v.length;
  const ma = avg(a), mb = avg(b);
  let covariance = 0, va = 0, vb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    covariance += x * y;
    va += x * x;
    vb += y * y;
  }
  // Silence and nearly constant samples cannot establish a match.
  if (va / a.length < 0.01 || vb / b.length < 0.01) return 0;
  return covariance / Math.sqrt(va * vb);
}

/** Same length alone is not enough. Compare audio content with up to 0.8s
 * of lead-in drift. Require both halves to agree, not just an opening logo. */
export function sameTrailerEdition(a: TrailerEdition, b: TrailerEdition): boolean {
  if (!a.duration || !b.duration || Math.abs(a.duration - b.duration) > 1.5) return false;
  const x = a.envelope ?? [], y = b.envelope ?? [];
  // A shared opening is not proof that two longer videos are the same.
  if (Math.min(x.length, y.length) < 120 ||
      x.length < (a.duration - 1.5) * 10 || y.length < (b.duration - 1.5) * 10) return false;
  // Decode/encode delay can differ by a fraction of an envelope window.
  // Compare both the raw envelope and a 0.5-second moving average to
  // tolerate compression and dynamic-range differences between uploads.
  const smooth = (v: readonly number[]) => v.slice(0, -4)
    .map((_, i) => (v[i] + v[i + 1] + v[i + 2] + v[i + 3] + v[i + 4]) / 5);
  const aligned = (a: readonly number[], b: readonly number[], shift: number) => {
    const start = Math.max(0, Math.ceil(-shift));
    const end = Math.min(a.length, Math.ceil(b.length - 1 - shift));
    const left = a.slice(start, end);
    const right = left.map((_, i) => {
      const pos = start + i + shift;
      const base = Math.floor(pos);
      const frac = pos - base;
      return b[base] * (1 - frac) + b[base + 1] * frac;
    });
    return [left, right] as const;
  };
  const matches = (left: readonly number[], right: readonly number[]) => {
    const mid = Math.floor(left.length / 2);
    return left.length >= 120 && correlation(left, right) >= 0.9 &&
      correlation(left.slice(0, mid), right.slice(0, mid)) >= 0.8 &&
      correlation(left.slice(mid), right.slice(mid)) >= 0.8;
  };
  const sx = smooth(x), sy = smooth(y);
  for (let shift = -8; shift <= 8; shift += 0.5) {
    const [left, right] = aligned(x, y, shift);
    if (matches(left, right)) return true;
    if (correlation(left, right) >= 0.72 && matches(...aligned(sx, sy, shift))) return true;
  }
  return false;
}

/** Keep distinct trailers and their relevance order; replace a duplicate
 * group with its highest available resolution, even if listed second. */
export function preferTrailerEditions(
  ids: readonly string[], editions: readonly TrailerEdition[],
): string[] {
  const byId = new Map(editions.map((e) => [e.id, e]));
  const out: string[] = [];
  for (const id of ids) {
    const edition = byId.get(id);
    const at = edition ? out.findIndex((existing) => {
      const prior = byId.get(existing);
      return !!prior && sameTrailerEdition(prior, edition);
    }) : -1;
    if (at < 0) {
      out.push(id);
    } else if ((edition?.height ?? 0) > (byId.get(out[at])?.height ?? 0)) {
      out[at] = id;
    }
  }
  return out;
}
