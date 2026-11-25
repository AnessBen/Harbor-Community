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

function build(
  safeFetch: (url: string, init?: { signal?: AbortSignal }) => Promise<unknown>,
  catalog?: {
    allowed?: (id: string) => boolean;
    candidates: (
      track: import("../src/lib/music/types").MusicTrack,
      connector: string,
    ) => Promise<unknown[]>;
  },
  netease?: {
    enabled: boolean;
    load: (
      track: import("../src/lib/music/types").MusicTrack,
      signal: AbortSignal,
    ) => Promise<import("../src/lib/music/lyrics").LyricLine[] | null>;
  },
) {
  const listeners = new Set<() => void>();
  const setEnabled = (enabled: boolean) => {
    if (!netease || netease.enabled === enabled) return;
    netease.enabled = enabled;
    for (const listener of listeners) listener();
  };
  const calls: string[] = [];
  const input = readFileSync(new URL("../src/lib/music/lyrics.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name: string) => {
      if (name === "yaml") return yaml;
      if (name === "./source-version")
        return {
          backingTrackVersion: (track: { title: string; version?: string }) =>
            /\b(?:instrumental|karaoke|backing[ -]?track|no[ -]?vocals|without vocals|vocal[ -]?removed|sing[ -]?along)\b/i.test(
              track.title + " " + (track.version ?? ""),
            )
              ? "instrumental"
              : null,
        };
      if (name === "./lyrics-provider-settings")
        return {
          neteaseLyricsEnabled: () => netease?.enabled === true,
          subscribeLyricsProviders: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        };
      if (name === "./netease-lyrics")
        return {
          loadNetEaseFallback:
            netease?.load ??
            (() => {
              throw Error("Unexpected fallback");
            }),
        };
      if (name === "./source-consent")
        return { musicSourceAllowed: (id: string) => catalog?.allowed?.(id) ?? !!catalog };
      if (name === "./sources")
        return { getMusicSourceCandidates: catalog?.candidates ?? (async () => []) };
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
  return { lyrics: module.exports as Lyrics, calls, setEnabled };
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

test("broad lyrics search resolves joined and vowel-variant transliterations without changing the track", async () => {
  const row = {
    trackName: "Kan We Kan",
    artistName: "Hamaki",
    albumName: "Omroh Ma Yeghib",
    duration: 189.912,
    syncedLyrics: "[00:02]Matched",
  };
  const original = track({
    title: "Kanw Kan",
    artist: "Hamaki",
    album: "Omro M Yegheeb",
    durationSeconds: 190,
  });
  const { lyrics, calls } = build(async (url) =>
    ok(new URL(url).searchParams.get("q") === "kan hamaki" ? [row] : []),
  );
  assert.deepEqual(await lyrics.loadTrackLyrics(original), [{ at: 2, text: "Matched" }]);
  assert.equal(original.title, "Kanw Kan");
  assert.equal(original.artist, "Hamaki");
  assert.equal(calls.length, 5);
  assert.ok(calls.slice(0, 4).every((url) => !new URL(url).searchParams.has("q")));
  await lyrics.loadTrackLyrics(original);
  assert.equal(calls.length, 5);
});

test("broad matching accepts a shortened single artist credit when album and duration agree", async () => {
  const { lyrics } = build(async (url) =>
    ok(
      new URL(url).searchParams.has("q")
        ? [
            {
              trackName: "Kan W Kan",
              artistName: "Mohamed Hamaki",
              albumName: "Omroh Ma Yeghib",
              duration: 190,
              syncedLyrics: "[00:03]Matched",
            },
          ]
        : [],
    ),
  );
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title: "Kanw Kan",
        artist: "Hamaki",
        album: "Omro M Yegheeb",
        durationSeconds: 190,
      }),
    ),
    [{ at: 3, text: "Matched" }],
  );
});

test("broad matching handles word boundaries without requiring an album when the artist and duration are exact", async () => {
  const { lyrics } = build(async (url) =>
    ok(
      new URL(url).searchParams.has("q")
        ? [
            {
              trackName: "Night Fall",
              artistName: "Example Artist",
              duration: 180,
              syncedLyrics: "[00:03]Matched",
            },
          ]
        : [],
    ),
  );
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title: "Nightfall",
        artist: "Example Artist",
        durationSeconds: 180,
      }),
    ),
    [{ at: 3, text: "Matched" }],
  );
});

