// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const renderer = readFileSync(
  new URL("../src/components/player/transport/control-renderer.tsx", import.meta.url),
  "utf8",
);

function controlCase(id: string, nextId: string): string {
  const start = renderer.indexOf(`case "${id}": {`);
  const end = renderer.indexOf(`case "${nextId}": {`, start);
  assert.ok(start >= 0, `${id} renderer is present`);
  assert.ok(end > start, `${id} renderer has a bounded case`);
  return renderer.slice(start, end);
}

test("previous episode stays available in tight transport layouts", () => {
  const previous = controlCase("prev-episode", "seek-back");

  assert.match(previous, /if \(!ctx\.showEpisodeNav\) return null;/);
  assert.doesNotMatch(
    previous,
    /if\s*\(\s*ctx\.tight\s*\|\|/,
    "tight mode must not hide previous episode",
  );
  assert.match(
    previous,
    /const iconOnly = ctx\.tight \|\| v === "condensed"/,
    "tight mode must use the compact icon-only button",
  );
});

test("next episode stays available in tight transport layouts", () => {
  const next = controlCase("next-episode", "pick-another");

  assert.match(next, /if \(!ctx\.showEpisodeNav\) return null;/);
  assert.doesNotMatch(
    next,
    /if\s*\(\s*ctx\.tight\s*\|\|/,
    "tight mode must not hide next episode",
  );
  assert.match(
    next,
    /const iconOnly = ctx\.tight \|\| v === "condensed"/,
    "tight mode must use the compact icon-only button",
  );
});
