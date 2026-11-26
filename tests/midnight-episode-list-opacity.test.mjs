import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Midnight does not fade an entire long episode list on a scroll timeline", () => {
  const css = readFileSync(
    new URL("../src/themes/midnight/styles/midnight.css", import.meta.url),
    "utf8",
  );
  const rule = css.match(/([^{}]+)\{\s*animation: midnight-detail-chapter linear both;/);
  assert.ok(rule, "other detail sections retain the chapter animation");
  assert.match(rule[1], /\[data-detail-section\]/);
  assert.doesNotMatch(rule[1], /\[data-(?:anime-)?episodes\]/);
});
