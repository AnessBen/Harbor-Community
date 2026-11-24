/* Shared, experimental GTK3 / Wayland PQ surface implementation. */
#include <gtk/gtk.h>
#include <gdk/gdkwayland.h>
#include <webkit2/webkit2.h>
#include <wayland-client.h>
#include <wayland-egl.h>
#include <EGL/egl.h>
#include <EGL/eglext.h>
#define GL_GLEXT_PROTOTYPES
#include <GL/gl.h>
#include <GL/glext.h>
#include <mpv/client.h>
#include <mpv/render_gl.h>
#include <dlfcn.h>
#include <stdbool.h>
#include <locale.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "color-management-v1-client-protocol.h"
#include "policy.h"

/* Client API 2.7 adds this enum. Keep builds possible with older headers;
 * the runtime API check prevents ever sending it to an older libmpv. */
#define RENDERER_PARAM ((mpv_render_param_type)23)

typedef struct {
    GtkWidget *window;
    struct wl_display *display; /* borrowed from GDK; never disconnect */
    struct wl_event_queue *queue;
    struct wl_registry *registry;
    struct wl_compositor *compositor;
    struct wl_subcompositor *subcompositor;
    struct wl_surface *surface;
    struct wl_subsurface *subsurface;
    struct wp_color_manager_v1 *manager;
    struct wp_color_management_surface_v1 *color;
    struct wp_image_description_v1 *description;
    bool parametric, pq, bt2020, manager_done;
    bool description_ready, description_failed;
    struct wl_egl_window *native;
    EGLDisplay egl;
    EGLContext context;
    EGLSurface target;
    mpv_handle *mpv;
    mpv_render_context *render;
    int width, height, scale;
    guint timer;
    gint redraw; /* only shared with mpv update callback */
    bool shown, failed;
} Probe;

static void intent(void *data, struct wp_color_manager_v1 *obj, uint32_t value) {
    (void)data; (void)obj; (void)value; /* perceptual is mandatory */
}
static void feature(void *data, struct wp_color_manager_v1 *obj, uint32_t value) {
    (void)obj;
    if (value == WP_COLOR_MANAGER_V1_FEATURE_PARAMETRIC)
        ((Probe *)data)->parametric = true;
}
static void transfer(void *data, struct wp_color_manager_v1 *obj, uint32_t value) {
    (void)obj;
    if (value == WP_COLOR_MANAGER_V1_TRANSFER_FUNCTION_ST2084_PQ)
        ((Probe *)data)->pq = true;
}
static void primaries(void *data, struct wp_color_manager_v1 *obj, uint32_t value) {
    (void)obj;
    if (value == WP_COLOR_MANAGER_V1_PRIMARIES_BT2020)
        ((Probe *)data)->bt2020 = true;
}
static void done(void *data, struct wp_color_manager_v1 *obj) {
    (void)obj; ((Probe *)data)->manager_done = true;
}
static const struct wp_color_manager_v1_listener manager_listener = {
    .supported_intent = intent, .supported_feature = feature,
    .supported_tf_named = transfer, .supported_primaries_named = primaries,
    .done = done,
};

static void global(void *data, struct wl_registry *registry, uint32_t name,
                   const char *interface, uint32_t version) {
    Probe *p = data;
    if (version < 1) return;
    if (!strcmp(interface, wl_compositor_interface.name) && !p->compositor)
        p->compositor = wl_registry_bind(registry, name, &wl_compositor_interface,
                                         version < 3 ? version : 3);
    else if (!strcmp(interface, wl_subcompositor_interface.name) && !p->subcompositor)
        p->subcompositor = wl_registry_bind(registry, name, &wl_subcompositor_interface, 1);
    else if (!strcmp(interface, wp_color_manager_v1_interface.name) && !p->manager) {
        /* Bind v1 deliberately: stable event/enum set and no ready2 event. */
        p->manager = wl_registry_bind(registry, name, &wp_color_manager_v1_interface, 1);
        wp_color_manager_v1_add_listener(p->manager, &manager_listener, p);
    }
}
static void global_remove(void *data, struct wl_registry *registry, uint32_t name) {
    (void)data; (void)registry; (void)name;
}
static const struct wl_registry_listener registry_listener = {
    .global = global, .global_remove = global_remove,
};
static void description_failed(void *data, struct wp_image_description_v1 *obj,
                               uint32_t cause, const char *message) {
    (void)obj;
    ((Probe *)data)->description_failed = true;
    fprintf(stderr, "Image description rejected (%u): %s\n", cause, message);
}
static void description_ready(void *data, struct wp_image_description_v1 *obj,
                              uint32_t identity) {
    (void)obj; (void)identity;
    ((Probe *)data)->description_ready = true;
}
static const struct wp_image_description_v1_listener description_listener = {
    .failed = description_failed, .ready = description_ready,
};

