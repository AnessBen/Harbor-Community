#!/usr/bin/env bash
# Build a pinned, relocatable libmpv + native HDR backend for the Linux packages.
# Never install these libraries over the host's system libraries.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(realpath -m "${1:?Usage: linux-hdr-runtime.sh BUILD_DIR}")"
prefix="$work/prefix"
stage="$work/runtime"
mkdir -p "$work" "$prefix" "$stage"
jobs="${HARBOR_BUILD_JOBS:-$(nproc)}"
mpv_rev=d32c910be63d1dd325c7b3efeaa09c3c4c8d51ce
placebo_rev=275f7dea27924cdd34ab2e6c20e448b6bc4fab65
ffmpeg_rev=1041abdc962f4cc4f394aa8de9dc5236c0c3b9e7
wayland_rev=87cc8a8728a923fc57938faa81ba0e74f34ecdc7
protocols_rev=ee78491a237eaff9389a0ccf8680521d074407d3
vulkan_headers_rev=952f776f6573aafbb62ea717d871cd1d6816c387
vulkan_loader_rev=809941a4ca137df69dc9c6e8eb456bd70309197c

checkout() {
  local name="$1" url="$2" rev="$3"
  local dir="$work/$name"
  if [[ ! -d "$dir/.git" ]]; then
    git init "$dir"
    git -C "$dir" remote add origin "$url"
  fi
  if [[ "$(git -C "$dir" remote get-url origin)" != "$url" ]]; then
    echo "Unexpected upstream for $name" >&2; exit 1
  fi
  git -C "$dir" fetch --depth=1 origin "$rev"
  git -C "$dir" checkout --detach FETCH_HEAD
  test "$(git -C "$dir" rev-parse HEAD)" = "$rev"
}
build_meson() {
  local name="$1"; shift
  local wipe=(); [[ ! -f "$work/$name-build/meson-private/coredata.dat" ]] || wipe=(--wipe)
  meson setup "${wipe[@]}" "$work/$name-build" "$work/$name" \
    --prefix="$prefix" --libdir=lib --buildtype=release --wrap-mode=nodownload "$@"
  meson compile -C "$work/$name-build" -j "$jobs"
  meson install -C "$work/$name-build"
}
export PATH="$prefix/bin:$PATH"
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig:$prefix/share/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
# Build-time resolution only. The installed package uses an origin-relative
# ELF search path; do not export this prefix to user's applications.
export LD_LIBRARY_PATH="$prefix/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
checkout wayland https://github.com/wayland-mirror/wayland.git "$wayland_rev"
build_meson wayland -Ddocumentation=false -Dtests=false
checkout protocols https://github.com/wayland-mirror/wayland-protocols.git "$protocols_rev"
build_meson protocols -Dtests=false
# MPV's Vulkan backend requires 1.4.309. Older Ubuntu SDKs ship 1.3.
# Build the matched Khronos headers and loader only when needed; retain
# the host Vulkan ICDs and the full Vulkan renderer rather than disabling it.
if ! pkg-config --atleast-version=1.4.309 vulkan; then
  checkout Vulkan-Headers https://github.com/KhronosGroup/Vulkan-Headers.git "$vulkan_headers_rev"
  cmake -S "$work/Vulkan-Headers" -B "$work/Vulkan-Headers-build" -G Ninja \
    -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_INSTALL_LIBDIR=lib
  cmake --build "$work/Vulkan-Headers-build" --parallel "$jobs"
  cmake --install "$work/Vulkan-Headers-build"
  checkout Vulkan-Loader https://github.com/KhronosGroup/Vulkan-Loader.git "$vulkan_loader_rev"
  cmake -S "$work/Vulkan-Loader" -B "$work/Vulkan-Loader-build" -G Ninja \
    -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_INSTALL_LIBDIR=lib \
    -DCMAKE_PREFIX_PATH="$prefix" -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=OFF
  cmake --build "$work/Vulkan-Loader-build" --parallel "$jobs"
  cmake --install "$work/Vulkan-Loader-build"
fi
pkg-config --atleast-version=1.4.309 vulkan
checkout ffmpeg https://github.com/FFmpeg/FFmpeg.git "$ffmpeg_rev"
mkdir -p "$work/ffmpeg-build"
(
  cd "$work/ffmpeg-build"
  "$work/ffmpeg/configure" --prefix="$prefix" --libdir="$prefix/lib" \
    --enable-shared --disable-static --enable-pic --disable-programs \
    --disable-doc --disable-debug --disable-autodetect \
    --enable-gnutls --enable-libdrm --enable-vaapi --enable-vdpau \
    --enable-libdav1d --enable-libass --enable-zlib
  make -j "$jobs"
  make install
)
checkout placebo https://github.com/haasn/libplacebo.git "$placebo_rev"
git -C "$work/placebo" submodule update --init --recursive --depth=1 -- 3rdparty
# Keep normal renderer functionality, including GPU-next on X11 and Wayland.
build_meson placebo -Ddefault_library=shared -Ddemos=false -Dtests=false \
  -Dopengl=enabled -Dvulkan=enabled -Dshaderc=enabled
