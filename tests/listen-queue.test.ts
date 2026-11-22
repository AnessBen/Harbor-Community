import assert from "node:assert/strict";
import test from "node:test";
import { createListenQueueBuilder } from "../src/lib/listen-together/queue";
import type { MusicTrack } from "../src/lib/music/types";

const track = (id: string): MusicTrack => ({
  id,
  connectorId: "online",
  title: id,
  artist: "Artist",
  artwork: "",
  durationLabel: "",
  durationSeconds: 0,
});
const mode = { repeat: "off", shuffle: false } as const;
test("reorders preserve entry IDs for duplicate recordings and expose the current entry", () => {
  const build = createListenQueueBuilder();
  const a = track("a"),
    b = track("a"),
    c = track("c");
  const before = build(a, [b, c], mode),
    after = build(a, [c, b], { repeat: "all", shuffle: true });
  assert.notEqual(before.entries[0].entryId, before.entries[1].entryId);
  assert.deepEqual(after.entries, [before.entries[0], before.entries[2], before.entries[1]]);
  assert.equal(after.currentEntryId, before.entries[0].entryId);
  assert.equal(build(null, [a, a], mode).entries.length, 2);
  assert.equal(after.shuffle, true);
});
test("the queue excludes local media and private URLs and fits the relay frame in UTF-8", () => {
  const build = createListenQueueBuilder();
  const tracks = Array.from({ length: 250 }, (_, i) => ({
    ...track(String(i)),
    title: "歌".repeat(256),
    playbackUrl: "private",
  }));
  const queue = build(
    { ...track("local:song"), connectorId: "local" },
    [track("https://private.example/track"), ...tracks],
    mode,
  );
  assert.equal(queue.currentEntryId, null);
  assert.ok(queue.entries.length > 1 && queue.entries.length < 200);
  assert.ok(!JSON.stringify(queue).includes("private"));
  assert.ok(
    Buffer.byteLength(
      JSON.stringify({ t: "listen-queue", queue: { ...queue, revision: Number.MAX_SAFE_INTEGER } }),
    ) <= 32768,
  );
  assert.equal(
    build(
      null,
      Array.from({ length: 250 }, (_, i) => track(String(i))),
      mode,
    ).entries.length,
    200,
  );
});
