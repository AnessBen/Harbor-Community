// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
import ts from "typescript";
import "./_localstorage-stub.ts";
import { planSettingsRestore, isSettingsBackupBlob } from "../src/lib/settings/backup-restore.ts";
import {
  MIRROR_KEY,
  SHARED_KEY,
  PROFILES_KEY,
  profileKey,
  recoverSettingsFile,
  loadEffective,
  readActiveSource,
  sourceKeyFor,
} from "../src/lib/settings/profile-store.ts";
import { DEFAULT } from "../src/lib/settings/defaults.ts";
import { setItemWithRecovery } from "../src/lib/storage-recovery.ts";

const foreign = "p_abcd_efgh";
const local = "p_ijkl_mnop";
const other = "p_qrst_uvwx";
const roster = (id: string, linked: boolean) =>
  JSON.stringify({ activeId: id, profiles: [{ id, settingsLinked: linked }] });
const blob = (key: string, value: string, savedAt = 10) =>
  JSON.stringify({
    ...DEFAULT,
    tmdbKey: value,
    omdbKey: value + "-omdb",
    _savedAt: savedAt,
    _savedSource: key,
  });
const linked = { profileId: local, linked: true };

test("an old settings-only backup replaces the linked source and mirror, not a longer unrelated profile", () => {
  const source = profileKey(foreign);
  const raw = blob(source, "fixture");
  const plan = planSettingsRestore(
    {
      [source]: raw,
      [MIRROR_KEY]: raw,
      [SHARED_KEY]: blob(SHARED_KEY, "other".repeat(100)),
    },
    linked,
    100,
  )!;
  assert.deepEqual(Object.keys(plan.records).sort(), [MIRROR_KEY, SHARED_KEY].sort());
  assert.equal(plan.records[MIRROR_KEY], plan.records[SHARED_KEY]);
  assert.equal(JSON.parse(plan.active!).tmdbKey, "fixture");
  assert.equal(JSON.parse(plan.active!)._savedAt, 100);
  assert.equal(JSON.parse(plan.active!)._savedSource, SHARED_KEY);
});

test("a scoped shared backup targets the active unlinked profile only", () => {
  const plan = planSettingsRestore(
    {
      [SHARED_KEY]: blob(SHARED_KEY, "fixture"),
    },
    { profileId: local, linked: false },
    100,
  )!;
  assert.equal(plan.source, profileKey(local));
  assert.equal(JSON.parse(plan.active!)._savedSource, profileKey(local));
  assert.equal(plan.records[SHARED_KEY], undefined);
  assert.equal(plan.records[profileKey(other)], undefined);
});

test("full backup preserves all profile settings and trusts canonical active blob over the mirror", () => {
  const plan = planSettingsRestore(
    {
      [PROFILES_KEY]: roster(foreign, false),
      [profileKey(foreign)]: blob(profileKey(foreign), "active"),
      [profileKey(other)]: blob(profileKey(other), "other"),
      [SHARED_KEY]: blob(SHARED_KEY, "shared"),
      [MIRROR_KEY]: blob(profileKey(other), "stale-mirror"),
    },
    { profileId: foreign, linked: false },
    100,
  )!;
  assert.equal(JSON.parse(plan.active!).tmdbKey, "active");
  assert.equal(JSON.parse(plan.records[profileKey(other)]).tmdbKey, "other");
  assert.equal(JSON.parse(plan.records[SHARED_KEY]).tmdbKey, "shared");
  assert.equal(plan.records[MIRROR_KEY], plan.records[profileKey(foreign)]);
});

test("legacy mirror and v1 blobs restore even when an existing canonical key would otherwise shadow them", () => {
  for (const key of [MIRROR_KEY, "harbor.settings.v1"]) {
    const plan = planSettingsRestore(
      {
        [key]: JSON.stringify({ tmdbKey: "legacy" }),
      },
      linked,
      100,
    )!;
    assert.equal(JSON.parse(plan.records[SHARED_KEY]).tmdbKey, "legacy");
  }
});

test("no settings in the selected backup means no settings write", () => {
  assert.equal(planSettingsRestore({ "harbor.parental": "{}" }, linked), null);
  assert.equal(isSettingsBackupBlob("harbor.settingsNew.v1"), false);
});

test("invalid or ambiguous settings do not silently become defaults or choose another profile", () => {
  assert.throws(() => planSettingsRestore({ [MIRROR_KEY]: "[]" }, linked), /Invalid settings/);
  assert.throws(
    () =>
      planSettingsRestore(
        {
          [profileKey(foreign)]: blob(profileKey(foreign), "one"),
          [profileKey(other)]: blob(profileKey(other), "two"),
        },
        linked,
      ),
    /identifiable active settings/,
  );
});

