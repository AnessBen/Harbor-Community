import { normalizeTitle } from "./search-normalize";
import { queueTrackKey } from "./queue-order";
import type { MusicTrack } from "./types";

const tokens = (value: string): string[] => normalizeTitle(value).split(" ").filter(Boolean);

function covers(needle: string[], haystack: Set<string>): boolean {
  return needle.length > 0 && needle.every((token) => haystack.has(token));
}

/**
 * A picked video is the song already playing when a different upload carries the whole
 * title and the lead artist. "Smart" and "LE SSERAFIM (르세라핌) 'Smart' OFFICIAL MV"
 * are the same recording; a remix, live take or another song is not.
 */
export function sameRecording(current: MusicTrack, track: MusicTrack): boolean {
  if (current.id === track.id && (current.connectorId ?? "") === (track.connectorId ?? "")) {
    return true;
  }
  const video = new Set([...tokens(track.title), ...tokens(track.artist)]);
  const song = new Set([...tokens(current.title), ...tokens(current.artist)]);
  const title = tokens(current.title);
  if (title.length === 0 || !covers(title, video)) return false;
  // The uploader's channel is not the act, so the act has to appear in the title too.
  return covers(tokens(current.artist), video) || covers(tokens(track.artist), song);
}

/**
 * The name a video plays under. Upload titles carry the act, marketing words and a
 * translated reading; the dock, now playing and Discord RPC should show the song.
 * Only those parts are removed, so "Song (Part 2)" keeps its bracket.
 */
export function videoDisplayTitle(title: string, artist: string): string {
  const value = title.normalize("NFKC").trim();
  const lead = artist.normalize("NFKC").trim();
  const withoutAct =
    lead && value.toLowerCase().startsWith(lead.toLowerCase()) ? value.slice(lead.length) : value;
  return (
    withoutAct
      .replace(
        /\b(?:official(?:\s+music)?(?:\s+(?:video|audio|mv|m\/v))?|lyrics?(?:\s+video)?|visuali[sz]er|m\/v|mv)\b/gi,
        " ",
      )
      // A bracketed group with no Latin letters is a translation of the name.
      .replace(/[\(\[]\s*([^\)\]]*)\s*[\)\]]/g, (group, inside: string) =>
        /[a-z]/i.test(inside) ? group : " ",
      )
      .replace(/["'“”‘’]/g, " ")
      .replace(/^[\s\-–—:|]+/, "")
      .replace(/\s+/g, " ")
      .trim() || title.trim()
  );
}

/**
 * Identity shown while a video plays. Opening the video of the song already playing keeps
 * the song's own name and artist, so the dock, the now playing page and Discord RPC do not
 * suddenly show an upload title like "KATSEYE (캣츠아이) 'Gnarly' Official MV".
 */
export function musicVideoPlayback(
  track: MusicTrack,
  live: { current: MusicTrack | null },
): MusicTrack {
  if (live.current && sameRecording(live.current, track)) {
    // Preserve the song's queue identity even when the video has another upload id.
    const changedSource =
      live.current.id !== track.id || live.current.connectorId !== track.connectorId;
    return {
      ...track,
      title: live.current.title,
      artist: live.current.artist,
      ...(live.current.collectionOrigin || changedSource
        ? {
            collectionOrigin: live.current.collectionOrigin ?? {
              id: live.current.id,
              connectorId: live.current.connectorId,
            },
          }
        : {}),
    };
  }
  const title = videoDisplayTitle(track.title, track.artist);
  return title && title !== track.title ? { ...track, title } : track;
}

type LiveVideoQueue = {
  current: MusicTrack | null;
  queue: readonly MusicTrack[];
  queueIndex: number;
};

function playingQueueIndex(track: MusicTrack, live: LiveVideoQueue): number {
  if (!live.current || !sameRecording(live.current, track)) return -1;
  const key = queueTrackKey(live.current);
  if (
    live.queueIndex >= 0 &&
    live.queue[live.queueIndex] &&
    queueTrackKey(live.queue[live.queueIndex]) === key
  )
    return live.queueIndex;
  return live.queue.findIndex((item) => queueTrackKey(item) === key);
}

