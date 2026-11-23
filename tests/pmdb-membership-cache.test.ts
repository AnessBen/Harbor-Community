import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/lib/publicmetadb/watchlist.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  const events: string[] = [];
  let profile = "profile-a";
  let session = { apiKey: "account-a" };
  let defaultList = "watchlist-a";
  let listChanged: () => void = () => {};
  let rejectItems = false;
  let deferItems: Promise<void> | null = null;
  const members: Array<{ id: string; tmdb_id: number; media_type: "tv"; list_id: string }> = [
    { id: "item-1", tmdb_id: 900, media_type: "tv", list_id: "watchlist-a" },
  ];
  const exports: Record<string, any> = {};
  const guard = (extra?: () => void) => {
    const ownerProfile = profile;
    const ownerSession = session;
    return () => {
      extra?.();
      if (ownerProfile !== profile || ownerSession !== session)
        throw new DOMException("Account changed", "AbortError");
    };
  };

  new Function("require", "exports", compiled)((id: string) => {
    if (id === "@/lib/active-profile-id")
      return { activeProfileId: () => profile };
    if (id === "./session") return {
      getSession: () => session,
      isAuthenticated: () => !!session.apiKey,
    };
    if (id === "./lists") return {
      capturePmdbListOwner: guard,
      clearPmdbListsCache: () => { events.push("clear-lists"); },
      getPmdbDefaultListId: () => defaultList,
      subscribePmdbLists: (fn: () => void) => {
        listChanged = fn;
        return () => {};
      },
      resolvePmdbList: async ({ listId }: { listId?: string | null }) => {
        const selected = listId ?? defaultList;
        events.push("list:" + selected);
        return { id: selected, type: "watchlist" };
      },
      fetchPmdbListItems: async (id: string) => {
        events.push("items:" + id);
        if (deferItems) await deferItems;
        if (rejectItems) throw new Error("PMDB unavailable");
        return members.filter((item) => item.list_id === id).map((item) => ({ ...item }));
      },
      changePmdbList: async (target: { tmdb_id: number; media_type: "tv" }, add: boolean) => {
        events.push(add ? "add" : "remove");
        if (add)
          members.push({ id: "item-new", tmdb_id: target.tmdb_id,
            media_type: target.media_type, list_id: defaultList });
        else
          members.splice(0, members.length,
            ...members.filter((item) => item.tmdb_id !== target.tmdb_id));
        listChanged();
      },
    };
    if (id === "./mappings") return { getTmdbForExternal: async () => null };
    throw new Error("Unexpected dependency: " + id);
  }, exports);

  return {
    events,
    setReject(value: boolean) { rejectItems = value; },
    setDeferred(value: Promise<void> | null) { deferItems = value; },
    setAccount(value: string) { session = { apiKey: value }; listChanged(); },
    setProfile(value: string) { profile = value; },
    setDefaultList(value: string) { defaultList = value; listChanged(); },
    notifyListChanged() { listChanged(); },
    fetch: exports.fetchPmdbWatchlist as (options?: {
      listId?: string | null; strict?: boolean; cacheForStatus?: boolean;
      assertCurrent?: () => void;
    }) => Promise<Array<{ id: string; tmdb_id: number; media_type: "tv" }>>,
    contains: exports.pmdbWatchlistContains as (
      items: Array<{ id: string; tmdb_id: number; media_type: "tv" }>,
      target: { tmdb_id: number; media_type: "tv" },
    ) => unknown,
    add: exports.addToPmdbWatchlist as (
      target: { tmdb_id: number; media_type: "tv" }, opts?: { strict?: boolean },
    ) => Promise<boolean>,
    remove: exports.removeFromPmdbWatchlist as (
      target: { tmdb_id: number; media_type: "tv" }, opts?: { strict?: boolean },
    ) => Promise<boolean>,
    clear: exports.clearPmdbWatchlistCache as () => void,
  };
}
const opts = { cacheForStatus: true, strict: true };

