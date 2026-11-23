import assert from "node:assert/strict";
import test from "node:test";
import {
  detailEditionTarget,
  resolveDetailEdition,
  showDetailGuides,
} from "../src/lib/games/detail-edition.ts";
import { parseAtlasGame, parseAtlasSummary } from "../src/lib/games/igdb-data.ts";
import type { GameDetail, GameSummary } from "../src/lib/games/types.ts";
import { emptyLaunchConfig, type CustomGame } from "../src/lib/games/custom-library.ts";
import { readSavedGames, writeSavedGames } from "../src/lib/games/saved.ts";
import { steamGuidesUrl, defaultSteamGuideFilters } from "../src/lib/games/steam-guide-options.ts";

const original = parseAtlasGame({
  id: 42,
  name: "Original console edition",
  summary: "The original adventure.",
  first_release_date: 694224000,
  platforms: [{ id: 19, name: "Super Nintendo" }],
  cover: { image_id: "original" },
  artworks: [{ image_id: "originalhero" }],
  external_games: [{ uid: "99", external_game_source: 1 }],
  involved_companies: [{ developer: true, company: { id: 8, name: "Original studio" } }],
});
const port: GameDetail = {
  id: "steam:99",
  steamId: 99,
  name: "Modern PC port",
  capsule: "pc-cover",
  platforms: ["Windows"],
  description: "Modern edition description",
  about: "Modern edition about",
  aboutHtml: "<p>PC port</p>",
  hero: "pc-hero",
  libraryHero: "pc-library-hero",
  logo: "pc-logo",
  screenshots: ["pc-shot"],
  trailers: [],
  genres: [],
  features: [],
  developers: ["Port studio"],
  publishers: [],
  release: "2026",
  releaseTimestamp: 1767225600,
  comingSoon: false,
  requirements: { minimum: "Windows 11", recommended: "RTX GPU" },
  languages: "English",
  achievements: 40,
};
const selected: GameSummary = { ...original, id: "igdb:42" };

test("IGDB pages keep Guides visible even before Steam or video discovery finishes", () => {
  const igdb = resolveDetailEdition(selected, port, original);
  assert.equal(showDetailGuides(selected, igdb.storeDetail, igdb.atlas, undefined, false), true);
  assert.equal(showDetailGuides(selected, null, null, undefined, false), true);

  // A reviewed local metadata match can display an IGDB edition under a
  // custom or Steam entry ID. It must still have the same Guides entry.
  const local: GameSummary = {
    id: "custom:00000000-0000-4000-8000-000000000001",
    name: "Linked local game",
    capsule: "",
    platforms: [],
  };
  const reviewed = {
    igdbId: original.igdbId,
    name: original.name,
    capsule: original.capsule,
    platforms: original.platforms,
  };
  assert.equal(showDetailGuides(local, null, original, reviewed, false), true);
  assert.equal(showDetailGuides(local, null, null, reviewed, false), true);
  assert.equal(showDetailGuides(port, null, original, undefined, false), true);

  // Ordinary Steam pages keep hiding Guides when all sources are confirmed
  // empty, while discovered guides remain available on either route.
  assert.equal(showDetailGuides(port, port, original, undefined, false), false);
  assert.equal(showDetailGuides(port, port, null, undefined, false), false);
  assert.equal(showDetailGuides(port, port, null, undefined, true), true);
  assert.equal(showDetailGuides(local, null, null, undefined, false), false);
});

test("an explicit IGDB edition keeps original metadata even when its Steam port is loaded", () => {
  const result = resolveDetailEdition(selected, port, original);
  assert.equal(result.target.steamId, undefined);
  assert.equal(result.storeDetail, null);
  assert.equal(result.detail?.description, original.description);
  assert.equal(result.detail?.hero, original.hero);
  assert.equal(result.detail?.libraryHero, undefined);
  assert.equal(result.detail?.aboutHtml, undefined);
  assert.equal(result.detail?.achievements, undefined);
  assert.deepEqual(result.detail?.platforms, ["Super Nintendo"]);
  assert.deepEqual(result.detail?.developers, ["Original studio"]);
  assert.deepEqual(result.detail?.requirements, { minimum: "", recommended: "" });
  assert.ok(result.detail?.release.includes("1992"));
  assert.equal(result.steamLinkId, 99);
  assert.equal(
    result.guideSteamId,
    99,
    "the exact IGDB Steam association can supply written guides",
  );
});

