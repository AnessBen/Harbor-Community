# Linux embedded HDR prototype (not a shipping Harbor renderer)

This standalone Linux test isolates the hardest requirement for Harbor's true
embedded HDR: a separately tagged high-bit-depth Wayland video subsurface under
a transparent GTK3/WebKitGTK parent that draws ordinary SDR controls. It is not connected
to Harbor's settings, playback bridge, or packaging. Existing players are
unaffected; do not publish an embedded HDR toggle until this is validated.

## Build and run

Requires a Linux development environment with GTK3/GDK Wayland, WebKitGTK 4.1, Wayland client
and EGL 1.5 headers, OpenGL, libmpv, wayland-protocols (color-management-v1 XML),
wayland-scanner and a C compiler. Runtime libmpv must expose client API 2.7
(upstream MPV 0.43 development branch as of 2026-11-24). The program uses the
ABI enum documented in that API; it refuses old runtimes instead of silently
substituting the legacy renderer. Use a development build for this test only.

```sh
cd tools/linux-hdr-probe
make check
make
GDK_BACKEND=wayland ./harbor-linux-hdr-probe /path/to/local-hdr10-video.mkv
# Compare against pure GTK controls if WebKit composition is broken:
GDK_BACKEND=wayland ./harbor-linux-hdr-probe --gtk-controls /path/to/local-hdr10-video.mkv
```

The app accepts local regular files only, ignores user mpv configs, and uses
software decoding initially to isolate presentation correctness. It requires
a compositor advertising color-management-v1, BT.2020, PQ and parametric image
descriptions, and a verified RGB10/A2-compatible, non-sRGB EGL framebuffer. It sets a PQ/BT.2020
description on its own Wayland child, forces a matching mpv target transfer
and primaries, and explicitly requests gpu-next. The child has an empty input
region. Play/pause, fullscreen and close are ordinary SDR WebKit controls by default;
`--gtk-controls` selects the native GTK comparison path. The WebKit document is
local and uses a fixed message bridge and a restrictive content security policy.

The prototype uses a fixed 1000-nit target for testing, integer GTK scale,
and a simple UI timer. It does not yet adapt to the display's preferred image
description or monitor changes, implement proper frame callbacks/pacing,
handle fractional scale exactly, integrate Harbor's actual WebKit application,
expose full Harbor controls,
or support HDR format transitions with independent SDR targets. EGL/Wayland
WSI color-surface ownership must be validated on each driver: a duplicate
color-management object is a fatal Wayland protocol error. This is isolated in
a separate process for that reason. A compositor accepting a PQ tag does not
prove a physical monitor is in HDR mode; SDR compositors may tone-map the child.

## Acceptance tests before integration

1. Build with the real Linux development headers and run under an HDR-capable
   Wayland compositor with HDR enabled. Verify the framebuffer channel sizes
   and the compositor's actual child-surface color description.
2. Compare a known PQ HDR10 test pattern against separate-window mpv, including
   grayscale, near-black and highlight clipping. Verify physical HDR at the
   display, not merely the source transfer function.
3. Compare transparent WebKit and native GTK control modes. Check normal SDR
   controls remain the same brightness over the video; test
   input, pause, resize, fullscreen, minimize/restore, mixed-DPI monitors,
   and repeated startup/teardown. Confirm no protocol errors.
4. Verify refusal on X11, an old libmpv, an unsupported compositor, and an
   8-bit-only EGL config. Do not expose an enabled Harbor option on failure.
5. Next integration stage: move surface ownership into a dedicated renderer
   module, attach it to Harbor's realized GDK window, preserve the WebKit
   overlay and native subtitle selection, use session-owned cleanup and
   compositor frame timing, and route unsupported configurations through the
   existing separate-window HDR or embedded SDR policy.

`make check` runs only the portable capability/geometry unit tests; it does not
validate the actual renderer. The prototype has no new production dependencies.

References:
- https://github.com/mpv-player/mpv/blob/master/DOCS/client-api-changes.rst
- https://github.com/mpv-player/mpv/blob/master/include/mpv/render.h
- https://wayland.app/protocols/color-management-v1
- https://docs.gtk.org/gtk3/wayland.html
