import type { QuickGame } from "./quick-library";
import type { GameSummary } from "./types";

export type SidebarGameDestination =
  | { kind: "shortcut"; id: string }
  | { kind: "details"; game: GameSummary }
  | { kind: "custom"; id: string }
  | { kind: "library"; mode: "retro" | "custom"; query: string };

/** Keep click targets tied to the actual library entry, never a guessed catalog match. */
export function sidebarGameDestination(game: QuickGame): SidebarGameDestination {
  if (game.source === "shortcut") return { kind: "shortcut", id: game.id };
  if (game.game) return { kind: "details", game: { ...game.game, libraryEntryId: game.id } };
  if (game.source === "custom") return { kind: "custom", id: game.custom.id };
  return {
    kind: "library",
    mode: game.source === "retro" ? "retro" : "custom",
    query: game.name,
  };
}