function transpileModule<T>(
  path: string,
  mocks: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): T {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(extra), code)(
    (key: string) => {
      assert.ok(Object.hasOwn(mocks, key), "Unmocked dependency: " + key);
      return mocks[key];
    },
    mod,
    mod.exports,
    ...Object.values(extra),
  );
  return mod.exports as T;
}

function fixture(failNative = false) {
  localStorage.clear();
  localStorage.setItem(PROFILES_KEY, roster(local, true));
  const old = blob(SHARED_KEY, "", Date.now() + 100000);
  localStorage.setItem(SHARED_KEY, old);
  localStorage.setItem(MIRROR_KEY, old);
  let disk = old;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: string[] = [];
  const fileStore = transpileModule<typeof import("../src/lib/settings/file-store")>(
    "../src/lib/settings/file-store.ts",
    {
      "@tauri-apps/api/core": {
        invoke: async (command: string, args: { content: string }) => {
          assert.equal(command, "settings_write");
          writes.push(args.content);
          await gate;
          if (failNative) throw new Error("disk failure");
          disk = args.content;
        },
      },
    },
    { window: { __TAURI_INTERNALS__: {} } },
  );
  const restore = transpileModule<typeof import("../src/lib/settings/backup-restore")>(
    "../src/lib/settings/backup-restore.ts",
    {
      "./profile-store": { readActiveSource, sourceKeyFor, MIRROR_KEY, SHARED_KEY, PROFILES_KEY },
      "./file-store": fileStore,
      "@/lib/storage-recovery": { setItemWithRecovery },
    },
  );
  const backup = transpileModule<typeof import("../src/lib/backup")>("../src/lib/backup.ts", {
    "@/lib/download-text": {},
    "@/lib/profile-sync/backup-payload": {},
    "@/lib/theme-storage": {},
    "@/lib/profiles": {},
    "@/lib/active-profile-id": { activeProfileId: () => readActiveSource().profileId },
    "@/lib/secret-store": {
      getAllSecrets: () => ({}),
      isSecretKey: () => false,
      flushSecrets: async () => {},
    },
    "@/lib/storage-recovery": { setItemWithRecovery },
    "@/lib/settings/backup-restore": restore,
    "@/lib/local-library": {},
  });
  const incoming = {
    format: "harbor-backup",
    version: 1,
    app: "test",
    exportedAt: "",
    sections: ["settings" as const],
    data: { [MIRROR_KEY]: blob(MIRROR_KEY, "restored") },
  };
  return {
    backup,
    incoming,
    release,
    writes,
    fileStore,
    get disk() {
      return disk;
    },
  };
}

test("actual restore waits for native persistence and startup recovery cannot erase imported metadata keys", async () => {
  const h = fixture();
  let done = false;
  const pending = h.backup.applyBackup(h.incoming).then(() => {
    done = true;
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(done, false);
  assert.equal(h.writes.length, 1);
  h.release();
  await pending;
  assert.equal(done, true);
  assert.equal(h.disk, localStorage.getItem(SHARED_KEY));
  assert.equal(recoverSettingsFile(h.disk, local, true), null);
  assert.equal(loadEffective(local, true).tmdbKey, "restored");
  assert.equal(loadEffective(local, true).omdbKey, "restored-omdb");
  localStorage.clear();
});

test("full restore uses restored roster before selecting the native settings source", async () => {
  const h = fixture();
  const pending = h.backup.applyBackup({
    ...h.incoming,
    sections: ["settings", "profiles"],
    data: {
      [PROFILES_KEY]: roster(foreign, false),
      [profileKey(foreign)]: blob(profileKey(foreign), "profile"),
      [SHARED_KEY]: blob(SHARED_KEY, "shared"),
      [MIRROR_KEY]: blob(SHARED_KEY, "wrong-mirror"),
    },
  });
  h.release();
  await pending;
  assert.equal(readActiveSource().profileId, foreign);
  assert.equal(JSON.parse(h.disk)._savedSource, profileKey(foreign));
  assert.equal(loadEffective(foreign, false).tmdbKey, "profile");
  assert.equal(loadEffective(foreign, true).tmdbKey, "shared");
  localStorage.clear();
});

test("native restore failure rejects instead of reloading, and native write queue remains usable", async () => {
  const h = fixture(true);
  const pending = h.backup.applyBackup(h.incoming);
  h.release();
  await assert.rejects(pending, /disk failure/);
  assert.equal(h.writes.length, 1);
  await h.fileStore.writeSettingsFile("ordinary autosave");
  assert.equal(h.writes.length, 2);
  localStorage.clear();
});