test("broader searches reject missing metadata, unrelated artists, wrong albums and different recordings", async () => {
  const requested = track({
    title: "Kanw Kan",
    artist: "Hamaki",
    album: "Omro M Yegheeb",
    durationSeconds: 190,
  });
  const row = {
    trackName: "Kan We Kan",
    artistName: "Hamaki",
    albumName: "Omroh Ma Yeghib",
    duration: 190,
    syncedLyrics: "[00:02]Wrong",
  };
  const { lyrics, calls } = build(async (url) =>
    ok(
      new URL(url).searchParams.has("q")
        ? [
            { ...row, trackName: "Kan Mali" },
            { ...row, artistName: "Another Singer" },
            { ...row, albumName: "Another Album" },
            { ...row, albumName: undefined },
            { ...row, duration: 205 },
            { ...row, duration: undefined },
            { ...row, artistName: undefined },
            { ...row, trackName: undefined },
            { ...row, trackName: "Kan We Kan (Live)" },
            { ...row, artistName: "Mohamed Hamaki", albumName: "Another Album" },
          ]
        : [],
    ),
  );
  assert.equal(await lyrics.loadTrackLyrics(requested), null);
  assert.ok(calls.filter((url) => new URL(url).searchParams.has("q")).length <= 2);
});

test("shared surnames are not enough for broader matching", async () => {
  const { lyrics } = build(async (url) =>
    ok(
      new URL(url).searchParams.has("q")
        ? [
            {
              trackName: "Night Fall",
              artistName: "Other Singer",
              albumName: "Example Album",
              duration: 180,
              syncedLyrics: "[00:03]Wrong",
            },
          ]
        : [],
    ),
  );
  assert.equal(
    await lyrics.loadTrackLyrics(
      track({
        title: "Nightfall",
        artist: "First Singer",
        album: "Example Album",
        durationSeconds: 180,
      }),
    ),
    null,
  );
});

test("no broad search is made without a known duration", async () => {
  const { lyrics, calls } = build(async () => ok([]));
  assert.equal(await lyrics.loadTrackLyrics(track({ durationSeconds: 0 })), null);
  assert.ok(calls.every((url) => !new URL(url).searchParams.has("q")));
});

test("a stronger broad match is preferred over a weaker spelling and artist match", async () => {
  const { lyrics } = build(async (url) =>
    ok(
      new URL(url).searchParams.has("q")
        ? [
            {
              trackName: "Kan We Kan",
              artistName: "Mohamed Hamaki",
              albumName: "Omroh Ma Yeghib",
              duration: 190,
              syncedLyrics: "[00:02]Weaker",
            },
            {
              trackName: "Kan W Kan",
              artistName: "Hamaki",
              albumName: "Omroh Ma Yeghib",
              duration: 189.9,
              syncedLyrics: "[00:03]Stronger",
            },
          ]
        : [],
    ),
  );
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title: "Kanw Kan",
        artist: "Hamaki",
        album: "Omro M Yegheeb",
        durationSeconds: 190,
      }),
    ),
    [{ at: 3, text: "Stronger" }],
  );
});

test("camel-case joined titles restore word boundaries before broad search", async () => {
  const { lyrics, calls } = build(async (url) =>
    ok(
      new URL(url).searchParams.get("q") === "spring day bts"
        ? [
            {
              trackName: "Spring Day",
              artistName: "BTS",
              albumName: "YOU NEVER WALK ALONE",
              duration: 274,
              syncedLyrics: "[00:01]Matched",
            },
          ]
        : [],
    ),
  );
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title: "SpringDay",
        artist: "BTS",
        album: "YOU NEVER WALK ALONE",
        durationSeconds: 275,
      }),
    ),
    [{ at: 1, text: "Matched" }],
  );
  assert.ok(calls.some((url) => new URL(url).searchParams.get("q") === "spring day bts"));
  assert.ok(calls.filter((url) => new URL(url).searchParams.has("q")).length <= 2);
});

