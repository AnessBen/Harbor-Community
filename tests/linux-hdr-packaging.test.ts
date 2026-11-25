import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const generator = fileURLToPath(new URL("../scripts/configure-linux-hdr-bundle.mjs", import.meta.url));
const base = JSON.parse(readFileSync(new URL("../src-tauri/tauri.linux-system.conf.json", import.meta.url), "utf8"));

test("native and portable packages stage the same private HDR runtime without losing dependencies", () => {
  const runtime = mkdtempSync(join(tmpdir(), "harbor-hdr-bundle-"));
  try {
    for (const name of ["libmpv.so.2", "libharbor-linux-hdr.so", "check-api", "sources.txt"]) {
      writeFileSync(join(runtime, name), "fixture");
    }
    for (const mode of ["native", "appimage"]) {
      const out = join(runtime, mode + ".json");
      const build = spawnSync(process.execPath, [generator, runtime, mode, out], { encoding: "utf8" });
      assert.equal(build.status, 0, build.stderr);
      const config = JSON.parse(readFileSync(out, "utf8"));
      assert.equal(config.bundle.createUpdaterArtifacts, false);
      for (const kind of mode === "native" ? ["deb", "rpm"] : ["appimage"]) {
        assert.equal(config.bundle.linux[kind].files["/usr/lib/harbor-hdr"], runtime);
        if (kind !== "appimage") {
          for (const dep of base.bundle.linux[kind].depends) {
            assert.ok(config.bundle.linux[kind].depends.includes(dep), dep);
          }
        }
      }
      if (mode === "native") {
        assert.deepEqual(config.bundle.externalBin, []);
        assert.equal(config.bundle.license, "MIT");
        for (const dependency of ["libbsd0", "libslang2"]) {
          assert.ok(config.bundle.linux.deb.depends.includes(dependency));
        }
        for (const dependency of ["libbsd", "slang"]) {
          assert.ok(config.bundle.linux.rpm.depends.includes(dependency));
        }
      }
    }
    rmSync(join(runtime, "libharbor-linux-hdr.so"));
    const failed = spawnSync(process.execPath, [generator, runtime, "native", join(runtime, "bad.json")]);
    assert.notEqual(failed.status, 0, "an incomplete runtime must fail packaging");
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});

test("the native and Flatpak builds pin the tested MPV, libplacebo and protocol revisions", () => {
  const script = readFileSync(new URL("../scripts/linux-hdr-runtime.sh", import.meta.url), "utf8");
  const manifest = readFileSync(new URL("../flatpak/site.harbor.Harbor.yml", import.meta.url), "utf8");
  for (const rev of [
    "d32c910be63d1dd325c7b3efeaa09c3c4c8d51ce",
    "275f7dea27924cdd34ab2e6c20e448b6bc4fab65",
    "ee78491a237eaff9389a0ccf8680521d074407d3",
  ]) {
    assert.ok(script.includes(rev));
    assert.ok(manifest.includes(rev));
  }
  assert.match(manifest, /\/app\/bin\/harbor --verify-linux-hdr-runtime/);
});

test("the native HDR runtime collects the tested recursive compatibility family", () => {
  const stage = readFileSync(new URL("../scripts/stage-linux-hdr-compat.sh", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../scripts/linux-hdr-runtime.sh", import.meta.url), "utf8");
  for (const abi of [
    "libmujs.so.*", "libbluray.so.*", "libluajit-5.1.so.*", "libshaderc.so.*",
    "libxml2.so.2", "libudfread.so.0", "libicuuc.so.74", "libicudata.so.74",
  ]) {
    assert.ok(stage.includes(abi), abi);
  }
  assert.ok(stage.includes('queue+=("$out/$needed")'));
  assert.ok(stage.includes("(SONAME)"));
  assert.ok(stage.includes("ubuntu-compat-sources.txt"));
  assert.ok(stage.includes("dpkg-query"));
  assert.ok(runtime.includes("stage-linux-hdr-compat.sh"));
});
