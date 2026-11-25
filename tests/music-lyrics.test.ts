import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as yaml from "yaml";

type Lyrics = typeof import("../src/lib/music/lyrics.ts");

const KING_VON = [
  "[ar:King Von]",
  "[ti:Evil Twins]",
  "[length:01:56]",
  "",
  "[00:10.98] (TouchofTrent be wildin' with it)",
  "[00:11.81] You want back then? (Let's get it), ayy, Von, tell bro go spin that Benz",
  "[00:15.4]",
  "[00:18] Evil twins",
].join("\n");

function build(safeFetch: (url: string, init?: { signal?: AbortSignal }) => Promise<unknown>) {
  const calls: string[] = [];
  const input = readFileSync(new URL("../src/lib/music/lyrics.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name: string) => {
      if (name === "yaml") return yaml;
      assert.equal(name, "@/lib/safe-fetch");
      return {
        safeFetch: async (url: string, init?: { signal?: AbortSignal }) => {
          calls.push(url);
          return safeFetch(url, init);
        },
      };
    },
    module,
    module.exports,
  );
  return { lyrics: module.exports as Lyrics, calls };
}

const ok = (body: unknown) => ({ ok: true, json: async () => body });

const track = (extra: Record<string, unknown> = {}) =>
  ({
    id: "t1",
    title: "Evil Twins",
    artist: "King Von",
    artwork: "",
    durationSeconds: 116,
    durationLabel: "1:56",
    ...extra,
  }) as any;

test("parseLrc reads the real King Von payload and ignores metadata tags", () => {
  const { lyrics } = build(async () => ok(null));
  const lines = lyrics.parseLrc(KING_VON);
  assert.deepEqual(lines, [
    { at: 10.98, text: "(TouchofTrent be wildin' with it)" },
    { at: 11.81, text: "You want back then? (Let's get it), ayy, Von, tell bro go spin that Benz" },
    { at: 15.4, text: "" },
    { at: 18, text: "Evil twins" },
  ]);
});

test("parseLrc expands multiple timestamps on one line and sorts out-of-order stamps", () => {
  const { lyrics } = build(async () => ok(null));
  const lines = lyrics.parseLrc("[00:30.00][00:05.500]Chorus\n[00:20.250]Verse\n");
  assert.deepEqual(lines, [
    { at: 5.5, text: "Chorus" },
    { at: 20.25, text: "Verse" },
    { at: 30, text: "Chorus" },
  ]);
});

test("parseLrc keeps an empty timing mark as a gap and drops junk", () => {
  const { lyrics } = build(async () => ok(null));
  const lines = lyrics.parseLrc("\n[by:someone]\n[01:00.00]\nnot a lyric line\n[01:02]Back in\n");
  assert.deepEqual(lines, [
    { at: 60, text: "" },
    { at: 62, text: "Back in" },
  ]);
});

test("lyricIndexAt is exact at boundaries, -1 before the first line, last after the end", () => {
  const { lyrics } = build(async () => ok(null));
  const lines = lyrics.parseLrc(KING_VON);
  assert.equal(lyrics.lyricIndexAt(lines, 0), -1);
  assert.equal(lyrics.lyricIndexAt(lines, 10.979), -1);
  assert.equal(lyrics.lyricIndexAt(lines, 10.98), 0);
  assert.equal(lyrics.lyricIndexAt(lines, 11.8), 0);
  assert.equal(lyrics.lyricIndexAt(lines, 11.81), 1);
  assert.equal(lyrics.lyricIndexAt(lines, 15.4), 2);
  assert.equal(lyrics.lyricIndexAt(lines, 18), 3);
  assert.equal(lyrics.lyricIndexAt(lines, 999), 3);
  assert.equal(lyrics.lyricIndexAt([], 5), -1);
  assert.equal(lyrics.lyricIndexAt(lines, Number.NaN), -1);
});