test("Explore re-listed Yakuza Kiwami uses the original Community guides without changing its edition", () => {
  const exploreRow = {
    id: 12595,
    name: "Yakuza Kiwami",
    external_games: [{ uid: "3717330", external_game_source: 1 }],
  };
  const exploreSummary = parseAtlasSummary(exploreRow)!;
  assert.equal(
    exploreSummary.id,
    "steam:3717330",
    "Explore can route an IGDB result through the newer Steam ID",
  );
  assert.equal(exploreSummary.igdbId, 12595);
  const exploreAtlas = parseAtlasGame(exploreRow);

  const newer = resolveDetailEdition(exploreSummary, null, exploreAtlas);
  assert.equal(newer.target.steamId, 3717330);
  assert.equal(newer.portableGame.steamId, 3717330);
  assert.equal(newer.steamLinkId, 3717330, "retain the official newer Steam listing");
  assert.equal(
    newer.guideSteamId,
    834530,
    "browse the older, more complete Community guide catalog",
  );
  const guidesUrl = steamGuidesUrl(newer.guideSteamId!, "", 1, defaultSteamGuideFilters("en"));
  assert.equal(
    new URL(guidesUrl).pathname,
    "/app/834530/guides/",
    "the Explore Original guides link must match the linked local Steam game's URL",
  );

  const explicitIgdb = resolveDetailEdition(
    { ...exploreSummary, id: "igdb:12595" },
    null,
    exploreAtlas,
  );
  assert.equal(explicitIgdb.portableGame.id, "igdb:12595");
  assert.equal(explicitIgdb.portableGame.steamId, undefined);
  assert.equal(explicitIgdb.steamLinkId, 3717330);
  assert.equal(explicitIgdb.guideSteamId, 834530);
  assert.equal(
    resolveDetailEdition({ ...exploreSummary, igdbId: 12596 }, null, null).guideSteamId,
    3717330,
    "do not remap a different IGDB edition",
  );
  assert.equal(
    resolveDetailEdition({ ...exploreSummary, steamId: 999 }, null, null).guideSteamId,
    999,
    "unrelated Steam games are unchanged",
  );
});

test("a linked local IGDB edition retains the exact Steam guides catalog without IGDB external metadata", () => {
  const localId = "859f6fb2-b195-4ac4-b57e-479fa08ece6e";
  const linked: GameSummary = {
    id: "igdb:12595",
    igdbId: 12595,
    steamId: 834530,
    name: "Yakuza Kiwami",
    capsule: "",
    platforms: ["Windows"],
  };
  const local: CustomGame = {
    id: localId,
    name: "Yakuza Kiwami",
    config: { ...emptyLaunchConfig(), executable: "D:/Games/Kiwami/game.exe" },
    linked,
    artwork: null,
    pinned: false,
    hidden: false,
    addedAt: 1,
    lastPlayed: 0,
    measuredSeconds: 0,
  };
  const selectedLocal: GameSummary = { ...linked, libraryEntryId: `custom:${localId}` };
  const atlasWithoutSteam = parseAtlasGame({ id: 12595, name: "Yakuza Kiwami" });
  for (const atlas of [null, atlasWithoutSteam]) {
    const result = resolveDetailEdition(selectedLocal, null, atlas, undefined, [local]);
    assert.equal(
      result.guideSteamId,
      834530,
      "use the exact locally linked Steam edition for guides",
    );
    assert.equal(result.target.steamId, undefined);
    assert.equal(result.portableGame.steamId, undefined);
    assert.equal(
      result.steamLinkId,
      undefined,
      "guides must not change the official store association",
    );
  }
  const resolve = (
    game: GameSummary,
    localGames = [local],
    reviewed?: { igdbId: number; name: string; capsule: string; platforms: string[] },
  ) => resolveDetailEdition(game, null, null, reviewed, localGames).guideSteamId;
  assert.equal(resolve(selectedLocal, []), undefined, "the selected local record must be present");
  assert.equal(resolve({ ...selectedLocal, libraryEntryId: "custom:other" }), undefined);
  assert.equal(resolve({ ...selectedLocal, id: "igdb:12596" }), undefined);
  assert.equal(
    resolve(selectedLocal, [{ ...local, linked: { ...linked, steamId: 999 } }]),
    999,
    "the current local record, not a stale UI snapshot, supplies the guide ID",
  );
  assert.equal(
    resolve(selectedLocal, [local], {
      igdbId: 42,
      name: "Another edition",
      capsule: "",
      platforms: [],
    }),
    undefined,
    "reviewed metadata must not use guides from another edition",
  );
  assert.equal(
    resolve({ ...selectedLocal, libraryEntryId: undefined }),
    undefined,
    "ordinary IGDB pages cannot trust an unverified embedded Steam ID",
  );
});

