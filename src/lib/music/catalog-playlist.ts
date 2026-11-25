import type { MusicCatalogPage, MusicTrack } from "./types";

const MAX_PLAYLIST_PAGES = 100;

/**
 * Follow provider cursors rather than assuming the first page is the whole
 * playlist. Keep the provider's order and the same unique-track semantics as
 * the detail view. Never report an incomplete playlist as a successful load.
 */
export async function readCatalogPlaylistTracks(
  fetchPage: (cursor: string | null) => Promise<MusicCatalogPage>,
  isCurrent: () => boolean = () => true,
): Promise<MusicTrack[]> {
  const tracks: MusicTrack[] = [];
  const seenTracks = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PLAYLIST_PAGES; page += 1) {
    if (!isCurrent()) throw new Error("Playlist loading cancelled");
    const result = await fetchPage(cursor);
    if (!isCurrent()) throw new Error("Playlist loading cancelled");
    for (const item of result.items) {
      if (item.kind !== "track") continue;
      const key = JSON.stringify([item.connectorId, item.id]);
      if (seenTracks.has(key)) continue;
      seenTracks.add(key);
      tracks.push(item);
    }
    const next = result.nextCursor;
    if (next == null) return tracks;
    if (typeof next !== "string" || !next.trim() || seenCursors.has(next))
      throw new Error("Music playlist pagination repeated or returned an invalid cursor");
    seenCursors.add(next);
    cursor = next;
  }
  throw new Error("Music playlist exceeded the supported page count");
}
