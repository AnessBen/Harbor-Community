#ifndef HARBOR_HDR_PROBE_POLICY_H
#define HARBOR_HDR_PROBE_POLICY_H
#include <stdbool.h>
#include <limits.h>

static inline bool hdr_protocol_ready(bool compositor, bool subcompositor,
                                      bool manager, bool parametric,
                                      bool pq, bool bt2020) {
    return compositor && subcompositor && manager && parametric && pq && bt2020;
}
static inline bool hdr_rgb10a2_format(int red, int green, int blue, int alpha) {
    return red == 10 && green == 10 && blue == 10 && (alpha == 0 || alpha == 2);
}
static inline bool hdr_dimensions(int logical_width, int logical_height, int scale,
                                  int *width, int *height) {
    if (logical_width < 1 || logical_height < 1 || scale < 1 ||
        logical_width > INT_MAX / scale || logical_height > INT_MAX / scale)
        return false;
    *width = logical_width * scale;
    *height = logical_height * scale;
    return true;
}
#endif