test("Arabic title-only discovery requires a complete matching romanized credit and close duration", async () => {
  const title = "\u0628\u0634\u0631\u0629 \u062e\u064a\u0631";
  const artist = "\u062d\u0633\u064a\u0646 \u0627\u0644\u062c\u0633\u0645\u064a";
  const candidate = {
    trackName: title,
    artistName: "Hussain Aljassmi",
    albumName: "Masri",
    duration: 228,
    syncedLyrics: "[00:03]Matched",
  };
  const { lyrics, calls } = build(async (url) =>
    ok(
      new URL(url).searchParams.get("q") === title
        ? [
            {
              ...candidate,
              artistName: "Different Aljassmi",
              duration: 229,
              syncedLyrics: "[00:02]Wrong",
            },
            candidate,
          ]
        : [],
    ),
  );
  assert.deepEqual(
    await lyrics.loadTrackLyrics(track({ title, artist, album: title, durationSeconds: 229 })),
    [{ at: 3, text: "Matched" }],
  );
  assert.equal(calls.filter((url) => new URL(url).searchParams.has("q")).length, 2);
});

test("a cross-script artist credit does not match different titles, versions or durations", async () => {
  const title = "\u0628\u0634\u0631\u0629 \u062e\u064a\u0631";
  const artist = "\u062d\u0633\u064a\u0646 \u0627\u0644\u062c\u0633\u0645\u064a";
  const row = {
    trackName: title,
    artistName: "Hussain Aljassmi",
    albumName: "Masri",
    duration: 228,
    syncedLyrics: "[00:03]Wrong",
  };
  const { lyrics } = build(async (url) =>
    ok(
      new URL(url).searchParams.has("q")
        ? [
            { ...row, trackName: "Other Song" },
            { ...row, trackName: title + " (Live)" },
            { ...row, duration: 232 },
            { ...row, artistName: "Ali Aljassmi" },
            { ...row, artistName: "Hassan Aljassmi" },
            { ...row, artistName: "Hussain Aljassmi & Other" },
            { ...row, artistName: "Aljassmi" },
            { ...row, artistName: undefined },
          ]
        : [],
    ),
  );
  assert.equal(
    await lyrics.loadTrackLyrics(track({ title, artist, album: title, durationSeconds: 229 })),
    null,
  );
});

test("explicit bilingual titles and artist credits work in either script", async () => {
  for (const [native, latin, artistNative, artistLatin] of [
    [
      "\u0924\u0941\u092e \u0939\u0940 \u0939\u094b",
      "Tum Hi Ho",
      "\u0905\u0930\u093f\u091c\u0940\u0924 \u0938\u093f\u0902\u0939",
      "Arijit Singh",
    ],
    ["\ubd04\ub0a0", "Spring Day", "\ubc29\ud0c4\uc18c\ub144\ub2e8", "BTS"],
    ["\u591c\u306b\u99c6\u3051\u308b", "Yoru ni Kakeru", "\u30e8\u30a2\u30bd\u30d3", "YOASOBI"],
  ]) {
    const { lyrics } = build(async (url) => {
      const q = new URL(url).searchParams;
      return ok(
        q.get("track_name") === latin && q.get("artist_name") === artistLatin
          ? [
              {
                trackName: latin,
                artistName: artistLatin,
                duration: 180,
                syncedLyrics: "[00:04]Matched",
              },
            ]
          : [],
      );
    });
    assert.deepEqual(
      await lyrics.loadTrackLyrics(
        track({
          title: native + " - " + latin,
          artist: artistNative + " (" + artistLatin + ")",
          durationSeconds: 180,
        }),
      ),
      [{ at: 4, text: "Matched" }],
      latin,
    );
  }
});

test("Arabic romanized title and artist require independently matching album", async () => {
  const title = "\u0628\u0634\u0631\u0629 \u062e\u064a\u0631",
    artist = "\u062d\u0633\u064a\u0646 \u0627\u0644\u062c\u0633\u0645\u064a";
  const row = {
    trackName: "Boshret Kheir",
    artistName: "Hussain Al Jassmi",
    albumName: "Boshret Kheir",
    duration: 228,
    syncedLyrics: "[00:01]Matched",
  };
  const { lyrics } = build(async (url) => ok(new URL(url).searchParams.has("q") ? [row] : []));
  assert.deepEqual(
    await lyrics.loadTrackLyrics(track({ title, artist, album: title, durationSeconds: 229 })),
    [{ at: 1, text: "Matched" }],
  );
  assert.equal(
    await lyrics.loadTrackLyrics(
      track({ title, artist, album: "Other Album", durationSeconds: 229, id: "wrong-album" }),
    ),
    null,
  );
});

