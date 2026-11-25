import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { selectSourceCandidate } from "../src/lib/music/source-selection";
import { shouldResolvePreferredSource } from "../src/lib/music/source-version";
import { adoptRequestedIdentity } from "../src/lib/music/queue-source";
import { queueTrackKey } from "../src/lib/music/queue-order";
import { youtubeRestrictionDelay } from "../src/lib/music/youtube-restriction";
import { sameMusicTrack } from "../src/lib/music/track-identity";
import type { MusicTrack } from "../src/lib/music/types";

const spotify: MusicTrack = {
  id: "spotify:track:one",
  connectorId: "spotify",
  title: "One",
  artist: "Artist",
  artwork: "",
  durationSeconds: 180,
  durationLabel: "3:00",
};
const alternative: MusicTrack = { ...spotify, id: "soundcloud:one", connectorId: "soundcloud" };

function fixture(
  failImmediately = false,
  youtubeFailure?: string,
  preferred = "spotify",
  preferredLookup?: (track: MusicTrack) => Promise<MusicTrack[]>,
) {
  const source = readFileSync(new URL("../src/lib/music/player.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("player.ts", source, ts.ScriptTarget.Latest, true);
  const functions = tree.statements.filter(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      ["playMusic", "nextPlayableSource", "recoverySources"].includes(node.name?.text ?? ""),
  );
  const declarations = `let explicitSource=null, playRequest=0, observedPause=null, resumeAt=null,
    recoverPlayback=null, audioReady=null, enginePrimed=false, pendingSpeakerDevice=null,
    returningToComputer=false, speakerTransfer=false; const autoSkipped=new Set();
    const SOURCE_ATTEMPT_CEILING=6, SOURCE_TTL_MS=120000;
    export const failLater=(message)=>recoverPlayback?.(message);`;
  const output = ts.transpileModule(
    declarations + functions.map((node) => node.getText(tree)).join("\n"),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    },
  ).outputText;
  const state = {
    phase: "idle",
    current: null as MusicTrack | null,
    queue: [] as MusicTrack[],
    queueIndex: 0,
    volume: 0.5,
    recents: [],
    likedIds: [],
    likedTracks: [],
    error: null,
  };
  const attempts: MusicTrack[] = [];
  let lookups = 0;
  const lookupConnectors: (string | undefined)[] = [];
  const scope = {
    state,
    queueTrackKey,
    youtubeRestrictionDelay,
    nextTrackWarmup: { suspendFor: () => {} },
    skipUnavailableTrack: () => {
      throw new Error("Must not skip a temporarily restricted track");
    },
    shouldResolvePreferredSource,
    selectSourceCandidate,
    adoptRequestedIdentity,
    sameMusicTrack,
    initializeMusic: async () => {},
    cancelMusicQueueAutomation: () => {},
    musicPlayerWasClosed: () => false,
    setMusicPlayerClosed: () => {},
    publish: (patch: unknown) => Object.assign(state, patch),
    clearSpotifyStartupWatchdog: () => {},
    armSpotifyStartupWatchdog: () => {},
    beginMusicQueue: () => {},
    resetMusicOrder: () => {},
    pinSourceFor: () => {},
    peekPinnedSource: () => null,
    rankByExplicitness: (candidates: unknown[]) => candidates,
    explicitnessOf: () => 0,
    musicPlaybackSourceAllowed: () => true,
    readMusicPreference: () => preferred,
    clampMusicVolume: (volume: number) => volume,
    sourcesFor: async (track: MusicTrack, _ttl?: number, _fresh?: boolean, connector?: string) => {
      lookups++;
      lookupConnectors.push(connector);
      if (connector && preferredLookup)
        return (await preferredLookup(track)).map((t) => ({
          connectorId: t.connectorId,
          health: "healthy",
          track: t,
        }));
      return [{ connectorId: "soundcloud", health: "healthy", track: alternative }];
    },
    invoke: async (command: string, args: { track: MusicTrack }) => {
      if (command !== "music_play_track") return;
      attempts.push(args.track);
      if (youtubeFailure && args.track.connectorId === "youtube") throw new Error(youtubeFailure);
      if (failImmediately && args.track.connectorId === "spotify")
        throw new Error("Spotify unavailable");
    },
    stopCastOwner: async () => {},
    ensureNativeEvents: async () => {},
    updateMediaSession: () => {},
    likedIdsFor: () => [],
    isMusicLiked: () => false,
    getMusicSpeakerState: () => ({ active: false }),
    deckAdoption: { deck: () => 0 },
    require: () => ({ unhideMusicRecent: () => {} }),
  };
  const exports: {
    playMusic?: typeof import("../src/lib/music/player").playMusic;
    failLater?: (message: string) => void;
  } = {};
  new Function(...Object.keys(scope), "exports", output)(...Object.values(scope), exports);
  return {
    play: exports.playMusic!,
    failLater: exports.failLater!,
    state,
    attempts,
    lookups: () => lookups,
    lookupConnectors,
  };
}

test("an explicitly selected Spotify source reports immediate failure without switching providers", async () => {
  const h = fixture(true);
  await assert.rejects(
    h.play(spotify, [spotify], undefined, false, false, true),
    /Spotify unavailable/,
  );
  assert.deepEqual(h.attempts, [spotify]);
  assert.equal(h.lookups(), 0);
  assert.equal(h.state.current?.connectorId, "spotify");
  assert.deepEqual(h.state.queue, [spotify]);
  assert.equal(h.state.phase, "error");
  assert.equal(h.state.error, "Spotify unavailable");
});

test("an explicitly selected source also stays selected when its engine fails later", async () => {
  const h = fixture();
  await h.play(spotify, [spotify], undefined, false, false, true);
  h.failLater("Spotify session ended");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.attempts, [spotify]);
  assert.equal(h.lookups(), 0);
  assert.equal(h.state.phase, "error");
  assert.equal(h.state.error, "Spotify session ended");
});

