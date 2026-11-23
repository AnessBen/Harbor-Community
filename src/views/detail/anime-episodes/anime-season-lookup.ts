import type { KitsuSearchHit } from "@/lib/providers/kitsu";

function titleTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 3);
}

/**
 * Derive the common series identity from the known franchise, rather than
 * assuming the opened (possibly last) arc is the franchise title. For example
 * Steel Ball Run's CW details open under its own title, while Stardust
 * Crusaders is catalogued under JoJo's Bizarre Adventure.
 */
export function seasonLookupSeriesName(
  openedTitle: string,
  franchiseTitles: readonly string[],
): string {
  const openedWords = new Set(titleTokens(openedTitle));
  const candidates = franchiseTitles
    .map((title) => title.split(":")[0].trim())
    .filter((base) => {
      const words = titleTokens(base);
      return words.length >= 2 && words.every((word) => openedWords.has(word));
    })
    .sort((a, b) => titleTokens(b).length - titleTokens(a).length);
  return candidates[0] ?? openedTitle;
}

export function seasonLookupQuery(seriesName: string, seasonName: string): string {
  return seriesName + " " + seasonName;
}

function seasonCandidates(
  hits: readonly KitsuSearchHit[],
  seriesName: string,
  seasonName: string,
  year: string | undefined,
): KitsuSearchHit[] {
  const base = titleTokens(seriesName);
  const arc = titleTokens(seasonName);
  const releaseYear = Number(year);
  if (!base.length || !arc.length || !/^\d{4}$/.test(year ?? "")) return [];
  if (/^season\s*\d+$/i.test(seasonName.trim())) return [];

  return hits.filter((hit) => {
    if (
      hit.year == null ||
      Math.abs(hit.year - releaseYear) > 1 ||
      !/^(tv|ona)$/i.test(hit.subtype ?? "")
    )
      return false;
    const words = new Set(titleTokens(hit.title));
    return base.every((word) => words.has(word)) && arc.every((word) => words.has(word));
  });
}

/**
 * The loaded franchise can end before newer cours (for example, JoJo's 2012
 * relations stop at Diamond is Unbreakable). Accept a Kitsu search result only
 * when the parent title, named arc, release year and format all agree.
 * A generic or ambiguous search must never assign the wrong tracker entry.
 */
export function matchingKitsuSeasonEntry(
  hits: readonly KitsuSearchHit[],
  seriesName: string,
  seasonName: string,
  year: string | undefined,
): string | null {
  const candidates = seasonCandidates(hits, seriesName, seasonName, year).filter(
    (hit) => !/\bpart\s+[2-9]\d*\b/i.test(hit.title) || /\bpart\s+[2-9]\d*\b/i.test(seasonName),
  );
  const exact = candidates.filter((hit) => hit.year === Number(year));
  if (exact.length > 1) return null;
  if (exact.length === 1) return "kitsu:" + exact[0].id;
  return candidates.length === 1 ? "kitsu:" + candidates[0].id : null;
}

/** A TVDB season may span multiple native cours (e.g. Stardust Crusaders).
 * Lookup matches remain untrusted until their episodes match the exact
 * provider season and IMDb series. */
export function matchingKitsuSeasonEntries(
  hits: readonly KitsuSearchHit[],
  seriesName: string,
  seasonName: string,
  year: string | undefined,
): string[] {
  const primary = matchingKitsuSeasonEntry(hits, seriesName, seasonName, year);
  if (!primary) return [];
  const candidates = seasonCandidates(hits, seriesName, seasonName, year).sort(
    (a, b) => (a.year ?? 0) - (b.year ?? 0),
  );
  const ids = [primary];
  for (const hit of candidates) {
    const id = "kitsu:" + hit.id;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
