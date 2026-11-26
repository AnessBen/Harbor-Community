import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

function load(path, mocks = {}) {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected dependency: " + name);
  }, exports);
  return exports;
}

const spoilers = load("src/lib/spoilers.ts");
const groups = load("src/views/detail/episode-groups.ts");
const settings = {
  hideSpoilers: true,
  spoilerHideThumbnails: true,
  spoilerHideTitles: true,
  spoilerHideDescriptions: true,
  spoilerSkipNext: true,
  showEpisodeDescription: true,
  episodeLayout: "grid",
};
const stub = () => null;
const react = { ...React, useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() };
const base = {
  react,
  "react/jsx-runtime": jsx,
  "react-dom": { createPortal: stub },
  "lucide-react": new Proxy({}, { get: () => stub }),
  "@/lib/i18n": { useT: () => (s) => s },
  "@/lib/settings": { useSettings: () => ({ settings }) },
  "@/lib/spoilers": spoilers,
  "@/components/episode-release-countdown": { EpisodeReleaseCountdown: stub },
  "@/components/icons/play-filled": { Play: stub },
  "@/components/poster": { Poster: () => jsx.jsx("span", { "data-art": true }) },
};
const meta = { id: "addon:fixture", name: "Fixture", type: "series" };
const videos = [1, 2, 3].map((episode) => ({
  id: "ep:" + episode,
  season: 1,
  episode,
  name: "Title " + episode,
  overview: "Synopsis " + episode,
  released: "2020-01-01",
}));
const clear = { thumb: false, title: false, desc: false };
const masked = { thumb: true, title: true, desc: true };

function loadCinemeta(captured) {
  const card = ({ g, spoiler, progress }) => {
    captured.push({ number: g.number, spoiler, watched: progress.watched });
    return null;
  };
  return load("src/views/detail/cinemeta-episodes.tsx", {
    ...base,
    "@/lib/season-view-pref": { getViewedSeason: () => 1, setViewedSeason: stub },
    "@/components/episode-watched-menu": { EpisodeWatchedMenu: stub },
    "@/lib/manual-watched": {
      manualEpisodeKeys: () => ({ watched: [], unwatched: [] }),
      manualWatchedState: () => undefined,
      manualWatchedVersion: () => 0,
      subscribeManualWatched: () => () => {},
    },
    "@/lib/active-profile-id": { isNuvioProviderActive: () => false },
    "@/lib/local-library/use-series-play": { useLocalAwareSeriesPlay: () => stub },
    "./episode-download-button": { EpisodeDownloadButton: stub },
    "./episode-reviews-dialog": { EpisodeReviewsButton: stub },
    "@/lib/episode-progress": { resumeDefaultSeason: () => 1 },
    "@/components/drag-strip": { DragStrip: ({ children }) => children },
    "./episode-grid": {
      EpisodeGrid: ({ episodes, spoilerFor, progressFor }) =>
        episodes.map((g) =>
          jsx.jsx(card, { g, spoiler: spoilerFor?.(g), progress: progressFor(g) }, g.key),
        ),
    },
    "./episode-grid-card": { EpisodeGridCard: card },
    "./season-explorer": { SeasonExplorer: stub },
    "./use-season-explorer": { useSeasonExplorerView: () => ({ items: [], details: new Map() }) },
    "@/lib/providers/tmdb/tmdb-client": { effectiveTmdbLanguage: () => "en" },
    "@/lib/season-name": { seasonPill: () => "" },
    "./episode-layout-toggle": { EpisodeLayoutToggle: stub },
    "./helpers": { isUpcomingDate: () => false },
    "./episode-rating-badge": { EpisodeRatingBadge: stub },
    "./use-episode-imdb-ratings": { useEpisodeImdbRatings: () => new Map() },
    "./episode-groups": groups,
  });
}

test("addon grid and strip preserve watched/next-up exceptions and mask later episodes", () => {
  for (const episodeLayout of ["grid", "strip"]) {
    settings.episodeLayout = episodeLayout;
    const captured = [];
    const { CinemetaEpisodes } = loadCinemeta(captured);
    renderToStaticMarkup(
      jsx.jsx(CinemetaEpisodes, {
        meta,
        videos,
        stremioWatched: new Set(["1:1"]),
      }),
    );
    assert.deepEqual(captured, [
      { number: 1, spoiler: clear, watched: true },
      { number: 2, spoiler: clear, watched: false },
      { number: 3, spoiler: masked, watched: false },
    ]);
  }
});

test("addon list applies all three CSS masks only to protected episodes", () => {
  settings.episodeLayout = "list";
  const { CinemetaEpisodes } = loadCinemeta([]);
  const html = renderToStaticMarkup(
    jsx.jsx(CinemetaEpisodes, {
      meta,
      videos,
      stremioWatched: new Set(["1:1"]),
    }),
  );
  assert.equal((html.match(/blur-\[14px\]/g) ?? []).length, 1);
  assert.equal((html.match(/blur-\[5px\]/g) ?? []).length, 2);
  settings.spoilerSkipNext = false;
  try {
    const all = renderToStaticMarkup(
      jsx.jsx(CinemetaEpisodes, {
        meta,
        videos,
        stremioWatched: new Set(["1:1"]),
      }),
    );
    assert.equal((all.match(/blur-\[14px\]/g) ?? []).length, 2);
  } finally {
    settings.spoilerSkipNext = true;
  }
});