test("simultaneous PMDB hero and overflow membership checks share a validated read", async () => {
  const h = harness();
  const results = await Promise.all([h.fetch(opts), h.fetch(opts), h.fetch(opts)]);
  assert.equal(results.length, 3);
  assert.equal(results[0][0].tmdb_id, 900);
  assert.equal(h.events.filter((event) => event === "items:watchlist-a").length, 1);
  const again = await h.fetch(opts);
  assert.equal(again[0].tmdb_id, 900);
  assert.equal(h.events.filter((event) => event === "items:watchlist-a").length, 1);
  await h.fetch({ strict: true });
  assert.equal(h.events.filter((event) => event === "items:watchlist-a").length, 2,
    "authoritative uncached read must still reach PMDB");
});

test("PMDB membership cache invalidates after successful add and remove", async () => {
  const h = harness();
  await h.fetch(opts);
  assert.equal(await h.add({ tmdb_id: 901, media_type: "tv" }, { strict: true }), true);
  assert.ok(h.contains(await h.fetch(opts), { tmdb_id: 901, media_type: "tv" }));
  assert.equal(await h.remove({ tmdb_id: 901, media_type: "tv" }, { strict: true }), true);
  assert.equal(h.contains(await h.fetch(opts), { tmdb_id: 901, media_type: "tv" }), null);
  assert.equal(h.events.filter((event) => event === "items:watchlist-a").length, 3);
});

test("PMDB status cache respects the chosen list, profile, and session", async () => {
  const h = harness();
  await h.fetch(opts);
  h.setDefaultList("watchlist-b");
  assert.deepEqual(await h.fetch(opts), []);
  h.setProfile("profile-b");
  await h.fetch(opts);
  h.setAccount("account-b");
  await h.fetch(opts);
  assert.equal(h.events.filter((event) => event.startsWith("items:")).length, 4);
});

test("failed PMDB list reads retry instead of caching false membership", async () => {
  const h = harness();
  h.setReject(true);
  await assert.rejects(h.fetch(opts));
  h.setReject(false);
  assert.equal((await h.fetch(opts)).length, 1);
  assert.equal(h.events.filter((event) => event.startsWith("items:")).length, 2);
});

test("PMDB stale in-flight membership cannot repopulate the invalidated cache", async () => {
  const h = harness();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  h.setDeferred(gate);
  const stale = h.fetch(opts);
  h.notifyListChanged();
  h.setDeferred(null);
  const fresh = h.fetch(opts);
  release();
  await assert.rejects(stale, /changed during status lookup/i);
  await fresh;
  await h.fetch(opts);
  assert.equal(h.events.filter((event) => event.startsWith("items:")).length, 2);
});

test("cached PMDB hits still verify the account guard and expire after 15 seconds", async () => {
  const h = harness();
  const originalNow = Date.now;
  let now = originalNow();
  try {
    Date.now = () => now;
    await h.fetch(opts);
    let checks = 0;
    await h.fetch({ ...opts, assertCurrent: () => { checks++; } });
    assert.ok(checks > 0);
    now += 15_001;
    await h.fetch(opts);
    assert.equal(h.events.filter((event) => event.startsWith("items:")).length, 2);
  } finally { Date.now = originalNow; }
});

test("PMDB cache clear and list read paths remain separate from authoritative writes", async () => {
  const h = harness();
  await h.fetch(opts);
  h.clear();
  await h.fetch(opts);
  assert.equal(h.events.filter((event) => event.startsWith("items:")).length, 2);
  assert.ok(h.events.includes("clear-lists"));
  const lists = readFileSync("src/lib/publicmetadb/lists.ts", "utf8");
  assert.match(lists, /const items = await fetchPmdbListItems\(list\.id, guard\)/,
    "removal must locate its item from a fresh server read");
  const button = readFileSync("src/views/detail/add-to-publicmetadb-button.tsx", "utf8");
  assert.match(button, /cacheForStatus: true/);
});