test("loadTrackLyrics reads the light get endpoint and still picks the closest duration", async () => {
  const { lyrics, calls } = build(async () =>
    ok([
      { duration: 240, instrumental: false, syncedLyrics: "[00:01.00]Live version" },
      { duration: 115, instrumental: false, syncedLyrics: "[00:02.00]Studio version" },
      { duration: 180, instrumental: false, syncedLyrics: "[00:03.00]Remix version" },
    ]),
  );
  const lines = await lyrics.loadTrackLyrics(track());
  assert.deepEqual(lines, [{ at: 2, text: "Studio version" }]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith("https://lrclib.net/api/get?"), calls[0]);
  assert.ok(calls[0].includes("artist_name=King%20Von"), calls[0]);
  assert.ok(calls[0].includes("duration=116"), calls[0]);
});

test("loadTrackLyrics prefers the exact get endpoint when album and duration are known", async () => {
  const { lyrics, calls } = build(async (url) =>
    url.includes("/api/get?")
      ? ok({ duration: 116, instrumental: false, syncedLyrics: "[00:04.00]Exact match" })
      : ok([]),
  );
  const lines = await lyrics.loadTrackLyrics(track({ album: "Welcome to O'Block", id: "t-get" }));
  assert.deepEqual(lines, [{ at: 4, text: "Exact match" }]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("album_name=Welcome%20to%20O'Block"), calls[0]);
  assert.ok(calls[0].includes("duration=116"), calls[0]);
});

test("a provider album that LRCLIB rejects does not force the heavy search", async () => {
  const { lyrics, calls } = build(async (url) =>
    url.includes("album_name=")
      ? { ok: false, status: 404, json: async () => null }
      : ok({ duration: 116, instrumental: false, syncedLyrics: "[00:07.00]Found anyway" }),
  );
  // YouTube Music sometimes stores "73K likes" in the album field.
  const lines = await lyrics.loadTrackLyrics(track({ id: "t-bad-album", album: "73K likes" }));
  assert.deepEqual(lines, [{ at: 7, text: "Found anyway" }]);
  assert.equal(calls.length, 2, calls.join("\n"));
  assert.ok(
    calls.every((url) => !url.includes("/api/search?")),
    calls.join("\n"),
  );
});

test("a wrong provider duration still resolves through get instead of the heavy search", async () => {
  const { lyrics, calls } = build(async (url) => {
    if (url.includes("album_name=") || url.includes("duration="))
      return { ok: false, status: 404, json: async () => null };
    return ok({ duration: 119, instrumental: false, syncedLyrics: "[00:08.00]Duration was off" });
  });
  const lines = await lyrics.loadTrackLyrics(track({ id: "t-duration", album: "73K likes" }));
  assert.deepEqual(lines, [{ at: 8, text: "Duration was off" }]);
  assert.equal(calls.length, 3, calls.join("\n"));
  assert.ok(
    calls.every((url) => !url.includes("/api/search?")),
    calls.join("\n"),
  );
});

test("loadTrackLyrics falls back to search when the exact lookup misses", async () => {
  const { lyrics, calls } = build(async (url) =>
    url.includes("/api/get?")
      ? { ok: false, status: 404, json: async () => null }
      : ok([{ duration: 116, instrumental: false, syncedLyrics: "[00:05.00]From search" }]),
  );
  const lines = await lyrics.loadTrackLyrics(track({ album: "Welcome to O'Block", id: "t-miss" }));
  assert.deepEqual(lines, [{ at: 5, text: "From search" }]);
  assert.equal(calls.length, 4);
  assert.ok(calls[0].includes("album_name="), calls[0]);
  assert.ok(calls[3].startsWith("https://lrclib.net/api/search?"), calls[3]);
});

test("loadTrackLyrics returns null for instrumentals and retains plain-only lyrics", async () => {
  const instrumental = build(async () =>
    ok([{ duration: 116, instrumental: true, plainLyrics: "" }]),
  );
  assert.equal(await instrumental.lyrics.loadTrackLyrics(track({ id: "t-inst" })), null);

  const plain = build(async () =>
    ok([{ duration: 116, instrumental: false, plainLyrics: "No timing here" }]),
  );
  const lines = await plain.lyrics.loadTrackLyrics(track({ id: "t-plain" }));
  assert.deepEqual(lines, [{ at: 0, text: "No timing here", unsynced: true }]);
  assert.equal(plain.lyrics.lyricIndexAt(lines!, 100), -1);
});

