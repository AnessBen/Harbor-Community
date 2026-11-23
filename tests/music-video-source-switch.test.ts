import assert from "node:assert/strict";
import test from "node:test";
import {
  musicVideoPlayback,
  musicVideoQueueEntries,
  musicVideoQueueSelection,
  musicVideoSourceSwitch,
  musicWatchQueue,
  queuedVideoStreamTrack,
} from "../src/lib/music/video-queue.ts";
import { queueTrackKey } from "../src/lib/music/queue-order.ts";
import type { MusicTrack } from "../src/lib/music/types.ts";

const song = (
  id: string,
  title: string,
  artist: string,
  mediaKind: "audio" | "video" = "audio",
): MusicTrack => ({
  id,
  connectorId: "youtube",
  title,
  artist,
  artwork: "",
  durationSeconds: 180,
  durationLabel: "3:00",
  mediaKind,
});

test("switching the playing song to video keeps the full queue and converts every song", () => {
  const before = song("before", "Before", "Artist");
  const current = song("audio", "Smart", "LE SSERAFIM");
  const after = song("after", "After", "Artist");
  const live = { current, queue: [before, current, after], queueIndex: 1 };
  const video = musicVideoPlayback(
    {
      ...song("official-mv", "LE SSERAFIM 'Smart' Official MV", "HYBE LABELS", "video"),
      videoSearch: false,
    },
    live,
  );
  assert.equal(musicVideoSourceSwitch(video, live), true);
  const result = musicWatchQueue(video, [song("suggested", "Suggested", "Artist", "video")], live);
  assert.deepEqual(
    result.map((item) => item.id),
    ["before", "official-mv", "after"],
  );
  assert.deepEqual(
    result.map((item) => item.mediaKind),
    ["video", "video", "video"],
  );
  assert.deepEqual(
    result.map((item) => item.videoSearch),
    [true, false, true],
  );
  assert.deepEqual(result.map(queueTrackKey), live.queue.map(queueTrackKey));
  assert.equal(result[0].title, before.title);
  assert.equal(result[2].artist, after.artist);
  assert.equal(video.title, current.title);
  assert.equal(video.artist, current.artist);
  assert.equal(
    result.some((item) => item.id === "suggested"),
    false,
  );
  assert.equal(live.queue[2].mediaKind, "audio", "never mutate the original playlist");
});

test("switching videos repeatedly keeps playlist identities and all following songs in video mode", () => {
  const original = song("audio", "Smart", "LE SSERAFIM");
  const first = musicVideoPlayback(
    {
      ...song("mv-one", "LE SSERAFIM - Smart Official MV", "HYBE LABELS", "video"),
      videoSearch: false,
    },
    { current: original },
  );
  const next = song("next", "Next", "Artist");
  const live = { current: first, queue: [first, next], queueIndex: 0 };
  const second = musicVideoPlayback(
    {
      ...song("mv-two", "LE SSERAFIM - Smart Official Video", "HYBE LABELS", "video"),
      videoSearch: false,
    },
    live,
  );
  const result = musicWatchQueue(second, [], live);
  assert.equal(musicVideoSourceSwitch(second, live), true);
  assert.equal(queueTrackKey(second), queueTrackKey(original));
  assert.deepEqual(
    result.map((item) => item.id),
    ["mv-two", "next"],
  );
  assert.deepEqual(
    result.map((item) => item.mediaKind),
    ["video", "video"],
  );
  assert.equal(result[1].videoSearch, true);
});

test("switching the last song keeps earlier queue history in video mode, not recommendations", () => {
  const earlier = song("earlier", "Earlier", "Artist");
  const current = song("audio", "Smart", "LE SSERAFIM");
  const live = { current, queue: [earlier, current], queueIndex: 1 };
  const video = musicVideoPlayback(
    song("mv", "LE SSERAFIM Smart Official MV", "HYBE LABELS", "video"),
    live,
  );
  const result = musicWatchQueue(video, [song("suggested", "Suggested", "Artist", "video")], live);
  assert.deepEqual(
    result.map((item) => item.id),
    ["earlier", "mv"],
  );
  assert.deepEqual(
    result.map((item) => item.mediaKind),
    ["video", "video"],
  );
  assert.deepEqual(result.map(queueTrackKey), live.queue.map(queueTrackKey));
});

