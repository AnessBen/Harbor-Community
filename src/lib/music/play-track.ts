import { getMusicState, playMusic } from "./player";
import { queueTrackKey } from "./queue-order";
import type { MusicTrack } from "./types";

export const MUSIC_SOURCE_KEY = "harbor.music.preferred-source.v1";
export const MUSIC_SOURCE_REQUIRED = "harbor:music-playback-source-required";

export type ResolvedMusicPlayback = { track: MusicTrack; queue: MusicTrack[] };

/** Initial selection and subsequent queue entries must use the same playback policy. */
export async function resolveAndPlayMusicTrack(
  track: MusicTrack,
  queue: MusicTrack[] = [track],
  singleSong = false,
): Promise<ResolvedMusicPlayback | null> {
  await playMusic(track, queue, undefined, false, false, false, undefined, singleSong);
  const state = getMusicState();
  if (!state.current || queueTrackKey(state.current) !== queueTrackKey(track)) return null;
  return { track: state.current, queue: state.queue };
}
