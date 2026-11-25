import assert from "node:assert/strict";
import test from "node:test";
import { readCatalogPlaylistTracks } from "../src/lib/music/catalog-playlist";
import type { MusicCatalogItem, MusicCatalogPage } from "../src/lib/music/types";

const track = (id: string, connectorId = "youtube"): MusicCatalogItem => ({
  kind: "track",
  id,
  connectorId,
  title: id,
  artist: "Artist",
  artwork: "",
  durationSeconds: 180,
  durationLabel: "3:00",
});
const page = (items: MusicCatalogItem[], nextCursor: string | null = null): MusicCatalogPage => ({
  items,
  nextCursor,
  scope: "catalog",
});

test("loads all 500 tracks in provider order, not just the first 100", async () => {
  const calls: (string | null)[] = [];
  const tracks = await readCatalogPlaylistTracks(async (cursor) => {
    calls.push(cursor);
    const offset = cursor === null ? 0 : Number(cursor);
    return page(
      Array.from({ length: 100 }, (_, i) => track(String(offset + i))),
      offset === 400 ? null : String(offset + 100),
    );
  });
  assert.deepEqual(calls, [null, "100", "200", "300", "400"]);
  assert.deepEqual(
    tracks.map((item) => item.id),
    Array.from({ length: 500 }, (_, i) => String(i)),
  );
});

test("single-page and empty playlists work without a continuation", async () => {
  assert.deepEqual(await readCatalogPlaylistTracks(async () => page([track("one")])), [
    track("one"),
  ]);
  assert.deepEqual(await readCatalogPlaylistTracks(async () => page([])), []);
});

test("preserves source identity and filters repeated entries across pages", async () => {
  const tracks = await readCatalogPlaylistTracks(async (cursor) =>
    cursor === null
      ? page([track("a"), track("b")], "next")
      : page([track("b"), track("b", "catalog"), track("c")]),
  );
  assert.deepEqual(
    tracks.map((item) => [item.connectorId, item.id]),
    [
      ["youtube", "a"],
      ["youtube", "b"],
      ["catalog", "b"],
      ["youtube", "c"],
    ],
  );
});

test("an empty intermediate page still follows its continuation", async () => {
  const tracks = await readCatalogPlaylistTracks(async (cursor) =>
    cursor === null
      ? page([track("a")], "one")
      : cursor === "one"
        ? page([], "two")
        : page([track("b")]),
  );
  assert.deepEqual(
    tracks.map((item) => item.id),
    ["a", "b"],
  );
});

test("rejects repeated cursors instead of returning a truncated playlist", async () => {
  await assert.rejects(
    readCatalogPlaylistTracks(async () => page([track("a")], "again")),
    /invalid cursor/,
  );
});

test("propagates continuation errors instead of silently returning the first page", async () => {
  await assert.rejects(
    readCatalogPlaylistTracks(async (cursor) => {
      if (cursor !== null) throw new Error("provider offline");
      return page([track("a")], "next");
    }),
    /provider offline/,
  );
});

test("does not load further pages after navigation or a new playback request", async () => {
  let current = true;
  let calls = 0;
  await assert.rejects(
    readCatalogPlaylistTracks(
      async () => {
        calls += 1;
        current = false;
        return page([track("a")], "next");
      },
      () => current,
    ),
    /cancelled/,
  );
  assert.equal(calls, 1);
});

test("rejects an unbounded provider continuation chain", async () => {
  let calls = 0;
  await assert.rejects(
    readCatalogPlaylistTracks(async () => page([], String(++calls))),
    /supported page count/,
  );
  assert.equal(calls, 100);
});
