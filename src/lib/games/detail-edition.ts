import type { AtlasGame } from "./igdb-data";
import type { GameDetail, GameSummary } from "./types";
import { launcherCatalogGame } from "./launchers";
import { launcherCatalogLookup, matchesLauncherCatalog } from "./launcher-catalog";
import type { LibraryMetadataMatch } from "./library-metadata";
import type { CustomGame } from "./custom-library";

export type DisplayGameDetail = Omit<GameDetail, "steamId"> & { steamId?: number };

/**
 * Some games have been re-listed on Steam, leaving most community guides on
 * their retired app ID. These verified edition-specific pairs affect only
 * the Steam Community Guides source, never the store link or launch identity.
 */
const legacyCommunityGuides = new Map([
  [3717330, { igdbId: 12595, appId: 834530 }], // Yakuza Kiwami (Legacy)
]);

function communityGuideAppId(appId: number | undefined, igdbId: number | undefined) {
  if (!appId) return undefined;
  const legacy = legacyCommunityGuides.get(appId);
  return legacy && legacy.igdbId === igdbId ? legacy.appId : appId;
}

/**
 * IGDB detail pages always expose the Guides hub: it includes video and external
 * written resources even when IGDB has no verified Steam association yet.
 * Steam-only pages retain availability-based discovery.
 */
export function showDetailGuides(
  game: GameSummary,
  storeDetail: GameDetail | null,
  atlas: AtlasGame | null,
  reviewed: LibraryMetadataMatch | undefined,
  available: boolean,
): boolean {
  return available || !!reviewed || /^igdb:[1-9]\d*$/.test(game.id) || (!!atlas && !storeDetail);
}

/** An IGDB route chooses that edition. An external store link does not change it. */
export function detailEditionTarget(game: GameSummary): GameSummary {
  const id = /^igdb:([1-9]\d*)$/.exec(game.id);
  return id && Number.isSafeInteger(Number(id[1]))
    ? { ...game, igdbId: Number(id[1]), steamId: undefined }
    : launcherCatalogGame(game);
}

export function resolveDetailEdition(
  game: GameSummary,
  store: GameDetail | null,
  metadata: AtlasGame | null,
  reviewed?: LibraryMetadataMatch,
  localGames: CustomGame[] = [],
) {
  const target = detailEditionTarget(game);
  const atlas =
    metadata &&
    (reviewed
      ? metadata.igdbId === reviewed.igdbId
      : launcherCatalogLookup(target.id, target.catalogSteamId)
        ? matchesLauncherCatalog(target, metadata)
        : target.igdbId
          ? metadata.igdbId === target.igdbId
          : !!target.steamId && metadata.steamId === target.steamId)
      ? metadata
      : null;
  const storeDetail =
    !reviewed && target.steamId && store?.steamId === target.steamId ? store : null;
  let detail: DisplayGameDetail | null =
    storeDetail ??
    (atlas
      ? {
          ...atlas,
          id: target.id,
          steamId: target.steamId,
          about: atlas.description,
          logo: "",
          trailers: [],
          genres: atlas.genres.map((item) => item.name),
          features: [...atlas.modes, ...atlas.perspectives].map((item) => item.name),
          developers: atlas.developers.map((item) => item.name),
          publishers: atlas.publishers.map((item) => item.name),
          release:
            atlas.release !== undefined
              ? new Date(atlas.release * 1000).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })
              : "",
          comingSoon: false,
          controller: undefined,
          requirements: { minimum: "", recommended: "" },
          languages: "",
          achievements: undefined,
        }
      : target.id.startsWith("source:") && !target.steamId && !target.igdbId && target.sourceListing
        ? {
            ...target,
            about: target.sourceListing.description,
            description: target.sourceListing.description,
            hero: target.capsule,
            logo: "",
            screenshots: target.sourceListing.screenshots,
            trailers: [],
            genres: [],
            features: [],
            developers: [],
            publishers: [],
            release: "",
            comingSoon: false,
            requirements: { minimum: "", recommended: "" },
            languages: "",
          }
        : null);
  if (detail) {
    // Steam can assign multiple category IDs to one label. Keep the source
    // categories intact while presenting each feature once, including snapshots.
    const features = [...new Set(detail.features)];
    if (features.length !== detail.features.length) detail = { ...detail, features };
  }
  const portableGame: GameSummary = {
    ...(detail ?? target),
    id: target.id,
    steamId: target.steamId,
    catalogSteamId: target.catalogSteamId,
    ...(reviewed
      ? { igdbId: target.igdbId, libraryEntryId: game.libraryEntryId ?? game.id }
      : atlas
        ? { igdbId: atlas.igdbId }
        : {}),
    ...(game.sourceOrigin ? { sourceOrigin: game.sourceOrigin } : {}),
    ...(target.importedArtwork ? { importedArtwork: target.importedArtwork } : {}),
  };
  // IGDB's exact record provides this association, never a title-based guess.
  const steamLinkId = target.steamId ?? (reviewed ? undefined : atlas?.steamId);
  // A locally linked IGDB edition already records its selected Steam association.
  // Check the exact library entry and selected edition rather than trusting a
  // bare Steam ID on an IGDB page (which may belong to a different edition).
  const localEntry = game.libraryEntryId?.startsWith("custom:")
    ? localGames.find((item) => `custom:${item.id}` === game.libraryEntryId)
    : undefined;
  const linked = localEntry?.linked;
  const localGuideSteamId =
    linked &&
    linked.id === game.id &&
    linked.igdbId === target.igdbId &&
    (!reviewed || reviewed.igdbId === linked.igdbId) &&
    Number.isSafeInteger(linked.steamId) &&
    (linked.steamId ?? 0) > 0
      ? linked.steamId
      : undefined;
  // Guide identity is read-only: never modify the selected edition, store link,
  // or the custom installation's launch identity. Re-listed Steam editions can
  // share their original Community guide catalog when the IGDB identity agrees.
  const guideSteamId = communityGuideAppId(
    target.steamId ?? localGuideSteamId ?? atlas?.steamId,
    reviewed?.igdbId ?? target.igdbId ?? atlas?.igdbId,
  );
  return { target, atlas, storeDetail, detail, portableGame, steamLinkId, guideSteamId };
}
