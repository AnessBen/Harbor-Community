import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type CastDeviceInfo = {
  id: string;
  name: string;
  host: string;
  port: number;
  model: string | null;
  kind: "chromecast" | "dlna" | "roku" | "airplay";
  control_url: string | null;
  audio_only: boolean;
};

export type TranscodeProfile = {
  max_height: number;
  force_h264: boolean;
  force_aac: boolean;
  force_stereo: boolean;
  max_video_kbps?: number;
};

/** Live conversion statistics while Harbor converts the stream for the receiver. */
export type CastTranscodeStats = {
  speed: number;
  outTimeSec: number;
  running: boolean;
  error: string | null;
};

/** What the converter does to the source: "copy" keeps a stream as it is. */
export type CastPlanSummary = {
  video: string;
  audio: string;
  sourceVideo: string;
  sourceAudio: string;
  outputWidth: number;
  outputHeight: number;
  tonemap: string | null;
  hardware: string | null;
  burnedSubtitles: boolean;
  deinterlaced: boolean;
  reasons: string[];
};

export type CastStatus = {
  position_sec: number;
  /** PLAYING, PAUSED, BUFFERING, IDLE, or UNREACHABLE when the receiver stopped answering. */
  player_state: string;
  connected: boolean;
  transport_codec?: string | null;
  transcode?: CastTranscodeStats | null;
  summary?: CastPlanSummary | null;
};

/** The cast settings panel. Mirrors `CastOptions` in `cast_transcode.rs`. */
export type CastOptions = {
  quality: "720p" | "1080p" | "1080p-hq" | "4k" | "original";
  forceConversion: boolean;
  hevcNative: boolean;
  hardwareDecoding: boolean;
  hardwareEncoding: boolean;
  fastSeek: boolean;
  tonemap: "auto" | "on" | "off";
  deinterlace: "none" | "auto" | "always";
  aspect: "default" | "16:9" | "4:3" | "21:9" | "fill";
  streamFormat: "auto" | "ts" | "hls";
  audioMode: "stereo" | "surround" | "original";
  volumeBoost: number;
  nightMode: boolean;
  dialogueBoost: boolean;
  audioDelayMs: number;
  subDelayMs: number;
  subEncoding: string;
};

export const DEFAULT_CAST_OPTIONS: CastOptions = {
  quality: "1080p-hq",
  forceConversion: false,
  hevcNative: false,
  hardwareDecoding: true,
  hardwareEncoding: true,
  fastSeek: false,
  tonemap: "auto",
  deinterlace: "auto",
  aspect: "default",
  streamFormat: "auto",
  audioMode: "stereo",
  volumeBoost: 0,
  nightMode: false,
  dialogueBoost: false,
  audioDelayMs: 0,
  subDelayMs: 0,
  subEncoding: "auto",
};

export type CastLoadInfo = {
  /** "hls", "ts", "direct" or "audio". */
  stream: string;
  summary: CastPlanSummary | null;
};

export type CastSubStyle = {
  font_size: number;
  font_color: string;
  border_color: string;
  border_size: number;
  margin_y: number;
  align_x: "left" | "center" | "right";
  /** Text on a translucent box instead of an outline. */
  background?: boolean;
};

export type CastSubInfo = {
  kind: "external" | "embedded";
  url?: string;
  src_index?: number;
  format?: "srt" | "ass" | "ssa" | "vtt";
  off: boolean;
};

export async function discoverCastDevices(): Promise<CastDeviceInfo[]> {
  if (!isTauri) return [];
  try {
    return await invoke<CastDeviceInfo[]>("cast_discover");
  } catch (e) {
    console.warn("[cast] discover failed", e);
    return [];
  }
}