test("loadTrackLyrics never throws and permits recovery after network failure", async () => {
  const { lyrics, calls } = build(async () => {
    throw new Error("offline");
  });
  assert.equal(await lyrics.loadTrackLyrics(track({ id: "t-off" })), null);
  assert.equal(await lyrics.loadTrackLyrics(track({ id: "t-off" })), null);
  assert.equal(calls.length, 4);
});

test("loadTrackLyrics caches a hit so scrubbing never refetches", async () => {
  const { lyrics, calls } = build(async () =>
    ok([{ duration: 116, instrumental: false, syncedLyrics: "[00:06.00]Cached" }]),
  );
  const first = await lyrics.loadTrackLyrics(track({ id: "t-cache" }));
  const second = await lyrics.loadTrackLyrics(track({ id: "t-cache" }));
  assert.deepEqual(first, second);
  assert.equal(calls.length, 1);
});

test("lyrics retry a temporary server error and retain the recovered result", async () => {
  let attempts = 0;
  const { lyrics, calls } = build(async () =>
    ++attempts === 1
      ? { ok: false, status: 503 }
      : ok([{ duration: 116, syncedLyrics: "[00:02]Recovered" }]),
  );
  assert.deepEqual(await lyrics.loadTrackLyrics(track()), [{ at: 2, text: "Recovered" }]);
  await lyrics.loadTrackLyrics(track());
  assert.equal(calls.length, 2);
});

test("lyrics do not immediately retry throttled requests or cache them as missing", async () => {
  let limited = true;
  const { lyrics, calls } = build(async () =>
    limited
      ? { ok: false, status: 429, headers: new Headers({ "Retry-After": "0" }) }
      : ok([{ duration: 116, syncedLyrics: "[00:02]Recovered" }]),
  );
  assert.equal(await lyrics.loadTrackLyrics(track()), null);
  assert.equal(calls.length, 1);
  limited = false;
  assert.deepEqual(await lyrics.loadTrackLyrics(track()), [{ at: 2, text: "Recovered" }]);
});
test("a YouTube video title is reduced to the song before lyrics are requested", () => {
  const { lyrics } = build(async () => ok(null));
  assert.equal(
    lyrics.lyricTitle("LE SSERAFIM (르세라핌) 'Smart' OFFICIAL MV", "LE SSERAFIM"),
    "Smart",
  );
  assert.equal(lyrics.lyricTitle("Smart (Slowed + Reverb ver.)", "LE SSERAFIM"), "Smart");
  assert.equal(lyrics.lyricTitle("Daft Punk - One More Time", "Daft Punk"), "One More Time");
  assert.equal(lyrics.lyricTitle("One More Time", "Daft Punk"), "One More Time");
  assert.equal(lyrics.lyricTitle("", "Daft Punk"), "");
});

test("the lyrics request uses the cleaned song title", async () => {
  const { lyrics, calls } = build(async () =>
    ok({ duration: 189, instrumental: false, syncedLyrics: "[00:02.00]Cleaned" }),
  );
  const lines = await lyrics.loadTrackLyrics(
    track({
      id: "t-mv",
      title: "LE SSERAFIM (르세라핌) 'Smart' OFFICIAL MV",
      artist: "LE SSERAFIM",
      durationSeconds: 189,
    }),
  );
  assert.deepEqual(lines, [{ at: 2, text: "Cleaned" }]);
  assert.ok(calls[0].includes("track_name=Smart"), calls[0]);
  assert.ok(!calls[0].includes("OFFICIAL"), calls[0]);
});

