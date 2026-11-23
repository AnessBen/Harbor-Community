import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const file = "src/views/detail/anime-episodes/use-entry-tracker-watched.ts";
const source = readFileSync(file, "utf8");
const exports: Record<string, unknown> = {};
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("require", "exports", compiled)((id: string) => {
  if (id === "react") return { useEffect() {}, useMemo() {}, useState() {} };
  if (id === "@/lib/aired") return { airedOnly: (eps: unknown[]) => eps };
  if (id === "@/lib/anilist/provider") return { useAnilist() {} };
  if (id === "@/lib/anilist/mutations") return { fetchListEntry() {} };
  if (id === "@/lib/anilist/sync") return { resolveAnilistMediaId() {} };
  if (id === "@/lib/mal/provider") return { useMal() {} };
  if (id === "@/lib/mal/mutations") return { fetchListEntry() {}, resolveMalMediaId() {} };
  if (id === "@/lib/tracker-status-events") return { useTrackerStatusVersion() {} };
  throw new Error("Unexpected import: " + id);
}, exports);
const watchedKeys = exports.watchedKeysForNativeEntry as (
  rows: Array<{ seasonNumber: number; number: number; airdate?: string }>,
  progress: number,
  completed: boolean,
  total: number | null,
) => Set<string>;
const cour = Array.from({ length: 24 }, (_, i) => ({
  seasonNumber: 1,
  number: i + 1,
  airdate: "2015-01-10",
}));

test("AniList progress remains relative to each native cour, not catalog season", () => {
  const first = watchedKeys(cour, 24, true, 24);
  const second = watchedKeys(cour, 24, true, 24);
  assert.equal(first.size, 24);
  assert.equal(second.size, 24);
  assert.ok(first.has("1:24"));
  assert.ok(second.has("1:1"));
  assert.ok(!first.has("2:24"), "AniList season 1 is entry-relative, not TVDB season 2");
});

test("a partial second cour never inherits completed progress from the first cour", () => {
  const partial = watchedKeys(cour, 3, false, 24);
  assert.deepEqual([...partial].sort(), ["1:1", "1:2", "1:3"]);
  assert.equal(watchedKeys(cour, 0, false, 24).size, 0);
  assert.equal(watchedKeys(cour, 900, false, 24).size, 24);
  assert.equal(watchedKeys(cour, 0, true, 24).size, 24);
});

test("multi-cour watched progress stays scoped to a native source ID", () => {
  const progress = readFileSync("src/views/detail/anime-episodes/use-anime-progress-map.ts", "utf8");
  const detail = readFileSync("src/views/detail/anime-episodes.tsx", "utf8");
  assert.match(progress, /entryAnilistBySource\?\.get\(ep\.sourceMetaId \?\? ""\)/);
  assert.match(progress, /entryMalBySource\?\.get\(ep\.sourceMetaId \?\? ""\)/);
  assert.match(detail, /useEntryTrackerWatched\(displayEpisodes\)/);
  assert.match(detail, /entryAnilistBySource: multiEntryWatched\.anilist/);
  assert.match(detail, /entryMalBySource: multiEntryWatched\.mal/);
});
