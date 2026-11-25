import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as yaml from "yaml";

function build(
  fetcher: (url: string) => Promise<unknown> = async () => {
    throw Error("Unexpected request");
  },
) {
  const load = (path: string, deps: Record<string, unknown>) => {
    const src = readFileSync(new URL(path, import.meta.url), "utf8");
    const output = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", output)(
      (name: string) => {
        assert.ok(name in deps, name);
        return deps[name];
      },
      module,
      module.exports,
    );
    return module.exports;
  };
  const safeFetch = { safeFetch: fetcher };
  const lyrics = load("../src/lib/music/lyrics.ts", {
    "@/lib/safe-fetch": safeFetch,
    yaml,
    "./source-version": load("../src/lib/music/source-version.ts", {}),
    "./lyrics-provider-settings": {
      neteaseLyricsEnabled: () => false,
      subscribeLyricsProviders: () => () => {},
    },
  });
  const version = load("../src/lib/music/source-version.ts", {});
  const prototype = load("../src/lib/music/netease-lyrics.ts", {
    "@/lib/safe-fetch": safeFetch,
    "./lyrics": lyrics,
    "./source-version": version,
  });
  return {
    prototype: prototype as typeof import("../src/lib/music/netease-lyrics"),
    lyrics: lyrics as typeof import("../src/lib/music/lyrics"),
  };
}
const track = {
  id: "original",
  connectorId: "spotify",
  title: "Example Song",
  artist: "Composer",
  album: "Example soundtrack",
  durationSeconds: 100,
  artwork: "",
  durationLabel: "1:40",
};
const candidate = {
  id: 123,
  title: "Example Song",
  artist: "Vocalist",
  album: "Example soundtrack deluxe",
  duration: 100.2,
};
const reviewed = {
  id: 123,
  harborTitle: track.title,
  harborArtist: track.artist,
  harborAlbum: track.album,
  providerTitle: candidate.title,
  providerArtist: candidate.artist,
  providerAlbum: candidate.album,
};
test("YRC absolute milliseconds become ordered word times in Harbor", () => {
  const { prototype, lyrics } = build();
  const lines = prototype.parseYrc(
    "[10000,2000](10000,750,0)Hello (10750,1250,0)world\n[30000,1000](30000,1000,0)Again",
    100,
  );
  assert.deepEqual(lines, [
    {
      at: 10,
      text: "Hello world",
      words: [
        { at: 10, end: 10.75, text: "Hello " },
        { at: 10.75, end: 12, text: "world" },
      ],
    },
    { at: 30, text: "Again", words: [{ at: 30, end: 31, text: "Again" }] },
  ]);
  assert.equal(lyrics.lyricIndexAt(lines, 9.99), -1);
  assert.equal(lyrics.lyricIndexAt(lines, 10), 0);
  assert.equal(lyrics.lyricIndexAt(lines, 30), 1);
  assert.equal(lyrics.lyricIndexAt(lines, 11), 0);
});
test("YRC rejects malformed, overlapping and out-of-recording words", () => {
  const { prototype } = build();
  assert.deepEqual(
    prototype.parseYrc(
      "[10000,1000](10000,800,0)A(10500,500,0)B\n[99000,2000](99000,2000,0)Bad\n[1000,2000]junk(1000,2000,0)Bad",
      100,
    ),
    [],
  );
});
test("LRC fallback preserves line-only songs and incomplete word payloads", () => {
  const { prototype } = build();
  const payload = {
    code: 200,
    lrc: { lyric: "[00:10.00]Hello world\n[00:30.00]Again" },
    yrc: { lyric: "[10000,2000](10000,750,0)Hello (10750,1250,0)world" },
  };
  const lines = prototype.parseNetEaseLyrics(payload, 100);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].words?.length, 2);
  assert.equal(lines[1].text, "Again");
  assert.equal(lines[1].words, undefined);
  assert.deepEqual(prototype.parseNetEaseLyrics({ ...payload, nolyric: true }, 100), []);
});
test("review approval is recording-specific and rejects instrumental, video, wrong album and duration", () => {
  const { prototype } = build();
  assert.equal(prototype.matchesReviewedRecording(track, candidate, reviewed), true);
  for (const invalid of [
    { ...track, title: "Example Song (Instrumental)" },
    { ...track, version: "Karaoke" },
    { ...track, mediaKind: "video" as const },
    { ...track, artist: "Other composer" },
    { ...track, durationSeconds: 104 },
  ]) {
    assert.equal(prototype.matchesReviewedRecording(invalid, candidate, reviewed), false);
  }
  assert.equal(
    prototype.matchesReviewedRecording(track, { ...candidate, album: "Other" }, reviewed),
    false,
  );
  assert.equal(
    prototype.matchesReviewedRecording(track, { ...candidate, id: 456 }, reviewed),
    false,
  );
  assert.equal(
    prototype.matchesReviewedRecording(track, { ...candidate, artist: "Other" }, reviewed),
    false,
  );
});
test("prototype refuses unreviewed recordings before requesting lyrics", async () => {
  let requests = 0;
  const { prototype } = build(async () => {
    requests++;
    return {
      ok: true,
      text: async () => JSON.stringify({ code: 200, lrc: { lyric: "[00:10]Example" } }),
    };
  });
  assert.deepEqual(
    await prototype.loadReviewedNetEaseLyrics(track, { ...candidate, id: 456 }, reviewed),
    [],
  );
  assert.equal(requests, 0);
  assert.equal((await prototype.loadReviewedNetEaseLyrics(track, candidate, reviewed)).length, 1);
  assert.equal(requests, 1);
});