/**
 * Resolve the stream independently of the queue's original song identity.
 * YouTube provides the picture, even when the queued audio came from Spotify
 * or another provider. Never use an upload for a different artist/recording.
 */
export function queuedVideoStreamTrack(
  track: MusicTrack,
  candidates: readonly MusicTrack[],
): MusicTrack | null {
  if (track.videoSearch === false || (track.connectorId !== "youtube" && !track.videoSearch))
    return null;
  const match = candidates.find(
    (candidate) =>
      candidate.connectorId === "youtube" &&
      !!candidate.sourceId &&
      (track.connectorId !== "youtube" || candidate.sourceId !== track.sourceId) &&
      sameRecording(track, candidate),
  );
  if (!match?.sourceId) return null;
  return {
    ...track,
    connectorId: "youtube",
    id: match.sourceId,
    sourceId: match.sourceId,
    videoSearch: false,
  };
}

/**
 * A video picked from a song-specific search belongs to the queued song that
 * opened that search, which need not be the song currently playing. The search
 * results are choices of source, never a replacement playlist.
 *
 * The listener explicitly chose an upload for this song, so preserve the song
 * identity even when the uploader labels it differently. Only apply the choice
 * if that exact queue entry is still present; a stale search cannot hijack a
 * newer listening session.
 */
export function musicVideoQueueSelection(
  picked: MusicTrack,
  requested: MusicTrack,
  live: LiveVideoQueue,
): { track: MusicTrack; queue: MusicTrack[] } | null {
  const index = live.queue.findIndex((entry) => queueTrackKey(entry) === queueTrackKey(requested));
  if (index < 0) return null;
  const track = musicVideoQueueEntries([
    {
      ...picked,
      mediaKind: "video",
      videoSearch: false,
      title: requested.title,
      artist: requested.artist,
      album: requested.album,
      collectionOrigin: requested.collectionOrigin ?? {
        id: requested.id,
        connectorId: requested.connectorId,
      },
    },
  ])[0];
  return {
    track,
    queue: musicVideoQueueEntries(live.queue).map((entry, at) => (at === index ? track : entry)),
  };
}

/** Source changes retain the existing queue, shuffle order and playlist origin. */
export function musicVideoSourceSwitch(track: MusicTrack, live: LiveVideoQueue): boolean {
  return playingQueueIndex(track, live) >= 0;
}

/**
 * Turn the *same songs* into video requests without changing their source/collection
 * identities. Only newly converted audio entries need a video lookup; videos chosen
 * explicitly from the video catalog keep their exact uploads.
 */
export function musicVideoQueueEntries(queue: readonly MusicTrack[]): MusicTrack[] {
  return queue.map((item) => {
    if (item.mediaKind !== "video")
      return { ...item, mediaKind: "video", videoSearch: item.videoSearch ?? true };
    // The watch UI can label a Spotify audio song as "video" before the
    // matching YouTube upload is resolved. Do not treat that as an exact video.
    if (item.connectorId !== "youtube" && item.videoSearch === undefined)
      return { ...item, videoSearch: true };
    return item;
  });
}

/**
 * Switching to the video of the playing song converts its whole existing queue
 * into video mode without importing related videos or replacing playlist entries.
 * Each following song searches for its corresponding video when playback reaches it.
 */
export function musicWatchQueue(
  track: MusicTrack,
  offered: readonly MusicTrack[],
  live: LiveVideoQueue,
): MusicTrack[] {
  const index = playingQueueIndex(track, live);
  if (index < 0) return musicVideoQueueEntries(offered);
  const video = musicVideoQueueEntries([track])[0];
  return musicVideoQueueEntries(live.queue).map((item, at) => (at === index ? video : item));
}
