import assert from "node:assert/strict";
import test from "node:test";
import { NextTrackWarmup } from "../src/lib/music/next-track-warmup";

function deferred() {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("only one speculative request runs even when the queue changes", async () => {
  const warm = new NextTrackWarmup();
  const gate = deferred();
  let calls = 0;
  const first = warm.run(
    "a",
    () => true,
    async () => {
      calls++;
      return gate.promise;
    },
  );
  await warm.run(
    "b",
    () => true,
    async () => {
      calls++;
      return true;
    },
  );
  assert.equal(calls, 1);
  gate.resolve(true);
  await first;
  await warm.run(
    "b",
    () => true,
    async () => {
      calls++;
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("queue changes prevent a pending match from starting extraction", async () => {
  const warm = new NextTrackWarmup();
  const gate = deferred();
  let current = true;
  let extracted = false;
  const first = warm.run(
    "a",
    () => current,
    async (stillCurrent) => {
      await gate.promise;
      if (!stillCurrent()) return false;
      extracted = true;
      return true;
    },
  );
  current = false;
  gate.resolve(true);
  await first;
  assert.equal(extracted, false);
});

test("reset invalidates an old job without creating a second concurrent job", async () => {
  const warm = new NextTrackWarmup();
  const gate = deferred();
  let stale = false;
  let calls = 0;
  const first = warm.run(
    "a",
    () => true,
    async (stillCurrent) => {
      await gate.promise;
      stale = !stillCurrent();
      return true;
    },
  );
  warm.reset();
  await warm.run(
    "b",
    () => true,
    async () => {
      calls++;
      return true;
    },
  );
  assert.equal(calls, 0);
  gate.resolve(true);
  await first;
  assert.equal(stale, true);
  await warm.run(
    "a",
    () => true,
    async () => {
      calls++;
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("successful and failed warmups are both throttled", async () => {
  const warm = new NextTrackWarmup();
  let calls = 0;
  for (const key of ["good", "bad", "good", "bad"]) {
    await warm.run(
      key,
      () => true,
      async () => {
        calls++;
        return key === "good";
      },
    );
  }
  assert.equal(calls, 2);
});

test("a YouTube restriction suppresses speculative requests across queue changes", async () => {
  const warm = new NextTrackWarmup();
  let calls = 0;
  await warm.run(
    "one",
    () => true,
    async () => {
      calls++;
      throw new Error("YouTube rate limit. Wait 120 seconds before retrying.");
    },
  );
  warm.reset();
  await warm.run(
    "two",
    () => true,
    async () => {
      calls++;
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.equal(warm.isSuspended(), true);
});