test("NetEase accepts the verified soundtrack recording but rejects the longer alternate", () => {
  const { prototype } = build();
  const source = {
    ...track,
    title:
      'The Way of the Ghost (feat. Clare Uchima) - from "Ghost of Tsushima" Music from the Video Game',
    artist: "Ilan Eshkeri, Clare Uchima, Jenny Plant",
    album: "Ghost of Tsushima (Music from the Video Game)",
    durationSeconds: 212,
  };
  const item = {
    ...candidate,
    title: "The Way of the Ghost",
    artist: "Ilan Eshkeri, Clare Uchima",
    album: source.album,
    duration: 212.694,
  };
  assert.equal(prototype.matchNetEaseRecording(source, item), true);
  assert.equal(prototype.matchNetEaseRecording(source, { ...item, duration: 254.931 }), false);
  assert.equal(
    prototype.matchNetEaseRecording(source, { ...item, artist: "Unrelated Artist" }),
    false,
  );
  assert.equal(prototype.matchNetEaseRecording(source, { ...item, album: "Other release" }), false);
  assert.equal(
    prototype.matchNetEaseRecording({ ...source, title: source.title + " (Instrumental)" }, item),
    false,
  );
});
test("composer/vocalist exception is scoped to the reviewed My Star recording", () => {
  const { prototype } = build();
  const source = {
    ...track,
    id: "spotify:track:76Nqs1GHACm5O7Yue6Bb2y",
    title: "My Star",
    artist: "\u7956\u5805 \u6b63\u6176",
    album: "FINAL FANTASY XVI Original Soundtrack",
    durationSeconds: 289,
  };
  const item = {
    id: 2077790381,
    title: "My Star",
    artist: "Amanda Achen-Keenan",
    album: "FINAL FANTASY XVI Original Soundtrack Ultimate Edition [Limited Edition]",
    duration: 288.99,
  };
  assert.equal(prototype.matchNetEaseRecording(source, item), true);
  assert.equal(prototype.matchNetEaseRecording({ ...source, id: "unverified" }, item), false);
  assert.equal(prototype.matchNetEaseRecording(source, { ...item, id: 123 }), false);
  assert.equal(prototype.matchNetEaseRecording({ ...source, version: "Live" }, item), false);
});
