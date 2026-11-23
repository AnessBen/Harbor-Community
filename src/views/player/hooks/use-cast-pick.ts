import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  guessContentType,
  type CastDeviceInfo,
  type CastOptions,
  type CastSubInfo,
  type CastSubStyle,
} from "@/lib/cast";
import { castProfile, knownStreamHeight, playerPicture } from "@/lib/cast/device-caps";
import {
  castOptionsFor,
  getCastPreferences,
  rememberCastDevice,
  type CastSubtitleLook,
} from "@/lib/cast/cast-preferences";
import {
  castNeedsConversion,
  fitTracksToCastSource,
  type SourcePicture,
} from "@/lib/cast/cast-source";
import type { RememberedDevice } from "@/lib/cast/device-settings";
import { useDebridClients } from "@/lib/debrid/registry";
import { t } from "@/lib/i18n";
import type { PlayerBridge, PlayerSnapshot, TrackInfo } from "@/lib/player/bridge";
import { getPlaybackPosition } from "@/lib/player/playback-clock";
import type { Settings } from "@/lib/settings";
import type { PlayerSrc } from "@/lib/view";
import { resolveCompatibleCastUrl } from "../cast-resolve";
import { localizedFfmpegInstallStep, type useCastSession } from "./use-cast-session";

type CastSession = ReturnType<typeof useCastSession>;

function subFormatFromTrack(track: TrackInfo): CastSubInfo["format"] {
  const codec = (track.codec ?? "").toLowerCase();
  const source = `${codec} ${(track.externalFilename ?? "").toLowerCase()}`;
  if (source.includes("ass") || source.includes("ssa")) return "ass";
  if (source.includes("vtt") || source.includes("webvtt")) return "vtt";
  return "srt";
}

function subFormatFromPath(path: string): CastSubInfo["format"] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ass") || lower.endsWith(".ssa")) return "ass";
  if (lower.endsWith(".vtt")) return "vtt";
  return "srt";
}

function buildCastSub(tracks: TrackInfo[], chosen?: TrackInfo): CastSubInfo | null {
  const selected = chosen ?? tracks.find((t) => t.selected);
  if (!selected) return null;
  if (selected.external) {
    if (!selected.externalFilename) return null;
    return {
      kind: "external",
      url: selected.externalFilename,
      format: subFormatFromTrack(selected),
      off: false,
    };
  }
  const embeddedIndex = tracks.filter((t) => !t.external).indexOf(selected);
  if (embeddedIndex < 0) return null;
  return { kind: "embedded", src_index: embeddedIndex, off: false };
}

/** 100% is a comfortable TV size on libass's 288-line canvas; the default 150% matches the old look. */
const CAST_SUB_BASE_SIZE = 18;

function buildCastSubStyle(s: Settings, look: CastSubtitleLook): CastSubStyle {
  return {
    font_size: Math.max(8, Math.round((CAST_SUB_BASE_SIZE * look.sizePercent) / 100)),
    font_color: look.color || s.subFontColor,
    border_color: s.subBorderColor,
    border_size: s.subBorderSize,
    margin_y: s.subMarginY + look.lift,
    align_x: s.subAlignX,
    background: look.background,
  };
}

/** The cast menu's own choices; "auto" follows the player. */
export type CastMediaChoices = {
  audioChoice: string;
  subtitleChoice: string;
  subtitleFile: string | null;
  burnSubs: boolean;
};

/** Subtitle, audio track and settings for the TV, from the cast menu's choices and the device. */
export function resolveCastMedia(
  snap: PlayerSnapshot,
  choices: CastMediaChoices,
  settings: Settings,
  device: RememberedDevice | null,
): {
  subtitle: CastSubInfo | null;
  subStyle: CastSubStyle | null;
  audioTrackOrdinal: number | undefined;
  options: CastOptions;
} {
  const prefs = getCastPreferences();
  let subtitle: CastSubInfo | null = null;
  if (choices.burnSubs && choices.subtitleChoice !== "off") {
    if (choices.subtitleChoice === "file") {
      subtitle = choices.subtitleFile
        ? {
            kind: "external",
            url: choices.subtitleFile,
            format: subFormatFromPath(choices.subtitleFile),
            off: false,
          }
        : null;
    } else if (choices.subtitleChoice === "auto") {
      subtitle = buildCastSub(snap.subtitleTracks);
    } else {
      const track = snap.subtitleTracks.find((t) => t.id === choices.subtitleChoice);
      subtitle = track ? buildCastSub(snap.subtitleTracks, track) : null;
    }
  }
  const embedded = snap.audioTracks.filter((t) => !t.external);
  const audioTrack =
    choices.audioChoice === "auto"
      ? snap.audioTracks.find((t) => t.selected)
      : snap.audioTracks.find((t) => t.id === choices.audioChoice);
  const ordinal = audioTrack && !audioTrack.external ? embedded.indexOf(audioTrack) : -1;
  return {
    subtitle,
    subStyle: subtitle ? buildCastSubStyle(settings, prefs.look) : null,
    audioTrackOrdinal: ordinal >= 0 ? ordinal : undefined,
    options: castOptionsFor(device, prefs),
  };
}