static bool fail(Probe *p, const char *message) {
    fprintf(stderr, "Embedded HDR probe: %s\n", message);
    p->failed = true;
    return false;
}
static void *get_proc(void *opaque, const char *name) {
    (void)opaque;
    void *ptr = (void *)eglGetProcAddress(name);
    return ptr ? ptr : dlsym(RTLD_DEFAULT, name);
}

static bool discover_wayland(Probe *p) {
    GdkDisplay *gdk_display = gtk_widget_get_display(p->window);
    if (!GDK_IS_WAYLAND_DISPLAY(gdk_display))
        return fail(p, "Native Wayland window required (not X11/XWayland).");
    p->display = gdk_wayland_display_get_wl_display(gdk_display);
    if (!p->display) return fail(p, "No native GTK Wayland display.");
    /* New proxies inherit this private queue, so our setup roundtrips don't
     * dispatch GTK's main-queue callbacks recursively. */
    p->queue = wl_display_create_queue(p->display);
    if (!p->queue) return fail(p, "Cannot create Wayland event queue.");
    struct wl_display *wrapper = wl_proxy_create_wrapper(p->display);
    if (!wrapper) return fail(p, "Cannot wrap Wayland display.");
    wl_proxy_set_queue((struct wl_proxy *)wrapper, p->queue);
    p->registry = wl_display_get_registry(wrapper);
    wl_proxy_wrapper_destroy(wrapper);
    if (!p->registry) return fail(p, "Cannot get Wayland registry.");
    wl_registry_add_listener(p->registry, &registry_listener, p);
    if (wl_display_roundtrip_queue(p->display, p->queue) < 0 ||
        wl_display_roundtrip_queue(p->display, p->queue) < 0)
        return fail(p, "Wayland registry roundtrip failed.");
    if (!hdr_protocol_ready(p->compositor != NULL && wl_proxy_get_version((struct wl_proxy *)p->compositor) >= 3,
                            p->subcompositor != NULL, p->manager != NULL && p->manager_done,
                            p->parametric, p->pq, p->bt2020))
        return fail(p, "Compositor lacks required subsurface/PQ/BT.2020 capabilities.");
    return true;
}

static bool setup_wayland(Probe *p) {
    GdkWindow *gdk_window = gtk_widget_get_window(p->window);
    if (!gdk_window || !discover_wayland(p))
        return false;
    struct wl_surface *parent = gdk_wayland_window_get_wl_surface(gdk_window);
    if (!parent) return fail(p, "No native GTK parent surface.");
    struct wp_image_description_creator_params_v1 *creator =
        wp_color_manager_v1_create_parametric_creator(p->manager);
    if (!creator) return fail(p, "Cannot allocate image-description creator.");
    /* PQ defaults define its full 10,000-nit encoding range and reference
     * white. Do not invent mastering display metadata for the source. */
    wp_image_description_creator_params_v1_set_tf_named(
        creator, WP_COLOR_MANAGER_V1_TRANSFER_FUNCTION_ST2084_PQ);
    wp_image_description_creator_params_v1_set_primaries_named(
        creator, WP_COLOR_MANAGER_V1_PRIMARIES_BT2020);
    p->description = wp_image_description_creator_params_v1_create(creator);
    if (!p->description) return fail(p, "Cannot allocate image description.");
    wp_image_description_v1_add_listener(p->description, &description_listener, p);
    if (wl_display_roundtrip_queue(p->display, p->queue) < 0 ||
        !p->description_ready || p->description_failed)
        return fail(p, "PQ image description was not accepted.");
    p->surface = wl_compositor_create_surface(p->compositor);
    if (!p->surface) return fail(p, "Cannot allocate video surface.");
    p->subsurface = wl_subcompositor_get_subsurface(p->subcompositor, p->surface, parent);
    if (!p->subsurface) return fail(p, "Cannot allocate video subsurface.");
    wl_subsurface_place_below(p->subsurface, parent);
    wl_subsurface_set_position(p->subsurface, 0, 0);
    wl_subsurface_set_desync(p->subsurface);
    struct wl_region *input = wl_compositor_create_region(p->compositor);
    if (!input) return fail(p, "Cannot allocate empty input region.");
    wl_surface_set_input_region(p->surface, input);
    wl_region_destroy(input);
    /* The child is our own surface, not GTK's SDR surface. We explicitly
     * own its image description, so don't ask EGL to set a second one. */
    p->color = wp_color_manager_v1_get_surface(p->manager, p->surface);
    if (!p->color) return fail(p, "Cannot allocate surface color manager.");
    wp_color_management_surface_v1_set_image_description(
        p->color, p->description, WP_COLOR_MANAGER_V1_RENDER_INTENT_PERCEPTUAL);
    if (wl_display_roundtrip_queue(p->display, p->queue) < 0)
        return fail(p, "Compositor rejected surface color configuration.");
    return true;
}