test("automatic playback still recovers and a new request clears the manual source choice", async () => {
  const h = fixture(true);
  await assert.rejects(h.play(spotify, [spotify], undefined, false, false, true));
  await h.play(spotify);
  assert.deepEqual(
    h.attempts.map((track) => track.connectorId),
    ["spotify", "spotify", "soundcloud"],
  );
  assert.equal(h.lookups(), 1);
  assert.equal(h.state.current?.connectorId, "soundcloud");
  assert.equal(h.state.error, null);
});

test("YouTube restrictions stop source fallback and automatic skipping, retaining the queue", async () => {
  const message = "YouTube rate limit. Wait 120 seconds before retrying.";
  const h = fixture(false, message, "youtube");
  const song = { ...spotify, id: "yt:one", connectorId: "youtube" };
  await assert.rejects(
    h.play(song, [song, alternative], undefined, true, true),
    /YouTube rate limit/,
  );
  assert.equal(h.attempts.length, 1);
  assert.equal(h.lookups(), 0);
  assert.deepEqual(h.state.queue, [song, alternative]);
  assert.equal(h.state.current?.id, song.id);
  assert.equal(h.state.phase, "error");
  assert.equal(h.state.error, message);
});

test("a later browser verification error preserves the current song", async () => {
  const h = fixture();
  const song = { ...spotify, id: "yt:one", connectorId: "youtube" };
  await h.play(song, [song, alternative], undefined, false, false, true);
  h.failLater("YouTube requires browser verification. Wait 120 seconds before retrying.");
  assert.equal(h.lookups(), 0);
  assert.equal(h.state.phase, "error");
  assert.deepEqual(h.state.queue, [song, alternative]);
});

test("each playlist track resolves the preferred provider without waiting for full fan-out", async () => {
  const second = { ...spotify, id: "spotify:track:two", title: "Two" };
  const h = fixture(false, undefined, "youtube", async (t) => [
    { ...t, connectorId: "youtube", id: "yt:" + t.id },
  ]);
  await h.play(spotify, [spotify, second]);
  await h.play(second, h.state.queue, undefined, true);
  assert.deepEqual(h.lookupConnectors, ["youtube", "youtube"]);
  assert.deepEqual(
    h.attempts.map((t) => t.connectorId),
    ["youtube", "youtube"],
  );
  assert.equal(h.state.queue.length, 2);
  assert.equal(h.state.current?.collectionOrigin?.id, second.id);
});

test("a preferred lookup timeout does not silently switch or skip the song", async () => {
  const h = fixture(false, undefined, "youtube", async () => {
    throw new Error("Preferred music source lookup timed out");
  });
  await assert.rejects(
    h.play(spotify, [spotify, alternative], undefined, true, true),
    /lookup timed out/,
  );
  assert.deepEqual(h.lookupConnectors, ["youtube"]);
  assert.equal(h.attempts.length, 0);
  assert.equal(h.state.phase, "error");
  assert.deepEqual(h.state.queue, [spotify, alternative]);
});

test("a genuine preferred no-match may fall back and the next song tries the preference again", async () => {
  const second = { ...spotify, id: "spotify:track:two", title: "Two" };
  const h = fixture(false, undefined, "youtube", async (t) =>
    t.id === spotify.id ? [] : [{ ...t, connectorId: "youtube", id: "yt:two" }],
  );
  await h.play(spotify, [spotify, second]);
  await h.play(second, h.state.queue, undefined, true);
  assert.deepEqual(h.lookupConnectors, ["youtube", undefined, "youtube"]);
  assert.deepEqual(
    h.attempts.map((t) => t.connectorId),
    ["soundcloud", "youtube"],
  );
});

test("an explicit upload choice does not suppress preferred lookup on the next recording", async () => {
  const second = { ...spotify, id: "spotify:track:two", title: "Two" };
  const h = fixture(false, undefined, "youtube", async (t) => [
    { ...t, connectorId: "youtube", id: "yt:two" },
  ]);
  await h.play(spotify, [spotify, second], undefined, false, false, true);
  await h.play(second, h.state.queue, undefined, true);
  assert.deepEqual(h.lookupConnectors, ["youtube"]);
  assert.deepEqual(
    h.attempts.map((t) => t.connectorId),
    ["spotify", "youtube"],
  );
});
