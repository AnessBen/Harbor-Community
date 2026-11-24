import {
  readActiveSource,
  sourceKeyFor,
  MIRROR_KEY,
  SHARED_KEY,
  PROFILES_KEY,
} from "./profile-store";
import { writeSettingsFile } from "./file-store";
import { setItemWithRecovery } from "@/lib/storage-recovery";

const LEGACY_KEY = "harbor.settings.v1";
const PROFILE_KEY = /^harbor\.settings\.(?:default|p_[a-z0-9]+_[a-z0-9]+)$/;

export function isSettingsBackupBlob(key: string): boolean {
  return key === MIRROR_KEY || key === SHARED_KEY || key === LEGACY_KEY || PROFILE_KEY.test(key);
}

type SettingsSource = ReturnType<typeof readActiveSource>;
type RestorePlan = {
  source: string;
  records: Record<string, string>;
  active: string | null;
};

function decode(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid settings in backup");
  }
  return value as Record<string, unknown>;
}

/** Profile-scoped settings must not be merged by blob size. The mirror identifies
 * the effective settings of the exporting profile; a full backup preserves its
 * roster and all canonical profile blobs instead. */
export function planSettingsRestore(
  data: Record<string, string>,
  destination: SettingsSource,
  now = Date.now(),
): RestorePlan | null {
  const blobs = Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => isSettingsBackupBlob(key))
      .map(([key, raw]) => [key, decode(raw)]),
  );
  if (Object.keys(blobs).length === 0) return null;
  const full = data[PROFILES_KEY] != null;
  const source = sourceKeyFor(destination.profileId, destination.linked);
  const mirror = blobs[MIRROR_KEY];
  const declaredSource = mirror?._savedSource;
  const effective = full
    ? (blobs[source] ?? blobs[SHARED_KEY] ?? mirror ?? blobs[LEGACY_KEY])
    : ((typeof declaredSource === "string" && isSettingsBackupBlob(declaredSource)
        ? blobs[declaredSource]
        : undefined) ??
      mirror ??
      blobs[SHARED_KEY] ??
      blobs[LEGACY_KEY]);
  const profiles = Object.keys(blobs).filter((key) => PROFILE_KEY.test(key));
  const active = effective ?? (!full && profiles.length === 1 ? blobs[profiles[0]] : undefined);
  if (!full && !active) throw new Error("Backup has no identifiable active settings");

  const stamp = (blob: Record<string, unknown>, key: string) =>
    JSON.stringify({ ...blob, _savedAt: now, _savedSource: key });
  const records: Record<string, string> = {};
  if (full) {
    for (const [key, blob] of Object.entries(blobs)) {
      if (key === SHARED_KEY || PROFILE_KEY.test(key)) records[key] = stamp(blob, key);
    }
  }
  const activeRaw = active ? stamp(active, source) : null;
  if (activeRaw !== null) {
    records[source] = activeRaw;
    records[MIRROR_KEY] = activeRaw;
  }
  return { source, records, active: activeRaw };
}

/** Run as the last restore step, after other asynchronous restore work.
 * Complete the queued native write before the caller reloads the app. */
export async function restoreSettingsBackup(data: Record<string, string>): Promise<void> {
  const plan = planSettingsRestore(data, readActiveSource());
  if (!plan) return;
  for (const [key, raw] of Object.entries(plan.records)) {
    if (!setItemWithRecovery(key, raw)) {
      throw new Error("Could not persist restored settings");
    }
  }
  if (plan.active !== null) await writeSettingsFile(plan.active, { strict: true });
}
