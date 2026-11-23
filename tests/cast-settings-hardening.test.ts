import assert from "node:assert/strict";
import test from "node:test";
import "./_localstorage-stub.ts";
import { DEFAULT_CAST_OPTIONS, type CastDeviceInfo, type CastSubInfo } from "../src/lib/cast.ts";
import {
  castNeedsConversion,
  directReloadRequest,
  pictureClass,
  pictureNeedsConversion,
  qualityWidthLimit,
} from "../src/lib/cast/cast-source.ts";
import { knownStreamHeight, playerPicture } from "../src/lib/cast/device-caps.ts";

// Preferences written by an older build, or edited by hand: wrong types, unknown choices and
// fractional numbers the Rust side would refuse.
localStorage.setItem(
  "harbor.cast.preferences.v1",
  JSON.stringify({
    options: {
      quality: "8k",
      audioMode: "surround",
      volumeBoost: -20,
      audioDelayMs: 1250.6,
      subDelayMs: 99_000_000,
      nightMode: "yes",
      subEncoding: "windows-1256",
    },
    look: { sizePercent: 9000, color: "red", lift: -5, background: true },
    devices: {
      "dlna-tv": {
        device: { name: "TV", kind: "dlna", model: null },
        overrides: { quality: "720p", volumeBoost: 50, aspect: "huge" },
      },
    },
    lastDeviceId: "dlna-tv",
  }),
);

const prefs = await import("../src/lib/cast/cast-preferences.ts");

function device(id: string): CastDeviceInfo {
  return {
    id,
    name: id,
    host: "192.0.2.20",
    port: 0,
    model: null,
    kind: "chromecast",
    control_url: null,
    audio_only: false,
  };
}

test("stored settings the converter cannot take are repaired when they load", () => {
  const { options, look, devices } = prefs.getCastPreferences();
  assert.equal(options.quality, DEFAULT_CAST_OPTIONS.quality, "an unknown quality is dropped");
  assert.equal(options.audioMode, "surround", "a valid choice is kept");
  assert.equal(options.volumeBoost, 0, "a negative boost is dropped");
  assert.equal(options.audioDelayMs, 1251, "a fractional delay becomes whole milliseconds");
  assert.equal(options.subDelayMs, prefs.CAST_DELAY_LIMIT_MS, "a runaway delay is bounded");
  assert.equal(options.nightMode, false, "a non-boolean switch is dropped");
  assert.equal(options.subEncoding, "windows-1256");
  assert.equal(look.sizePercent, 400);
  assert.equal(look.color, "#FFFFFF", "only #RRGGBB colours are kept");
  assert.equal(look.lift, 0);
  assert.equal(look.background, true);
  // A device keeps only its own settings, and only valid ones.
  assert.deepEqual(devices["dlna-tv"].overrides, { quality: "720p" });
});

test("sanitizing keeps every value the panel itself can produce", () => {
  const clean = prefs.sanitizeCastOptions({ ...DEFAULT_CAST_OPTIONS, volumeBoost: 100 });
  assert.deepEqual(clean, { ...DEFAULT_CAST_OPTIONS, volumeBoost: 100 });
  assert.deepEqual(prefs.sanitizeCastOptions(null), {});
  assert.deepEqual(prefs.sanitizeCastOptions({ volumeBoost: 30 }), {}, "not a panel step");
  assert.deepEqual(prefs.sanitizeCastOptions({ subEncoding: "x; rm -rf" }), {});
});

test("only the most recent devices keep their own settings", () => {
  for (let i = 0; i < 40; i++) prefs.rememberCastDevice(device(`cc-${i}`));
  // A device cast to again moves to the newest end instead of being forgotten.
  prefs.rememberCastDevice(device("cc-5"));
  const ids = Object.keys(prefs.getCastPreferences().devices);
  assert.equal(ids.length, 32);
  assert.equal(ids.at(-1), "cc-5");
  assert.ok(!ids.includes("dlna-tv"), "the oldest device is forgotten first");
  assert.ok(ids.includes("cc-39"));
  assert.equal(prefs.getCastPreferences().lastDeviceId, "cc-5");
});