test("lowercase joined titles discover the exact album recording without relying on a prior cached match", async () => {
  const { lyrics, calls } = build(async (url) => {
    const q = new URL(url).searchParams;
    return ok(
      q.get("track_name") === "spring day" && q.get("album_name") === "YOU NEVER WALK ALONE"
        ? [
            {
              trackName: "Spring Day",
              artistName: "BTS",
              albumName: "YOU NEVER WALK ALONE",
              duration: 275,
              syncedLyrics: "[00:02]Matched",
            },
          ]
        : [],
    );
  });
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title: "springday",
        artist: "BTS",
        album: "YOU NEVER WALK ALONE",
        durationSeconds: 275,
      }),
    ),
    [{ at: 2, text: "Matched" }],
  );
  assert.ok(calls.some((url) => new URL(url).searchParams.get("track_name") === "spring day"));
});
test("short native titles are eligible for title-only discovery with an explicit bilingual credit", async () => {
  const title = "\ubd04\ub0a0";
  const { lyrics, calls } = build(async (url) =>
    ok(
      new URL(url).searchParams.get("q") === title
        ? [
            {
              trackName: title,
              artistName: "BTS",
              duration: 275,
              syncedLyrics: "[00:01]Matched",
            },
          ]
        : [],
    ),
  );
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title,
        artist: "\ubc29\ud0c4\uc18c\ub144\ub2e8 (BTS)",
        durationSeconds: 275,
      }),
    ),
    [{ at: 1, text: "Matched" }],
  );
  assert.ok(calls.some((url) => new URL(url).searchParams.get("q") === title));
});
test("paired original catalog credits can discover the recording in a different script", async () => {
  const native = "\u591c\u306b\u99c6\u3051\u308b",
    artist = "\u30e8\u30a2\u30bd\u30d3";
  const { lyrics } = build(async (url) => {
    const q = new URL(url).searchParams;
    return ok(
      q.get("track_name") === "Yoru ni Kakeru" && q.get("artist_name") === "YOASOBI"
        ? [
            {
              trackName: "Yoru ni Kakeru",
              artistName: "YOASOBI",
              duration: 262,
              syncedLyrics: "[00:01]Matched",
            },
          ]
        : [],
    );
  });
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({
        title: native,
        artist,
        durationSeconds: 262,
        collectionOrigin: { id: "catalog:original", title: "Yoru ni Kakeru", artist: "YOASOBI" },
      }),
    ),
    [{ at: 1, text: "Matched" }],
  );
});

test("soundtrack descriptors recover the matching TV recording with tight duration", async () => {
  const title =
    "Forsa Tanya | \u062a\u062a\u0631 \u0627\u0644\u0628\u062f\u0627\u064a\u0629 (\u0645\u0633\u0644\u0633\u0644 \u0641\u0631\u0635\u0629 \u062a\u0627\u0646\u064a\u0629)";
  const candidate = {
    trackName: "Forsa Tanya - Music from the Original TV Series",
    artistName: "Ramy Sabry",
    albumName: "Forsa Tanya (Music from the Original TV Series)",
    duration: 246,
    syncedLyrics: "[00:02]Matched",
  };
  const { lyrics, calls } = build(async (url) =>
    ok(
      new URL(url).searchParams.get("track_name") === "Forsa Tanya"
        ? [{ ...candidate, duration: 258, syncedLyrics: "[00:01]Different recording" }, candidate]
        : [],
    ),
  );
  assert.deepEqual(
    await lyrics.loadTrackLyrics(
      track({ title, artist: "Ramy Sabry", album: "Forsa Tanya", durationSeconds: 247 }),
    ),
    [{ at: 2, text: "Matched" }],
  );
  assert.ok(calls.some((url) => new URL(url).searchParams.get("track_name") === "Forsa Tanya"));
});

