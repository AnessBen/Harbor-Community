import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { castCapabilities, castPreview, type CastCapabilities, type CastPreview } from "@/lib/cast";
import { panelDevice, useCastPreferences } from "@/lib/cast/cast-preferences";
import { castNeedsConversion, fitTracksToCastSource } from "@/lib/cast/cast-source";
import { castProfile, playerPicture } from "@/lib/cast/device-caps";
import { useDebridClients } from "@/lib/debrid/registry";
import type { PlayerBridge, PlayerSnapshot, TrackInfo } from "@/lib/player/bridge";
import {
  getPlaybackBuffered,
  getPlaybackPosition,
  setPlaybackClock,
} from "@/lib/player/playback-clock";
import type { Settings } from "@/lib/settings";
import type { PlayerSrc } from "@/lib/view";
import { previewCastResolution } from "../cast-resolve";
import { resolveCastMedia, useCastPick, type CastMediaChoices } from "./use-cast-pick";
import { useCastSession } from "./use-cast-session";

const SUBTITLE_FILE_EXTENSIONS = ["srt", "ass", "ssa", "vtt", "sub", "txt"];

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function usePlayerCast(params: {
  src: PlayerSrc;
  debrids: ReturnType<typeof useDebridClients>;
  snapRef: RefObject<PlayerSnapshot>;
  bridgeRef: RefObject<PlayerBridge | null>;
  settings: Settings;
}) {
  const { src, debrids, snapRef, bridgeRef, settings } = params;
  const session = useCastSession(bridgeRef, snapRef);
  const prefs = useCastPreferences();
  const castChoices = useMemo<CastMediaChoices>(
    () => ({
      audioChoice: session.castAudioChoice,
      subtitleChoice: session.castSubtitleChoice,
      subtitleFile: session.castSubtitleFile,
      burnSubs: session.burnSubsOnTv,
    }),
    [
      session.castAudioChoice,
      session.castSubtitleChoice,
      session.castSubtitleFile,
      session.burnSubsOnTv,
    ],
  );
  const pick = useCastPick({
    src,
    debrids,
    snapRef,
    bridgeRef,
    settings,
    castChoices,
    closeCastMenu: session.closeCastMenu,
    pickCastDevice: session.pickCastDevice,
    setCastErrorInfo: session.setCastErrorInfo,
  });

  useEffect(() => {
    if (session.castDevice && !session.audioRouting) {
      setPlaybackClock(session.castPositionSec || getPlaybackPosition(), getPlaybackBuffered());
    }
  }, [session.castDevice, session.castPositionSec, session.audioRouting]);

  // Settings changed while the TV plays are applied by restarting the cast where it is.
  const casting = session.castDevice != null && !session.audioRouting;
  const castDevice = session.castDevice;
  const previewDevice = panelDevice(prefs, castDevice);
  const reloadCast = session.reloadCast;
  const swapped = pick.castSourceSwapped;
  const castSource = pick.castSource;
  const liveIptv = src.meta.id?.startsWith("iptv:") ?? false;
  /**
   * What the running cast should receive now, and whether that needs the converter: a picture,
   * audio or subtitle setting can turn a cast the TV plays directly into a converted one.
   */
  const castChange = useCallback(() => {
    const media = fitTracksToCastSource(
      resolveCastMedia(snapRef.current, castChoices, settings, castDevice),
      swapped,
    );
    return {
      options: media.options,
      subtitle: media.subtitle,
      subStyle: media.subStyle,
      audioTrackOrdinal: media.audioTrackOrdinal ?? 0,
      transcode: castNeedsConversion(castSource.kind, liveIptv, media, castSource.picture),
    };
  }, [snapRef, castChoices, settings, castDevice, swapped, castSource, liveIptv]);
  // Everything the TV would receive, resolved the way a load resolves it. "Same as the player"
  // follows the player's own track and subtitle style changes, so those restart the cast too.
  const settingsKey = JSON.stringify(
    fitTracksToCastSource(
      resolveCastMedia(snapRef.current, castChoices, settings, previewDevice),
      swapped,
    ),
  );
  const appliedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!casting) {
      appliedKeyRef.current = null;
      return;
    }
    if (appliedKeyRef.current == null) {
      appliedKeyRef.current = settingsKey;
      return;
    }
    if (appliedKeyRef.current === settingsKey) return;
    const timer = window.setTimeout(() => {
      appliedKeyRef.current = settingsKey;
      void reloadCast(castChange());
    }, 700);
    return () => window.clearTimeout(timer);
  }, [casting, settingsKey, reloadCast, castChange]);

  const restartCast = useCallback(() => reloadCast(castChange()), [reloadCast, castChange]);

  const addSubtitleFile = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Subtitles", extensions: SUBTITLE_FILE_EXTENSIONS }],
      });
      if (typeof picked !== "string" || !picked) return;
      session.setCastSubtitleFile(picked);
      session.setCastSubtitleChoice("file");
      session.setBurnSubsOnTv(true);
    } catch {
      /* the dialog was dismissed */
    }
  }, [session]);

  // What the converter would do, for the settings panel's summary line.
  const [preview, setPreview] = useState<CastPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [caps, setCaps] = useState<CastCapabilities | null>(null);
  const menuOpen = session.castMenuOpen && prefs.panelOpen;
  useEffect(() => {
    if (!menuOpen || caps) return;
    let cancelled = false;
    void castCapabilities().then((c) => {
      if (!cancelled) setCaps(c);
    });
    return () => {
      cancelled = true;
    };
  }, [menuOpen, caps]);
  const isRemoteManifest = /\.(m3u8|mpd)(\?|$)/i.test(src.url);
  useEffect(() => {
    if (!menuOpen) return;
    if (isRemoteManifest || !src.url) {
      // An older request's cleanup keeps it from clearing these, and its result is for another source.
      setPreview(null);
      setPreviewBusy(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const snap = snapRef.current;
      const media = resolveCastMedia(snap, castChoices, settings, previewDevice);
      // The receiver's limits and the conversion a load would ask for, so the preview shows what
      // the TV will get rather than an unbounded conversion.
      const picture = playerPicture(snap, src.streamRef);
      const resolution = previewDevice
        ? previewCastResolution(src, previewDevice, {
            width: snap.videoWidth,
            height: snap.videoHeight,
          })
        : null;
      setPreviewBusy(true);
      void castPreview({
        url: src.url,
        headers: src.headers,
        options: media.options,
        audioTrackOrdinal: media.audioTrackOrdinal,
        burnSubtitles: media.subtitle != null,
        // The same embedded track a load would burn in, not a second guess at it.
        subtitleOrdinal: media.subtitle?.kind === "embedded" ? media.subtitle.src_index : undefined,
        transcode: resolution
          ? castNeedsConversion(resolution.kind, liveIptv, media, picture)
          : undefined,
        profile: resolution ? castProfile(resolution, liveIptv) : undefined,
      })
        .then((p) => {
          if (!cancelled) setPreview(p);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        })
        .finally(() => {
          if (!cancelled) setPreviewBusy(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [menuOpen, isRemoteManifest, src, settingsKey, castChoices, settings, snapRef, previewDevice]);

  const panelFor = useCallback(
    (audioTracks: TrackInfo[], subtitleTracks: TrackInfo[]) => ({
      audioTracks,
      subtitleTracks,
      audioChoice: session.castAudioChoice,
      subtitleChoice: session.castSubtitleChoice,
      subtitleFileName: session.castSubtitleFile ? fileName(session.castSubtitleFile) : null,
      burnSubs: session.burnSubsOnTv,
      onAudioChoice: session.setCastAudioChoice,
      onSubtitleChoice: session.setCastSubtitleChoice,
      onAddSubtitleFile: () => void addSubtitleFile(),
      onBurnSubs: session.setBurnSubsOnTv,
      preview,
      previewBusy,
      caps,
      device: session.castDevice,
      casting,
      applying: session.castApplying,
      stats: session.castStats,
      summary: casting ? session.castSummary : null,
    }),
    [session, addSubtitleFile, preview, previewBusy, caps, casting],
  );

  const sync = useMemo(
    () => ({
      activeRef: session.castActiveRef,
      play: session.playCast,
      pause: session.pauseCast,
      seek: session.seekCast,
      getPosition: session.getCastPosition,
      isPlaying: session.isCastPlaying,
    }),
    [
      session.castActiveRef,
      session.playCast,
      session.pauseCast,
      session.seekCast,
      session.getCastPosition,
      session.isCastPlaying,
    ],
  );

  return { ...session, ...pick, sync, panelFor, restartCast };
}

export type PlayerCastController = ReturnType<typeof usePlayerCast>;
