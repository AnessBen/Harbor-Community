import assert from "node:assert/strict";
import test from "node:test";
import { createAsyncIndexCache } from "../src/lib/ebook/search-performance";

test("concurrent local searches reuse the same scan, including an empty index", async () => {
  const cache = createAsyncIndexCache<string, string[]>();
  let scans = 0;
  const scan = async () => { scans++; return ["book.epub"]; };
  const [first, second] = await Promise.all([
    cache.read("local:books", scan),
    cache.read("local:books", scan),
  ]);
  assert.equal(scans, 1);
  assert.deepEqual(first, second);
  await cache.read("local:books", scan);
  assert.equal(scans, 1);
  const empty = async () => { scans++; return []; };
  assert.deepEqual(await cache.read("local:empty", empty), []);
  await cache.read("local:empty", empty);
  assert.equal(scans, 2);
});

test("refresh prevents an old scan from overwriting the new index", async () => {
  const cache = createAsyncIndexCache<string, string>();
  let completeOld!: (value: string) => void;
  const oldScan = cache.read("local:books", () => new Promise((resolve) => { completeOld = resolve; }));
  await Promise.resolve();
  cache.invalidate("local:books");
  const fresh = await cache.read("local:books", async () => "fresh");
  completeOld("stale");
  await oldScan;
  assert.equal(fresh, "fresh");
  assert.equal(cache.peek("local:books"), "fresh");
});

test("a failed scan is retryable", async () => {
  const cache = createAsyncIndexCache<string, string>();
  await assert.rejects(cache.read("library", async () => { throw Error("bad scan"); }));
  assert.equal(await cache.read("library", async () => "recovered"), "recovered");
});
