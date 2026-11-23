import assert from "node:assert/strict";
import test from "node:test";
import "./_localstorage-stub.ts";
import { DEFAULT_CAST_OPTIONS, type CastDeviceInfo } from "../src/lib/cast.ts";
import {
  castOptionsFor,
  deviceHasOverrides,
  panelDevice,
  rememberCastDevice,
  resetDeviceCastOptions,
  setCastOptions,
  getCastPreferences,
} from "../src/lib/cast/cast-preferences.ts";
import {
  automaticDeviceOptions,
  automaticStreamFormat,
  castOptionsForDevice,
  mergeDeviceOverrides,
} from "../src/lib/cast/device-settings.ts";

function device(
  kind: CastDeviceInfo["kind"],
  name: string,
  model: string | null,
  id = `${kind}-${name}`,
): CastDeviceInfo {
  return {
    id,
    name,
    host: "192.0.2.15",
    port: 0,
    model,
    kind,
    control_url: null,
    audio_only: false,
  };
}

const eshare = device("dlna", "EShare-1234", "AV Renderer Device", "dlna-eshare");

test("an unrecognised DLNA box gets settings every TV plays", () => {
  const o = automaticDeviceOptions(eshare);
  assert.equal(o.quality, "1080p-hq");
  assert.equal(o.hevcNative, false);
  assert.equal(o.audioMode, "stereo");
  assert.equal(o.tonemap, "auto");
  assert.equal(automaticStreamFormat(eshare), "ts");
});

test("a known TV brand keeps Dolby Digital", () => {
  const samsung = device("dlna", "[TV] Samsung 7 Series (55)", "UE55TU7000");
  assert.equal(automaticDeviceOptions(samsung).audioMode, "surround");
  assert.equal(automaticDeviceOptions(samsung).quality, "1080p-hq");
});

test("4K receivers take 4K and H.265 untouched", () => {
  const ultra = device("chromecast", "Living Room", "Chromecast Ultra");
  const o = automaticDeviceOptions(ultra);
  assert.deepEqual([o.quality, o.hevcNative, o.audioMode], ["4k", true, "surround"]);
  assert.equal(automaticStreamFormat(ultra), "hls");
  const appleTv4k = automaticDeviceOptions(device("airplay", "Den", "AppleTV14,1"));
  assert.deepEqual([appleTv4k.quality, appleTv4k.hevcNative], ["4k", true]);
});

test("an AirPlay receiver claiming to be an Apple TV 3 is treated as one: 1080p H.264", () => {
  const o = automaticDeviceOptions(device("airplay", "EShare-1234", "AppleTV3,2"));
  assert.deepEqual([o.quality, o.hevcNative, o.audioMode], ["1080p-hq", false, "stereo"]);
});

test("a first-generation Chromecast stays at 1080p stereo", () => {
  const o = automaticDeviceOptions(device("chromecast", "Bedroom", "Chromecast"));
  assert.deepEqual([o.quality, o.hevcNative, o.audioMode], ["1080p-hq", false, "stereo"]);
});

test("device settings sit on top of the viewer's own, and the viewer's changes win", () => {
  const base = { ...DEFAULT_CAST_OPTIONS, audioMode: "surround" as const, nightMode: true };
  const o = castOptionsForDevice(base, eshare, { quality: "720p" });
  assert.equal(o.audioMode, "stereo", "the device decides the sound format");
  assert.equal(o.quality, "720p", "the viewer's change for this device");
  assert.equal(o.nightMode, true, "the viewer's own setting follows every device");
  assert.deepEqual(castOptionsForDevice(base, null, undefined), base);
});

test("choosing the automatic value again drops the override", () => {
  const changed = mergeDeviceOverrides(eshare, undefined, { audioMode: "surround" });
  assert.deepEqual(changed, { audioMode: "surround" });
  assert.deepEqual(mergeDeviceOverrides(eshare, changed, { audioMode: "stereo" }), {});
});

test("each device remembers its own changes", () => {
  const chromecast = device("chromecast", "Bedroom", "Chromecast", "cc-1");
  assert.equal(panelDevice(getCastPreferences(), null), null, "nothing cast to yet");

  rememberCastDevice(eshare);
  setCastOptions(eshare, { audioMode: "surround", volumeBoost: 25 });
  rememberCastDevice(chromecast);

  assert.equal(castOptionsFor(eshare).audioMode, "surround");
  assert.equal(castOptionsFor(chromecast).audioMode, "stereo");
  assert.equal(castOptionsFor(chromecast).volumeBoost, 25, "shared settings follow every device");
  assert.equal(panelDevice(getCastPreferences(), null)?.id, "cc-1", "the last device cast to");
  assert.equal(deviceHasOverrides(eshare), true);

  resetDeviceCastOptions(eshare);
  assert.equal(castOptionsFor(eshare).audioMode, "stereo");
  assert.equal(deviceHasOverrides(eshare), false);
  assert.equal(castOptionsFor(eshare).volumeBoost, 25);
});
