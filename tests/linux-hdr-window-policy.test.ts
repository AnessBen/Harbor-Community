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
    linuxHdrWindow: false, linuxHdrEmbedded: false, hdrWindow: false, embed: true,
  });
  assert.equal(mpvWindowPolicy({ ...defaults, playerMpvEmbed: false }, true, false).embed, false);
});

test("Linux native HDR forces a separate window, then restores embedding when SDR returns", () => {
  const settings = { ...defaults, playerHdrToSdr: false };
  assert.deepEqual(mpvWindowPolicy(settings, true, false), {
    linuxHdrWindow: true, linuxHdrEmbedded: false, hdrWindow: true, embed: false,
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

test("experimental Linux HDR requires both explicit selection and a configured native library", () => {
  const selected = { ...defaults, playerHdrToSdr: false, playerLinuxEmbeddedHdr: true };
  assert.equal(mpvWindowPolicy(selected, true, false, false).linuxHdrWindow, true);
  assert.equal(mpvWindowPolicy(selected, true, false, false).embed, false);
  assert.deepEqual(mpvWindowPolicy(selected, true, false, true), {
    linuxHdrWindow: false, linuxHdrEmbedded: true, hdrWindow: false, embed: true,
  });
  assert.equal(mpvWindowPolicy({ ...selected, playerMpvEmbed: false }, true, false, true).embed, true);
  assert.equal(mpvWindowPolicy({ ...selected, playerHdrToSdr: true }, true, false, true).linuxHdrEmbedded, false);
  assert.equal(mpvWindowPolicy({ ...selected, playerLinuxEmbeddedHdr: false }, true, false, true).linuxHdrWindow, true);
  assert.equal(mpvWindowPolicy(selected, false, true, true).linuxHdrEmbedded, false);
  assert.equal(mpvWindowPolicy(selected, false, false, true).linuxHdrEmbedded, false);
});

test("experimental native HDR keeps its PQ target fixed during frontend live updates", async () => {
  const h = mpvBridgeHarness(undefined, { anime4k: false, hdrToSdr: false, embed: true, linuxEmbeddedHdr: true }, "linux");
  h.bridge.setHdrToSdr?.(false, false);
  await flushBridge();
  assert.equal(h.commands.filter((c) => c.command === "mpv_set_property").length, 0);
});
