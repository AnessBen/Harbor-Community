import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/views/detail/anime-episodes/anime-season-lookup.ts", "utf8");
const exports: Record<string, unknown> = {};
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("require", "exports", compiled)(() => { throw new Error("unexpected runtime import"); }, exports);
const pick = exports.matchingKitsuSeasonEntry as (
  hits: Array<{ id: number; title: string; year: number | null; subtype: string | null }>,
  base: string,
  season: string,
  year: string | undefined,
) => string | null;

const jojo = "JoJo's Bizarre Adventure";
const hits = [
  { id: 41410, title: "JoJo's Bizarre Adventure: Golden Wind", year: 2018, subtype: "TV" },
  { id: 42116, title: "JoJo's Bizarre Adventure: Golden Wind Recap", year: 2019, subtype: "special" },
  { id: 44294, title: "JoJo's Bizarre Adventure: Stone Ocean", year: 2021, subtype: "TV" },
  { id: 46010, title: "JoJo's Bizarre Adventure: Stone Ocean Part 2", year: 2022, subtype: "TV" },
  { id: 49847, title: "Steel Ball Run: JoJo's Bizarre Adventure", year: 2026, subtype: "ONA" },
];

test("missing JoJo seasons resolve to their actual Kitsu entries", () => {
  assert.equal(pick(hits, jojo, "Golden Wind", "2018"), "kitsu:41410");
  assert.equal(pick(hits, jojo, "Stone Ocean", "2021"), "kitsu:44294");
  assert.equal(pick(hits, jojo, "Steel Ball Run", "2026"), "kitsu:49847");
});

test("season search rejects wrong dates, formats, generic names, and ambiguous hits", () => {
  assert.equal(pick(hits, jojo, "Golden Wind", "2019"), "kitsu:41410");
  assert.equal(pick(hits, jojo, "Golden Wind", "2020"), null);
  assert.equal(pick(hits, jojo, "Season 4", "2018"), null);
  assert.equal(pick(hits, jojo, "Stone Ocean", "2022"), "kitsu:44294");
  assert.equal(pick(hits, jojo, "Golden Wind", undefined), null);
  assert.equal(pick(hits, "Unrelated Anime", "Golden Wind", "2018"), null);
  assert.equal(pick([...hits, { ...hits[0], id: 999 }], jojo, "Golden Wind", "2018"), null);
});


test("season name plus adjacent premiere year is a general fallback when catalog metadata starts a year later", () => {
  const sample = [
    { id: 100, title: "Example Anime: Northern Arc", year: 2024, subtype: "TV" },
    { id: 101, title: "Example Anime: Northern Arc Part 2", year: 2025, subtype: "TV" },
    { id: 102, title: "Example Anime: Southern Arc", year: 2025, subtype: "TV" },
  ];
  assert.equal(pick(sample, "Example Anime", "Northern Arc", "2025"), "kitsu:100");
  assert.equal(pick(sample, "Example Anime", "Southern Arc", "2025"), "kitsu:102");
  assert.equal(pick(sample, "Example Anime", "Northern Arc Part 2", "2025"), "kitsu:101");
  assert.equal(pick(sample, "Example Anime", "Season 2", "2025"), null);
});

const pickCours = exports.matchingKitsuSeasonEntries as (
  hits: Array<{ id: number; title: string; year: number | null; subtype: string | null }>,
  base: string,
  season: string,
  year: string | undefined,
) => string[];
const commonSeries = exports.seasonLookupSeriesName as (
  openedTitle: string,
  franchiseTitles: string[],
) => string;
const query = exports.seasonLookupQuery as (base: string, arc: string) => string;

test("Steel Ball Run CW details resolve a common franchise title for older JoJo seasons", () => {
  const series = commonSeries("Steel Ball Run: JoJo's Bizarre Adventure", [
    "JoJo's Bizarre Adventure: Golden Wind",
    "JoJo's Bizarre Adventure: Stone Ocean",
    "Steel Ball Run: JoJo's Bizarre Adventure",
  ]);
  assert.equal(series, "JoJo's Bizarre Adventure");
  assert.equal(query(series, "Diamond is Unbreakable"),
    "JoJo's Bizarre Adventure Diamond is Unbreakable");
  assert.equal(commonSeries("Unrelated Show: Part Two", []), "Unrelated Show: Part Two");
});

test("Stardust Crusaders season resolves both verified cour candidates", () => {
  const entries = [
    { id: 8063, title: "JoJo's Bizarre Adventure: Stardust Crusaders", year: 2014, subtype: "TV" },
    { id: 8739, title: "JoJo's Bizarre Adventure: Stardust Crusaders - Battle in Egypt", year: 2015, subtype: "TV" },
    { id: 11459, title: "JoJo's Bizarre Adventure: Diamond is Unbreakable", year: 2016, subtype: "TV" },
  ];
  assert.deepEqual(pickCours(entries, jojo, "Stardust Crusaders", "2014"), ["kitsu:8063", "kitsu:8739"]);
  assert.deepEqual(pickCours(entries, jojo, "Diamond is Unbreakable", "2016"), ["kitsu:11459"]);
  assert.deepEqual(pickCours(entries, jojo, "Season 2", "2014"), []);
  assert.deepEqual(pickCours(entries, "Wrong Series", "Stardust Crusaders", "2014"), []);
});

test("candidate lookup never invents a primary owner when the requested season is ambiguous", () => {
  const duplicate = [
    { id: 12, title: "Example Anime: Fire Arc", year: 2024, subtype: "TV" },
    { id: 13, title: "Example Anime: Fire Arc", year: 2024, subtype: "TV" },
  ];
  assert.deepEqual(pickCours(duplicate, "Example Anime", "Fire Arc", "2024"), []);
});