test("the converter runs exactly when the cast needs something a copy cannot give", () => {
  const plain = { subtitle: null, audioTrackOrdinal: undefined, options: DEFAULT_CAST_OPTIONS };
  assert.equal(castNeedsConversion("compat", false, plain), false);
  assert.equal(castNeedsConversion("swapped", false, plain), false);
  assert.equal(castNeedsConversion("transcode", false, plain), true);
  assert.equal(castNeedsConversion("compat", true, plain), true, "live TV");
  const subtitle: CastSubInfo = { kind: "external", url: "C:/a.srt", format: "srt", off: false };
  assert.equal(castNeedsConversion("compat", false, { ...plain, subtitle }), true);
  assert.equal(castNeedsConversion("compat", false, { ...plain, audioTrackOrdinal: 1 }), true);
  assert.equal(castNeedsConversion("compat", false, { ...plain, audioTrackOrdinal: 0 }), false);
  for (const change of [
    { volumeBoost: 25 },
    { nightMode: true },
    { dialogueBoost: true },
    { audioDelayMs: -50 },
    { forceConversion: true },
  ]) {
    const options = { ...DEFAULT_CAST_OPTIONS, ...change };
    assert.equal(castNeedsConversion("compat", false, { ...plain, options }), true);
  }
  // Settings the converter only uses when it runs anyway do not start it.
  const passive = { ...DEFAULT_CAST_OPTIONS, subDelayMs: 500, quality: "720p" as const };
  assert.equal(castNeedsConversion("compat", false, { ...plain, options: passive }), false);
});

const direct = { subtitle: null, audioTrackOrdinal: undefined, options: DEFAULT_CAST_OPTIONS };
const withOptions = (change: Partial<typeof DEFAULT_CAST_OPTIONS>) => ({
  ...direct,
  options: { ...DEFAULT_CAST_OPTIONS, ...change },
});

test("picture settings send a directly compatible stream through the converter", () => {
  // A 1080p stream the receiver plays as it is.
  assert.equal(castNeedsConversion("compat", false, direct, { height: 1080 }), false);
  assert.equal(
    castNeedsConversion("compat", false, withOptions({ quality: "720p" }), { height: 1080 }),
    true,
  );
  assert.equal(
    castNeedsConversion("compat", false, withOptions({ aspect: "4:3" }), { height: 1080 }),
    true,
  );
  assert.equal(
    castNeedsConversion("compat", false, withOptions({ aspect: "fill" }), { height: 1080 }),
    true,
  );
  assert.equal(
    castNeedsConversion("compat", false, withOptions({ deinterlace: "always" }), { height: 1080 }),
    true,
  );
  assert.equal(
    castNeedsConversion("compat", false, withOptions({ tonemap: "on" }), { height: 1080 }),
    true,
  );
  // A swapped alternative is judged by its own height, like the player's file.
  assert.equal(
    castNeedsConversion("swapped", false, withOptions({ quality: "720p" }), { height: 1080 }),
    true,
  );
});

test("a quality setting converts only a source known to be taller than it", () => {
  const at = (quality: typeof DEFAULT_CAST_OPTIONS.quality, height: number | undefined) =>
    pictureNeedsConversion({ ...DEFAULT_CAST_OPTIONS, quality }, { height });
  assert.equal(at("1080p", 1080), false, "already that size");
  assert.equal(at("1080p-hq", 1080), false);
  assert.equal(at("720p", 720), false);
  assert.equal(at("720p", 800), true, "a 1920x800 scope film is taller than 720p");
  assert.equal(at("1080p", 2160), true);
  assert.equal(at("4k", 2160), false);
  assert.equal(at("original", 4320), false);
  // An unknown height is left to the converter's probe instead of converting every cast.
  assert.equal(at("720p", undefined), false);
  assert.equal(at("720p", 0), false);
  // Settings the converter applies only when it runs anyway.
  for (const change of [{ deinterlace: "auto" as const }, { tonemap: "off" as const }]) {
    assert.equal(
      pictureNeedsConversion({ ...DEFAULT_CAST_OPTIONS, ...change }, { height: 1080 }),
      false,
    );
  }
});

test("a quality setting also converts a source wider than that class of receiver decodes", () => {
  assert.deepEqual(
    [720, 1080, 2160, 4320].map(qualityWidthLimit),
    [1280, 1920, 4096, 8192],
    "the same limits as max_width_for in cast_transcode.rs",
  );
  const at = (quality: typeof DEFAULT_CAST_OPTIONS.quality, width: number, height: number) =>
    pictureNeedsConversion({ ...DEFAULT_CAST_OPTIONS, quality }, { width, height });
  assert.equal(at("1080p", 2560, 1080), true, "a 2560x1080 picture is no taller than 1080p");
  assert.equal(at("1080p", 1920, 1080), false);
  assert.equal(at("1080p", 1920, 800), false, "a scope film within 1920 stays direct");
  assert.equal(at("4k", 4096, 2160), false, "DCI 4K fits a 4K receiver");
  assert.equal(at("720p", 1440, 600), true);
});

