import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { t } from "@/lib/i18n";
import { ffmpegInstallStep } from "@/lib/ffmpeg-install";
import {
  castLoad,
  castPause,
  castPlay,
  castReload,
  castSeek,
  castStatus,
  castStop,
  type CastDeviceInfo,
  type CastLoadInfo,
  type CastOptions,
  type CastPlanSummary,
  type CastSubInfo,
  type CastSubStyle,
  type CastTranscodeStats,
  type TranscodeProfile,
} from "@/lib/cast";
import { directReloadRequest, type CastReloadChange } from "@/lib/cast/cast-source";
import type { PlayerBridge, PlayerSnapshot } from "@/lib/player/bridge";
import { VideoAudioCast } from "@/lib/player/video-audio-cast";
import {
  claimCastSession,
  ownsCastSession,
  releaseCastSession,
  withCastSession,
  type CastLease,
} from "@/lib/cast-ownership";
import type { CastErrorInfo } from "../cast-error-modal";

type LoadParams = {
  host: string;
  port: number;
  url: string;
  title: string;
  poster?: string;
  contentType?: string;
  startTimeSec?: number;
  headers?: Record<string, string>;
  transcode?: boolean;
  profile?: TranscodeProfile;
  subtitle?: CastSubInfo | null;
  subStyle?: CastSubStyle | null;
  audioOnly?: boolean;
  audioTrackOrdinal?: number;
  options?: CastOptions;
  deviceId?: string;
  /** What the player knows of the source's picture; an unknown size is probed natively. */
  sourceWidth?: number;
  sourceHeight?: number;
};

/** Receiver trouble the session bar offers a fix for. */
export type CastTrouble = "unreachable" | "stopped" | null;

export function localizedFfmpegInstallStep(): string {
  const step = ffmpegInstallStep();
  if (step === "Open a terminal and run: brew install ffmpeg") {
    return t("Open a terminal and run: brew install ffmpeg");
  }
  if (
    step === "Install ffmpeg using your system package manager (apt, dnf, pacman, zypper, etc.)."
  ) {
    return t("Install ffmpeg using your system package manager (apt, dnf, pacman, zypper, etc.).");
  }
  if (step === "Open a terminal and run: winget install Gyan.FFmpeg") {
    return t("Open a terminal and run: winget install Gyan.FFmpeg");
  }
  return step;
}

function buildActionableCastError(
  err: string,
  deviceName: string,
  deviceKind: CastDeviceInfo["kind"],
): CastErrorInfo | null {
  if (
    deviceKind === "roku" &&
    /ROKU_ECP_BLOCKED|control by mobile apps|network access/i.test(err)
  ) {
    return {
      title: t("Enable Roku Network Access"),
      message: t(
        "Your Roku is set to block control requests from apps on your network, so Harbor can't reach it. This is a one-time setting on the Roku.",
      ),
      steps: [
        t("On your Roku remote, press Home."),
        t("Open Settings, then System, then Advanced system settings."),
        t('Select "Control by mobile apps" and set Network access to "Default".'),
        t("Come back to Harbor and try casting again."),
      ],
      deviceName,
    };
  }
  if (deviceKind === "roku" && /ROKU_ECP_NOT_FOUND/i.test(err)) {
    return {
      title: t("Couldn't reach this Roku"),
      message: t(
        "Harbor found something at this address that looked like a Roku, but it didn't respond like one. The device may be offline or another product picked up the same broadcast.",
      ),
      steps: [
        t("Make sure the Roku is powered on and on the same Wi-Fi as your computer."),
        t("Close the cast menu and reopen it to rescan the network."),
        t("If multiple Rokus appear, pick the one matching your TV's name."),
      ],
      deviceName,
    };
  }
  if (deviceKind === "roku" && /ROKU_MEDIA_ASSISTANT_MISSING|media assistant/i.test(err)) {
    return {
      title: t("Install Media Assistant"),
      message: t(
        "Roku changed its OS to block the built-in Media Player from accepting video from other apps. Media Assistant is a free channel built to take over that job. One-time install on your Roku and casting works.",
      ),
      steps: [
        t("On your Roku, open Streaming Channels from the home screen."),
        t('Search for "Media Assistant" (channel ID 782875, free).'),
        t("Install it."),
        t("Come back to Harbor and try casting again."),
      ],
      deviceName,
    };
  }
  if (/ffmpeg/i.test(err)) {
    return {
      title: t("Install ffmpeg"),
      message: t(
        "Harbor uses ffmpeg to convert streams into formats TVs can play. It's a one-time install and Harbor will pick it up automatically.",
      ),
      steps: [
        localizedFfmpegInstallStep(),
        t("Restart Harbor after the install completes."),
        t("Open the cast menu and try this device again."),
      ],
      deviceName,
    };
  }
  return null;
}

