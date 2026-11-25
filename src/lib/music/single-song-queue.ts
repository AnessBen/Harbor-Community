import { freshContinuationTracks } from "./queue-continuation";
import { queueTrackKey } from "./queue-order";
import type { MusicTrack } from "./types";

type Snapshot = {
  current: MusicTrack | null;
  queue: MusicTrack[];
  phase: string;
  revision: number;
};

export type SingleSongQueueDependencies = {
  snapshot: () => Snapshot;
  recommendations: (seed: MusicTrack) => Promise<MusicTrack[]>;
  filter: (tracks: MusicTrack[]) => MusicTrack[];
  apply: (queue: MusicTrack[]) => void;
};

/** Populate a newly started standalone song, not a collection or an edited queue. */
export async function fillSingleSongQueue(
  selected: MusicTrack,
  api: SingleSongQueueDependencies,
): Promise<void> {
  const initial = api.snapshot();
  const key = queueTrackKey(selected);
  const seed = initial.current;
  if (
    !seed ||
    seed.mediaKind === "video" ||
    selected.mediaKind === "video" ||
    queueTrackKey(seed) !== key ||
    initial.queue.length !== 1 ||
    queueTrackKey(initial.queue[0]) !== key ||
    initial.phase === "error" ||
    initial.phase === "idle"
  )
    return;
  const initialKeys = initial.queue.map(queueTrackKey);
  const currentQueue = (): MusicTrack[] | null => {
    const latest = api.snapshot();
    // Audio-quality events rebuild the queue with updated track objects.
    // Only changes to playback or the ordered track identities invalidate this request.
    const matches =
      latest.revision === initial.revision &&
      latest.queue.length === initialKeys.length &&
      latest.queue.every((track, index) => queueTrackKey(track) === initialKeys[index]) &&
      latest.current !== null &&
      queueTrackKey(latest.current) === key &&
      latest.phase !== "error" &&
      latest.phase !== "idle";
    return matches ? latest.queue : null;
  };
  try {
    const found = await api.recommendations(seed);
    const queue = currentQueue();
    if (!queue) return;
    const following = freshContinuationTracks(api.filter(found), queue).slice(0, 40);
    if (following.length) api.apply([...queue, ...following]);
  } catch {
    // Recommendations are optional. A failed lookup never interrupts the requested song.
  }
}

export async function singleSongRecommendations(seed: MusicTrack): Promise<MusicTrack[]> {
  const { musicSourceAllowed } = await import("./source-consent");
  const id = [seed.sourceId, seed.id.replace(/^youtube:/, "")].find(
    (value) => value && /^[a-zA-Z0-9_-]{11}$/.test(value),
  );
  // The provider's seed-specific radio is a single metadata request, not a stream extraction.
  if (seed.connectorId === "youtube" && id && musicSourceAllowed("youtube")) {
    const { stationTracks } = await import("./catalog");
    try {
      const tracks = await stationTracks({
        id: "RDAMVM" + id,
        connectorId: "youtube",
        name: seed.title,
        artwork: seed.artwork,
      });
      if (freshContinuationTracks(tracks, [seed]).length) return tracks;
    } catch (error) {
      // Don't fan out recommendation requests while the provider is restricting us.
      if (
        /429|rate.limit|limiting requests|too many requests|browser verification/i.test(
          String(error),
        )
      )
        return [];
    }
  }
  // Other providers use Harbor's existing multi-source similarity ranking.
  return (await import("./radio")).loadSimilarTracks(seed);
}