test("soundtrack matching works in either direction for explicitly labeled film and television releases", async () => {
  for (const [title, candidateTitle] of [
    ["Example Song (Original Motion Picture Soundtrack)", "Example Song"],
    ["Example Song", "Example Song (Music from the Original TV Series)"],
    ["Example Song - Opening Theme", "Example Song - Music from the Original TV Series"],
  ]) {
    const { lyrics } = build(async () =>
      ok([
        {
          trackName: candidateTitle,
          artistName: "Example Artist",
          albumName: "Example Album (Original Soundtrack)",
          duration: 200,
          syncedLyrics: "[00:03]Matched",
        },
      ]),
    );
    assert.deepEqual(
      await lyrics.loadTrackLyrics(
        track({ title, artist: "Example Artist", album: "Example Album", durationSeconds: 201 }),
      ),
      [{ at: 3, text: "Matched" }],
    );
  }
});

test("soundtrack fallback rejects wrong artist, release, duration, role and alternate recording", async () => {
  const row = {
    trackName: "Example Song - Music from the Original TV Series",
    artistName: "Example Artist",
    albumName: "Example Album (Original Soundtrack)",
    duration: 200,
    syncedLyrics: "[00:01]Wrong",
  };
  for (const candidate of [
    { ...row, artistName: "Different Artist" },
    { ...row, artistName: undefined },
    { ...row, albumName: "Unrelated Album" },
    { ...row, duration: 205 },
    { ...row, duration: undefined },
    { ...row, trackName: "Example Song - Ending Theme" },
    { ...row, trackName: "Example Song (Live)" },
    { ...row, trackName: "Example Song - Music from the Original TV Series (Remix)" },
    { ...row, trackName: "Example Song - Unrelated Subtitle" },
    { ...row, trackName: "Other Song - Music from the Original TV Series" },
  ]) {
    const { lyrics } = build(async () => ok([candidate]));
    assert.equal(
      await lyrics.loadTrackLyrics(
        track({
          title: "Example Song - Opening Theme",
          artist: "Example Artist",
          album: "Example Album",
          durationSeconds: 200,
        }),
      ),
      null,
      JSON.stringify(candidate),
    );
  }
});

test("parenthesized soundtrack aliases cannot bypass the tight duration and release checks", async () => {
  for (const extra of [
    { duration: 205 },
    { albumName: "Other Album" },
    { artistName: undefined },
  ]) {
    const { lyrics } = build(async () =>
      ok([
        {
          trackName: "Example Song (Music from the Original TV Series)",
          artistName: "Example Artist",
          albumName: "Example Album",
          duration: 200,
          syncedLyrics: "[00:01]Wrong",
          ...extra,
        },
      ]),
    );
    assert.equal(
      await lyrics.loadTrackLyrics(
        track({
          title: "Example Song",
          artist: "Example Artist",
          album: "Example Album",
          durationSeconds: 200,
        }),
      ),
      null,
    );
  }
});

test("verified catalog recording credits enable cross-script lyrics without changing track metadata", async () => {
  const original = track({
    connectorId: "spotify",
    title: "My Star",
    artist: "\u7956\u5805 \u6b63\u6176",
    album: "FINAL FANTASY XVI Original Soundtrack",
    durationSeconds: 289,
  });
  const other = {
    ...original,
    connectorId: "youtube",
    id: "yt",
    artist: "Masayoshi Soken",
    durationSeconds: 290,
  };
  const row = {
    trackName: "My Star",
    artistName: other.artist,
    albumName: original.album,
    duration: 289,
    syncedLyrics: "[00:02]Matched",
  };
  let lookups = 0;
  const { lyrics, calls } = build(
    async (url) => ok(new URL(url).searchParams.get("artist_name") === other.artist ? [row] : []),
    {
      candidates: async (target, connector) => {
        lookups++;
        assert.equal(connector, "youtube");
        assert.equal(target.artist, original.artist);
        return [{ connectorId: "youtube", health: "healthy", track: other }];
      },
    },
  );
  assert.deepEqual(await lyrics.loadTrackLyrics(original), [{ at: 2, text: "Matched" }]);
  assert.equal(lookups, 1);
  assert.equal(original.artist, "\u7956\u5805 \u6b63\u6176");
  assert.ok(calls.some((url) => new URL(url).searchParams.get("artist_name") === other.artist));
});

