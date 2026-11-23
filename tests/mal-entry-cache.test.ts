import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/lib/mal/mutations.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  const events: string[] = [];
  let username = "test-account-a";
  let profile = "profile-a";
  let sessionChanged: () => void = () => {};
  let rejectReads = false;
  let status = "watching";
  let deferRead: Promise<void> | null = null;
  const exports: Record<string, any> = {};

  new Function("require", "exports", compiled)((id: string) => {
    if (id === "@/lib/active-profile-id")
      return { activeProfileId: () => profile };
    if (id === "./session") return {
      getSession: () => ({ userName: username }),
      subscribeSession: (fn: () => void) => {
        sessionChanged = fn;
        return () => {};
      },
    };
    if (id === "./client") return {
      malRequest: async (path: string, options?: { method?: string }) => {
        const method = options?.method ?? "GET";
        events.push(method + ":" + path);
        if (method === "GET") {
          if (deferRead) await deferRead;
          if (rejectReads) throw new Error("MAL unavailable");
          return {
            id: Number(path.split("/")[2].split("?")[0]),
            num_episodes: 24,
            my_list_status: {
              status,
              num_episodes_watched: status === "completed" ? 24 : 3,
            },
          };
        }
        if (method === "PATCH") {
          status = "completed";
          return { status: "completed", num_episodes_watched: 24 };
        }
        if (method === "DELETE") return undefined;
        throw new Error("Unexpected method: " + method);
      },
    };
    throw new Error("Unexpected dependency: " + id);
  }, exports);

  return {
    events,
    setAccount(value: string) { username = value; },
    setProfile(value: string) { profile = value; },
    invalidateSession() { sessionChanged(); },
    setRejectReads(value: boolean) { rejectReads = value; },
    setDeferredRead(value: Promise<void> | null) { deferRead = value; },
    fetch: exports.fetchListEntry as (id: number, strict?: boolean) => Promise<any>,
    save: exports.saveListEntry as (data: { malId: number; status: string }) => Promise<any>,
    remove: exports.deleteListEntry as (id: number) => Promise<boolean>,
  };
}

test("simultaneous MAL detail, menu and progress reads share one API request", async () => {
  const h = harness();
  const [a, b, c] = await Promise.all([h.fetch(101), h.fetch(101), h.fetch(101)]);
  assert.deepEqual([a.entry.status, b.entry.status, c.entry.status],
    ["watching", "watching", "watching"]);
  assert.equal(h.events.length, 1);
  await h.fetch(101);
  assert.equal(h.events.length, 1, "repeat lookup reuses the recent result");
  await h.fetch(101, true);
  assert.equal(h.events.length, 2, "strict verification bypasses the cache");
});

test("MAL writes invalidate cached entry state and preserve strict behavior", async () => {
  const h = harness();
  await h.fetch(102);
  await h.save({ malId: 102, status: "completed" });
  assert.equal((await h.fetch(102)).entry.status, "completed");
  assert.equal(await h.remove(102), true);
  await h.fetch(102);
  assert.deepEqual(h.events.map((event) => event.split(":")[0]),
    ["GET", "PATCH", "GET", "DELETE", "GET"]);
});

test("MAL status cache is isolated by both account and Harbor profile", async () => {
  const h = harness();
  await h.fetch(103);
  h.setAccount("test-account-b");
  await h.fetch(103);
  h.setProfile("profile-b");
  await h.fetch(103);
  h.invalidateSession();
  await h.fetch(103);
  assert.equal(h.events.length, 4);
});

test("failed MAL lookups retry and do not poison the shared cache", async () => {
  const h = harness();
  h.setRejectReads(true);
  await assert.rejects(h.fetch(104));
  h.setRejectReads(false);
  assert.equal((await h.fetch(104)).entry.status, "watching");
  assert.equal(h.events.length, 2);
});

test("an invalidated in-flight MAL read cannot overwrite a newer result", async () => {
  const h = harness();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  h.setDeferredRead(gate);
  const stale = h.fetch(105);
  h.invalidateSession();
  h.setDeferredRead(null);
  const fresh = h.fetch(105);
  release();
  await Promise.all([stale, fresh]);
  await h.fetch(105);
  assert.equal(h.events.length, 2, "invalidated pending read is never cached again");
});

test("MAL status cache expires after its short TTL", async () => {
  const h = harness();
  const originalNow = Date.now;
  let now = originalNow();
  try {
    Date.now = () => now;
    await h.fetch(106);
    now += 14_000;
    await h.fetch(106);
    now += 1_001;
    await h.fetch(106);
    assert.equal(h.events.length, 2);
  } finally { Date.now = originalNow; }
});
