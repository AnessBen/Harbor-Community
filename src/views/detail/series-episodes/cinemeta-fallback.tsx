import { useMemo } from "react";
import type { Meta } from "@/lib/cinemeta";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { episodeSpoilerMasks } from "@/lib/spoilers";
import type { CinemetaVideo } from "../episode-groups";
import { CinemetaEpisodeRow } from "../cinemeta-episodes";

export function CinemetaFallback({
  meta,
  videos,
  season,
  imdbRatings,
  watchedFor,
}: {
  meta: Meta;
  videos: NonNullable<Meta["videos"]> | undefined;
  season: number;
  imdbRatings?: Map<string, number>;
  watchedFor: (ep: CinemetaVideo) => boolean;
}) {
  const t = useT();
  const { settings } = useSettings();
  const eps = useMemo(() => {
    if (!videos) return [];
    return videos
      .filter((v) => v.season === season && v.episode != null)
      .slice()
      .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
  }, [videos, season]);
  const masks = episodeSpoilerMasks(settings, eps, watchedFor);
  if (eps.length === 0) {
    return (
      <p className="text-[14px] text-ink-subtle">{t("No episodes available for this season.")}</p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {eps.map((ep) => (
        <CinemetaEpisodeRow
          key={ep.id ?? `${ep.season}-${ep.episode}`}
          meta={meta}
          ep={ep}
          watched={watchedFor(ep)}
          spoiler={masks.get(ep)!}
          imdbRating={imdbRatings?.get(`${season}:${ep.episode ?? ep.number}`)}
        />
      ))}
    </div>
  );
}