test("provider fallback rows use watched progress and shared spoiler policy", () => {
  const captured = [];
  const { CinemetaFallback } = load("src/views/detail/series-episodes/cinemeta-fallback.tsx", {
    ...base,
    "../cinemeta-episodes": {
      CinemetaEpisodeRow: ({ ep, watched, spoiler }) => {
        captured.push({ number: ep.episode, watched, spoiler });
        return null;
      },
    },
  });
  renderToStaticMarkup(
    jsx.jsx(CinemetaFallback, {
      meta,
      videos: [...videos].reverse(),
      season: 1,
      watchedFor: (ep) => ep.episode === 1,
    }),
  );
  assert.deepEqual(captured, [
    { number: 1, watched: true, spoiler: clear },
    { number: 2, watched: false, spoiler: clear },
    { number: 3, watched: false, spoiler: masked },
  ]);
});

test("Big Picture series cards mask artwork, title and synopsis with focus reveal classes", () => {
  const { BpEpisodeCard } = load("src/views/big-picture/detail/bp-episode-card.tsx", {
    ...base,
    "@/lib/providers/tmdb": { pickEpisodeName: (name) => name },
    "@/lib/sfx": { SFX: {} },
    "../bp-i18n": { useBpT: () => (s) => s },
    "../bp-episode-still": {
      BP_EPISODE_CARD_W: "240px",
      BP_SPOILER_TEXT: "spoiler-text group-data-[bp-focus=true]:blur-[0px]",
      BP_SPOILER_THUMB: "spoiler-thumb group-data-[bp-focus=true]:blur-[0px]",
      BpEpisodeRating: stub,
      BpEpisodeStill: stub,
    },
    "./bp-detail-chrome": { bpShortDate: () => "" },
  });
  const props = {
    ep: {
      key: "ep:3",
      group: 1,
      label: 3,
      season: 1,
      episode: 3,
      name: "Secret title",
      overview: "Secret synopsis",
    },
    stills: [],
    watched: false,
    progress: 0,
    onPlay: stub,
  };
  const html = renderToStaticMarkup(jsx.jsx(BpEpisodeCard, { ...props, spoiler: masked }));
  assert.equal((html.match(/spoiler-thumb/g) ?? []).length, 1);
  assert.equal((html.match(/spoiler-text/g) ?? []).length, 2);
  assert.equal((html.match(/group-data-\[bp-focus=true\]:blur-\[0px\]/g) ?? []).length, 3);
  assert.doesNotMatch(html, /aria-label="[^"]*Secret title/);
  assert.doesNotMatch(
    renderToStaticMarkup(jsx.jsx(BpEpisodeCard, { ...props, spoiler: clear })),
    /spoiler-(?:text|thumb)/,
  );
});

test("ordered grid uses each season's own progress and mask for duplicate episode numbers", () => {
  const captured = [];
  const { EpisodeStrip } = load("src/views/detail/episode-strip.tsx", {
    ...base,
    "@/components/hover-tooltip": { HoverTooltip: stub },
    "./episode-rating-badge": { EpisodeRatingBadge: stub },
    "./episode-grid-card": { EpisodePreview: stub },
    "@/components/drag-strip": { DragStrip: stub },
    "@/lib/dates": { formatAirDate: () => "" },
    "@/lib/view": { useView: () => ({}) },
    "@/lib/local-library/use-series-play": { useLocalAwareSeriesPlay: () => stub },
    "./episode-grid": {
      EpisodeGrid: ({ episodes, progressFor, spoilerFor }) => {
        captured.push(
          ...episodes.map((g) => ({
            season: g.season,
            watched: progressFor(g).watched,
            spoiler: spoilerFor(g),
          })),
        );
        return null;
      },
    },
    "./episode-download-button": { EpisodeDownloadButton: stub },
    "./episode-reviews-dialog": { EpisodeReviewsDialog: stub, EpisodeReviewsIconButton: stub },
    "./helpers": { isUpcomingDate: () => false },
    "@/lib/episode-reviews": { episodeReviewsTarget: () => undefined },
  });
  const episodes = [1, 2].map((seasonNumber) => ({
    id: seasonNumber * 100 + 1,
    seasonNumber,
    episodeNumber: 1,
    name: "Episode " + seasonNumber,
    runtime: 24,
    airDate: null,
  }));
  renderToStaticMarkup(
    jsx.jsx(EpisodeStrip, {
      meta,
      episodes,
      layout: "grid",
      thumbnailFor: () => undefined,
      progressFor: (ep) => ({ watched: ep.seasonNumber === 1, ratio: 0, startedAt: 0 }),
      spoilerFor: (ep) => (ep.seasonNumber === 1 ? clear : masked),
    }),
  );
  assert.deepEqual(captured, [
    { season: 1, watched: true, spoiler: clear },
    { season: 2, watched: false, spoiler: masked },
  ]);
});
