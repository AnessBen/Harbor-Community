import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { RecommendationContinuation } from "../src/lib/music/recommendation-continuation";
import { fillSingleSongQueue } from "../src/lib/music/single-song-queue";
import {
  queueInsertAfterManualBlock,
  withTrackNext,
  markManuallyQueued,
} from "../src/lib/music/queue-insert";
import { MusicQueueOrder, queueTrackKey } from "../src/lib/music/queue-order";
import {
  cancelMusicQueueAutomation,
  ownMusicQueueAutomation,
  ownsMusicQueueAutomation,
} from "../src/lib/music/queue-automation";
import type { MusicTrack } from "../src/lib/music/types";

const song = (id: string, artist = "Artist"): MusicTrack => ({
  id,
  title: id,
  artist,
  connectorId: "youtube",
  artwork: "",
  durationSeconds: 180,
  durationLabel: "3:00",
});
function fixture() {
  const queue = Array.from({ length: 41 }, (_, i) => song(String(i)));
  let state = { current: queue[0] as MusicTrack | null, queue, phase: "playing", enabled: true };
  let now = 0,
    count = 0,
    remaining = 40;
  let resolve!: (tracks: MusicTrack[]) => void;
  let reject!: (reason: Error) => void;
  const c = new RecommendationContinuation({
    snapshot: () => state,
    remaining: () => remaining,
    recommendations: () => {
      count++;
      return new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
    },
    filter: (tracks) => tracks.filter((t) => t.artist !== "Blocked"),
    apply: (queue) => {
      state = { ...state, queue };
    },
    now: () => now,
  });
  const at = (index: number) => {
    state = { ...state, current: state.queue[index] };
    remaining = state.queue.length - index - 1;
  };
  return {
    c,
    at,
    count: () => count,
    get: () => state,
    resolve: (t: MusicTrack[]) => resolve(t),
    reject: () => reject(Error("unavailable")),
    update: (patch: Partial<typeof state>) => {
      state = { ...state, ...patch };
    },
    advanceTime: (ms: number) => {
      now += ms;
    },
  };
}
const tick = () => Promise.resolve();
test("refills at four upcoming tracks, with one request and 18 unique additions", async () => {
  const f = fixture();
  f.at(35);
  assert.equal(f.c.request(), null);
  f.at(36);
  const p = f.c.request()!;
  assert.equal(f.c.request(), p);
  await tick();
  assert.equal(f.count(), 1);
  const fresh = Array.from({ length: 25 }, (_, i) => song("new" + i));
  f.resolve([
    f.get().queue[0],
    { ...f.get().queue[1], id: "other-source", connectorId: "catalog" },
    song("blocked", "Blocked"),
    { ...song("video"), mediaKind: "video" },
    ...fresh,
    fresh[0],
  ]);
  assert.equal(await p, true);
  assert.equal(f.get().queue.length, 59);
  assert.deepEqual(f.get().queue.slice(41), fresh.slice(0, 18));
  assert.equal(f.c.request(), null);
  f.at(54);
  const p2 = f.c.request()!;
  await tick();
  f.resolve([fresh[0], song("second-batch")]);
  assert.equal(await p2, true);
  assert.equal(f.get().queue.at(-1)?.id, "second-batch");
});
test("normal collections, repeat modes and paused playback do not initiate refill", () => {
  const f = fixture();
  f.at(40);
  f.update({ enabled: false });
  assert.equal(f.c.request(), null);
  assert.equal(f.c.request(true), null);
  f.update({ enabled: true, phase: "paused" });
  assert.equal(f.c.request(), null);
  assert.equal(f.count(), 0);
});
test("metadata changes and advancing within the same queue preserve the pending refill", async () => {
  const f = fixture();
  f.at(36);
  const p = f.c.request()!;
  await tick();
  f.at(37);
  const measured = { ...f.get().current!, quality: { codec: "opus" } };
  f.update({
    current: measured,
    queue: f.get().queue.map((t) => (t.id === measured.id ? measured : t)),
  });
  f.resolve([song("new")]);
  assert.equal(await p, true);
  assert.equal(f.get().queue[37], measured);
});
test("unrecognized replacements, cancellation, repeat changes and error discard in-flight results", async () => {
  for (const change of ["edit", "cancel", "repeat", "error"]) {
    const f = fixture();
    f.at(36);
    const p = f.c.request()!;
    await tick();
    if (change === "edit") f.update({ queue: [f.get().current!] });
    if (change === "cancel") f.c.stop();
    if (change === "repeat") f.update({ enabled: false });
    if (change === "error") f.update({ phase: "error" });
    const before = f.get().queue;
    f.resolve([song("new")]);
    assert.equal(await p, false);
    assert.equal(f.get().queue, before);
  }
});
test("end of queue joins an in-flight refill instead of launching another", async () => {
  const f = fixture();
  f.at(36);
  const p = f.c.request()!;
  await tick();
  f.at(40);
  assert.equal(f.c.request(true), p);
  f.update({ phase: "paused" });
  f.resolve([song("new")]);
  assert.equal(await p, true);
  assert.equal(f.count(), 1);
  assert.equal(f.get().queue[41].id, "new");
});
test("failed or duplicate-only batches back off and never loop on the same seed", async () => {
  const f = fixture();
  f.at(36);
  const p = f.c.request()!;
  await tick();
  f.reject();
  assert.equal(await p, false);
  f.at(37);
  assert.equal(f.c.request(), null);
  f.advanceTime(60_000);
  const p2 = f.c.request()!;
  await tick();
  f.resolve(f.get().queue);
  assert.equal(await p2, false);
  f.advanceTime(60_000);
  assert.equal(f.c.request(true), null);
  f.at(38);
  const p3 = f.c.request()!;
  await tick();
  f.resolve([song("new")]);
  assert.equal(await p3, true);
});
test("explicit queue replacement cancels ownership without dropping existing recommendations", () => {
  let stopped = false;
  const owner = ownMusicQueueAutomation(() => {
    stopped = true;
  });
  assert.equal(ownsMusicQueueAutomation(owner), true);
  assert.equal(cancelMusicQueueAutomation(), false);
  assert.equal(stopped, true);
  assert.equal(ownsMusicQueueAutomation(owner), false);
});
test("shuffle refill preview excludes visited tracks after append", () => {
  const order = new MusicQueueOrder();
  const queue = Array.from({ length: 8 }, (_, i) => song(String(i)));
  const modes = { shuffle: true, repeat: "off" as const };
  const random = () => 0.5;
  let index = 0;
  for (let i = 0; i < 7; i++) {
    const next = order.next(queue, index, modes, true, null, random)!;
    index = queue.indexOf(next);
  }
  assert.equal(order.upcoming(queue, index, modes, 5, random).length, 0);
  const appended = [...queue, song("new1"), song("new2")];
  assert.deepEqual(
    new Set(order.upcoming(appended, index, modes, 5, random).map((t) => t.id)),
    new Set(["new1", "new2"]),
  );
});