test("missing or stale atlas data cannot fall back to another edition or validate its Steam link", () => {
  for (const atlas of [null, { ...original, igdbId: 43 }]) {
    const result = resolveDetailEdition(selected, port, atlas);
    assert.equal(result.detail, null);
    assert.equal(result.steamLinkId, undefined);
    assert.equal(result.guideSteamId, undefined);
    assert.equal(result.portableGame.id, "igdb:42");
    assert.equal(result.portableGame.steamId, undefined);
  }
  assert.equal(
    resolveDetailEdition(selected, port, { ...original, steamId: undefined }).steamLinkId,
    undefined,
  );
});

test("saved ROM identity stays IGDB before and after enrichment and survives persistence", () => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    },
  });
  const before = resolveDetailEdition(selected, port, null).portableGame;
  const after = resolveDetailEdition(selected, port, original).portableGame;
  assert.equal(before.id, after.id);
  assert.equal(after.igdbId, 42);
  assert.equal(after.steamId, undefined);
  writeSavedGames("edition-fixture", [after]);
  assert.equal(readSavedGames("edition-fixture")[0]?.id, "igdb:42");
  assert.equal(readSavedGames("edition-fixture")[0]?.name, original.name);
  writeSavedGames("raw-rom-fixture", [selected, port]);
  assert.deepEqual(
    readSavedGames("raw-rom-fixture").map((game) => game.id),
    ["igdb:42", "steam:99"],
  );
  data.set("harbor.games.saved.v1:legacy-rom", JSON.stringify([selected]));
  assert.equal(readSavedGames("legacy-rom")[0]?.id, "igdb:42");
});

test("Steam-origin pages keep their store metadata while linked launcher identity remains stable", () => {
  const steam = resolveDetailEdition(port, port, original);
  assert.equal(steam.detail, port);
  assert.equal(steam.storeDetail, port);
  assert.equal(steam.portableGame.id, "steam:99");
  assert.equal(steam.steamLinkId, 99);
  const launcher = { ...port, id: "epic:owned-copy" };
  assert.equal(resolveDetailEdition(launcher, port, original).portableGame.id, launcher.id);
  assert.equal(resolveDetailEdition(port, { ...port, steamId: 100 }, null).detail, null);
});

test("the explicit route ID is the authority for the IGDB request", () => {
  assert.deepEqual(detailEditionTarget({ ...selected, igdbId: 777 }), {
    ...selected,
    igdbId: 42,
    steamId: undefined,
  });
  assert.equal(detailEditionTarget(port), port);
});

test("repeated Steam controller labels render once without dropping category identities", () => {
  // Hades II's public appdetails assigns these different IDs identical labels.
  const featureCategories = [
    { id: 28, name: "Full controller support" },
    { id: 55, name: "DualShock Controller Support" },
    { id: 56, name: "DualShock Controller Support" },
    { id: 57, name: "DualSense Controller Support" },
    { id: 58, name: "DualSense Controller Support" },
    { id: 23, name: "Steam Cloud" },
  ];
  const source: GameDetail = {
    ...port,
    featureCategories,
    features: featureCategories.map((category) => category.name),
  };
  for (const detail of [source, { ...source, cachedAt: 1234 }]) {
    const result = resolveDetailEdition(port, detail, null);
    assert.deepEqual(result.detail?.features, [
      "Full controller support",
      "DualShock Controller Support",
      "DualSense Controller Support",
      "Steam Cloud",
    ]);
    assert.equal(result.storeDetail, detail);
    assert.equal(result.detail?.featureCategories, featureCategories);
    assert.deepEqual(
      result.detail?.featureCategories?.map((category) => category.id),
      [28, 55, 56, 57, 58, 23],
    );
    assert.equal(detail.features.length, 6);
    assert.equal(result.detail?.cachedAt, detail.cachedAt);
  }
});

test("repeated atlas feature labels preserve distinct metadata routes and edition identity", () => {
  const atlas = {
    ...original,
    modes: [
      { id: 1, name: "Single player" },
      { id: 1, name: "Single player" },
    ],
    perspectives: [{ id: 2, name: "Side view" }],
  };
  const result = resolveDetailEdition(selected, port, atlas);
  assert.deepEqual(result.detail?.features, ["Single player", "Side view"]);
  assert.equal(result.atlas, atlas);
  assert.equal(result.atlas?.modes.length, 2);
  assert.equal(result.portableGame.id, selected.id);
  assert.equal(result.storeDetail, null);
});
