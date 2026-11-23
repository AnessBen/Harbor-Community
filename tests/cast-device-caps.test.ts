import assert from "node:assert/strict";
import test from "node:test";
import {
  checkStreamCompat,
  castProfile,
  getDeviceCaps,
  keepCodecsProfile,
  UNIVERSAL_SAFE_PROFILE,
} from "../src/lib/cast/device-caps";

const airplay = (model: string) => getDeviceCaps({ kind: "airplay", name: "Living Room", model });

test("older Apple TVs are capped at the resolution they decode", () => {
  assert.equal(airplay("AppleTV2,1").maxResolution, 720, "the second generation stops at 720p");
  assert.equal(airplay("AppleTV3,2").maxResolution, 1080);
  assert.equal(airplay("AppleTV5,3").maxResolution, 1080, "Apple TV HD");
  assert.equal(airplay("AppleTV3,2").hevc, false);
});

test("an Apple TV 4K keeps its own capabilities", () => {
  assert.ok(airplay("AppleTV14,1").maxResolution >= 2160);
});

test("burning subtitles into a compatible stream keeps to the receiver's limits", () => {
  // A 720p H.264/AAC film the Nest Hub plays as it is: compatible, so no codec is forced.
  const hub = getDeviceCaps({
    kind: "chromecast",
    name: "Kitchen display",
    model: "Google Nest Hub",
  });
  const film = { title: "Film 2020 720p WEB H264 AAC", liveWidth: 1280, liveHeight: 720 };
  assert.ok(checkStreamCompat(film, hub).ok);
  const limits = keepCodecsProfile(film, hub);
  assert.deepEqual(
    { max_height: limits.max_height, max_video_kbps: limits.max_video_kbps },
    { max_height: 720, max_video_kbps: 3500 },
  );
  assert.equal(limits.force_h264, false);
  assert.equal(limits.force_aac, false);
  // Subtitles start a conversion, and Harbor may remux a file on its own: either way the cast
  // carries those limits instead of none, for the stream as it was and for one swapped in.
  for (const kind of ["compat", "swapped"] as const) {
    assert.deepEqual(castProfile({ kind, profile: limits }, false), limits, kind);
  }
  // A conversion the receiver needs keeps its own profile; live TV gets the safe one.
  const needed = { ...limits, force_h264: true };
  assert.equal(castProfile({ kind: "transcode", profile: needed }, true), needed);
  assert.equal(castProfile({ kind: "compat", profile: limits }, true), UNIVERSAL_SAFE_PROFILE);
});
