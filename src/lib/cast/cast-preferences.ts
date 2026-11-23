import { useSyncExternalStore } from "react";
import { DEFAULT_CAST_OPTIONS, type CastDeviceInfo, type CastOptions } from "@/lib/cast";
import {
  castOptionsForDevice,
  isDeviceOption,
  mergeDeviceOverrides,
  pickDeviceOptions,
  type DeviceOptions,
  type RememberedDevice,
} from "./device-settings";

/**
 * The cast settings panel's choices. They persist per viewer; the subtitle and audio track pickers
 * follow the film instead and live in the player. Settings that depend on the receiver are kept
 * per device (see `device-settings.ts`), the rest apply to every cast.
 */
export type CastSubtitleLook = {
  /** Percent of the player's subtitle size. */
  sizePercent: number;
  color: string;
  background: boolean;
  /** Extra lift above the bottom edge, in output pixels. */
  lift: number;
};

export type CastDeviceMemory = {
  device: RememberedDevice;
  /** Only the device settings the viewer changed; everything else follows the device. */
  overrides: Partial<DeviceOptions>;
};

export type CastPreferences = {
  options: CastOptions;
  look: CastSubtitleLook;
  /** The settings panel inside the cast menu is expanded. */
  panelOpen: boolean;
  devices: Record<string, CastDeviceMemory>;
  /** The device the panel shows while nothing is casting: the last one cast to. */
  lastDeviceId: string | null;
};

const KEY = "harbor.cast.preferences.v1";

/** Audio and subtitle delays stop at ±30 s; more is never a sync fix. */
export const CAST_DELAY_LIMIT_MS = 30_000;
/** Devices whose own settings are remembered; the longest unused are forgotten first. */
const MAX_REMEMBERED_DEVICES = 32;

const CHOICES = {
  quality: ["720p", "1080p", "1080p-hq", "4k", "original"],
  tonemap: ["auto", "on", "off"],
  deinterlace: ["none", "auto", "always"],
  aspect: ["default", "16:9", "4:3", "21:9", "fill"],
  streamFormat: ["auto", "ts", "hls"],
  audioMode: ["stereo", "surround", "original"],
} as const satisfies { [K in keyof CastOptions]?: ReadonlyArray<CastOptions[K]> };

const BOOLEANS = [
  "forceConversion",
  "hevcNative",
  "hardwareDecoding",
  "hardwareEncoding",
  "fastSeek",
  "nightMode",
  "dialogueBoost",
] as const satisfies ReadonlyArray<keyof CastOptions>;

const VOLUME_BOOSTS = [0, 25, 50, 100];

function wholeMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(-CAST_DELAY_LIMIT_MS, Math.min(CAST_DELAY_LIMIT_MS, Math.round(value)));
}

/**
 * Keeps only stored values the converter accepts. The Rust side reads numbers strictly, so a
 * fractional delay or a negative boost left by an older build would otherwise fail every cast.
 */
export function sanitizeCastOptions(raw: unknown): Partial<CastOptions> {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;
  const out: Partial<Record<keyof CastOptions, unknown>> = {};
  for (const [key, allowed] of Object.entries(CHOICES) as Array<
    [keyof typeof CHOICES, readonly string[]]
  >) {
    if (typeof input[key] === "string" && allowed.includes(input[key])) out[key] = input[key];
  }
  for (const key of BOOLEANS) {
    if (typeof input[key] === "boolean") out[key] = input[key];
  }
  if (typeof input.volumeBoost === "number" && VOLUME_BOOSTS.includes(input.volumeBoost)) {
    out.volumeBoost = input.volumeBoost;
  }
  const audioDelay = wholeMs(input.audioDelayMs);
  if (audioDelay !== undefined) out.audioDelayMs = audioDelay;
  const subDelay = wholeMs(input.subDelayMs);
  if (subDelay !== undefined) out.subDelayMs = subDelay;
  if (typeof input.subEncoding === "string" && /^[a-z0-9_-]{1,32}$/i.test(input.subEncoding)) {
    out.subEncoding = input.subEncoding;
  }
  return out as Partial<CastOptions>;
}

function sanitizeLook(raw: unknown): Partial<CastSubtitleLook> {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;
  const out: Partial<CastSubtitleLook> = {};
  if (typeof input.sizePercent === "number" && Number.isFinite(input.sizePercent)) {
    out.sizePercent = Math.max(50, Math.min(400, Math.round(input.sizePercent)));
  }
  if (typeof input.color === "string" && /^#[0-9a-f]{6}$/i.test(input.color)) {
    out.color = input.color;
  }
  if (typeof input.background === "boolean") out.background = input.background;
  if (typeof input.lift === "number" && Number.isFinite(input.lift)) {
    out.lift = Math.max(0, Math.min(200, Math.round(input.lift)));
  }
  return out;
}

export const DEFAULT_CAST_LOOK: CastSubtitleLook = {
  sizePercent: 150,
  color: "#FFFFFF",
  background: false,
  lift: 0,
};

const DEFAULTS: CastPreferences = {
  options: DEFAULT_CAST_OPTIONS,
  look: DEFAULT_CAST_LOOK,
  panelOpen: false,
  devices: {},
  lastDeviceId: null,
};

