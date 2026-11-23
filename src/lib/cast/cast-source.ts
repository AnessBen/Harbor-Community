import type { CastOptions, CastSubInfo, CastSubStyle } from "@/lib/cast";

type TrackSelection = {
  subtitle: CastSubInfo | null;
  subStyle: CastSubStyle | null;
  audioTrackOrdinal: number | undefined;
};

/**
 * Track choices for the stream the TV actually plays. A swapped stream is another file, so the
 * player's track numbers say nothing about its tracks: its default audio plays and only subtitle
 * files (not embedded tracks) burn in. Every load and reload of that cast goes through here.
 */
export function fitTracksToCastSource<T extends TrackSelection>(media: T, swapped: boolean): T {
  if (!swapped) return media;
  const subtitle = media.subtitle?.kind === "embedded" ? null : media.subtitle;
  return {
    ...media,
    audioTrackOrdinal: undefined,
    subtitle,
    subStyle: subtitle ? media.subStyle : null,
  };
}

/** The output height of each quality setting, as `CastOptions::quality` in `cast_transcode.rs`. */
const QUALITY_HEIGHT: Record<CastOptions["quality"], number> = {
  "720p": 720,
  "1080p": 1080,
  "1080p-hq": 1080,
  "4k": 2160,
  original: 4320,
};

/**
 * The widest picture a receiver of a height class decodes, as `max_width_for` in
 * `cast_transcode.rs`: 16:9 at that height, and DCI's 4096 from 2160 up.
 */
export function qualityWidthLimit(height: number): number {
  const width = height >= 2160 ? (4096 * height) / 2160 : (height * 16) / 9;
  return Math.max(2, Math.round(width / 2) * 2);
}

/**
 * The usual name of a picture size: the smallest standard height whose 16:9 frame holds it, so a
 * 1920x804 scope film is 1080p, as Blu-ray calls it, not "804p". An unknown width goes by height.
 */
export function pictureClass(width: number, height: number): number {
  for (const standard of [480, 576, 720, 1080, 1440, 2160, 4320]) {
    if (height <= standard && width <= qualityWidthLimit(standard)) return standard;
  }
  return height;
}

/** What is known of the source's picture: the decoded size, or the height its release names. */
export type SourcePicture = { height?: number; width?: number };

/**
 * Picture settings that change the video itself. A stream sent to the receiver as it is would
 * silently ignore them, so they need the converter. A quality setting only does when the source is
 * known to be taller or wider than it; an unknown size is left to the converter's own probe.
 */
export function pictureNeedsConversion(
  options: CastOptions,
  source: SourcePicture | undefined,
): boolean {
  const limit = QUALITY_HEIGHT[options.quality];
  const height = source?.height ?? 0;
  const width = source?.width ?? 0;
  return (
    options.aspect !== "default" ||
    options.deinterlace === "always" ||
    options.tonemap === "on" ||
    (limit != null && (height > limit || width > qualityWidthLimit(limit)))
  );
}

/**
 * Whether the cast goes through Harbor's converter. A copied stream plays its first audio track
 * untouched, so another track or any audio processing needs the conversion too, and so does any
 * picture setting that changes the video (`pictureNeedsConversion`).
 */
export function castNeedsConversion(
  resolvedKind: "compat" | "swapped" | "transcode",
  liveIptv: boolean,
  media: {
    subtitle: CastSubInfo | null;
    audioTrackOrdinal: number | undefined;
    options: CastOptions;
  },
  source?: SourcePicture,
): boolean {
  const o = media.options;
  const audioWork =
    (media.audioTrackOrdinal ?? 0) > 0 ||
    o.volumeBoost > 0 ||
    o.nightMode ||
    o.dialogueBoost ||
    o.audioDelayMs !== 0;
  return (
    resolvedKind === "transcode" ||
    liveIptv ||
    media.subtitle != null ||
    audioWork ||
    o.forceConversion ||
    pictureNeedsConversion(o, source)
  );
}

/** What a settings change asks of a running cast. */
export type CastReloadChange = {
  options?: CastOptions;
  subtitle?: CastSubInfo | null;
  subStyle?: CastSubStyle | null;
  audioTrackOrdinal?: number;
  /** The change needs the converter (`castNeedsConversion`). */
  transcode?: boolean;
};

/**
 * The load request that applies `change` to a cast the receiver plays directly. Such a cast has
 * no conversion to restart, so it is loaded again at `positionSec`; a change that needs the
 * converter turns the conversion on, and a later change never turns it back off mid-cast.
 */
export function directReloadRequest<
  P extends {
    startTimeSec?: number;
    options?: CastOptions;
    subtitle?: CastSubInfo | null;
    subStyle?: CastSubStyle | null;
    audioTrackOrdinal?: number;
    transcode?: boolean;
  },
>(loaded: P, change: CastReloadChange, positionSec: number): P {
  return {
    ...loaded,
    startTimeSec: positionSec,
    ...(change.options ? { options: change.options } : {}),
    ...(change.subtitle !== undefined
      ? { subtitle: change.subtitle, subStyle: change.subtitle ? change.subStyle : null }
      : {}),
    ...(change.audioTrackOrdinal !== undefined
      ? { audioTrackOrdinal: change.audioTrackOrdinal }
      : {}),
    transcode: (loaded.transcode ?? false) || (change.transcode ?? false),
  };
}