test("a one-song queue stays a one-song video queue", () => {
  const current = song("song", "Smart", "LE SSERAFIM");
  const live = { current, queue: [current], queueIndex: 0 };
  const video = musicVideoPlayback(
    song("mv", "LE SSERAFIM Smart Official MV", "HYBE LABELS", "video"),
    live,
  );
  const result = musicWatchQueue(
    video,
    [video, song("recommendation", "Elsewhere", "Artist")],
    live,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].mediaKind, "video");
  assert.equal(queueTrackKey(result[0]), queueTrackKey(current));
});

test("Up Next video conversion preserves song credits, source IDs and playlist collection origin", () => {
  const source: MusicTrack = {
    ...song("spotify-track", "Original Song", "Original Artist"),
    connectorId: "spotify",
    collectionOrigin: {
      id: "playlist-song",
      connectorId: "spotify",
      title: "Original Song",
      artist: "Original Artist",
    },
  };
  const alreadyVideo = { ...song("official", "Other Video", "Other", "video"), videoSearch: false };
  const result = musicVideoQueueEntries([source, alreadyVideo]);
  assert.equal(result[0].mediaKind, "video");
  assert.equal(result[0].videoSearch, true);
  assert.equal(result[0].connectorId, "spotify");
  assert.equal(result[0].id, source.id);
  assert.equal(result[0].title, source.title);
  assert.equal(queueTrackKey(result[0]), queueTrackKey(source));
  assert.equal(result[1], alreadyVideo, "an explicit video never becomes another search");
  assert.equal(source.mediaKind, "audio");
});

test("Spotify and other audio-provider songs use matching YouTube streams without changing queue IDs", () => {
  const source: MusicTrack = {
    ...song("spotify-song", "Smart", "LE SSERAFIM"),
    connectorId: "spotify",
  };
  const queued = musicVideoQueueEntries([source])[0];
  const unrelated = {
    ...song("unrelated", "Smart Official MV", "Different Artist", "video"),
    sourceId: "other000001",
    videoSearch: false,
  };
  const actual = {
    ...song("video-id", "LE SSERAFIM Smart Official MV", "HYBE LABELS", "video"),
    sourceId: "video000001",
    videoSearch: false,
  };
  assert.equal(queuedVideoStreamTrack(queued, [unrelated]), null);
  const resolved = queuedVideoStreamTrack(queued, [unrelated, actual]);
  assert.equal(resolved?.connectorId, "youtube");
  assert.equal(resolved?.id, actual.sourceId);
  assert.equal(resolved?.sourceId, actual.sourceId);
  assert.equal(resolved?.videoSearch, false);
  assert.equal(queued.id, source.id, "the queue song still has its own ID");
  assert.equal(queued.connectorId, "spotify");
  assert.equal(queueTrackKey(queued), queueTrackKey(source));
  assert.equal(queuedVideoStreamTrack({ ...queued, videoSearch: false }, [actual]), null);
});

test("YouTube audio queue entries search for the selected recording, not their square-art upload", () => {
  const original = { ...song("audio-id", "Smart", "LE SSERAFIM"), sourceId: "oldAudio001" };
  const queued = musicVideoQueueEntries([original])[0];
  const sameAudio = {
    ...song("audio-id", "LE SSERAFIM Smart", "HYBE LABELS", "video"),
    sourceId: "oldAudio001",
  };
  const official = {
    ...song("official", "LE SSERAFIM Smart Official MV", "HYBE LABELS", "video"),
    sourceId: "official001",
  };
  assert.equal(queuedVideoStreamTrack(queued, [sameAudio, official])?.sourceId, "official001");
});

test("an unrelated music video still uses the offered list without changing the live queue", () => {
  const current = song("audio", "Smart", "LE SSERAFIM");
  const live = { current, queue: [current, song("next", "Next", "Artist")], queueIndex: 0 };
  const different = song("other", "ELEVEN", "IVE", "video");
  const offered = [different, song("another", "Another", "IVE", "video")];
  assert.equal(musicVideoSourceSwitch(different, live), false);
  assert.deepEqual(musicWatchQueue(different, offered, live), offered);
});

test("a stale current song absent from the queue cannot replace a different entry", () => {
  const current = song("stale", "Smart", "LE SSERAFIM");
  const live = { current, queue: [song("new", "New", "Artist")], queueIndex: 0 };
  const selected = musicVideoPlayback(
    song("mv", "LE SSERAFIM Smart Official MV", "HYBE LABELS", "video"),
    live,
  );
  assert.equal(musicVideoSourceSwitch(selected, live), false);
  assert.deepEqual(musicWatchQueue(selected, [selected], live), [selected]);
});

