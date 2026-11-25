import assert from "node:assert/strict";
import test from "node:test";
import { fillSingleSongQueue } from "../src/lib/music/single-song-queue";
import type { MusicTrack } from "../src/lib/music/types";

const song = (id: string, artist = "Artist", connectorId = "youtube"): MusicTrack => ({
  id,
  title: id,
  artist,
  connectorId,
  artwork: "",
  durationSeconds: 180,
  durationLabel: "3:00",
});
function fixture() {
  const seed = song("seed");
  const a = song("a", "Other artist");
  const b = song("b", "Third artist");
  let state = { current: seed as MusicTrack | null, queue: [seed], phase: "playing", revision: 1 };
  let finish!: (tracks: MusicTrack[]) => void;
  let calls = 0;
  const pending = new Promise<MusicTrack[]>((resolve) => {
    finish = resolve;
  });
  const api = {
    snapshot: () => state,
    recommendations: async () => {
      calls++;
      return pending;
    },
    filter: (tracks: MusicTrack[]) => tracks,
    apply: (queue: MusicTrack[]) => {
      state = { ...state, queue };
    },
  };
  return {
    seed,
    a,
    b,
    api,
    finish,
    state: () => state,
    calls: () => calls,
    update: (patch: Partial<typeof state>) => {
      state = { ...state, ...patch };
    },
  };
}
test("a standalone song stays first and gets related recordings without duplicates or video", async () => {
  const f = fixture();
  const work = fillSingleSongQueue(f.seed, f.api);
  f.finish([
    f.seed,
    { ...f.seed, id: "same-recording", connectorId: "catalog" },
    f.a,
    f.a,
    { ...f.b, mediaKind: "video" },
    f.b,
  ]);
  await work;
  assert.deepEqual(f.state().queue, [f.seed, f.a, f.b]);
  assert.equal(f.calls(), 1);
});
test("a playlist or search collection is not replaced", async () => {
  const f = fixture();
  f.update({ queue: [f.seed, f.a] });
  await fillSingleSongQueue(f.seed, f.api);
  assert.equal(f.calls(), 0);
});
test("a manually edited queue wins over pending recommendations", async () => {
  const f = fixture();
  const work = fillSingleSongQueue(f.seed, f.api);
  f.update({ queue: [f.seed, f.b] });
  f.finish([f.a]);
  await work;
  assert.deepEqual(f.state().queue, [f.seed, f.b]);
});
test("a fresh playback request or failure prevents stale recommendations", async () => {
  for (const patch of [{ revision: 2 }, { phase: "error" }, { current: null }]) {
    const f = fixture();
    const work = fillSingleSongQueue(f.seed, f.api);
    f.update(patch);
    f.finish([f.a]);
    await work;
    assert.deepEqual(f.state().queue, [f.seed]);
  }
});
test("a failed recommendation lookup leaves the selected song intact", async () => {
  const f = fixture();
  await fillSingleSongQueue(f.seed, {
    ...f.api,
    recommendations: async () => {
      throw Error("unavailable");
    },
  });
  assert.deepEqual(f.state().queue, [f.seed]);
});

test("audio-quality metadata updates do not invalidate pending recommendations", async () => {
  const f = fixture();
  const work = fillSingleSongQueue(f.seed, f.api);
  const measured = { ...f.seed, quality: { codec: "opus", bitrateKbps: 128 } };
  f.update({ current: measured, queue: [measured], phase: "paused" });
  f.finish([f.a, f.b]);
  await work;
  assert.deepEqual(f.state().queue, [measured, f.a, f.b]);
  assert.equal(f.state().queue[0], measured);
});
test("a different singleton queue is still rejected even if the playback revision is unchanged", async () => {
  const f = fixture();
  const work = fillSingleSongQueue(f.seed, f.api);
  f.update({ queue: [f.b] });
  f.finish([f.a]);
  await work;
  assert.deepEqual(f.state().queue, [f.b]);
});
test("a source-resolved metadata update retains the original queue identity", async () => {
  const f = fixture();
  const work = fillSingleSongQueue(f.seed, f.api);
  const resolved = {
    ...f.seed,
    id: "resolved",
    connectorId: "soundcloud",
    collectionOrigin: { id: f.seed.id, connectorId: f.seed.connectorId },
  };
  f.update({ current: resolved, queue: [resolved] });
  f.finish([f.a]);
  await work;
  assert.deepEqual(f.state().queue, [resolved, f.a]);
});