export function useCastSession(
  bridgeRef: RefObject<PlayerBridge | null>,
  snapRef: RefObject<PlayerSnapshot>,
) {
  const [castMenuOpen, setCastMenuOpen] = useState(false);
  const [castMenuAnchor, setCastMenuAnchor] = useState<{ right: number; bottom: number } | null>(
    null,
  );
  const [castDevice, setCastDevice] = useState<CastDeviceInfo | null>(null);
  const [pendingCastDevice, setPendingCastDevice] = useState<CastDeviceInfo | null>(null);
  const [castError, setCastError] = useState<string | null>(null);
  const [castErrorInfo, setCastErrorInfo] = useState<CastErrorInfo | null>(null);
  const [castPlaying, setCastPlaying] = useState<boolean>(true);
  const [castPositionSec, setCastPositionSec] = useState<number>(0);
  const [burnSubsOnTv, setBurnSubsOnTv] = useState<boolean>(true);
  const [castAudioChoice, setCastAudioChoice] = useState<string>("auto");
  const [castSubtitleChoice, setCastSubtitleChoice] = useState<string>("auto");
  const [castSubtitleFile, setCastSubtitleFile] = useState<string | null>(null);
  const [castApplying, setCastApplying] = useState(false);
  const [castTrouble, setCastTrouble] = useState<CastTrouble>(null);
  const [castStats, setCastStats] = useState<CastTranscodeStats | null>(null);
  const [castSummary, setCastSummary] = useState<CastPlanSummary | null>(null);
  const idleTicksRef = useRef(0);
  const everPlayedRef = useRef(false);
  const seekTargetRef = useRef<number | null>(null);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekWaitersRef = useRef<Array<() => void>>([]);
  /** Settings changes being applied; the TV's position is not shown until all are done. */
  const applyingRef = useRef(0);
  /** How the running cast was loaded, so a direct one can be loaded again with new settings. */
  const lastLoadRef = useRef<{
    device: CastDeviceInfo;
    params: Omit<LoadParams, "host" | "port">;
    stream: string;
  } | null>(null);
  const lastCastPositionRef = useRef<number>(0);
  const castStartTargetRef = useRef<number>(0);
  const castSeekConfirmedRef = useRef<boolean>(false);
  const castDeviceRef = useRef<CastDeviceInfo | null>(null);
  castDeviceRef.current = castDevice;
  const castActiveRef = useRef<boolean>(false);
  castActiveRef.current = castDevice != null;
  const castPlayingRef = useRef<boolean>(true);
  const leaseRef = useRef<CastLease | null>(null);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const generationRef = useRef(0);
  const owned = useCallback(<T>(work: () => Promise<T>) => {
    const lease = leaseRef.current;
    if (!lease) return Promise.reject(new Error("Cast session was replaced."));
    return withCastSession(lease, work);
  }, []);
  const [audio] = useState(
    () =>
      new VideoAudioCast(
        {
          load: (options) => owned(() => castLoad(options)),
          play: () => owned(castPlay),
          pause: () => owned(castPause),
          seek: (sec) => owned(() => castSeek(sec)),
          stop: async () => {
            const lease = leaseRef.current;
            await owned(castStop);
            releaseCastSession(lease);
          },
          status: () => owned(castStatus),
        },
        bridgeRef,
        () => snapRef.current,
      ),
  );
  const audioState = useSyncExternalStore(audio.subscribe, audio.getSnapshot);
  const audioRouting = audioState.device != null;
  castActiveRef.current = castDevice != null || audioRouting;

  useEffect(() => {
    return () => {
      ++generationRef.current;
      if (ownsCastSession(leaseRef.current)) void stopRef.current().catch(() => {});
    };
  }, []);

  // The menu opens on the device list; the session bar's settings button opens it on the settings.
  const [castMenuSettings, setCastMenuSettings] = useState(false);
  const openCastMenu = useCallback(
    (anchor: { right: number; bottom: number } | null, opts?: { settings?: boolean }) => {
      setCastMenuAnchor(anchor);
      setCastMenuSettings(opts?.settings === true);
      setCastMenuOpen(true);
    },
    [],
  );

  const closeCastMenu = useCallback(() => setCastMenuOpen(false), []);

  const pickCastDevice = useCallback(
    async (
      device: CastDeviceInfo,
      params: Omit<LoadParams, "host" | "port">,
      beforeLoad?: () => void,
    ) => {
      setCastMenuOpen(false);
      setCastError(null);
      const generation = ++generationRef.current;
      try {
        const lease = await claimCastSession("video", () => stopRef.current());
        leaseRef.current = lease;
        if (generation !== generationRef.current) {
          releaseCastSession(lease);
          return;
        }
      } catch (error) {
        setCastError(error instanceof Error ? error.message : String(error));
        return;
      }
      if (device.audio_only) {
        try {
          await audio.start(device, params);
        } catch {
          /* route retains stop/return controls on failure */
        }
        if (!audio.getSnapshot().device) releaseCastSession(leaseRef.current);
        return;
      }
      setPendingCastDevice(device);
      setCastTrouble(null);
      setCastStats(null);
      setCastSummary(null);
      idleTicksRef.current = 0;
      everPlayedRef.current = false;
      beforeLoad?.();
      const startTarget = params.startTimeSec ?? 0;
      lastCastPositionRef.current = startTarget;
      castStartTargetRef.current = startTarget;
      castSeekConfirmedRef.current = startTarget <= 1;
      const sessionLease = leaseRef.current;
      const res = await owned(() =>
        castLoad({
          host: device.host,
          port: device.port,
          kind: device.kind,
          controlUrl: device.control_url,
          deviceId: device.id,
          ...params,
        }),
      );
      if (generation !== generationRef.current || !ownsCastSession(sessionLease)) return;
      if (res.ok) {
        setCastDevice(device);
        setPendingCastDevice(null);
        setCastSummary(res.info?.summary ?? null);
        lastLoadRef.current = { device, params, stream: res.info?.stream ?? "direct" };
      } else {
        setPendingCastDevice(null);
        try {
          await owned(castStop);
          releaseCastSession(sessionLease);
        } catch (error) {
          if (generation !== generationRef.current || !ownsCastSession(sessionLease)) return;
          setCastDevice(device);
          setCastError(String(error));
          return;
        }
        const err = res.error ?? t("Could not cast to {deviceName}.", { deviceName: device.name });
        const actionable = buildActionableCastError(err, device.name, device.kind);
        if (actionable) {
          setCastErrorInfo(actionable);
        } else {
          setCastError(err);
          setTimeout(() => setCastError(null), 8000);
          bridgeRef?.current?.play({ reason: "cast" }).catch(() => {});
        }
      }
    },
    [audio, bridgeRef, owned],
  );

  useEffect(() => {
    if (!castDevice) {
      setCastPlaying(true);
      setCastPositionSec(0);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const lease = leaseRef.current;
      const s = await owned(castStatus).catch((error) => {
        if (!cancelled && ownsCastSession(lease)) setCastError(String(error));
        return null;
      });
      if (cancelled || !s || !ownsCastSession(lease)) return;
      setCastStats(s.transcode ?? null);
      if (s.summary) setCastSummary(s.summary);
      if (s.player_state === "UNREACHABLE") {
        setCastTrouble("unreachable");
        return;
      }
      // A receiver that drops to idle by itself (decoder error, renderer restart) is no longer
      // playing, whatever Harbor last asked of it.
      if (s.player_state === "IDLE" && everPlayedRef.current) {
        idleTicksRef.current += 1;
        if (idleTicksRef.current >= 3) setCastTrouble("stopped");
      } else {
        idleTicksRef.current = 0;
        if (s.player_state === "PLAYING" || s.player_state === "PAUSED") setCastTrouble(null);
      }
      if (s.player_state === "PLAYING") {
        castPlayingRef.current = true;
        setCastPlaying(true);
      } else if (s.player_state === "PAUSED") {
        castPlayingRef.current = false;
        setCastPlaying(false);
      } else if (s.player_state === "BUFFERING") {
        castPlayingRef.current = true;
        setCastPlaying(true);
      }
      if (!castSeekConfirmedRef.current) {
        if (s.position_sec >= castStartTargetRef.current - 5) {
          castSeekConfirmedRef.current = true;
        } else {
          return;
        }
      }
      if (s.position_sec > 0) {
        if (s.player_state === "PLAYING" && s.position_sec > castStartTargetRef.current + 1) {
          everPlayedRef.current = true;
        }
        // While a seek or a settings change restarts the stream, the receiver still reports the
        // old stream for a moment; keep showing where it is going.
        if (seekTargetRef.current == null && !applyingRef.current) {
          lastCastPositionRef.current = s.position_sec;
          setCastPositionSec(s.position_sec);
        }
      }
    };
    void tick();
    let id: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await tick();
      if (!cancelled) id = setTimeout(() => void poll(), 1000);
    };
    id = setTimeout(() => void poll(), 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [castDevice, owned]);

  useEffect(() => {
    if (!audioRouting) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await audio.poll();
      if (!cancelled) timer = setTimeout(() => void poll(), 1000);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [audio, audioRouting]);

  useEffect(() => {
    if (!castDevice) return;
    bridgeRef?.current?.pause("cast");
  }, [castDevice, bridgeRef]);

  const togglePlayCast = useCallback(async () => {
    if (audio.getSnapshot().device) {
      await (audio.getSnapshot().phase === "playing" ? audio.pause() : audio.play()).catch(
        () => {},
      );
      return;
    }
    try {
      if (castPlayingRef.current) {
        await owned(castPause);
        castPlayingRef.current = false;
        setCastPlaying(false);
      } else {
        await owned(castPlay);
        castPlayingRef.current = true;
        setCastPlaying(true);
      }
    } catch (error) {
      setCastError(String(error));
    }
  }, [audio, owned]);

  const playCast = useCallback(async () => {
    if (audio.getSnapshot().device) return audio.play();
    await owned(castPlay);
    castPlayingRef.current = true;
    setCastPlaying(true);
  }, [audio, owned]);

  const pauseCast = useCallback(async () => {
    if (audio.getSnapshot().device) return audio.pause();
    await owned(castPause);
    castPlayingRef.current = false;
    setCastPlaying(false);
  }, [audio, owned]);

  const getCastPosition = useCallback(
    () => (audio.getSnapshot().device ? audio.getSnapshot().position : lastCastPositionRef.current),
    [audio],
  );
  const isCastPlaying = useCallback(
    () =>
      audio.getSnapshot().device ? audio.getSnapshot().phase === "playing" : castPlayingRef.current,
    [audio],
  );

  const stopCast = useCallback(async () => {
    const lease = leaseRef.current;
    if (!ownsCastSession(lease)) return;
    if (audio.getSnapshot().device) {
      await audio.stop();
      releaseCastSession(lease);
      return;
    }
    const finalPos = lastCastPositionRef.current;
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = null;
    seekTargetRef.current = null;
    seekWaitersRef.current.splice(0).forEach((done) => done());
    try {
      await owned(castStop);
    } catch (error) {
      setCastError(String(error));
      throw error;
    }
    if (!ownsCastSession(lease)) return;
    releaseCastSession(lease);
    lastLoadRef.current = null;
    setCastDevice(null);
    setPendingCastDevice(null);
    const bridge = bridgeRef?.current;
    if (bridge && finalPos > 1) {
      bridge.seek(finalPos);
    }
  }, [audio, bridgeRef, owned]);
  stopRef.current = stopCast;

  const returnAudioToComputer = useCallback(async () => {
    const lease = leaseRef.current;
    if (!ownsCastSession(lease)) return;
    try {
      await audio.returnToComputer();
      releaseCastSession(lease);
    } catch {
      /* route remains visible for an explicit retry */
    }
  }, [audio]);

  const seekCast = useCallback(
    async (sec: number) => {
      if (audio.getSnapshot().device) {
        await audio.seek(sec).catch(() => {});
        return;
      }
      // A converted cast restarts its conversion on every seek, so rapid presses (+15 s, +15 s)
      // become one seek to where they end up.
      const target = Math.max(0, sec);
      seekTargetRef.current = target;
      lastCastPositionRef.current = target;
      setCastPositionSec(target);
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      // The seek belongs to the cast it was made in: if that cast stops or another one starts
      // before the timer fires, the seek is dropped instead of reaching the new cast.
      const lease = leaseRef.current;
      await new Promise<void>((resolve) => {
        seekWaitersRef.current.push(resolve);
        seekTimerRef.current = setTimeout(() => {
          seekTimerRef.current = null;
          const waiters = seekWaitersRef.current.splice(0);
          const finalTarget = seekTargetRef.current ?? target;
          if (!lease || leaseRef.current !== lease || !ownsCastSession(lease)) {
            waiters.forEach((done) => done());
            return;
          }
          void withCastSession(lease, () => castSeek(finalTarget))
            .then(() => {
              if (leaseRef.current !== lease) return;
              castStartTargetRef.current = finalTarget;
              castSeekConfirmedRef.current = false;
              everPlayedRef.current = false;
              idleTicksRef.current = 0;
            })
            .catch((error) => {
              if (leaseRef.current === lease) setCastError(String(error));
            })
            .finally(() => {
              if (seekTargetRef.current === finalTarget) seekTargetRef.current = null;
              waiters.forEach((done) => done());
            });
        }, 450);
      });
    },
    [audio],
  );

  /** Drops a seek still waiting for its timer and releases whoever awaits it. */
  const cancelPendingSeek = useCallback(() => {
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = null;
    seekTargetRef.current = null;
    seekWaitersRef.current.splice(0).forEach((done) => done());
  }, []);
  useEffect(() => cancelPendingSeek, [cancelPendingSeek]);

  /** Restarts the running cast with changed settings at the current position. */
  const reloadCast = useCallback(
    async (params: CastReloadChange): Promise<CastLoadInfo | null> => {
      const device = castDeviceRef.current;
      if (!device || audio.getSnapshot().device) return null;
      // A seek still waiting for its timer is where the viewer wants to be; the restart goes there
      // and the seek is dropped instead of restarting the stream a second time.
      const position = seekTargetRef.current ?? lastCastPositionRef.current;
      cancelPendingSeek();
      applyingRef.current += 1;
      setCastApplying(true);
      try {
        const loaded = lastLoadRef.current;
        let info: CastLoadInfo | null;
        if (loaded && loaded.device.id === device.id && loaded.stream === "direct") {
          // A stream handed to the receiver directly has nothing to restart: it is loaded again
          // with the new settings, and the converter takes over if they need it.
          const next = directReloadRequest(loaded.params, params, position);
          const res = await owned(() =>
            castLoad({
              host: device.host,
              port: device.port,
              kind: device.kind,
              controlUrl: device.control_url,
              deviceId: device.id,
              ...next,
            }),
          );
          if (!res.ok) {
            throw new Error(
              res.error ?? t("Could not cast to {deviceName}.", { deviceName: device.name }),
            );
          }
          info = res.info ?? null;
          lastLoadRef.current = { device, params: next, stream: info?.stream ?? "direct" };
          setCastSummary(info?.summary ?? null);
        } else {
          // A converted cast restarts its conversion; the new settings shape the plan there.
          info = await owned(() =>
            castReload({
              positionSec: position,
              options: params.options,
              subtitle: params.subtitle,
              subStyle: params.subStyle,
              audioTrackOrdinal: params.audioTrackOrdinal,
            }),
          );
        }
        lastCastPositionRef.current = position;
        castStartTargetRef.current = position;
        castSeekConfirmedRef.current = false;
        everPlayedRef.current = false;
        idleTicksRef.current = 0;
        setCastTrouble(null);
        if (info?.summary) setCastSummary(info.summary);
        return info;
      } catch (error) {
        setCastError(String(error));
        return null;
      } finally {
        applyingRef.current -= 1;
        if (applyingRef.current === 0) setCastApplying(false);
      }
    },
    [audio, owned, cancelPendingSeek],
  );

  const dismissCastErrorInfo = useCallback(() => {
    setCastErrorInfo(null);
    if (!castDeviceRef.current && !audio.getSnapshot().device)
      bridgeRef.current?.play({ reason: "cast" }).catch(() => {});
  }, [audio, bridgeRef]);

  return {
    castMenuOpen,
    castMenuAnchor,
    castMenuSettings,
    castDevice: audioRouting && audioState.phase !== "connecting" ? audioState.device : castDevice,
    pendingCastDevice: audioState.phase === "connecting" ? audioState.device : pendingCastDevice,
    castError: audioState.error ?? castError,
    audioRouting,
    audioPhase: audioState.phase,
    returnAudioToComputer,
    castErrorInfo,
    setCastErrorInfo,
    dismissCastErrorInfo,
    castPlaying: audioRouting ? audioState.phase === "playing" : castPlaying,
    castPositionSec: audioRouting ? audioState.position : castPositionSec,
    burnSubsOnTv,
    setBurnSubsOnTv,
    castAudioChoice,
    setCastAudioChoice,
    castSubtitleChoice,
    setCastSubtitleChoice,
    castSubtitleFile,
    setCastSubtitleFile,
    castApplying,
    castTrouble,
    castStats,
    castSummary,
    reloadCast,
    openCastMenu,
    closeCastMenu,
    pickCastDevice,
    togglePlayCast,
    stopCast,
    seekCast,
    castActiveRef,
    playCast,
    pauseCast,
    getCastPosition,
    isCastPlaying,
  };
}
