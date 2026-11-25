#!/usr/bin/env node
// Generate a disposable Tauri overlay for the private Linux HDR runtime.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const [runtimeArg, mode, outputArg] = process.argv.slice(2);
if (!runtimeArg || !["native", "appimage"].includes(mode) || !outputArg) {
  throw new Error("usage: configure-linux-hdr-bundle.mjs RUNTIME_DIR native|appimage OUTPUT");
}
const runtime = path.resolve(runtimeArg);
for (const name of ["libmpv.so.2", "libharbor-linux-hdr.so", "check-api", "sources.txt"]) {
  if (!fs.statSync(path.join(runtime, name)).isFile()) throw new Error("Missing " + name);
}
const config =
  mode === "native"
    ? JSON.parse(
        fs.readFileSync(
          new URL("../src-tauri/tauri.linux-system.conf.json", import.meta.url),
          "utf8",
        ),
      )
    : { bundle: { createUpdaterArtifacts: false, linux: {} } };
const linux = config.bundle.linux;
for (const kind of mode === "native" ? ["deb", "rpm"] : ["appimage"]) {
  linux[kind] ??= {};
  linux[kind].files ??= {};
  // Tauri's custom file map is destination -> source; use absolute source
  // paths so the overlay can be generated outside src-tauri.
  linux[kind].files["/usr/lib/harbor-hdr"] = runtime;
}
if (mode === "native") {
  // Retain the original system media dependencies (including external mpv
  // compatibility), and add explicit runtime deps for the private stack.
  const deb = [
    "libgnutls30t64",
    "libdav1d7",
    "libass9",
    "libdrm2",
    "libva2",
    "libvdpau1",
    "libluajit-5.1-2",
    "libshaderc1",
    "liblcms2-2",
    "libxxhash0",
    "libffi8",
    "libexpat1",
    "libasound2t64",
    "libpulse0",
    "libpipewire-0.3-0t64",
    "libxkbcommon0",
    "libx11-6",
    "libxext6",
    "libxrandr2",
    "libxpresent1",
    "libxss1",
    "libxinerama1",
    "libxv1",
    "libxfixes3",
    "libxcb1",
    "libgbm1",
    "libdisplay-info1",
    "libjpeg-turbo8",
    "libuchardet0",
    "libzimg2",
    "libvulkan1",
    "zlib1g",
    "libbsd0",
    "libslang2",
  ];
  const rpm = [
    "gnutls",
    "libdav1d",
    "libass",
    "libdrm",
    "libva",
    "libvdpau",
    "luajit",
    "libshaderc",
    "lcms2",
    "xxhash-libs",
    "libffi",
    "expat",
    "alsa-lib",
    "pulseaudio-libs",
    "pipewire-libs",
    "libxkbcommon",
    "libX11",
    "libXext",
    "libXrandr",
    "libXpresent",
    "libXScrnSaver",
    "libXinerama",
    "libXv",
    "libXfixes",
    "libxcb",
    "mesa-libgbm",
    "libdisplay-info",
    "libjpeg-turbo",
    "uchardet",
    "zimg",
    "vulkan-loader",
    "zlib-ng-compat",
    "libbsd",
    "slang",
  ];
  linux.deb.depends = [...new Set([...linux.deb.depends, ...deb])];
  const sonames = new Set(fs.readdirSync(runtime));
  const required = new Set();
  if (process.platform === "linux") {
    for (const file of sonames) {
      if (!/\.so(?:\.|$)/.test(file)) continue;
      const fd = fs.openSync(path.join(runtime, file), "r");
      const magic = Buffer.alloc(4);
      try {
        fs.readSync(fd, magic, 0, 4, 0);
      } finally {
        fs.closeSync(fd);
      }
      if (magic.toString("hex") !== "7f454c46") continue;
      const result = spawnSync("readelf", ["-d", path.join(runtime, file)], { encoding: "utf8" });
      if (result.status !== 0) throw new Error("Cannot inspect ELF dependency list for " + file);
      for (const match of result.stdout.matchAll(/\(NEEDED\).*?\[([^\]]+)\]/g)) {
        const name = match[1];
        if (!sonames.has(name) && /^lib[^/]+\.so(?:\.|$)/.test(name))
          required.add(name + "()(64bit)");
      }
    }
  }
  linux.rpm.depends = [...new Set([...linux.rpm.depends, ...rpm, ...required])];
}
fs.writeFileSync(outputArg, JSON.stringify(config, null, 2) + "\n");