checkout mpv https://github.com/mpv-player/mpv.git "$mpv_rev"
build_meson mpv -Dlibmpv=true -Dcplayer=true -Dbuild-date=false \
  -Dmanpage-build=disabled -Dtests=false -Dlua=luajit \
  -Dgl=enabled -Dplain-gl=enabled -Degl=enabled -Dwayland=enabled \
  -Degl-wayland=enabled -Dx11=enabled -Degl-x11=enabled \
  -Dalsa=enabled -Dpulse=enabled -Dvaapi=enabled -Dvdpau=enabled -Dvulkan=enabled
make -C "$root/tools/linux-hdr-probe" -B check embedded \
  COLOR_XML="$work/protocols/staging/color-management/color-management-v1.xml"
# Copy actual SONAME files, not absolute symlinks or development headers.
# Explicit allowlist: system GTK, Mesa/GL/EGL, audio, and hardware drivers stay
# system-provided. The FFmpeg and Wayland ABI families travel together.
stems=(libmpv libplacebo libavcodec libavfilter libavformat libavutil libswresample libswscale libavdevice libwayland-client libwayland-egl libwayland-cursor libwayland-server)
if [[ -f "$prefix/lib/libvulkan.so.1" ]]; then stems+=(libvulkan); fi
for stem in "${stems[@]}"; do
  shopt -s nullglob
  candidates=("$prefix/lib/$stem.so."*)
  found=false
  for file in "${candidates[@]}"; do
    [[ -f "$file" && ! -L "$file" ]] || continue
    soname="$(patchelf --print-soname "$file")"
    [[ "$soname" == "$stem.so."* ]] || { echo "Bad SONAME: $file" >&2; exit 1; }
    install -m755 "$file" "$stage/$soname"
    patchelf --force-rpath --set-rpath '$ORIGIN' "$stage/$soname"
    found=true
  done
  [[ "$found" == true ]] || { echo "Missing library: $stem" >&2; exit 1; }
done
install -m755 "$root/tools/linux-hdr-probe/libharbor-linux-hdr.so" "$stage/libharbor-linux-hdr.so"
patchelf --force-rpath --set-rpath '$ORIGIN' "$stage/libharbor-linux-hdr.so"
# Use distinct SONAMEs for FFmpeg/libplacebo so GStreamer, WebKit and other
# system components do not accidentally pick up our private codec libraries.
# mpv and GTK must still share the same Wayland ABI, so do not rename Wayland.
for file in "$stage"/libav*.so.* "$stage"/libsw*.so.* "$stage"/libplacebo.so.*; do
  old="$(basename "$file")"
  new="libharbor-${old#lib}"
  patchelf --set-soname "$new" "$file"
  for consumer in "$stage"/*.so*; do
    if patchelf --print-needed "$consumer" | grep -Fxq "$old"; then
      patchelf --replace-needed "$old" "$new" "$consumer"
    fi
  done
  mv "$file" "$stage/$new"
done
mkdir -p "$stage/licenses"
for name in wayland protocols ffmpeg placebo mpv Vulkan-Headers Vulkan-Loader; do
  [[ -d "$work/$name" ]] || continue
  mkdir -p "$stage/licenses/$name"
  for file in "$work/$name"/{LICENSE*,COPYING*,Copyright}; do
    [[ -f "$file" ]] && cp "$file" "$stage/licenses/$name/" || true
  done
done
cat > "$stage/sources.txt" <<EOF
wayland https://github.com/wayland-mirror/wayland/tree/$wayland_rev
wayland-protocols https://github.com/wayland-mirror/wayland-protocols/tree/$protocols_rev
FFmpeg https://github.com/FFmpeg/FFmpeg/tree/$ffmpeg_rev
libplacebo https://github.com/haasn/libplacebo/tree/$placebo_rev
mpv https://github.com/mpv-player/mpv/tree/$mpv_rev
EOF
if [[ -d "$work/Vulkan-Loader" ]]; then
  printf '%s\n' \
    "Vulkan-Headers https://github.com/KhronosGroup/Vulkan-Headers/tree/$vulkan_headers_rev" \
    "Vulkan-Loader https://github.com/KhronosGroup/Vulkan-Loader/tree/$vulkan_loader_rev" >> "$stage/sources.txt"
fi
# Build and execute the same ABI check shipped in the source tree. Verify
# resolution from the staged directory, not from the development prefix.
cc -o "$work/check-api" "$root/tools/linux-hdr-probe/check_api.c" \
  $(pkg-config --cflags --libs mpv) -ldl
install -m755 "$work/check-api" "$stage/check-api"
patchelf --force-rpath --set-rpath '$ORIGIN' "$stage/check-api"
env -u LD_LIBRARY_PATH "$stage/check-api" "$stage/libharbor-linux-hdr.so"
for so in "$stage"/*.so*; do
  output="$(env LD_LIBRARY_PATH="$stage" ldd "$so")"
  if grep -q 'not found' <<< "$output"; then echo "$output" >&2; exit 1; fi
done
echo "Pinned Linux HDR runtime staged at $stage"
