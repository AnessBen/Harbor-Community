#!/usr/bin/env bash
# Copy only ABI-sensitive media dependencies from the authenticated build host.
# Keep libc, GTK/WebKit, Wayland, Vulkan ICDs and graphics/audio drivers native.
set -euo pipefail
runtime="$(realpath "${1:?runtime directory}")"
out="$(realpath -m "${2:?output directory}")"
mkdir -p "$out/licenses/ubuntu-compat"
manifest="$out/ubuntu-compat-sources.txt"
touch "$manifest"
# Ubuntu's MuJS/JPEG and optional media libraries have SONAMEs that can
# differ on Fedora, Arch and NixOS. Preserve the exact linked SONAME.
queue=("$runtime"/libmpv.so.2 "$runtime"/libharbor-*.so.*)
for ((i=0; i<${#queue[@]}; i++)); do
  file="${queue[i]}"
  [[ -f "$file" ]] || continue
  while IFS= read -r needed; do
    case "$needed" in
      libbluray.so.*|libxml2.so.2|libudfread.so.0|libicuuc.so.74|libicudata.so.74|libicui18n.so.74|libluajit-5.1.so.*|libshaderc.so.*|libSPIRV*.so*|libglslang*.so*|libMachineIndependent.so*|libOSDependent.so*|libGenericCodeGen.so*|libSPVRemapper.so*|libHLSL.so*|libOGLCompiler.so*|libmujs.so.*|libjpeg.so.8|libjpeg.so.8.*|librubberband.so.*|libsndio.so.*|libcdio*.so.*|libdvdread.so.*|libdvdnav.so.*|libcaca.so.*|libsixel.so.*|libdisplay-info.so.*|libzimg.so.*|libuchardet.so.*|libfftw3*.so.*|libsamplerate.so.*) ;;
      *) continue ;;
    esac
    [[ ! -e "$runtime/$needed" && ! -e "$out/$needed" ]] || continue
    src="$(ldconfig -p | awk -v n="$needed" '$1 == n && /x86-64/ && !found {print $NF; found=1}')"
    [[ -n "$src" && -f "$src" ]] || { echo "Missing exact host ABI: $needed" >&2; exit 1; }
    src="$(realpath "$src")"
    actual="$(readelf -d "$src" | sed -n 's/.*(SONAME).*\[\(.*\)\].*/\1/p')"
    [[ "$actual" == "$needed" ]] || { echo "Wrong SONAME: $src" >&2; exit 1; }
    install -m755 "$src" "$out/$needed"
    patchelf --force-rpath --set-rpath '$ORIGIN' "$out/$needed"
    queue+=("$out/$needed")
    owner="$(dpkg-query -S "$src" 2>/dev/null | sed -n '1s/: .*//p')" || true
    if [[ -z "$owner" && "$src" == /usr/* ]]; then
      owner="$(dpkg-query -S "${src#/usr}" 2>/dev/null | sed -n '1s/: .*//p')" || true
    fi
    [[ -n "$owner" ]] || { echo "No Debian package owns $src" >&2; exit 1; }
    version="$(dpkg-query -W -f='${Version}' "$owner")"
    package="${owner%%:*}"
    copyright="/usr/share/doc/$package/copyright"
    [[ -f "$copyright" ]] || { echo "Missing license metadata: $package" >&2; exit 1; }
    cp -L "$copyright" "$out/licenses/ubuntu-compat/$package.copyright"
    printf '%s %s %s\n' "$needed" "$owner" "$version" >> "$manifest"
    echo "Staged ABI-compatible $needed from $owner $version"
  done < <(readelf -d "$file" | sed -n 's/.*(NEEDED).*\[\(.*\)\].*/\1/p')
done
sort -u -o "$manifest" "$manifest"
