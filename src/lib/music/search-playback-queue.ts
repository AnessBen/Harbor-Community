import { queueTrackKey } from "./queue-order";
import type { MusicTrack } from "./types";

/** A search action owns a snapshot of the results, not the previous queue.
 * Keep the chosen result and the visible ranking, but never mix audio and video.
 */
export function searchPlaybackQueue(
  selected: MusicTrack,
  results: readonly MusicTrack[],
): MusicTrack[] {
  const key = queueTrackKey(selected);
  const video = selected.mediaKind === "video";
  const seen = new Set<string>();
  const queue: MusicTrack[] = [];
  for (const track of results) {
    if ((track.mediaKind === "video") !== video) continue;
    const id = queueTrackKey(track);
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(id === key ? selected : track);
  }
  if (!seen.has(key)) queue.unshift(selected);
  return queue;
}
