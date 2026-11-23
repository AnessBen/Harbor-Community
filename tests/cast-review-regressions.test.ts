// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import "./_localstorage-stub.ts";
import type { CastSubInfo, CastSubStyle } from "../src/lib/cast.ts";
import { fitTracksToCastSource } from "../src/lib/cast/cast-source.ts";

const style = { fontSize: 27 } as unknown as CastSubStyle;
const embedded: CastSubInfo = { kind: "embedded", ordinal: 1, format: "srt", off: false } as never;
const file: CastSubInfo = { kind: "external", url: "C:/subs/a.srt", format: "srt", off: false };

test("reloading a swapped stream never applies the player's track numbers to it", () => {
  // The player's file has Japanese as audio track 2; the alternative stream's order is unknown.
  const media = { subtitle: embedded, subStyle: style, audioTrackOrdinal: 1, options: {} };
  const reloaded = fitTracksToCastSource(media, true);
  assert.equal(reloaded.audioTrackOrdinal, undefined);
  assert.equal(reloaded.subtitle, null);
  assert.equal(reloaded.subStyle, null);
  assert.equal(reloaded.options, media.options);
  // A subtitle file belongs to no stream, so it still burns in.
  const withFile = fitTracksToCastSource({ ...media, subtitle: file }, true);
  assert.equal(withFile.subtitle, file);
  assert.equal(withFile.subStyle, style);
  // The player's own file keeps every choice.
  assert.equal(fitTracksToCastSource(media, false), media);
});