static bool dimensions(Probe *p, int *w, int *h, int *scale) {
    *scale = gtk_widget_get_scale_factor(p->window);
    return hdr_dimensions(gtk_widget_get_allocated_width(p->window),
                          gtk_widget_get_allocated_height(p->window), *scale, w, h);
}
static bool setup_egl(Probe *p) {
    p->egl = eglGetPlatformDisplay(EGL_PLATFORM_WAYLAND_KHR, p->display, NULL);
    if (p->egl == EGL_NO_DISPLAY || !eglInitialize(p->egl, NULL, NULL) ||
        !eglBindAPI(EGL_OPENGL_API))
        return fail(p, "Wayland EGL desktop OpenGL unavailable.");
    EGLint attrs[] = { EGL_SURFACE_TYPE, EGL_WINDOW_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT,
                       EGL_RED_SIZE, 10, EGL_GREEN_SIZE, 10, EGL_BLUE_SIZE, 10,
                       EGL_ALPHA_SIZE, 0, EGL_NONE };
    EGLConfig config = NULL;
    EGLint count = 0, r = 0, g = 0, b = 0, a = 0;
    if (!eglChooseConfig(p->egl, attrs, NULL, 0, &count) || count < 1)
        return fail(p, "No 10-bit RGB EGL window config.");
    EGLConfig *configs = g_new(EGLConfig, count);
    if (eglChooseConfig(p->egl, attrs, configs, count, &count)) {
        for (EGLint i = 0; i < count; ++i) {
            if (eglGetConfigAttrib(p->egl, configs[i], EGL_RED_SIZE, &r) &&
                eglGetConfigAttrib(p->egl, configs[i], EGL_GREEN_SIZE, &g) &&
                eglGetConfigAttrib(p->egl, configs[i], EGL_BLUE_SIZE, &b) &&
                eglGetConfigAttrib(p->egl, configs[i], EGL_ALPHA_SIZE, &a) &&
                hdr_rgb10a2_format(r, g, b, a)) {
                config = configs[i];
                break;
            }
        }
    }
    g_free(configs);
    if (!config) return fail(p, "No RGB10/A2-compatible EGL window config.");
    if (!dimensions(p, &p->width, &p->height, &p->scale))
        return fail(p, "Invalid initial surface size.");
    wl_surface_set_buffer_scale(p->surface, p->scale);
    p->native = wl_egl_window_create(p->surface, p->width, p->height);
    if (!p->native) return fail(p, "Cannot create EGL native window.");
    p->target = eglCreatePlatformWindowSurface(p->egl, config, p->native, NULL);
    EGLint ctx_attrs[] = { EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 3,
                           EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,
                           EGL_NONE };
    p->context = eglCreateContext(p->egl, config, EGL_NO_CONTEXT, ctx_attrs);
    if (p->target == EGL_NO_SURFACE || p->context == EGL_NO_CONTEXT ||
        !eglMakeCurrent(p->egl, p->target, p->target, p->context))
        return fail(p, "Cannot make 10-bit EGL context current.");
    /* GL_RED_BITS is not portable in a core profile. Query the actual
     * default framebuffer attachment instead, and require its encoding and
     * format to agree with the mpv target declaration. */
    r = g = b = a = 0;
    GLint component = 0, encoding = 0;
    glGetFramebufferAttachmentParameteriv(GL_FRAMEBUFFER, GL_BACK_LEFT, GL_FRAMEBUFFER_ATTACHMENT_RED_SIZE, &r);
    glGetFramebufferAttachmentParameteriv(GL_FRAMEBUFFER, GL_BACK_LEFT, GL_FRAMEBUFFER_ATTACHMENT_GREEN_SIZE, &g);
    glGetFramebufferAttachmentParameteriv(GL_FRAMEBUFFER, GL_BACK_LEFT, GL_FRAMEBUFFER_ATTACHMENT_BLUE_SIZE, &b);
    glGetFramebufferAttachmentParameteriv(GL_FRAMEBUFFER, GL_BACK_LEFT, GL_FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE, &a);
    glGetFramebufferAttachmentParameteriv(GL_FRAMEBUFFER, GL_BACK_LEFT, GL_FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE, &component);
    glGetFramebufferAttachmentParameteriv(GL_FRAMEBUFFER, GL_BACK_LEFT, GL_FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING, &encoding);
    if (glGetError() != GL_NO_ERROR || !hdr_rgb10a2_format(r, g, b, a) ||
        component != GL_UNSIGNED_NORMALIZED || encoding != GL_LINEAR)
        return fail(p, "Actual GL framebuffer is not linear-encoded RGB10/A2 UNORM.");
    fprintf(stderr, "Wayland EGL framebuffer: %d/%d/%d/%d bits\n", r, g, b, a);
    eglSwapInterval(p->egl, 0);
    return true;
}

