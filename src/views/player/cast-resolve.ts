import {
  checkStreamCompat,
  getDeviceCaps,
  keepCodecsProfile,
  pickBestCompatStream,
  pickTranscodeProfile,
  type DeviceCaps,
} from "@/lib/cast/device-caps";
import { isFfmpegPresent, type CastDeviceInfo, type TranscodeProfile } from "@/lib/cast";
import { useDebridClients } from "@/lib/debrid/registry";
import { peekPickerCache } from "@/lib/picker-cache";
import { registerStreamProxy } from "@/lib/stream-proxy";
import { resolveStream } from "@/lib/streams/resolve";
import type { ScoredStream } from "@/lib/streams/types";
import type { PlayerSrc } from "@/lib/view";

export type CastResolution =
  // `profile` holds the receiver's limits for any conversion made anyway (subtitles, a remux).
  | { kind: "compat"; url: string; caps: DeviceCaps; profile: TranscodeProfile }
  | {
      kind: "swapped";
      url: string;
      alt: ScoredStream;
      caps: DeviceCaps;
      profile: TranscodeProfile;
      reasons: string[];
    }
  | {
      kind: "transcode";
      url: string;
      caps: DeviceCaps;
      profile: TranscodeProfile;
      reasons: string[];
    }
  | { kind: "needs-ffmpeg"; caps: DeviceCaps; reasons: string[] }
  | { kind: "incompatible"; caps: DeviceCaps; reasons: string[]; candidatesChecked: number };

function urlNeedsRemuxForCast(url: string, kind: string): boolean {
  if (kind !== "chromecast" && kind !== "dlna" && kind !== "roku") return false;
  const path = (url.split("?")[0] || "").toLowerCase();
  return (
    path.endsWith(".mp4") ||
    path.endsWith(".m4v") ||
    path.endsWith(".mkv") ||
    path.endsWith(".avi") ||
    path.endsWith(".mov")
  );
}

/** The player's stream as the receiver checks see it: its release fields plus the decoded size. */
function castStreamFor(src: PlayerSrc, liveDims: { width: number; height: number }) {
  return src.streamRef
    ? { ...src.streamRef, liveWidth: liveDims.width, liveHeight: liveDims.height }
    : { liveWidth: liveDims.width, liveHeight: liveDims.height };
}

/**
 * Whether casting the player's own stream to `device` converts it, and the receiver limits that
 * bound the conversion, decided as `resolveCompatibleCastUrl` decides them for that stream. The
 * settings panel uses it to preview a cast before (or without) looking for an alternative stream.
 */
export function previewCastResolution(
  src: PlayerSrc,
  device: Pick<CastDeviceInfo, "kind" | "name" | "model">,
  liveDims: { width: number; height: number },
): { kind: "compat" | "transcode"; profile: TranscodeProfile } {
  const caps = getDeviceCaps(device);
  const stream = castStreamFor(src, liveDims);
  if (checkStreamCompat(stream, caps).ok) {
    return {
      kind: urlNeedsRemuxForCast(src.url, device.kind) ? "transcode" : "compat",
      profile: keepCodecsProfile(stream, caps),
    };
  }
  return { kind: "transcode", profile: pickTranscodeProfile(stream, caps) };
}

export async function resolveCompatibleCastUrl(
  src: PlayerSrc,
  device: CastDeviceInfo,
  debrids: ReturnType<typeof useDebridClients>,
  liveDims: { width: number; height: number },
  animePreferImdbStreams = true,
): Promise<CastResolution> {
  const caps = getDeviceCaps(device);
  const augmented = castStreamFor(src, liveDims);
  const currentCompat = checkStreamCompat(augmented, caps);
  if (currentCompat.ok) {
    if (urlNeedsRemuxForCast(src.url, device.kind)) {
      const ffmpegOk = await isFfmpegPresent();
      if (ffmpegOk) {
        return {
          kind: "transcode",
          url: src.url,
          caps,
          profile: keepCodecsProfile(augmented, caps),
          reasons: ["remux to MPEGTS for reliable cast playback (avoids moov-atom-at-end issues)"],
        };
      }
    }
    return { kind: "compat", url: src.url, caps, profile: keepCodecsProfile(augmented, caps) };
  }
  const cached = peekPickerCache(src.meta, src.episode, animePreferImdbStreams);
  const candidates: ScoredStream[] = cached?.result.picker.all ?? [];
  const alt = pickBestCompatStream(candidates, caps);
  if (alt) {
    const ac = new AbortController();
    const r = await resolveStream(alt, debrids, ac.signal, false, false, undefined, true, false);
    if (r.ok) {
      let url = r.data.url;
      if (r.data.headers && Object.keys(r.data.headers).length > 0) {
        try {
          const proxied = await registerStreamProxy(r.data.url, r.data.headers);
          url = proxied.url;
        } catch {
          url = "";
        }
      }
      if (url) {
        return {
          kind: "swapped",
          url,
          alt,
          caps,
          profile: keepCodecsProfile(alt, caps),
          reasons: currentCompat.reasons,
        };
      }
    }
  }
  const ffmpegOk = await isFfmpegPresent();
  if (ffmpegOk) {
    const profile = pickTranscodeProfile(augmented, caps);
    return {
      kind: "transcode",
      url: src.url,
      caps,
      profile,
      reasons: currentCompat.reasons,
    };
  }
  return {
    kind: "needs-ffmpeg",
    caps,
    reasons: currentCompat.reasons,
  };
}
