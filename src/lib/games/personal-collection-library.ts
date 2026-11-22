import type { CustomGame } from "./custom-library";
import { EMULATION_SYSTEMS, localGames, type EmulationStore, type LocalGame } from "./emulation";
import { romPreferenceId } from "./library-preferences";
import type { PersonalCollectionGame } from "./personal-collections";
import type { QuickGame } from "./quick-library";

export function quickCollectionGame(game: QuickGame): PersonalCollectionGame | null {
  if (game.source === "custom") return customCollectionGame(game.custom);
  if (game.source === "retro") return romCollectionGame(game.local);
  return game.game ?? null;
}
/**
 * Resolve the right-click folder target from the exact local game, not a
 * same-named Steam/IGDB catalog match. A custom card can render before its
 * quick-library projection is populated, but the profile's custom entry is
 * already available.
 */
export function collectionFolderTarget(
  game: PersonalCollectionGame,
  quick: QuickGame[],
  custom: CustomGame[],
): QuickGame | null {
  const identity = game.libraryEntryId ?? game.id;
  const entry = quick.find((item) => {
    if (item.id !== identity) return false;
    if (game.local?.kind === "custom")
      return item.source === "custom" && item.custom.id === game.local.id;
    if (game.local?.kind === "rom")
      return (
        item.source === "retro" &&
        item.local.system === game.local.system &&
        item.local.path === game.local.path
      );
    return true;
  });
  if (entry) return entry;
  if (game.local?.kind !== "custom" || game.id !== `custom:${game.local.id}`) return null;
  const customId = game.local.id;
  const local = custom.find((item) => item.id === customId);
  if (!local) return null;
  return {
    id: game.id,
    name: local.name,
    favorite: local.pinned,
    lastPlayed: local.lastPlayed,
    ready: false,
    source: "custom",
    custom: local,
  };
}

export function customCollectionGame(game: CustomGame): PersonalCollectionGame {
  return {
    id: `custom:${game.id}`,
    name: game.name,
    capsule: game.linked?.capsule ?? "",
    portrait: game.linked?.portrait,
    platforms: game.linked?.platforms ?? [],
    local: { kind: "custom", id: game.id },
  };
}
export function romCollectionGame(game: LocalGame): PersonalCollectionGame {
  return {
    id: romPreferenceId(game.system, game.path),
    name: game.linked?.name ?? game.name,
    capsule: game.linked?.capsule ?? "",
    portrait: game.linked?.portrait,
    platforms: [EMULATION_SYSTEMS.find((s) => s.id === game.system)?.name ?? ""],
    local: { kind: "rom", system: game.system, path: game.path },
  };
}
export type ResolvedCollectionGame = {
  game: PersonalCollectionGame;
  custom?: CustomGame;
  rom?: ReturnType<typeof localGames>[number];
};

/** Resolve exact, profile-local references once; a catalog match or shared name never chooses a launch target. */
export function resolveCollectionLibrary(
  games: PersonalCollectionGame[],
  custom: CustomGame[],
  retro: EmulationStore,
): Record<string, ResolvedCollectionGame> {
  const pc = new Map(custom.map((game) => [game.id, game]));
  const roms = new Map(
    localGames(retro).map((game) => [romPreferenceId(game.system, game.path), game]),
  );
  return Object.fromEntries(
    games.map((game) => {
      const current = game.local?.kind === "custom" ? pc.get(game.local.id) : undefined;
      const rom = game.local?.kind === "rom" ? roms.get(game.id) : undefined;
      // Missing entries keep their readable snapshot and membership, never another copy's launch target.
      return [
        game.id,
        {
          game: current ? customCollectionGame(current) : rom ? romCollectionGame(rom) : game,
          custom: current,
          rom,
        },
      ];
    }),
  );
}