export async function castLoad(opts: {
  host: string;
  port: number;
  url: string;
  title?: string;
  poster?: string;
  contentType?: string;
  startTimeSec?: number;
  kind?: "chromecast" | "dlna" | "roku" | "airplay";
  controlUrl?: string | null;
  headers?: Record<string, string>;
  transcode?: boolean;
  profile?: TranscodeProfile;
  subtitle?: CastSubInfo | null;
  subStyle?: CastSubStyle | null;
  /** Extract audio from this exact source; the receiver must confirm progress before LOAD resolves. */
  audioOnly?: boolean;
  /** Embedded audio ordinal in this exact source (FFmpeg 0:a:N), never mpv aid. */
  audioTrackOrdinal?: number;
  audioStartPaused?: boolean;
  options?: CastOptions;
  /** The discovered device id; lets Harbor find a DLNA renderer again after it restarts. */
  deviceId?: string;
  /**
   * The source's picture size when the player knows it. A load of a stream the receiver could play
   * as it is checks the quality setting against it, and probes the source when it is not given.
   */
  sourceWidth?: number;
  sourceHeight?: number;
}): Promise<{ ok: boolean; error: string | null; info?: CastLoadInfo | null }> {
  if (!isTauri) return { ok: false, error: "Casting requires the desktop build." };
  try {
    const info = await invoke<CastLoadInfo | null>("cast_load", {
      host: opts.host,
      port: opts.port,
      url: opts.url,
      title: opts.title ?? null,
      poster: opts.poster ?? null,
      contentType: opts.contentType ?? null,
      startTimeSec: opts.startTimeSec ?? null,
      kind: opts.kind ?? "chromecast",
      controlUrl: opts.controlUrl ?? null,
      headers: opts.headers ?? null,
      transcode: opts.transcode ?? false,
      profile: opts.profile ?? null,
      subtitle: opts.subtitle ?? null,
      subStyle: opts.subStyle ?? null,
      audioOnly: opts.audioOnly ?? false,
      audioTrackOrdinal: opts.audioTrackOrdinal ?? null,
      audioStartPaused: opts.audioStartPaused ?? false,
      options: opts.options ?? null,
      deviceId: opts.deviceId ?? null,
      sourceWidth: opts.sourceWidth ?? null,
      sourceHeight: opts.sourceHeight ?? null,
    });
    return { ok: true, error: null, info: info ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Applies changed settings to the running cast by restarting it at `positionSec`. */
export async function castReload(opts: {
  positionSec: number;
  options?: CastOptions;
  subtitle?: CastSubInfo | null;
  subStyle?: CastSubStyle | null;
  audioTrackOrdinal?: number;
}): Promise<CastLoadInfo | null> {
  if (!isTauri) return null;
  return await invoke<CastLoadInfo>("cast_reload", {
    positionSec: Math.max(0, opts.positionSec),
    options: opts.options ?? null,
    subtitle:
      opts.subtitle === undefined ? null : (opts.subtitle ?? { kind: "external", off: true }),
    subStyle: opts.subStyle ?? null,
    audioTrackOrdinal: opts.audioTrackOrdinal ?? null,
  });
}

export type CastCapabilities = {
  available: boolean;
  nvenc: boolean;
  qsv: boolean;
  amf: boolean;
  videotoolbox: boolean;
  libplacebo: boolean;
  zscaleTonemap: boolean;
  readrate: boolean;
};

export type CastPreview = {
  durationSec: number;
  summary: CastPlanSummary;
  caps: CastCapabilities;
  hardware: string | null;
  subtitleCodecs: string[];
};

/** What casting this source with these settings would do. */
export async function castPreview(opts: {
  url: string;
  headers?: Record<string, string>;
  options: CastOptions;
  audioTrackOrdinal?: number;
  burnSubtitles: boolean;
  subtitleOrdinal?: number;
  /** The conversion the cast would ask for, and the receiver's limits that bound it. */
  transcode?: boolean;
  profile?: TranscodeProfile;
}): Promise<CastPreview | null> {
  if (!isTauri) return null;
  return await invoke<CastPreview>("cast_preview", {
    url: opts.url,
    headers: opts.headers ?? null,
    options: opts.options,
    audioTrackOrdinal: opts.audioTrackOrdinal ?? null,
    burnSubtitles: opts.burnSubtitles,
    subtitleOrdinal: opts.subtitleOrdinal ?? null,
    transcode: opts.transcode ?? null,
    profile: opts.profile ?? null,
  });
}

export type CastVolume = { supported: boolean; level: number; muted: boolean };

/** Reads, and optionally changes, the receiver's own volume (0–100). */
export async function castVolume(level?: number, muted?: boolean): Promise<CastVolume> {
  if (!isTauri) return { supported: false, level: 0, muted: false };
  return await invoke<CastVolume>("cast_volume", {
    level: level == null ? null : Math.round(Math.min(100, Math.max(0, level))),
    muted: muted ?? null,
  });
}

export async function castCapabilities(): Promise<CastCapabilities | null> {
  if (!isTauri) return null;
  try {
    return await invoke<CastCapabilities>("cast_capabilities");
  } catch {
    return null;
  }
}

export async function castPlay(): Promise<void> {
  if (!isTauri) return;
  await invoke("cast_play");
}

export async function castPause(): Promise<void> {
  if (!isTauri) return;
  await invoke("cast_pause");
}

export async function castSeek(sec: number): Promise<void> {
  if (!isTauri) return;
  await invoke("cast_seek", { sec });
}

export async function castStop(): Promise<void> {
  if (!isTauri) return;
  await invoke("cast_stop");
}

export async function castStatus(): Promise<CastStatus | null> {
  if (!isTauri) return null;
  return (await invoke<CastStatus | null>("cast_status")) ?? null;
}

let ffmpegPresentCache: boolean | null = null;
export async function isFfmpegPresent(): Promise<boolean> {
  if (!isTauri) return false;
  if (ffmpegPresentCache != null) return ffmpegPresentCache;
  try {
    ffmpegPresentCache = await invoke<boolean>("cast_ffmpeg_present");
  } catch {
    ffmpegPresentCache = false;
  }
  return ffmpegPresentCache;
}

function mimeFromExt(s: string): string | undefined {
  const lower = s.toLowerCase().split("?")[0];
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (lower.endsWith(".mpd")) return "application/dash+xml";
  if (lower.endsWith(".ts")) return "video/mp2t";
  return undefined;
}

export function guessContentType(url: string, fallbackName?: string): string {
  return mimeFromExt(url) ?? (fallbackName ? mimeFromExt(fallbackName) : undefined) ?? "video/mp4";
}
