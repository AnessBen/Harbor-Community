import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as matching from "../src/lib/trailer-matching.ts";
import * as candidates from "../src/lib/trailer-candidates.ts";
import * as scheduler from "../src/lib/request-scheduler.ts";

const fixture = { id: "tt0206512", name: "SpongeBob SquarePants", releaseInfo: "1999", type: "series" };
const clip = "0lGyuTtYUJo";
const promo = "3iMZwqc1nqQ";
const movie = "47ceXAEr2Oo";
const typed = { key: "aaaaaaaaaaa", type: "Trailer", site: "YouTube", official: true, name: "Trailer" };
const compiled = ts.transpileModule(readFileSync("src/lib/trailer-resolver.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function resolver(videos: any[] = [], addonIds: string[] = [], addonOnly = false, editions: any[] = [], searchResults?: (query: string) => any[]) {
  const calls: string[] = [];
  const mocks: Record<string, any> = {
    "@tauri-apps/api/core": { invoke: async (command: string, args: any) => {
      calls.push(command);
      if (command === "probe_trailer_edition") return editions.find(e => e.id === args.videoId) ?? null;
      if (command === "inspect_trailer_video") return { id: args.videoId, title: "Krabby Patties Ranked By Size! | SpongeBob", channel: "SpongeBob SquarePants Official" };
      assert.equal(command, "search_trailer_videos");
      if (searchResults) return searchResults(args.query);
      assert.match(args.query, /SpongeBob SquarePants 1999 TV series official trailer/);
      return [
        { id: movie, title: "The SpongeBob SquarePants Movie (2004) Official Trailer", duration: 139 },
        { id: promo, title: "SpongeBob SquarePants Premiere Promo (July 12, 1999)", duration: 16 },
      ];
    }},
    "@/lib/cinemeta": { meta: async () => ({ trailerStreams: addonIds.map(ytId => ({ ytId })) }), narrowMediaType: (v: string) => v },
    "@/lib/metadata-policy": { readMetadataSettings: () => ({ addonOnlyMetadata: addonOnly }) },
    "@/lib/providers/tmdb/tmdb-imdb-resolve": { tmdbIdFromImdb: async () => "tmdb:tv:387" },
    "@/lib/providers/tmdb/tmdb-trailers": { tmdbTrailerVideos: async () => { calls.push("tmdb"); return videos; } },
    "@/lib/providers/tmdb/tmdb-client": { effectiveTmdbLanguage: () => "en-US" },
    "@/lib/trailer-matching": matching,
    "@/lib/trailer-candidates": candidates,
    "@/lib/request-scheduler": scheduler,
  };
  const exports: any = {};
  new Function("require", "exports", "window", compiled)((name: string) => {
    assert.ok(name in mocks, name); return mocks[name];
  }, exports, { __TAURI_INTERNALS__: {} });
  return { calls, resolve: exports.resolveTrailerCandidates as (meta: any, key: string, opts?: any) => Promise<string[]> };
}
test("rejects clip metadata and untrusted addon clip, then finds matching fallback", async () => {
  const r = resolver([{ ...typed, key: clip, type: "Clip" }], [clip]);
  assert.deepEqual(await r.resolve(fixture, "key"), [promo]);
  assert.deepEqual(r.calls, ["tmdb", "inspect_trailer_video", "search_trailer_videos"]);
});
test("trusted classified trailer is preferred without starting a YouTube search", async () => {
  const r = resolver([typed]);
  assert.deepEqual(await r.resolve(fixture, "key"), [typed.key]);
  assert.deepEqual(r.calls, ["tmdb"]);
});
test("addon-only mode does not query built-in TMDB and concurrent searches coalesce", async () => {
  const r = resolver([typed], [], true);
  const first = r.resolve(fixture, "key");
  const second = r.resolve(fixture, "key");
  assert.equal(first, second);
  assert.deepEqual(await first, [promo]);
  assert.deepEqual(await second, [promo]);
  assert.deepEqual(r.calls, ["search_trailer_videos"]);
});
test("an excluded clip cannot leak back through another source", async () => {
  const r = resolver([], [clip]);
  assert.deepEqual(await r.resolve(fixture, "key", { excludedIds: [clip] }), [promo]);
  assert.deepEqual(r.calls, ["tmdb", "search_trailer_videos"]);
});

test("shared resolver promotes a higher-resolution duplicate and caches probes", async () => {
  const a = "Lg8n_CA5BMY", b = "VHPDL0ghWNk";
  const envelope = Array.from({ length: 300 }, (_, i) => Math.sin(i * 1.9) + Math.cos(i * 0.21) + 6);
  const r = resolver([{ ...typed, key: a }, { ...typed, key: b }], [], false, [
    { id: a, height: 480, duration: 30, envelope },
    { id: b, height: 720, duration: 30, envelope },
  ]);
  assert.deepEqual(await r.resolve(fixture, "key"), [b]);
  assert.deepEqual(await r.resolve(fixture, "key"), [b]);
  assert.equal(r.calls.filter(c => c === "probe_trailer_edition").length, 2);
});

test("Jimmy Neutron retries a promo query when the movie dominates trailer search", async () => {
  const show = { id: "tt0320808", name: "The Adventures of Jimmy Neutron: Boy Genius", releaseInfo: "2002", type: "series" };
  const queries: string[] = [];
  const relatedMovie = { id: "f7vGlqs3-cE", title: "Jimmy Neutron: Boy Genius - Trailer", duration: 141 };
  const special = { id: "Y-4OnsLD5-c", title: "The Adventures of Jimmy Neutron Boy Genius: The Eggpire Strikes Back Promo", duration: 61 };
  const series = { id: "-tLvS-GpjKk", title: "The Adventures of Jimmy Neutron Boy Genius Promo (Nickelodeon 2002)", duration: 31 };
  const r = resolver([], [], false, [], query => {
    queries.push(query);
    return query.endsWith("series promo") ? [relatedMovie, special, series] : [relatedMovie, special];
  });
  assert.deepEqual(await r.resolve(show, "key"), [series.id]);
  assert.deepEqual(queries, [
    "The Adventures of Jimmy Neutron: Boy Genius 2002 TV series official trailer",
    "The Adventures of Jimmy Neutron Boy Genius 2002 series promo",
  ]);
  assert.deepEqual(await r.resolve(show, "key"), [series.id]);
  assert.equal(queries.length, 2);
});

test("excluded search matches cannot prevent a valid alternate query", async () => {
  const replacement = "GLgy7Vwml3Y";
  const r = resolver([], [], false, [], query =>
    query.endsWith("series promo")
      ? [{ id: replacement, title: "SpongeBob SquarePants Original Promo (1999)", duration: 16 }]
      : [{ id: promo, title: "SpongeBob SquarePants Premiere Promo (July 12, 1999)", duration: 16 }],
  );
  assert.deepEqual(await r.resolve(fixture, "key", { excludedIds: [promo] }), [replacement]);
  assert.deepEqual(r.calls, ["tmdb", "search_trailer_videos", "search_trailer_videos"]);
});

test("empty searches stop after two attempts without accepting related movies", async () => {
  const r = resolver([], [], false, [], () => [{ id: movie, title: "The SpongeBob SquarePants Movie (2004) Trailer", duration: 139 }]);
  assert.deepEqual(await r.resolve(fixture, "key"), []);
  assert.deepEqual(r.calls, ["tmdb", "search_trailer_videos", "search_trailer_videos"]);
});
