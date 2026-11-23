import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAsyncIndexCache, withSearchDeadline } from "../src/lib/ebook/search-performance";

test("concurrent local searches reuse the same scan, including an empty index", async () => {
  const cache = createAsyncIndexCache<string, string[]>();
  let scans = 0;
  const scan = async () => {
    scans++;
    return ["book.epub"];
  };
  const [first, second] = await Promise.all([
    cache.read("local:books", scan),
    cache.read("local:books", scan),
  ]);
  assert.equal(scans, 1);
  assert.deepEqual(first, second);
  await cache.read("local:books", scan);
  assert.equal(scans, 1);
  const empty = async () => {
    scans++;
    return [];
  };
  assert.deepEqual(await cache.read("local:empty", empty), []);
  await cache.read("local:empty", empty);
  assert.equal(scans, 2);
});

test("refresh prevents an old scan from overwriting the new index", async () => {
  const cache = createAsyncIndexCache<string, string>();
  let completeOld!: (value: string) => void;
  const oldScan = cache.read(
    "local:books",
    () =>
      new Promise((resolve) => {
        completeOld = resolve;
      }),
  );
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
  await assert.rejects(
    cache.read("library", async () => {
      throw Error("bad scan");
    }),
  );
  assert.equal(await cache.read("library", async () => "recovered"), "recovered");
});

test("remote deadline stops waiting for an unresponsive provider", async () => {
  let providerSignal: AbortSignal | undefined;
  await assert.rejects(
    withSearchDeadline((signal) => {
      providerSignal = signal;
      return new Promise<string>(() => {});
    }, 10),
    /timed out/,
  );
  assert.equal(providerSignal?.aborted, true);
});

test("superseding a search aborts its request while letting later searches complete", async () => {
  const controller = new AbortController();
  let providerSignal: AbortSignal | undefined;
  const old = withSearchDeadline(
    (signal) => {
      providerSignal = signal;
      return new Promise<string>(() => {});
    },
    2_000,
    controller.signal,
  );
  controller.abort();
  await assert.rejects(old, /cancelled/);
  assert.equal(providerSignal?.aborted, true);
  assert.equal(await withSearchDeadline(async () => "next", 2_000), "next");
});

test("interactive provider searches stream results without waiting for cross-source metadata", () => {
  const providers = readFileSync(new URL("../src/lib/ebook/providers.ts", import.meta.url), "utf8");
  const start = providers.indexOf("export async function loadSourceEBookPage(");
  const end = providers.indexOf("export async function browseSourceEBooks(", start);
  const search = providers.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(search, /events\?\.onSource\?\.\(mergeEBookMetadata\(items, \[\]\)\)/);
  assert.match(search, /timedProviderSearch\(provider, query, offset, tagId, options\.signal\)/);
  assert.match(
    search,
    /if \(query\) return dedupeEBooks\(selected\)\.map\(applyLocalEBookDetails\)/,
  );
  assert.match(search, /provider\.enrich\(items\)/);
});

test("provider cancellation reaches Gutenberg, HTML sources and plugin workers", () => {
  const providers = readFileSync(new URL("../src/lib/ebook/providers.ts", import.meta.url), "utf8");
  const gutendex = readFileSync(new URL("../src/lib/ebook/gutendex.ts", import.meta.url), "utf8");
  assert.match(providers, /gutendexSearch\(query, offset, background, signal\)/);
  assert.match(providers, /page\(\s*`search:\$\{query\}`,[\s\S]*?offset,\s*signal/);
  assert.match(providers, /worker!\.call\(method, args, timeout, signal\)/);
  assert.match(
    gutendex,
    /fetchCatalog\(\x60\$\{GUTENDEX_BASE\}\$\{path\}\x60, background, signal\)/,
  );
});
