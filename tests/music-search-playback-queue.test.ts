import assert from "node:assert/strict";
import test from "node:test";
import { searchPlaybackQueue } from "../src/lib/music/search-playback-queue";
import { MusicQueueOrder } from "../src/lib/music/queue-order";
import type { MusicTrack } from "../src/lib/music/types";
const song = (id: string, connectorId = "catalog", video = false): MusicTrack => ({
  id,
  connectorId,
  title: id,
  artist: "Artist",
  artwork: "",
  durationSeconds: 180,
  durationLabel: "3:00",
  ...(video ? { mediaKind: "video" as const } : {}),
});
test("search retains ranking, selected index and subsequent tracks", () => {
  const a = song("a"),
    b = song("b"),
    c = song("c");
  const queue = searchPlaybackQueue(b, [a, b, c]);
  assert.deepEqual(queue, [a, b, c]);
  assert.equal(new MusicQueueOrder().next(queue, 1, { shuffle: false, repeat: "off" }, false), c);
});
test("top result absent from the ranked tracks is inserted without losing the list", () => {
  const a = song("a"),
    b = song("b"),
    top = song("top");
  assert.deepEqual(searchPlaybackQueue(top, [a, b]), [top, a, b]);
});
test("search audio and video queues remain separate", () => {
  const a = song("a"),
    b = song("b", "youtube", true),
    c = song("c");
  assert.deepEqual(searchPlaybackQueue(a, [a, b, c]), [a, c]);
  assert.deepEqual(searchPlaybackQueue(b, [a, b, c]), [b]);
});
test("same source identity is unique and selected metadata wins", () => {
  const a = song("a"),
    b = song("b"),
    selected = { ...a, title: "Selected" };
  assert.deepEqual(searchPlaybackQueue(selected, [a, a, b]), [selected, b]);
});
test("source-resolved identity stays at the original position", () => {
  const a = song("a"),
    b = song("b"),
    resolved = {
      ...song("yt", "youtube"),
      collectionOrigin: { id: a.id, connectorId: a.connectorId },
    };
  assert.deepEqual(searchPlaybackQueue(resolved, [b, a]), [b, resolved]);
});