function formatCastReasons(reasons: string[]): string {
  return reasons
    .map((reason) => {
      const resolution = /^(\d+)p above device max (\d+)p$/.exec(reason);
      if (resolution) {
        return t("{resolution}p above device max {maxResolution}p", {
          resolution: resolution[1],
          maxResolution: resolution[2],
        });
      }
      switch (reason) {
        case "Dolby Vision unsupported":
          return t("Dolby Vision unsupported");
        case "HDR10 unsupported":
          return t("HDR10 unsupported");
        case "AV1 unsupported":
          return t("AV1 unsupported");
        case "HEVC unsupported":
          return t("HEVC unsupported");
        case "TrueHD audio unsupported":
          return t("TrueHD audio unsupported");
        case "DTS audio unsupported":
          return t("DTS audio unsupported");
        case "E-AC-3 unsupported":
          return t("E-AC-3 unsupported");
        case "AC-3 audio unsupported":
          return t("AC-3 audio unsupported");
        case "MKV container unsupported":
          return t("MKV container unsupported");
        case "audio must be re-encoded":
          return t("audio must be re-encoded");
        default:
          return reason;
      }
    })
    .join(", ");
}

export function useCastPick(params: {
  src: PlayerSrc;
  debrids: ReturnType<typeof useDebridClients>;
  snapRef: RefObject<PlayerSnapshot>;
  bridgeRef: RefObject<PlayerBridge | null>;
  settings: Settings;
  castChoices: CastMediaChoices;
  closeCastMenu: () => void;
  pickCastDevice: CastSession["pickCastDevice"];
  setCastErrorInfo: CastSession["setCastErrorInfo"];
}) {
  const {
    src,
    debrids,
    snapRef,
    bridgeRef,
    settings,
    castChoices,
    closeCastMenu,
    pickCastDevice,
    setCastErrorInfo,
  } = params;
  const [castIncompatError, setCastIncompatError] = useState<string | null>(null);
  const [castTranscoding, setCastTranscoding] = useState(false);
  // Whether the TV plays a compatible alternative instead of the player's file.
  const [castSourceSwapped, setCastSourceSwapped] = useState(false);
  // The stream the TV plays: how it reached it and its height, which a settings change during
  // the cast needs to decide whether the converter must take over.
  const [castSource, setCastSource] = useState<{
    kind: "compat" | "swapped" | "transcode";
    picture: SourcePicture;
  }>({ kind: "compat", picture: {} });

  useEffect(() => {
    if (!castIncompatError) return;
    const timeoutId = window.setTimeout(() => setCastIncompatError(null), 8000);
    return () => window.clearTimeout(timeoutId);
  }, [castIncompatError]);

  const onPickDevice = useCallback(
    async (device: CastDeviceInfo) => {
      if (device.audio_only) {
        const snap = snapRef.current;
        closeCastMenu();
        const embedded = snap.audioTracks.filter((track) => !track.external);
        const selected = snap.audioTracks.find((track) => track.selected);
        if (selected?.external || (!selected && embedded.length > 1)) {
          setCastIncompatError(t("video.cast.trackUnavailable"));
          return;
        }
        if (src.isLive || src.meta.id?.startsWith("iptv:")) {
          setCastIncompatError(t("video.cast.liveUnsupported"));
          return;
        }
        if (device.kind !== "dlna") {
          setCastIncompatError(
            t(device.kind === "airplay" ? "music.cast.airplay" : "video.cast.protocol"),
          );
          return;
        }
        setCastTranscoding(true);
        await pickCastDevice(device, {
          url: src.url,
          headers: src.headers,
          title: src.title,
          poster: src.meta.poster ?? undefined,
          contentType: guessContentType(src.url, src.streamRef?.title ?? src.title),
          startTimeSec: getPlaybackPosition(),
          audioOnly: true,
          audioTrackOrdinal: selected ? embedded.indexOf(selected) : undefined,
        });
        return;
      }
      const snap = snapRef.current;
      const resolved = await resolveCompatibleCastUrl(
        src,
        device,
        debrids,
        {
          width: snap.videoWidth,
          height: snap.videoHeight,
        },
        settings.animePreferImdbStreams,
      );
      if (resolved.kind === "incompatible") {
        const hint =
          resolved.candidatesChecked === 0
            ? t(
                '{deviceLabel} can\'t play this stream ({reasons}). Click "Pick another" first to load alternatives, then try casting again.',
                {
                  deviceLabel: resolved.caps.label,
                  reasons: formatCastReasons(resolved.reasons),
                },
              )
            : t(
                "{deviceLabel} can't play this stream ({reasons}) and none of the {count} available alternatives match its capabilities.",
                {
                  deviceLabel: resolved.caps.label,
                  reasons: formatCastReasons(resolved.reasons),
                  count: resolved.candidatesChecked,
                },
              );
        setCastIncompatError(hint);
        closeCastMenu();
        return;
      }
      if (resolved.kind === "needs-ffmpeg") {
        setCastErrorInfo({
          title: t("Install ffmpeg"),
          message: t(
            "{deviceLabel} can't decode this stream natively ({reasons}). Harbor uses ffmpeg to convert it into a format your TV understands.",
            {
              deviceLabel: resolved.caps.label,
              reasons: formatCastReasons(resolved.reasons),
            },
          ),
          steps: [
            localizedFfmpegInstallStep(),
            t("Restart Harbor after the install completes."),
            t("Open the cast menu and try this device again."),
          ],
          deviceName: device.name,
        });
        closeCastMenu();
        return;
      }
      if (resolved.kind === "swapped") {
        console.info(
          `[cast] swapped stream for ${resolved.caps.label}: ${resolved.reasons.join(", ")} -> ${resolved.alt.parsedTitle ?? resolved.alt.title ?? "alt"}`,
        );
      }
      if (resolved.kind === "transcode") {
        console.info(
          `[cast] transcoding for ${resolved.caps.label}: ${resolved.reasons.join(", ")}`,
        );
      }
      const isLiveIptv = src.meta.id?.startsWith("iptv:") ?? false;
      // From here the device's own settings apply, and the panel shows them.
      rememberCastDevice(device);
      const swapped = resolved.kind === "swapped";
      setCastSourceSwapped(swapped);
      // A swapped stream is another file: only its own release name tells its height.
      const picture: SourcePicture = swapped
        ? { height: knownStreamHeight(resolved.alt) }
        : playerPicture(snap, src.streamRef);
      setCastSource({ kind: resolved.kind, picture });
      const media = fitTracksToCastSource(
        resolveCastMedia(snap, castChoices, settings, device),
        swapped,
      );
      const audioTrackOrdinal = media.audioTrackOrdinal;
      const burnSub = media.subtitle;
      const forceTranscode = castNeedsConversion(resolved.kind, isLiveIptv, media, picture);
      // Any conversion (burning in subtitles, audio work, or one Harbor starts itself) keeps to
      // the receiver's resolution and bit rate, and changes no codec it plays; live TV gets the
      // safe 1080p H.264 profile.
      const profile = castProfile(resolved, isLiveIptv);
      setCastTranscoding(forceTranscode);
      await pickCastDevice(
        device,
        {
          url: resolved.url,
          title: src.title,
          poster: src.meta.poster ?? undefined,
          contentType: forceTranscode
            ? "application/x-mpegURL"
            : guessContentType(resolved.url, src.streamRef?.title ?? src.title),
          startTimeSec: isLiveIptv ? 0 : getPlaybackPosition(),
          headers: isLiveIptv ? { "user-agent": "VLC/3.0.20 LibVLC/3.0.20" } : undefined,
          transcode: forceTranscode,
          profile,
          subtitle: burnSub,
          subStyle: burnSub ? media.subStyle : null,
          audioTrackOrdinal,
          options: media.options,
          // What the player knows of the picture; an unknown size is probed before direct play.
          sourceWidth: picture.width,
          sourceHeight: picture.height,
        },
        () => bridgeRef.current?.pause("cast"),
      );
    },
    [
      src,
      debrids,
      snapRef,
      bridgeRef,
      settings,
      castChoices,
      closeCastMenu,
      pickCastDevice,
      setCastErrorInfo,
    ],
  );

  return {
    castIncompatError,
    setCastIncompatError,
    castTranscoding,
    setCastTranscoding,
    castSourceSwapped,
    castSource,
    onPickDevice,
  };
}
