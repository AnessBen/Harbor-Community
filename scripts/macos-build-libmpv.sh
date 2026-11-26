#!/usr/bin/env bash
# Build the upstream renderer in an isolated prefix, without replacing Homebrew mpv.
set -euo pipefail

if [[ "$(uname -s)" != Darwin || $# != 1 ]]; then
  echo "Usage (macOS): $0 ABSOLUTE_INSTALL_PREFIX" >&2
  exit 2
fi
prefix="$1"
[[ "$prefix" = /* ]] || { echo "An absolute prefix is required" >&2; exit 2; }
revision=3e8aa53ec1e46a4cc9982ced47eb0010a94f5783
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The stable formula supplies the dependency closure, not the bundled libmpv.
brew install mpv pkg-config meson ninja
brew_root="$(brew --prefix)"
export PKG_CONFIG_PATH="$brew_root/lib/pkgconfig:$brew_root/share/pkgconfig:$(brew --prefix libarchive)/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"

git init -q "$work/mpv"
git -C "$work/mpv" remote add origin https://github.com/mpv-player/mpv.git
git -C "$work/mpv" fetch --depth=1 origin "$revision"
git -C "$work/mpv" checkout --detach FETCH_HEAD
[[ "$(git -C "$work/mpv" rev-parse HEAD)" = "$revision" ]]
# Never silently download another dependency version via Meson wraps.
meson setup "$work/build" "$work/mpv" --prefix="$prefix" --libdir=lib \
  --buildtype=release --wrap-mode=nodownload \
  -Dlibmpv=true -Dcplayer=true -Dbuild-date=false -Dmanpage-build=disabled \
  -Dgl=enabled -Dplain-gl=enabled -Dvideotoolbox-gl=enabled \
  -Dlua=luajit -Djavascript=enabled -Dlibarchive=enabled -Duchardet=enabled -Dvulkan=enabled
meson compile -C "$work/build"
meson install -C "$work/build"

export PKG_CONFIG_PATH="$prefix/lib/pkgconfig:$PKG_CONFIG_PATH"
[[ "$(pkg-config --variable=prefix mpv)" = "$prefix" ]]
# Verify the actual installed ABI instead of relying on the filename/version string.
python3 - "$prefix/lib/libmpv.dylib" <<'PY'
import ctypes
import sys
lib = ctypes.CDLL(sys.argv[1])
lib.mpv_client_api_version.restype = ctypes.c_ulong
version = lib.mpv_client_api_version()
if version < ((2 << 16) | 7):
    raise SystemExit(f"Missing renderer API: {version >> 16}.{version & 65535}")
print(f"libmpv client API {version >> 16}.{version & 65535}")
PY
"$prefix/bin/mpv" --version