test("skipping a song aborts its obsolete lyrics request and fetches the next song", async () => {
  let cancelled = 0;
  const { lyrics, calls } = build(async (url, init) => {
    if (url.includes("Evil%20Twins")) {
      return new Promise((_, reject) => {
        const stop = () => {
          cancelled += 1;
          reject(new Error("cancelled"));
        };
        if (init?.signal?.aborted) stop();
        else init?.signal?.addEventListener("abort", stop, { once: true });
      });
    }
    return ok({ duration: 116, syncedLyrics: "[00:02]New song" });
  });
  const previous = new AbortController();
  const abandoned = lyrics.loadTrackLyrics(track({ id: "previous-song" }), previous.signal);
  previous.abort();
  assert.equal(await abandoned, null);
  assert.equal(cancelled, 1);
  assert.deepEqual(await lyrics.loadTrackLyrics(track({ id: "new-song", title: "New Song" })), [
    { at: 2, text: "New song" },
  ]);
  assert.equal(calls.length, 2);
});

test("one lyrics viewer leaving does not cancel another viewer of the same song", async () => {
  let respond!: (value: unknown) => void;
  let upstreamCancelled = false;
  const { lyrics, calls } = build(async (_url, init) => {
    return new Promise((resolve) => {
      respond = resolve;
      init?.signal?.addEventListener(
        "abort",
        () => {
          upstreamCancelled = true;
        },
        { once: true },
      );
    });
  });
  const panel = new AbortController();
  const karaoke = new AbortController();
  const panelRequest = lyrics.loadTrackLyrics(track({ id: "shared" }), panel.signal);
  const karaokeRequest = lyrics.loadTrackLyrics(track({ id: "shared" }), karaoke.signal);
  panel.abort();
  assert.equal(await panelRequest, null);
  assert.equal(upstreamCancelled, false);
  respond(ok({ duration: 116, syncedLyrics: "[00:03]Shared" }));
  assert.deepEqual(await karaokeRequest, [{ at: 3, text: "Shared" }]);
  assert.equal(calls.length, 1);
});

test("a cancellable viewer cannot abort another caller without a signal", async () => {
  let respond!: (value: unknown) => void;
  let cancelled = false;
  const { lyrics, calls } = build(
    async (_url, init) =>
      new Promise((resolve) => {
        respond = resolve;
        init?.signal?.addEventListener(
          "abort",
          () => {
            cancelled = true;
          },
          { once: true },
        );
      }),
  );
  const viewer = new AbortController();
  const cancelMe = lyrics.loadTrackLyrics(track({ id: "legacy-and-viewer" }), viewer.signal);
  const keepMe = lyrics.loadTrackLyrics(track({ id: "legacy-and-viewer" }));
  viewer.abort();
  assert.equal(await cancelMe, null);
  assert.equal(cancelled, false);
  respond(ok({ duration: 116, syncedLyrics: "[00:04]Kept alive" }));
  assert.deepEqual(await keepMe, [{ at: 4, text: "Kept alive" }]);
  assert.equal(calls.length, 1);
});

test("plain lyrics are retained when no timed match exists and timed lyrics win when available", async () => {
  const { lyrics } = build(async (url) =>
    url.includes("/search?")
      ? ok([{ duration: 116, syncedLyrics: "[00:03]Timed" }])
      : ok({ duration: 116, plainLyrics: "First\n\nSecond" }),
  );
  assert.deepEqual(await lyrics.loadTrackLyrics(track()), [{ at: 3, text: "Timed" }]);
});

test("LRCLIB word timing is parsed from Lyricsfile YAML in seconds", async () => {
  const { lyrics } = build(async () =>
    ok({
      duration: 116,
      hasWordSync: true,
      syncedLyrics: "[00:02]Hello world",
      lyricsfile: [
        "version: '1.0'",
        "lines:",
        "  - text: Hello world",
        "    start_ms: 2000",
        "    words:",
        "      - text: 'Hello '",
        "        start_ms: 2000",
        "        end_ms: 2400",
        "      - text: world",
        "        start_ms: 2400",
      ].join("\n"),
    }),
  );
  assert.deepEqual(await lyrics.loadTrackLyrics(track()), [
    {
      at: 2,
      text: "Hello world",
      words: [
        { at: 2, end: 2.4, text: "Hello " },
        { at: 2.4, text: "world" },
      ],
    },
  ]);
  assert.deepEqual(lyrics.parseLyricsfile("lines: ["), []);
});

