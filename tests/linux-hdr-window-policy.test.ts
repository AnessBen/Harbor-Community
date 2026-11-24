// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { mpvWindowPolicy } from "../src/lib/player/mpv-window-policy.ts";
import { mpvBridgeHarness, flushBridge } from "./helpers/mpv-bridge-harness.ts";

const defaults = {
  playerMpvEmbed: true,
  playerHdrToSdr: true,
  playerHdrOpaqueWindow: false,
};

test("Linux SDR retains the saved embed preference", () => {
  assert.deepEqual(mpvWindowPolicy(defaults, true, false), {
    linuxHdrWindow: false, hdrWindow: false, embed: true,
  });
  assert.equal(mpvWindowPolicy({ ...defaults, playerMpvEmbed: false }, true, false).embed, false);
});

test("Linux native HDR forces a separate window, then restores embedding when SDR returns", () => {
  const settings = { ...defaults, playerHdrToSdr: false };
  assert.deepEqual(mpvWindowPolicy(settings, true, false), {
    linuxHdrWindow: true, hdrWindow: true, embed: false,
  });
  assert.equal(settings.playerMpvEmbed, true);
  assert.equal(mpvWindowPolicy({ ...settings, playerHdrToSdr: true }, true, false).embed, true);
  assert.equal(mpvWindowPolicy({ ...settings, playerMpvEmbed: false }, true, false).embed, false);
});

test("Windows HDR window selection and macOS embedding retain their existing behavior", () => {
  assert.equal(mpvWindowPolicy({ ...defaults, playerHdrToSdr: false }, false, true).embed, true);
  assert.equal(mpvWindowPolicy({ ...defaults, playerHdrOpaqueWindow: true }, false, true).embed, false);
  assert.equal(mpvWindowPolicy({ ...defaults, playerHdrToSdr: false }, false, false).embed, true);
});

test("native Linux HDR live bridge does not reset native SDR fallback or negotiated output", async () => {
  const h = mpvBridgeHarness(undefined, { anime4k: false, hdrToSdr: false, embed: false }, "linux");
  h.bridge.setHdrToSdr?.(false, false);
  await flushBridge();
  assert.equal(h.commands.filter((c) => c.command === "mpv_set_property").length, 0);
});

test("SDR mode still applies the tone mapping and Windows keeps its colorspace hint", async () => {
  const h = mpvBridgeHarness(undefined, { anime4k: false, hdrToSdr: true, embed: true }, "linux");
  h.bridge.setHdrToSdr?.(true, false);
  await flushBridge();
  assert.ok(h.commands.some((c) => c.args.name === "target-trc" && c.args.value === "bt.1886"));
  const w = mpvBridgeHarness(undefined, { anime4k: false, hdrToSdr: false, embed: false }, "windows");
  w.bridge.setHdrToSdr?.(false, false);
  await flushBridge();
  assert.ok(w.commands.some((c) => c.args.name === "target-colorspace-hint" && c.args.value === "yes"));
});