test("a stream's height is the decoded or named one, never a guess", () => {
  assert.equal(knownStreamHeight({ liveHeight: 800 }), 800);
  assert.equal(knownStreamHeight({ parsedTitle: "Film.2024.2160p.WEB-DL" }), 2160);
  assert.equal(knownStreamHeight({ title: "Film 720p" }), 720);
  assert.equal(knownStreamHeight({ title: "Film" }), undefined);
  assert.equal(knownStreamHeight({ liveHeight: 0, title: "Film" }), undefined);
  // The player's picture: the decoded size when it has one; a name gives only a height.
  assert.deepEqual(playerPicture({ videoWidth: 3840, videoHeight: 2076 }, undefined), {
    width: 3840,
    height: 2076,
  });
  assert.deepEqual(playerPicture({ videoWidth: 0, videoHeight: 0 }, { title: "Film 2160p" }), {
    height: 2160,
  });
  assert.deepEqual(playerPicture({ videoWidth: 0, videoHeight: 0 }, undefined), {
    height: undefined,
  });
});

test("changing a picture setting during a direct cast reloads it through the converter", () => {
  // The TV plays a compatible 1080p stream directly.
  const loaded = {
    url: "https://cdn.example/film.m3u8",
    startTimeSec: 0,
    transcode: false,
    options: DEFAULT_CAST_OPTIONS,
    subtitle: null,
    subStyle: null,
    audioTrackOrdinal: 0,
  };
  const media = withOptions({ aspect: "4:3" });
  const change = {
    options: media.options,
    subtitle: media.subtitle,
    subStyle: null,
    audioTrackOrdinal: 0,
    transcode: castNeedsConversion("compat", false, media, { height: 1080 }),
  };
  const next = directReloadRequest(loaded, change, 754.5);
  assert.equal(next.transcode, true, "the 4:3 picture needs the converter");
  assert.equal(next.options.aspect, "4:3");
  assert.equal(next.startTimeSec, 754.5, "it continues where the TV was");
  assert.equal(next.url, loaded.url);
  // Going back to the default picture mid-cast keeps the conversion running.
  const back = directReloadRequest(
    next,
    {
      options: DEFAULT_CAST_OPTIONS,
      transcode: castNeedsConversion("compat", false, direct, { height: 1080 }),
    },
    800,
  );
  assert.equal(back.transcode, true);
  // A change that needs nothing leaves a direct cast direct, and keeps what it did not mention.
  const louder = directReloadRequest(loaded, { audioTrackOrdinal: 0, transcode: false }, 10);
  assert.equal(louder.transcode, false);
  assert.equal(louder.options, DEFAULT_CAST_OPTIONS);
  assert.equal(louder.subtitle, null);
});

test("a cast load tells the native side what the player knows of the picture", async () => {
  // cast.ts compiled on its own, with the Tauri bridge replaced by a recorder.
  const { readFileSync } = await import("node:fs");
  const ts = (await import("typescript")).default;
  const source = readFileSync(new URL("../src/lib/cast.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sent: Array<Record<string, unknown>> = [];
  const invoke = async (command: string, args: Record<string, unknown>) => {
    assert.equal(command, "cast_load");
    sent.push(args);
    return { stream: "direct", summary: null };
  };
  const exports: { castLoad?: (opts: Record<string, unknown>) => Promise<{ ok: boolean }> } = {};
  new Function("require", "exports", "window", compiled)(
    (id: string) => {
      assert.equal(id, "@tauri-apps/api/core");
      return { invoke };
    },
    exports,
    { __TAURI_INTERNALS__: {} },
  );
  const base = { host: "192.0.2.20", port: 0, url: "https://cdn.example/film.mkv", kind: "dlna" };
  assert.ok((await exports.castLoad!({ ...base, sourceWidth: 1920, sourceHeight: 1080 })).ok);
  assert.equal(sent[0].sourceWidth, 1920);
  assert.equal(sent[0].sourceHeight, 1080);
  // An unknown size goes as null, so the native side probes the source before playing it directly.
  await exports.castLoad!({ ...base, options: { ...DEFAULT_CAST_OPTIONS, quality: "720p" } });
  assert.equal(sent[1].sourceWidth, null);
  assert.equal(sent[1].sourceHeight, null);
  assert.equal(sent[1].transcode, false, "the frontend leaves the decision to the probe");
});

test("a converted picture is named by its standard class, not its exact height", () => {
  // Scope films keep their shape inside the 16:9 frame and are still the class they fill.
  assert.equal(pictureClass(1920, 1038), 1080);
  assert.equal(pictureClass(1920, 804), 1080);
  assert.equal(pictureClass(1280, 692), 720);
  assert.equal(pictureClass(1920, 1080), 1080);
  assert.equal(pictureClass(3840, 1606), 2160);
  assert.equal(pictureClass(720, 576), 576, "PAL DVD");
  // A picture as tall as 720p but wider than its frame is the next class up.
  assert.equal(pictureClass(1440, 720), 1080);
  // Without a width (an older summary) the height decides.
  assert.equal(pictureClass(0, 720), 720);
});
