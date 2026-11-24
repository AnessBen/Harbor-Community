import assert from "node:assert/strict";
import test from "node:test";
import { preferTrailerEditions, rankTrailerSearch, sameTrailerEdition, trailerMatch } from "../src/lib/trailer-matching.ts";

const sponge = { title: "SpongeBob SquarePants", type: "series" as const, year: "1999" };
const video = (title: string, id = "0lGyuTtYUJo") => ({ id, title, duration: 90 });

test("rejects the exact video reproduced in Harbor, even on the official channel", () => {
  assert.equal(trailerMatch(sponge, { ...video("Krabby Patties Ranked By Size! | SpongeBob"), channel: "SpongeBob SquarePants Official" }), -1);
});
test("rejects franchise movies, unrelated titles, fan edits and reactions", () => {
  for (const name of [
    "The SpongeBob SquarePants Movie Official Trailer",
    "SpongeBob SquarePants: Sponge Out of Water Trailer",
    "SpongeBob SquarePants 2 Trailer",
    "SpongeBob SquarePants Official Trailer Reaction",
    "SpongeBob SquarePants Fan Made Trailer",
    "The Fairly OddParents Official Trailer",
    "SpongeBob SquarePants Official Clip",
  ]) assert.equal(trailerMatch(sponge, video(name)), -1, name);
});
test("ranks actual trailers first, matching year before undated, deduplicated", () => {
  assert.deepEqual(rankTrailerSearch(sponge, [
    video("SpongeBob SquarePants Official Teaser", "aaaaaaaaaaa"),
    video("SpongeBob SquarePants Trailer", "bbbbbbbbbbb"),
    video("SpongeBob SquarePants (1999) Official Trailer", "ccccccccccc"),
    video("SpongeBob SquarePants (1999) Official Trailer", "ccccccccccc"),
  ]), ["ccccccccccc", "bbbbbbbbbbb", "aaaaaaaaaaa"]);
});
test("rejects wrong movie year, invalid IDs and full episodes", () => {
  const movie = { title: "Dune", type: "movie" as const, year: "2021" };
  assert.equal(trailerMatch(movie, video("Dune (1984) Official Trailer")), -1);
  assert.equal(trailerMatch(movie, video("Dune Part Two Official Trailer")), -1);
  assert.equal(trailerMatch(movie, video("Dune Official Trailer", "bad")), -1);
  assert.equal(trailerMatch(sponge, { ...video("SpongeBob SquarePants Official Trailer"), duration: 1500 }), -1);
  assert.ok(trailerMatch(movie, video("Dune (2021) Official Trailer")) > 0);
});
test("allows exact alternate title", () => {
  assert.ok(trailerMatch({ title: "Spirited Away", aliases: ["Sen to Chihiro"], type: "movie" }, video("Sen to Chihiro Official Trailer")) > 0);
});

test("real YouTube results for the reported shows accept matching promos but not movies", () => {
  assert.ok(trailerMatch(sponge, video("SpongeBob SquarePants Premiere Promo (July 12, 1999)", "3iMZwqc1nqQ")) > 0);
  assert.ok(trailerMatch(sponge, video("Spongebob Squarepants Original Promo (1999)", "GLgy7Vwml3Y")) > 0);
  assert.equal(trailerMatch(sponge, video("The SpongeBob SquarePants Movie (2004) Trailer #1 | Movieclips Classic Trailers", "47ceXAEr2Oo")), -1);
  assert.equal(trailerMatch(sponge, video("SpongeBob SquarePants Nickelodeon First Promo Television Commercial Soundtrack (1999)", "fSeX_9zK2C8")), -1);
  assert.ok(trailerMatch({ title: "The Fairly OddParents", type: "series", year: "2001" }, video("The Fairly OddParents Promo (2001)", "Lg8n_CA5BMY")) > 0);
  assert.ok(trailerMatch({ title: "The Adventures of Jimmy Neutron: Boy Genius", type: "series", year: "2002" }, video("The Adventures of Jimmy Neutron Boy Genius Promo (Nickelodeon 2002)", "-tLvS-GpjKk")) > 0);
  assert.equal(trailerMatch({ title: "The Adventures of Jimmy Neutron: Boy Genius", type: "series", year: "2002" }, video("Jimmy Neutron: Boy Genius - Trailer", "f7vGlqs3-cE")), -1);
});

test("does not mistake a third-party season upload for the original series trailer", () => {
  const odd = { title: "The Fairly OddParents", type: "series" as const, year: "2001" };
  assert.equal(trailerMatch(odd, { ...video("The Fairly OddParents: Season 10 | Official Trailer #2", "xwBJ3sTWgm8"), channel: "N Central Vids" }), -1);
  assert.equal(trailerMatch(odd, video("The Fairly OddParents Official Trailer Bandicam")), -1);
  assert.equal(trailerMatch(odd, video("The Fairly OddParents Official Trailer")), trailerMatch(odd, video("The Fairly OddParents Trailer")));
  assert.ok(trailerMatch(odd, video("The Fairly OddParents Promo (2001)", "Lg8n_CA5BMY")) > 0);
});

test("duplicate uploads retain the better resolution in the original primary slot", () => {
  const envelope = Array.from({ length: 300 }, (_, i) => Math.sin(i * 1.79) + Math.cos(i * 0.33) + 5);
  const low = { id: "Lg8n_CA5BMY", height: 480, duration: 30, envelope };
  const high = { id: "VHPDL0ghWNk", height: 720, duration: 30, envelope: [5, 5, ...envelope.slice(0, -2)].map(x => x * 1.1) };
  const distinct = { id: "aaaaaaaaaaa", height: 1080, duration: 30, envelope: envelope.map((_, i) => Math.sin(i * 0.77) + 5) };
  assert.equal(sameTrailerEdition(low, high), true);
  assert.equal(sameTrailerEdition(low, distinct), false);
  assert.deepEqual(preferTrailerEditions([low.id, high.id, distinct.id], [low, high, distinct]), [high.id, distinct.id]);
  assert.deepEqual(preferTrailerEditions([high.id, low.id], [low, high]), [high.id]);
});
test("does not deduplicate missing probes, silence, or long clips with matching openings", () => {
  const envelope = Array.from({ length: 300 }, (_, i) => Math.sin(i) + 5);
  const a = { id: "aaaaaaaaaaa", duration: 30, envelope };
  const b = { id: "bbbbbbbbbbb", duration: 30, envelope: [] };
  assert.deepEqual(preferTrailerEditions([a.id, b.id], [a, b]), [a.id, b.id]);
  assert.equal(sameTrailerEdition({ ...a, duration: 120 }, { ...b, duration: 120, envelope }), false);
  assert.equal(sameTrailerEdition({ ...a, envelope: Array(300).fill(0) }, { ...b, envelope: Array(300).fill(0) }), false);
});