test("verified cross-script credit discovery works in reverse and uses original collection provenance", async () => {
  const original = track({
    connectorId: "spotify",
    title: "Example",
    artist: "Example Artist",
    album: "Album release",
    durationSeconds: 200,
  });
  const native = "\u4f8b\u306e\u4f5c\u66f2\u5bb6";
  const current = {
    ...original,
    connectorId: "youtube",
    id: "selected",
    collectionOrigin: {
      id: "original",
      connectorId: "spotify",
      title: original.title,
      artist: original.artist,
    },
  };
  const row = {
    trackName: original.title,
    artistName: native,
    albumName: original.album,
    duration: 200,
    syncedLyrics: "[00:04]Matched",
  };
  const { lyrics } = build(
    async (url) => ok(new URL(url).searchParams.get("artist_name") === native ? [row] : []),
    {
      candidates: async (target, connector) => {
        assert.equal(target.id, "original");
        assert.equal(target.connectorId, "spotify");
        assert.equal(connector, "youtube");
        return [
          {
            connectorId: "youtube",
            health: "healthy",
            track: { ...original, connectorId: "youtube", id: "selected", artist: native },
          },
        ];
      },
    },
  );
  assert.deepEqual(await lyrics.loadTrackLyrics(current), [{ at: 4, text: "Matched" }]);
});

test("catalog artist fallback rejects conflicting, unverified and different recordings", async () => {
  const original = track({
    connectorId: "spotify",
    title: "Example",
    artist: "\u4f8b\u306e\u4f5c\u66f2\u5bb6",
    album: "Album release",
    durationSeconds: 200,
  });
  const other = { ...original, connectorId: "youtube", id: "yt", artist: "Example Artist" };
  const candidate = (extra = {}) => ({
    connectorId: "youtube",
    health: "healthy",
    track: { ...other, ...extra },
  });
  for (const candidates of [
    [candidate({ title: "Other Song" })],
    [candidate({ album: "Other Album" })],
    [candidate({ durationSeconds: 203 })],
    [candidate({ mediaKind: "video" })],
    [candidate({ connectorId: "soundcloud" })],
    [candidate({ version: "Live" })],
    [candidate({ artist: "Example Artist, Other Artist" })],
    [candidate(), candidate({ artist: "Different Artist" })],
    [{ ...candidate(), health: "offline" }],
  ]) {
    const { lyrics, calls } = build(async () => ok([]), { candidates: async () => candidates });
    assert.equal(await lyrics.loadTrackLyrics(original), null);
    assert.ok(!calls.some((url) => new URL(url).searchParams.get("artist_name") === other.artist));
  }
});

test("verified catalog artist still requires exact LRCLIB recording metadata", async () => {
  const original = track({
    connectorId: "spotify",
    title: "Example",
    artist: "\u4f8b\u306e\u4f5c\u66f2\u5bb6",
    album: "Album release",
    durationSeconds: 200,
  });
  const other = { ...original, connectorId: "youtube", id: "yt", artist: "Example Artist" };
  const row = {
    trackName: original.title,
    artistName: other.artist,
    albumName: original.album,
    duration: 200,
    syncedLyrics: "[00:01]Wrong",
  };
  for (const invalid of [
    { ...row, trackName: "Example (Live)" },
    { ...row, artistName: "Other Artist" },
    { ...row, albumName: "Other Album" },
    { ...row, duration: 203 },
    { ...row, artistName: undefined },
    { ...row, albumName: undefined },
    { ...row, instrumental: true },
  ]) {
    const { lyrics } = build(
      async (url) =>
        ok(new URL(url).searchParams.get("artist_name") === other.artist ? [invalid] : []),
      {
        candidates: async () => [{ connectorId: "youtube", health: "healthy", track: other }],
      },
    );
    assert.equal(await lyrics.loadTrackLyrics(original), null);
  }
});

