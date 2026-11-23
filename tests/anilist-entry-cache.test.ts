import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Result = {
  calls: string[];
  changeAccount: (userId: number) => void;
  invalidateSession: () => void;
  fetchListEntry: (
    id: number,
    strict?: boolean,
  ) => Promise<{
    episodes: number | null;
    entry: { status: string; progress: number } | null;
  }>;
  saveListEntry: (data: { mediaId: number; status: string }) => Promise<unknown>;
  deleteListEntry: (id: number) => Promise<boolean>;
};

function load(): Result {
  const file = readFileSync("src/lib/anilist/mutations.ts", "utf8");
  const code = ts.transpileModule(file, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let userId = 12;
  let subscribed: () => void = () => {};
  const calls: string[] = [];
  const exports: Record<string, any> = {};
  const data = {
    Media: {
      episodes: 24,
      mediaListEntry: {
        id: 99,
        status: "COMPLETED",
        progress: 24,
        private: false,
        customLists: [],
      },
    },
    Viewer: { mediaListOptions: { animeList: { customLists: [] } } },
  };
  new Function("require", "exports", code)((id: string) => {
    if (id === "./client")
      return {
        anilistRequest: async (query: string, vars: Record<string, any>) => {
          if (query.includes("SaveMediaListEntry(")) {
            calls.push("save:" + vars.mediaId);
            return { SaveMediaListEntry: { id: 99, status: vars.status, progress: 24 } };
          }
          if (query.includes("DeleteMediaListEntry(")) {
            calls.push("delete:" + vars.id);
            return { DeleteMediaListEntry: { deleted: true } };
          }
          calls.push("read:" + vars.mediaId);
          return data;
        },
      };
    if (id === "@/lib/active-profile-id") return { activeProfileId: () => "default" };
    if (id === "./session")
      return {
        getSession: () => ({ userId }),
        subscribeSession: (fn: () => void) => {
          subscribed = fn;
          return () => {};
        },
      };
    throw Error("unexpected import " + id);
  }, exports);
  return {
    calls,
    changeAccount: (next) => {
      userId = next;
    },
    invalidateSession: () => subscribed(),
    fetchListEntry: exports.fetchListEntry,
    saveListEntry: exports.saveListEntry,
    deleteListEntry: exports.deleteListEntry,
  };
}

test("concurrent detail, progress and overflow AniList reads share one request", async () => {
  const m = load();
  const [a, b, c] = await Promise.all([
    m.fetchListEntry(20474),
    m.fetchListEntry(20474),
    m.fetchListEntry(20474),
  ]);
  assert.deepEqual(
    [a.entry?.status, b.entry?.status, c.entry?.status],
    ["COMPLETED", "COMPLETED", "COMPLETED"],
  );
  assert.deepEqual(m.calls, ["read:20474"]);
  await m.fetchListEntry(20474);
  assert.deepEqual(m.calls, ["read:20474"], "repeat call uses short-lived cache");
  await m.fetchListEntry(20474, true);
  assert.deepEqual(m.calls, ["read:20474", "read:20474"], "strict verification bypasses cache");
});

test("AniList writes invalidate cached read and subsequent visits refetch", async () => {
  const m = load();
  await m.fetchListEntry(21450);
  await m.saveListEntry({ mediaId: 21450, status: "CURRENT" });
  await m.fetchListEntry(21450);
  await m.deleteListEntry(99);
  await m.fetchListEntry(21450);
  assert.deepEqual(m.calls, ["read:21450", "save:21450", "read:21450", "delete:99", "read:21450"]);
});

test("per-user cache avoids status leaking across AniList account changes", async () => {
  const m = load();
  await m.fetchListEntry(20799);
  m.changeAccount(13);
  await m.fetchListEntry(20799);
  m.invalidateSession();
  await m.fetchListEntry(20799);
  assert.deepEqual(m.calls, ["read:20799", "read:20799", "read:20799"]);
});