/** Exercise the actual EOF transport path, without starting a native stream. */
function playerEndFixture(generated: boolean) {
  const source = readFileSync(new URL("../src/lib/music/player.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("player.ts", source, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "nextMusic",
  )!;
  const code = ts.transpileModule(fn.getText(tree), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const seed = song("last"),
    next = song("next");
  const state = {
    current: seed,
    queue: [seed],
    queueIndex: 0,
    phase: "playing",
    duration: 180,
    currentTime: 180,
  };
  let complete!: (added: boolean) => void;
  const pending = new Promise<boolean>((resolve) => {
    complete = resolve;
  });
  let requests = 0;
  const controller = {
    request: () => {
      requests++;
      return pending;
    },
  };
  const played: MusicTrack[] = [];
  const transport = { repeat: "off" };
  const scope = {
    state,
    autoSkipped: new Set(),
    getMusicTransport: () => transport,
    ownsMusicVideo: () => false,
    getMusicSpeakerState: () => ({ active: false }),
    videoController: null,
    musicAdvance: () => state.queue[state.queueIndex + 1] ?? null,
    playMusic: async (track: MusicTrack) => {
      played.push(track);
    },
    invoke: async () => {},
    publish: (patch: Partial<typeof state>) => Object.assign(state, patch),
    pauseMusicSpeaker: async () => {},
  };
  const exports: {
    nextMusic?: (auto?: boolean) => void;
    replace?: () => void;
    changeRequest?: () => void;
  } = {};
  new Function(
    ...Object.keys(scope),
    "exports",
    "controller",
    "generated",
    "let followingListenHost=false, enginePrimed=true, playRequest=1,pendingRecommendationEnd=null;let recommendationContinuation=generated?controller:null;\n" +
      code +
      "\nexports.replace=()=>{recommendationContinuation=null;pendingRecommendationEnd=null;};exports.changeRequest=()=>{playRequest++;};",
  )(...Object.values(scope), exports, controller, generated);
  return {
    state,
    played,
    requests: () => requests,
    advance: exports.nextMusic!,
    replace: exports.replace!,
    changeRequest: exports.changeRequest!,
    transport,
    complete: (added: boolean) => {
      if (added) state.queue = [seed, next];
      complete(added);
    },
    next,
  };
}
test("actual player EOF waits for one refill and advances when the recommendations arrive", async () => {
  const f = playerEndFixture(true);
  f.advance(true);
  f.advance(true);
  assert.equal(f.requests(), 1);
  assert.equal(f.state.phase, "paused");
  assert.deepEqual(f.played, []);
  f.complete(true);
  await tick();
  assert.deepEqual(f.played, [f.next]);
});
test("actual player EOF remains finite for collections and stale or failed refills", async () => {
  const collection = playerEndFixture(false);
  collection.advance(true);
  assert.equal(collection.requests(), 0);
  assert.equal(collection.state.phase, "paused");
  for (const cancel of ["replace", "request", "repeat", "failure"]) {
    const f = playerEndFixture(true);
    f.advance(true);
    if (cancel === "replace") f.replace();
    if (cancel === "request") f.changeRequest();
    if (cancel === "repeat") f.transport.repeat = "all";
    f.complete(cancel !== "failure");
    await tick();
    assert.deepEqual(f.played, [], cancel);
  }
});

test("a replaced queue cannot inherit recommendation ownership even without an explicit cancellation", () => {
  const f = fixture();
  const replacement = song("new-collection");
  f.update({ current: replacement, queue: [replacement] });
  assert.equal(f.c.request(true), null);
  assert.equal(f.count(), 0);
});

test("adding, removing and reordering during a refill keeps edits and excludes removed recordings", async () => {
  const f = fixture();
  f.at(36);
  const p = f.c.request()!;
  await tick();
  const old = f.get().queue;
  const removed = old[38];
  const manual = song("manual");
  const edited = [...old.slice(0, 37), manual, old[40], old[37], old[39]];
  assert.equal(f.c.adoptEdit(edited), true);
  f.update({ queue: edited });
  f.resolve([
    removed,
    { ...removed, id: "different-upload", connectorId: "catalog" },
    manual,
    song("new"),
  ]);
  assert.equal(await p, true);
  assert.deepEqual(f.get().queue, [...edited, song("new")]);
  f.at(f.get().queue.length - 1);
  const p2 = f.c.request()!;
  await tick();
  f.resolve([removed, song("later")]);
  assert.equal(await p2, true);
  assert.equal(f.get().queue.at(-1)?.id, "later");
  assert.ok(!f.get().queue.includes(removed));
});
test("a user may explicitly re-add a removed song, but automatic refills may not", async () => {
  const f = fixture();
  f.at(36);
  const removed = f.get().queue[38];
  const edited = f.get().queue.filter((t) => t !== removed);
  assert.equal(f.c.adoptEdit(edited), true);
  f.update({ queue: edited });
  const restored = [...edited, removed];
  assert.equal(f.c.adoptEdit(restored), true);
  f.update({ queue: restored });
  const p = f.c.request()!;
  await tick();
  f.resolve([removed, song("fresh")]);
  assert.equal(await p, true);
  assert.equal(f.get().queue.filter((t) => t === removed).length, 1);
});
test("individual edits cannot retain ownership when they remove the current song", () => {
  const f = fixture();
  assert.equal(f.c.adoptEdit([]), false);
  assert.equal(f.c.adoptEdit(f.get().queue.slice(1)), false);
});
test("initial recommendations accept explicitly adopted edits without overwriting the user's queue", async () => {
  const seed = song("seed"),
    manual = song("manual"),
    removed = song("removed");
  let state = { current: seed, queue: [seed], phase: "playing", revision: 1, enabled: true };
  let resolve!: (tracks: MusicTrack[]) => void;
  const pending = new Promise<MusicTrack[]>((yes) => {
    resolve = yes;
  });
  const controller = new RecommendationContinuation(
    {
      snapshot: () => state,
      remaining: () => 0,
      recommendations: () => pending,
      filter: (t) => t,
      apply: (queue) => {
        state = { ...state, queue };
      },
    },
    false,
  );
  const result = fillSingleSongQueue(seed, {
    snapshot: () => state,
    recommendations: () => pending,
    acceptsQueue: (q) => controller.acceptsQueue(q),
    filter: (t) => controller.excludeSeen(t),
    apply: (queue) => {
      assert.equal(controller.adoptEdit(queue), true);
      state = { ...state, queue };
    },
  });
  assert.equal(controller.request(), null);
  let edited = [seed, manual, removed];
  assert.equal(controller.adoptEdit(edited), true);
  state = { ...state, queue: edited };
  edited = [seed, manual];
  assert.equal(controller.adoptEdit(edited), true);
  state = { ...state, queue: edited };
  resolve([manual, removed, song("fresh")]);
  await result;
  assert.deepEqual(state.queue, [seed, manual, song("fresh")]);
});
test("actual player individual edits preserve generated ownership and Clear Queue cancels it", async () => {
  const source = readFileSync(new URL("../src/lib/music/player.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("player.ts", source, ts.ScriptTarget.Latest, true);
  const names = ["setMusicQueue", "editMusicQueue", "enqueueMusic", "playNextMusic"];
  const functions = tree.statements.filter(
    (n) => ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? ""),
  );
  const code = ts.transpileModule(functions.map((n) => n.getText(tree)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const seed = song("seed"),
    a = song("a"),
    b = song("b"),
    manual = song("manual"),
    next = song("next");
  const state = {
    current: seed,
    queue: [seed, a, b],
    queueIndex: 0,
    phase: "playing",
    enabled: true,
  };
  let resolve!: (tracks: MusicTrack[]) => void;
  let pending = new Promise<MusicTrack[]>((yes) => {
    resolve = yes;
  });
  const exports = {} as Pick<
    typeof import("../src/lib/music/player"),
    "setMusicQueue" | "editMusicQueue" | "enqueueMusic" | "playNextMusic"
  >;
  const controller = new RecommendationContinuation({
    snapshot: () => state,
    remaining: () => 2,
    recommendations: () => pending,
    filter: (t) => t,
    apply: (queue) => exports.setMusicQueue(queue, owner),
  });
  const owner = ownMusicQueueAutomation(() => controller.stop());
  const scope = {
    state,
    recommendationContinuation: controller,
    queueTrackKey,
    filterBlockedTracks: (t: MusicTrack[]) => t,
    ownsMusicQueueAutomation,
    cancelMusicQueueAutomation,
    queueInsertAfterManualBlock,
    withTrackNext,
    markManuallyQueued,
    setMusicPriorityNext: () => {},
    publish: (patch: Partial<typeof state>) => Object.assign(state, patch),
    invoke: async () => {},
  };
  new Function(...Object.keys(scope), "exports", code)(...Object.values(scope), exports);
  const refill = controller.request()!;
  await tick();
  exports.enqueueMusic(manual);
  exports.playNextMusic(next);
  exports.editMusicQueue([seed, next, manual, b]);
  assert.equal(ownsMusicQueueAutomation(owner), true);
  resolve([a, song("fresh")]);
  assert.equal(await refill, true);
  assert.deepEqual(state.queue, [seed, next, manual, b, song("fresh")]);
  state.current = next;
  state.queueIndex = 1;
  pending = new Promise<MusicTrack[]>((yes) => {
    resolve = yes;
  });
  const lateRefill = controller.request()!;
  await tick();
  exports.setMusicQueue([seed, next]);
  assert.equal(ownsMusicQueueAutomation(owner), false);
  resolve([song("late")]);
  assert.equal(await lateRefill, false);
  assert.equal(controller.request(true), null);
  assert.deepEqual(state.queue, [seed, next]);
});
