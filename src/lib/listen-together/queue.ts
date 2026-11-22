import type { MusicTrack } from "@/lib/music/types";
import type { MusicTransport } from "@/lib/music/transport";

export type ListenQueueEntry = {
  entryId: string;
  connectorId: string;
  trackId: string;
  title: string;
  artist: string;
};

export type ListenQueue = MusicTransport & {
  revision: number;
  entries: ListenQueueEntry[];
  currentEntryId: string | null;
};

const encoder = new TextEncoder();
const safeId = (id: string) =>
  id.length > 0 && id.length <= 256 && !/[\s/\\?#]/.test(id) && !/^(local|file):/i.test(id);

// Keep queue-entry identity separate from recording identity: one recording can appear twice.
export function createListenQueueBuilder() {
  const ids = new WeakMap<MusicTrack, string>();
  let serial = 0;
  return (
    current: MusicTrack | null,
    upcoming: MusicTrack[],
    transport: MusicTransport,
  ): ListenQueue => {
    const queue: ListenQueue = { ...transport, revision: 0, currentEntryId: null, entries: [] };
    const occurrences = new Map<string, number>();
    let bytes = 256; // Envelope, revision and currentEntryId, including a future larger revision.
    for (const [index, track] of [current, ...upcoming].entries()) {
      const connectorId = track?.connectorId;
      if (
        !track ||
        !connectorId ||
        connectorId.toLowerCase() === "local" ||
        !safeId(connectorId) ||
        !safeId(track.id) ||
        !track.title
      )
        continue;
      let id = ids.get(track);
      if (!id) {
        id = String(++serial);
        ids.set(track, id);
      }
      const n = (occurrences.get(id) ?? 0) + 1;
      occurrences.set(id, n);
      const entry = {
        entryId: n === 1 ? id : id + "-" + n,
        trackId: track.id,
        connectorId,
        title: track.title.slice(0, 256),
        artist: track.artist.slice(0, 256),
      };
      bytes += encoder.encode(JSON.stringify(entry)).length + 1;
      if (bytes > 32768 || queue.entries.length >= 200) break;
      queue.entries.push(entry);
      if (index === 0) queue.currentEntryId = entry.entryId;
    }
    return queue;
  };
}