test("catalog alias discovery respects source consent, local privacy and the exact-match fast path", async () => {
  const original = track({
    connectorId: "spotify",
    title: "Example",
    artist: "\u4f8b\u306e\u4f5c\u66f2\u5bb6",
    album: "Album release",
    durationSeconds: 200,
  });
  let calls = 0;
  const candidates = async () => {
    calls++;
    return [];
  };
  for (const t of [
    original,
    { ...original, connectorId: "local" },
    { ...original, album: original.title },
  ]) {
    const { lyrics } = build(async () => ok([]), { candidates, allowed: (id) => id !== "youtube" });
    assert.equal(await lyrics.loadTrackLyrics(t), null);
  }
  const { lyrics } = build(
    async () =>
      ok({
        trackName: original.title,
        artistName: original.artist,
        duration: 200,
        syncedLyrics: "[00:01]Exact",
      }),
    { candidates },
  );
  assert.deepEqual(await lyrics.loadTrackLyrics(original), [{ at: 1, text: "Exact" }]);
  assert.equal(calls, 0);
});

test("optional NetEase fallback is disabled by default and setting changes invalidate misses", async () => {
  let requests = 0;
  const { lyrics, setEnabled } = build(async () => ok([]), undefined, {
    enabled: false,
    load: async () => {
      requests++;
      return [{ at: 5, text: "Fallback" }];
    },
  });
  assert.equal(await lyrics.loadTrackLyrics(track()), null);
  assert.equal(requests, 0);
  setEnabled(true);
  assert.deepEqual(await lyrics.loadTrackLyrics(track()), [
    { at: 5, text: "Fallback", provider: "netease" },
  ]);
  assert.equal(requests, 1);
  assert.deepEqual(await lyrics.loadTrackLyrics(track()), [
    { at: 5, text: "Fallback", provider: "netease" },
  ]);
  assert.equal(requests, 1);
  setEnabled(false);
  assert.equal(await lyrics.loadTrackLyrics(track()), null);
  assert.equal(requests, 1);
});

test("LRCLIB timed results retain priority even with NetEase enabled", async () => {
  let requests = 0;
  const { lyrics } = build(
    async () =>
      ok({
        trackName: "Evil Twins",
        artistName: "King Von",
        duration: 116,
        syncedLyrics: "[00:05]Primary",
      }),
    undefined,
    {
      enabled: true,
      load: async () => {
        requests++;
        return [{ at: 5, text: "Fallback" }];
      },
    },
  );
  assert.deepEqual(await lyrics.loadTrackLyrics(track()), [{ at: 5, text: "Primary" }]);
  assert.equal(requests, 0);
});

test("NetEase timed result upgrades plain LRCLIB, but a failure preserves plain lyrics", async () => {
  const primary = {
    trackName: "Evil Twins",
    artistName: "King Von",
    duration: 116,
    plainLyrics: "Primary",
  };
  const { lyrics } = build(async () => ok(primary), undefined, {
    enabled: true,
    load: async () => [{ at: 7, text: "Synced" }],
  });
  assert.deepEqual(await lyrics.loadTrackLyrics(track()), [
    { at: 7, text: "Synced", provider: "netease" },
  ]);
  const failing = build(async () => ok(primary), undefined, {
    enabled: true,
    load: async () => {
      throw Error("offline");
    },
  });
  assert.deepEqual(await failing.lyrics.loadTrackLyrics(track()), [
    { at: 0, text: "Primary", unsynced: true },
  ]);
});

test("explicit instrumental tracks do not query either lyrics provider", async () => {
  let requests = 0;
  const { lyrics, calls } = build(async () => ok([]), undefined, {
    enabled: true,
    load: async () => {
      requests++;
      return [{ at: 1, text: "Wrong" }];
    },
  });
  for (const t of [
    track({ title: "To the Wilder (Instrumental)" }),
    track({ version: "Karaoke" }),
    track({ collectionOrigin: { id: "original", title: "Song (Instrumental)" } }),
  ]) {
    assert.equal(await lyrics.loadTrackLyrics(t), null);
  }
  assert.equal(calls.length, 0);
  assert.equal(requests, 0);
});

test("disabling NetEase cancels an outstanding fallback and prevents stale results", async () => {
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  let observed: AbortSignal | undefined;
  const { lyrics, setEnabled } = build(async () => ok([]), undefined, {
    enabled: true,
    load: async (_track, signal) => {
      observed = signal;
      start();
      return new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve([{ at: 1, text: "Stale" }]), { once: true }),
      );
    },
  });
  const result = lyrics.loadTrackLyrics(track());
  await started;
  setEnabled(false);
  assert.equal(await result, null);
  assert.ok(observed?.aborted);
  assert.equal(await lyrics.loadTrackLyrics(track()), null);
});