test("mismatched recordings and artists are rejected", async () => {
  const { lyrics } = build(async () =>
    ok([
      {
        duration: 116,
        trackName: "Evil Twins",
        artistName: "Wrong Artist",
        syncedLyrics: "[00:02]Wrong",
      },
      {
        duration: 200,
        trackName: "Evil Twins",
        artistName: "King Von",
        syncedLyrics: "[00:02]Wrong take",
      },
      {
        duration: 116,
        trackName: "Other Song",
        artistName: "King Von",
        syncedLyrics: "[00:02]Wrong title",
      },
    ]),
  );
  assert.equal(await lyrics.loadTrackLyrics(track()), null);
});

test("original Arabic title alias is tried without losing Unicode", async () => {
  const title = "\u062D\u0628\u064A\u0628\u064A";
  const artist = "\u0639\u0645\u0631\u0648";
  const { lyrics, calls } = build(async (url) => {
    const params = new URL(url).searchParams;
    return params.get("track_name") === title
      ? ok({
          duration: 116,
          trackName: title,
          artistName: artist,
          plainLyrics: "\u0633\u0644\u0627\u0645",
        })
      : ok([]);
  });
  assert.deepEqual(
    await lyrics.loadTrackLyrics(track({ title: "Habibi (" + title + ")", artist })),
    [{ at: 0, text: "\u0633\u0644\u0627\u0645", unsynced: true }],
  );
  assert.ok(calls.some((url) => new URL(url).searchParams.get("track_name") === title));
});

test("Retry-After applies across different tracks", async () => {
  const { lyrics, calls } = build(async () => ({
    ok: false,
    status: 429,
    headers: new Headers({ "Retry-After": "60" }),
  }));
  assert.equal(await lyrics.loadTrackLyrics(track({ id: "first" })), null);
  assert.equal(await lyrics.loadTrackLyrics(track({ id: "second" })), null);
  assert.equal(calls.length, 1);
});

test("collaborative credits fall back to individual performers with matching recording", async () => {
  const { lyrics, calls } = build(async (url) => {
    const artist = new URL(url).searchParams.get("artist_name");
    if (artist === "Arijit Singh") {
      return ok([
        {
          trackName: "Tum Hi Ho",
          artistName: "Arijit Singh",
          duration: 330,
          syncedLyrics: "[00:04]Different recording",
        },
        {
          trackName: "Tum Hi Ho",
          artistName: "Arijit Singh",
          duration: 262,
          syncedLyrics: "[00:03]Correct recording",
        },
      ]);
    }
    return ok([{ trackName: "Tum Hi Ho", artistName: artist, duration: 261, instrumental: true }]);
  });
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title: "Tum Hi Ho",
        artist: "Mithoon & Arijit Singh",
        album: "Aashiqui 2 (Original Motion Picture Soundtrack)",
        durationSeconds: 261,
      }),
    ),
    [{ at: 3, text: "Correct recording" }],
  );
  assert.ok(calls.some((url) => new URL(url).searchParams.get("artist_name") === "Arijit Singh"));
});

test("partial credits cannot match without the right title and a close duration", async () => {
  const { lyrics } = build(async () =>
    ok([
      {
        trackName: "Other Song",
        artistName: "Arijit Singh",
        duration: 261,
        syncedLyrics: "[00:03]Wrong title",
      },
      {
        trackName: "Tum Hi Ho",
        artistName: "Arijit Singh",
        duration: 280,
        syncedLyrics: "[00:03]Wrong recording",
      },
      {
        trackName: "Tum Hi Ho",
        artistName: "Unrelated singer",
        duration: 261,
        syncedLyrics: "[00:03]Wrong singer",
      },
      { artistName: "Arijit Singh", duration: 261, syncedLyrics: "[00:03]Missing title" },
      {
        trackName: "Tum Hi Ho",
        artistName: "Arijit Singh",
        syncedLyrics: "[00:03]Missing duration",
      },
    ]),
  );
  assert.equal(
    await lyrics.loadTrackLyrics(
      track({
        title: "Tum Hi Ho",
        artist: "Mithoon & Arijit Singh",
        durationSeconds: 261,
      }),
    ),
    null,
  );
});