function readDevices(raw: unknown): Record<string, CastDeviceMemory> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, CastDeviceMemory> = {};
  for (const [id, entry] of Object.entries(raw as Record<string, Partial<CastDeviceMemory>>)) {
    const device = entry?.device;
    if (!device || typeof device.name !== "string" || typeof device.kind !== "string") continue;
    out[id] = {
      device: { id, name: device.name, kind: device.kind, model: device.model ?? null },
      overrides: pickDeviceOptions(sanitizeCastOptions(entry.overrides)),
    };
  }
  return out;
}

function read(): CastPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<CastPreferences>;
    const devices = readDevices(parsed.devices);
    return {
      options: { ...DEFAULT_CAST_OPTIONS, ...sanitizeCastOptions(parsed.options) },
      look: { ...DEFAULT_CAST_LOOK, ...sanitizeLook(parsed.look) },
      panelOpen: parsed.panelOpen === true,
      devices,
      lastDeviceId:
        typeof parsed.lastDeviceId === "string" && devices[parsed.lastDeviceId]
          ? parsed.lastDeviceId
          : null,
    };
  } catch {
    return DEFAULTS;
  }
}

let current: CastPreferences = read();
const listeners = new Set<() => void>();

function commit(next: CastPreferences): CastPreferences {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* settings still apply for this session */
  }
  for (const fn of listeners) fn();
  return current;
}

export function getCastPreferences(): CastPreferences {
  return current;
}

export function updateCastPreferences(patch: {
  options?: Partial<CastOptions>;
  look?: Partial<CastSubtitleLook>;
  panelOpen?: boolean;
}): CastPreferences {
  return commit({
    ...current,
    options: { ...current.options, ...patch.options },
    look: { ...current.look, ...patch.look },
    panelOpen: patch.panelOpen ?? current.panelOpen,
  });
}

/** Called when a cast starts: the device's settings follow it from now on. */
export function rememberCastDevice(device: CastDeviceInfo): CastPreferences {
  const known = current.devices[device.id];
  const remembered: RememberedDevice = {
    id: device.id,
    name: device.name,
    kind: device.kind,
    model: device.model,
  };
  // The device moves to the end, so the ones cast to longest ago are the first to be forgotten.
  const others = Object.entries(current.devices).filter(([id]) => id !== device.id);
  const kept = others.slice(Math.max(0, others.length - (MAX_REMEMBERED_DEVICES - 1)));
  return commit({
    ...current,
    devices: {
      ...Object.fromEntries(kept),
      [device.id]: { device: remembered, overrides: known?.overrides ?? {} },
    },
    lastDeviceId: device.id,
  });
}

/** The device the panel edits: the one casting, else the last one cast to. */
export function panelDevice(
  prefs: CastPreferences,
  active: CastDeviceInfo | null,
): RememberedDevice | null {
  if (active) return active;
  return prefs.lastDeviceId ? (prefs.devices[prefs.lastDeviceId]?.device ?? null) : null;
}

/** Everything a cast to this device uses: the viewer's settings plus the device's own. */
export function castOptionsFor(
  device: RememberedDevice | null,
  prefs: CastPreferences = current,
): CastOptions {
  return castOptionsForDevice(
    prefs.options,
    device,
    device ? prefs.devices[device.id]?.overrides : undefined,
  );
}

export function deviceHasOverrides(device: RememberedDevice | null, prefs = current): boolean {
  return !!device && Object.keys(prefs.devices[device.id]?.overrides ?? {}).length > 0;
}

/** Applies a panel change: device settings to that device only, the rest to every cast. */
export function setCastOptions(
  device: RememberedDevice | null,
  patch: Partial<CastOptions>,
): CastPreferences {
  const shared: Partial<CastOptions> = {};
  const forDevice: Partial<DeviceOptions> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (device && isDeviceOption(key)) Object.assign(forDevice, { [key]: value });
    else Object.assign(shared, { [key]: value });
  }
  let devices = current.devices;
  if (device && Object.keys(forDevice).length > 0) {
    const memory = devices[device.id];
    devices = {
      ...devices,
      [device.id]: {
        device: memory?.device ?? device,
        overrides: mergeDeviceOverrides(device, memory?.overrides, forDevice),
      },
    };
  }
  return commit({ ...current, options: { ...current.options, ...shared }, devices });
}

/** Back to the defaults; with a device, its settings go back to what suits it. */
export function resetCastPreferences(device: RememberedDevice | null = null): CastPreferences {
  const devices = { ...current.devices };
  if (device && devices[device.id]) devices[device.id] = { ...devices[device.id], overrides: {} };
  return commit({
    ...current,
    options: DEFAULT_CAST_OPTIONS,
    look: DEFAULT_CAST_LOOK,
    devices,
  });
}

/** Only the device's settings go back to automatic; the viewer's own stay. */
export function resetDeviceCastOptions(device: RememberedDevice): CastPreferences {
  const memory = current.devices[device.id];
  if (!memory) return current;
  return commit({
    ...current,
    devices: { ...current.devices, [device.id]: { ...memory, overrides: {} } },
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useCastPreferences(): CastPreferences {
  return useSyncExternalStore(subscribe, getCastPreferences, getCastPreferences);
}