static void redraw(void *data) {
    g_atomic_int_set(&((Probe *)data)->redraw, 1);
}
static bool setup_render(Probe *p) {
    mpv_opengl_init_params gl = { .get_proc_address = get_proc, .get_proc_address_ctx = NULL };
    mpv_render_param init[] = {
        { MPV_RENDER_PARAM_API_TYPE, (void *)MPV_RENDER_API_TYPE_OPENGL },
        { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl },
        { MPV_RENDER_PARAM_WL_DISPLAY, p->display },
        { RENDERER_PARAM, (void *)"gpu-next" },
        { MPV_RENDER_PARAM_INVALID, NULL },
    };
    if (mpv_render_context_create(&p->render, p->mpv, init) < 0)
        return fail(p, "Explicit gpu-next render context rejected (no legacy renderer fallback).");
    mpv_render_context_set_update_callback(p->render, redraw, p);
    return true;
}

static void restore_context(EGLenum api, EGLDisplay display, EGLContext context,
                            EGLSurface draw, EGLSurface read, EGLDisplay ours) {
    if (ours != EGL_NO_DISPLAY) {
        eglBindAPI(EGL_OPENGL_API);
        eglMakeCurrent(ours, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    }
    eglBindAPI(api);
    if (context != EGL_NO_CONTEXT)
        eglMakeCurrent(display, draw, read, context);
}
static gboolean render_frame(Probe *p) {
    if (!gtk_widget_get_mapped(p->window)) return G_SOURCE_CONTINUE;
    int w, h, scale;
    if (!dimensions(p, &w, &h, &scale)) return G_SOURCE_CONTINUE;
    bool resize = w != p->width || h != p->height || scale != p->scale;
    if (!resize && p->shown && !g_atomic_int_compare_and_exchange(&p->redraw, 1, 0))
        return G_SOURCE_CONTINUE;
    /* Resize the native window before acquiring its EGL back buffer. Otherwise
     * Mesa may render the new viewport into an old-size buffer on the first
     * fullscreen frame, especially when playback is paused. */
    if (resize) {
        p->width = w; p->height = h; p->scale = scale;
        wl_surface_set_buffer_scale(p->surface, scale);
        wl_egl_window_resize(p->native, w, h, 0, 0);
    }
    EGLenum prev_api = eglQueryAPI();
    EGLDisplay prev_display = eglGetCurrentDisplay();
    EGLContext prev_context = eglGetCurrentContext();
    EGLSurface prev_draw = eglGetCurrentSurface(EGL_DRAW), prev_read = eglGetCurrentSurface(EGL_READ);
    if (!eglBindAPI(EGL_OPENGL_API) || !eglMakeCurrent(p->egl, p->target, p->target, p->context)) {
        restore_context(prev_api, prev_display, prev_context, prev_draw, prev_read, p->egl);
        fail(p, "EGL context lost."); goto stop;
    }
    uint64_t update = mpv_render_context_update(p->render);
    if (resize || !p->shown || (update & MPV_RENDER_UPDATE_FRAME)) {
        mpv_opengl_fbo fbo = { .fbo = 0, .w = w, .h = h, .internal_format = GL_RGB10_A2 };
        int flip = 1, depth = 10, block = 0;
        mpv_render_param params[] = {
            { MPV_RENDER_PARAM_OPENGL_FBO, &fbo }, { MPV_RENDER_PARAM_FLIP_Y, &flip },
            { MPV_RENDER_PARAM_DEPTH, &depth }, { MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &block },
            { MPV_RENDER_PARAM_INVALID, NULL },
        };
        int rc = mpv_render_context_render(p->render, params);
        if (rc < 0 || !eglSwapBuffers(p->egl, p->target))
            fail(p, "Rendering or presentation failed.");
        else {
            mpv_render_context_report_swap(p->render);
            /* A resize can take one swap to acquire the new backing buffer.
             * Redraw once more even when mpv is paused, and keep redrawing
             * until the attached buffer has the requested pixel dimensions. */
            int attached_w = 0, attached_h = 0;
            wl_egl_window_get_attached_size(p->native, &attached_w, &attached_h);
            p->shown = !resize && attached_w == w && attached_h == h;
        }
    }
    restore_context(prev_api, prev_display, prev_context, prev_draw, prev_read, p->egl);
    if (!p->failed) return G_SOURCE_CONTINUE;
stop:
    return G_SOURCE_REMOVE;
}