test("a video-labeled Spotify song still resolves its corresponding video", () => {
  const selected: MusicTrack = {
    ...song("spotify-audio", "Smart", "LE SSERAFIM", "video"),
    connectorId: "spotify",
    // The watch-page UI labels audio entries as video before resolving an upload.
  };
  const video = musicVideoQueueEntries([selected])[0];
  assert.equal(video.mediaKind, "video");
  assert.equal(video.videoSearch, true);
  assert.equal(queueTrackKey(video), queueTrackKey(selected));
  const uploaded: MusicTrack = {
    ...song("uploaded", "LE SSERAFIM Smart Official MV", "HYBE LABELS", "video"),
    sourceId: "upload00001",
  };
  assert.equal(queuedVideoStreamTrack(video, [uploaded])?.sourceId, "upload00001");
});

test("Song Mix: selecting a video for an Up Next song preserves the mix, not the search results", () => {
  const playing = song("mix-a", "Song A", "Artist A");
  const requested = {
    ...song("mix-b", "Smart", "LE SSERAFIM"),
    album: "UNFORGIVEN",
  };
  const following = song("mix-c", "Song C", "Artist C");
  const live = {
    current: playing,
    queue: [playing, requested, following],
    queueIndex: 0,
  };
  const selectedUpload = {
    ...song("official-mv", "LE SSERAFIM 'Smart' Official MV", "HYBE LABELS", "video"),
    videoSearch: false,
    sourceId: "official-mv",
  };
  const result = musicVideoQueueSelection(selectedUpload, requested, live);
  assert.ok(result, "the video belongs to the Up Next song, even though another song is playing");
  assert.deepEqual(result.queue.map(queueTrackKey), live.queue.map(queueTrackKey));
  assert.deepEqual(
    result.queue.map((entry) => entry.mediaKind),
    ["video", "video", "video"],
  );
  assert.deepEqual(
    result.queue.map((entry) => entry.id),
    ["mix-a", "official-mv", "mix-c"],
  );
  assert.equal(result.track.id, "official-mv");
  assert.equal(result.track.title, requested.title);
  assert.equal(result.track.artist, requested.artist);
  assert.equal(result.track.album, requested.album);
  assert.equal(queueTrackKey(result.track), queueTrackKey(requested));
  assert.equal(result.queue[1], result.track);
  assert.equal(live.queue[0].mediaKind, "audio", "the stored mix remains unmodified");
});

test("song-specific source selection trusts the user's chosen upload without guessing song identities", () => {
  const requested = song("spotify-song", "Song B", "Original Artist");
  requested.connectorId = "spotify";
  const live = { current: requested, queue: [requested], queueIndex: 0 };
  // Some valid uploads omit the act or title from their YouTube metadata.
  const picked = song("video-upload", "Official Music Video", "Label Channel", "video");
  const result = musicVideoQueueSelection(picked, requested, live);
  assert.ok(result);
  assert.equal(result.track.id, "video-upload", "play exactly what was selected");
  assert.equal(result.track.title, requested.title, "retain the queued song's display identity");
  assert.equal(result.track.artist, requested.artist);
  assert.equal(result.track.connectorId, "youtube");
  assert.equal(result.track.collectionOrigin?.connectorId, "spotify");
  assert.equal(result.track.collectionOrigin?.id, "spotify-song");
  assert.deepEqual(result.queue.map(queueTrackKey), live.queue.map(queueTrackKey));
});

test("a stale video search cannot replace a changed Song Mix", () => {
  const requested = song("gone", "Smart", "LE SSERAFIM");
  const live = {
    current: song("new", "Different Song", "Artist"),
    queue: [song("new", "Different Song", "Artist")],
    queueIndex: 0,
  };
  const video = song("mv", "LE SSERAFIM Smart Official MV", "HYBE LABELS", "video");
  assert.equal(musicVideoQueueSelection(video, requested, live), null);
});

test("the contextual search request flows from Music view through the video playback queue", async () => {
  const { readFileSync } = await import("node:fs");
  const view = readFileSync("src/views/music.tsx", "utf8");
  const watch = readFileSync("src/components/music/music-watch.tsx", "utf8");
  assert.match(view, /videoSelectionTarget\.current = getMusicState\(\)\.queue\.some\(/);
  assert.match(view, /queueTarget=\{watch\.queueTarget\}/);
  assert.match(watch, /musicVideoQueueSelection\(track, queueTarget, current\)/);
  assert.match(watch, /selected\?\.queue \?\? musicWatchQueue\(/);
  assert.match(watch, /const sourceSwitch = !!selected \|\| musicVideoSourceSwitch\(/);
});
