import type { CastDeviceInfo, CastOptions } from "@/lib/cast";
import { getDeviceCaps, isGuessedDlnaCaps } from "./device-caps";

/**
 * Cast settings that depend on what the receiver can play. Each device gets its own: they start
 * from what suits the device and keep only the changes the viewer made for it. The other settings
 * (subtitle look, delays, audio boosts, hardware) are the viewer's own and follow every device.
 */
export const DEVICE_OPTION_KEYS = [
  "quality",
  "forceConversion",
  "hevcNative",
  "tonemap",
  "aspect",
  "streamFormat",
  "audioMode",
] as const satisfies ReadonlyArray<keyof CastOptions>;

export type DeviceOptionKey = (typeof DEVICE_OPTION_KEYS)[number];
export type DeviceOptions = Pick<CastOptions, DeviceOptionKey>;

/** Enough of a device to work out its settings again before it is discovered. */
export type RememberedDevice = Pick<CastDeviceInfo, "id" | "name" | "kind" | "model">;

export function isDeviceOption(key: string): key is DeviceOptionKey {
  return (DEVICE_OPTION_KEYS as readonly string[]).includes(key);
}

/** Only the device settings out of a set of options; the rest belong to every cast. */
export function pickDeviceOptions(options: Partial<CastOptions>): Partial<DeviceOptions> {
  const out: Partial<Record<DeviceOptionKey, unknown>> = {};
  for (const key of DEVICE_OPTION_KEYS) {
    if (key in options) out[key] = options[key];
  }
  return out as Partial<DeviceOptions>;
}

/**
 * What suits the device out of the box: its largest picture, H.265 and HDR sent untouched only
 * where it shows them itself, and Dolby Digital only where it is known to decode it. A DLNA
 * renderer Harbor does not recognise gets stereo AAC, the one sound every TV plays.
 */
export function automaticDeviceOptions(device: RememberedDevice): DeviceOptions {
  const caps = getDeviceCaps(device);
  const dolby = (caps.passthroughAc3 || caps.passthroughEac3) && !isGuessedDlnaCaps(caps);
  return {
    quality: caps.maxResolution >= 2160 ? "4k" : caps.maxResolution <= 720 ? "720p" : "1080p-hq",
    forceConversion: false,
    // Native H.265 keeps HDR too, so only a device that shows HDR may take it untouched.
    hevcNative: caps.hevc && caps.hdr10,
    tonemap: "auto",
    aspect: "default",
    streamFormat: "auto",
    audioMode: dolby ? "surround" : "stereo",
  };
}

/** The stream "auto" picks for this device, as the converter decides it in `cast.rs`. */
export function automaticStreamFormat(device: Pick<CastDeviceInfo, "kind">): "ts" | "hls" {
  return device.kind === "dlna" ? "ts" : "hls";
}

/** The viewer's settings with the device's own on top: automatic, then the viewer's changes. */
export function castOptionsForDevice(
  base: CastOptions,
  device: RememberedDevice | null,
  overrides: Partial<DeviceOptions> | undefined,
): CastOptions {
  if (!device) return base;
  return { ...base, ...automaticDeviceOptions(device), ...overrides };
}

/** Folds a change into a device's overrides; choosing the automatic value drops the override. */
export function mergeDeviceOverrides(
  device: RememberedDevice,
  overrides: Partial<DeviceOptions> | undefined,
  patch: Partial<DeviceOptions>,
): Partial<DeviceOptions> {
  const automatic = automaticDeviceOptions(device);
  const next: Partial<Record<DeviceOptionKey, unknown>> = { ...overrides };
  for (const key of DEVICE_OPTION_KEYS) {
    if (!(key in patch)) continue;
    if (patch[key] === automatic[key]) delete next[key];
    else next[key] = patch[key];
  }
  return next as Partial<DeviceOptions>;
}