test("a single artist credit can also match a collaborator from the original collection", async () => {
  const { lyrics } = build(async (url) => {
    const artist = new URL(url).searchParams.get("artist_name");
    return ok(
      artist === "Arijit Singh"
        ? [
            {
              trackName: "Tum Hi Ho",
              artistName: artist,
              duration: 262,
              syncedLyrics: "[00:03]Correct",
            },
          ]
        : [],
    );
  });
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title: "Tum Hi Ho",
        artist: "Mithoon",
        durationSeconds: 261,
        collectionOrigin: { id: "catalog:1", title: "Tum Hi Ho", artist: "Mithoon & Arijit Singh" },
      }),
    ),
    [{ at: 3, text: "Correct" }],
  );
});

test("artist sets accept added composer credits in Darkhaast", async () => {
  const { lyrics } = build(async () =>
    ok([
      {
        trackName: "Darkhaast",
        artistName: "Mithoon, Arijit Singh, Sunidhi Chauhan",
        duration: 374,
        syncedLyrics: "[00:05]Matched",
      },
    ]),
  );
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title: "Darkhaast",
        artist: "Arijit Singh & Sunidhi Chauhan",
        durationSeconds: 375,
      }),
    ),
    [{ at: 5, text: "Matched" }],
  );
});

test("artist sets handle reordered, slash-separated and duplicate credits", async () => {
  const { lyrics } = build(async () =>
    ok([
      {
        trackName: "Example",
        artistName: "Singer B/Singer A/Singer A",
        duration: 116,
        syncedLyrics: "[00:02]Matched",
      },
    ]),
  );
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title: "Example",
        artist: "Singer A & Singer B",
      }),
    ),
    [{ at: 2, text: "Matched" }],
  );
});

test("artist set containment also works from a single performer to expanded credits", async () => {
  const { lyrics } = build(async () =>
    ok([
      {
        trackName: "Example",
        artistName: "Composer; Singer",
        duration: 116,
        syncedLyrics: "[00:02]Matched",
      },
    ]),
  );
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title: "Example",
        artist: "Singer",
      }),
    ),
    [{ at: 2, text: "Matched" }],
  );
});

test("shared collaborators alone do not match a different artist set", async () => {
  const { lyrics } = build(async () =>
    ok([
      {
        trackName: "Example",
        artistName: "Singer A & Singer C",
        duration: 116,
        syncedLyrics: "[00:02]Wrong collaboration",
      },
      {
        trackName: "Example",
        artistName: "Singer A & Singer B & Composer",
        duration: 140,
        syncedLyrics: "[00:02]Wrong recording",
      },
      {
        trackName: "Other Song",
        artistName: "Singer A & Singer B & Composer",
        duration: 116,
        syncedLyrics: "[00:02]Wrong song",
      },
      {
        trackName: "Example",
        artistName: "Singer A & Singer B & Composer",
        syncedLyrics: "[00:02]Missing duration",
      },
      {
        artistName: "Singer A & Singer B & Composer",
        duration: 116,
        syncedLyrics: "[00:02]Missing title",
      },
    ]),
  );
  assert.equal(
    await lyrics.loadTrackLyrics(
      track({
        title: "Example",
        artist: "Singer A & Singer B",
      }),
    ),
    null,
  );
});

test("full artist credit wins over a subset with equal recording duration", async () => {
  const { lyrics } = build(async () =>
    ok([
      {
        trackName: "Example",
        artistName: "Singer A",
        duration: 116,
        syncedLyrics: "[00:02]Partial",
      },
      {
        trackName: "Example",
        artistName: "Singer A & Singer B",
        duration: 116,
        syncedLyrics: "[00:02]Full",
      },
    ]),
  );
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title: "Example",
        artist: "Singer A & Singer B",
      }),
    ),
    [{ at: 2, text: "Full" }],
  );
});
