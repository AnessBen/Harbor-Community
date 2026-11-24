/* Experimental, isolated proof of concept: GTK3 controls over a PQ Wayland
 * subsurface. Never linked into Harbor or enabled in production. */
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

static bool setup_wayland(Probe *p) {
    GdkWindow *gdk_window = gtk_widget_get_window(p->window);
    GdkDisplay *gdk_display = gtk_widget_get_display(p->window);
    if (!GDK_IS_WAYLAND_DISPLAY(gdk_display) || !gdk_window)
        return fail(p, "Native Wayland window required (not X11/XWayland).");
    p->display = gdk_wayland_display_get_wl_display(gdk_display);
    struct wl_surface *parent = gdk_wayland_window_get_wl_surface(gdk_window);
    if (!p->display || !parent) return fail(p, "No native GTK parent surface.");
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
static bool setup_mpv(Probe *p, const char *path) {
    if (mpv_client_api_version() < MPV_MAKE_VERSION(2, 7))
        return fail(p, "libmpv client API >=2.7 required (upstream 0.43 development API).");
    p->mpv = mpv_create();
    if (!p->mpv) return fail(p, "Cannot allocate mpv.");
    const char *options[][2] = {
        {"config", "no"}, {"load-scripts", "no"}, {"ytdl", "no"},
        {"vo", "libmpv"}, {"hwdec", "no"}, {"osc", "no"},
        {"input-default-bindings", "no"}, {"terminal", "yes"},
        {"target-trc", "pq"}, {"target-prim", "bt.2020"},
        {"target-colorspace-hint", "no"}, {"target-peak", "1000"},
        {"video-output-levels", "full"}, {"dither-depth", "10"},
        {"video-timing-offset", "0"},
    };
    for (size_t i = 0; i < sizeof(options)/sizeof(options[0]); i++) {
        int rc = mpv_set_option_string(p->mpv, options[i][0], options[i][1]);
        if (rc < 0) {
            fprintf(stderr, "mpv option %s rejected: %s\n", options[i][0], mpv_error_string(rc));
            return fail(p, "Required render option rejected; not loading video.");
        }
    }
    if (mpv_initialize(p->mpv) < 0) return fail(p, "mpv initialization failed.");
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
    /* No blocking mpv command while the render context is active. */
    const char *cmd[] = { "loadfile", path, "replace", NULL };
    if (mpv_command_async(p->mpv, 1, cmd) < 0) return fail(p, "Cannot enqueue file.");
    fprintf(stderr, "PQ/BT.2020 child tagged; gpu-next initialized. Not proof of physical HDR.\n");
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
static gboolean tick(gpointer data) {
    Probe *p = data;
    if (wl_display_dispatch_queue_pending(p->display, p->queue) < 0) {
        fail(p, "Wayland connection failed."); goto stop;
    }
    for (;;) {
        mpv_event *event = mpv_wait_event(p->mpv, 0);
        if (event->event_id == MPV_EVENT_NONE) break;
        if (event->event_id == MPV_EVENT_SHUTDOWN ||
            (event->event_id == MPV_EVENT_END_FILE &&
             ((mpv_event_end_file *)event->data)->reason == MPV_END_FILE_REASON_ERROR)) {
            fail(p, "MPV stopped or failed to decode."); goto stop;
        }
        if (event->event_id == MPV_EVENT_COMMAND_REPLY && event->error < 0) {
            fail(p, "MPV command failed."); goto stop;
        }
    }
    if (!gtk_widget_get_mapped(p->window)) return G_SOURCE_CONTINUE;
    int w, h, scale;
    if (!dimensions(p, &w, &h, &scale)) return G_SOURCE_CONTINUE;
    bool resize = w != p->width || h != p->height || scale != p->scale;
    if (!resize && p->shown && !g_atomic_int_compare_and_exchange(&p->redraw, 1, 0))
        return G_SOURCE_CONTINUE;
    EGLenum prev_api = eglQueryAPI();
    EGLDisplay prev_display = eglGetCurrentDisplay();
    EGLContext prev_context = eglGetCurrentContext();
    EGLSurface prev_draw = eglGetCurrentSurface(EGL_DRAW), prev_read = eglGetCurrentSurface(EGL_READ);
    if (!eglBindAPI(EGL_OPENGL_API) || !eglMakeCurrent(p->egl, p->target, p->target, p->context)) {
        restore_context(prev_api, prev_display, prev_context, prev_draw, prev_read, p->egl);
        fail(p, "EGL context lost."); goto stop;
    }
    if (resize) {
        p->width = w; p->height = h; p->scale = scale;
        wl_surface_set_buffer_scale(p->surface, scale);
        wl_egl_window_resize(p->native, w, h, 0, 0);
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
            p->shown = true;
        }
    }
    restore_context(prev_api, prev_display, prev_context, prev_draw, prev_read, p->egl);
    if (!p->failed) return G_SOURCE_CONTINUE;
stop:
    p->timer = 0;
    gtk_main_quit();
    return G_SOURCE_REMOVE;
}

static gboolean draw(GtkWidget *widget, cairo_t *cr, gpointer data) {
    (void)widget; (void)data;
    cairo_save(cr);
    cairo_set_operator(cr, CAIRO_OPERATOR_SOURCE);
    cairo_set_source_rgba(cr, 0, 0, 0, 0);
    cairo_paint(cr);
    cairo_restore(cr);
    return FALSE; /* let GTK draw its normal SDR child controls */
}
static void pause_clicked(GtkButton *button, gpointer data) {
    (void)button;
    Probe *p = data;
    const char *cmd[] = { "cycle", "pause", NULL };
    mpv_command_async(p->mpv, 2, cmd);
}
static void fullscreen_clicked(GtkButton *button, gpointer data) {
    (void)button;
    Probe *p = data;
    GdkWindow *window = gtk_widget_get_window(p->window);
    if (gdk_window_get_state(window) & GDK_WINDOW_STATE_FULLSCREEN)
        gtk_window_unfullscreen(GTK_WINDOW(p->window));
    else gtk_window_fullscreen(GTK_WINDOW(p->window));
}
static void close_clicked(GtkButton *button, gpointer data) {
    (void)button; (void)data; gtk_main_quit();
}
/* Test the actual GTK3/WebKitGTK overlay used by Harbor, not just a native
 * control bar. The document is entirely local with a closed command set. */
static void web_command(WebKitUserContentManager *manager, WebKitJavascriptResult *result,
                        gpointer data) {
    (void)manager;
    Probe *p = data;
    JSCValue *value = webkit_javascript_result_get_js_value(result);
    if (!jsc_value_is_string(value)) return;
    char *command = jsc_value_to_string(value);
    if (p->mpv && !strcmp(command, "pause")) pause_clicked(NULL, p);
    else if (!strcmp(command, "fullscreen")) fullscreen_clicked(NULL, p);
    else if (!strcmp(command, "close")) close_clicked(NULL, p);
    g_free(command);
}
static GtkWidget *webkit_controls(Probe *p) {
    static const char html[] =
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; "
        "style-src 'unsafe-inline'; script-src 'unsafe-inline'\">"
        "<style>html,body{margin:0;background:transparent;color:white;font:16px sans-serif}"
        "header{position:fixed;top:16px;left:16px;padding:10px 14px;background:#222b;border-radius:8px}"
        "footer{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;"
        "gap:8px;padding:12px;background:#222b;border-radius:10px}"
        "button{font:inherit;color:white;background:#333;border:1px solid #888;border-radius:6px;"
        "padding:10px 16px;cursor:pointer}button:focus-visible{outline:2px solid white}</style>"
        "</head><body><header>Harbor HDR probe — SDR WebKit overlay</header>"
        "<footer><button data-c='pause'>Play / pause</button>"
        "<button data-c='fullscreen'>Fullscreen</button>"
        "<button data-c='close'>Close</button></footer>"
        "<script>document.querySelectorAll('button').forEach(b=>b.addEventListener('click',"
        "()=>window.webkit.messageHandlers.harborProbe.postMessage(b.dataset.c)))</script></body></html>";
    WebKitUserContentManager *manager = webkit_user_content_manager_new();
    g_signal_connect(manager, "script-message-received::harborProbe", G_CALLBACK(web_command), p);
    if (!webkit_user_content_manager_register_script_message_handler(manager, "harborProbe")) {
        g_object_unref(manager);
        fail(p, "Cannot register local WebKit test control bridge.");
        return NULL;
    }
    GtkWidget *view = webkit_web_view_new_with_user_content_manager(manager);
    g_object_unref(manager);
    gtk_widget_set_app_paintable(view, TRUE);
    GdkRGBA transparent = {0.0, 0.0, 0.0, 0.0};
    webkit_web_view_set_background_color(WEBKIT_WEB_VIEW(view), &transparent);
    gtk_widget_set_hexpand(view, TRUE);
    gtk_widget_set_vexpand(view, TRUE);
    gtk_widget_set_halign(view, GTK_ALIGN_FILL);
    gtk_widget_set_valign(view, GTK_ALIGN_FILL);
    webkit_web_view_load_html(WEBKIT_WEB_VIEW(view), html, NULL);
    return view;
}
static gboolean close_window(GtkWidget *widget, GdkEvent *event, gpointer data) {
    (void)widget; (void)event; (void)data;
    gtk_main_quit(); return TRUE;
}

static void cleanup(Probe *p) {
    if (p->timer) g_source_remove(p->timer);
    if (p->render) {
        mpv_render_context_set_update_callback(p->render, NULL, NULL);
        /* Context must be current before freeing its OpenGL objects. */
        if (!eglBindAPI(EGL_OPENGL_API) || !eglMakeCurrent(p->egl, p->target, p->target, p->context)) {
            /* A lost context is unrecoverable in this standalone probe.
             * Exit without asking libmpv to free GL objects on the wrong context. */
            fprintf(stderr, "EGL context lost during cleanup; exiting probe.\n");
            _Exit(1);
        }
        mpv_render_context_free(p->render);
    }
    if (p->mpv) mpv_terminate_destroy(p->mpv);
    if (p->egl != EGL_NO_DISPLAY) {
        eglMakeCurrent(p->egl, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        if (p->target != EGL_NO_SURFACE) eglDestroySurface(p->egl, p->target);
        if (p->context != EGL_NO_CONTEXT) eglDestroyContext(p->egl, p->context);
        /* Do not eglTerminate: GTK owns a connection to the same display. */
    }
    if (p->native) wl_egl_window_destroy(p->native);
    if (p->color) wp_color_management_surface_v1_destroy(p->color);
    if (p->description) wp_image_description_v1_destroy(p->description);
    if (p->subsurface) wl_subsurface_destroy(p->subsurface);
    if (p->surface) wl_surface_destroy(p->surface);
    if (p->manager) wp_color_manager_v1_destroy(p->manager);
    if (p->subcompositor) wl_subcompositor_destroy(p->subcompositor);
    if (p->compositor) wl_compositor_destroy(p->compositor);
    if (p->registry) wl_registry_destroy(p->registry);
    if (p->queue) wl_event_queue_destroy(p->queue);
    if (p->display) wl_display_flush(p->display);
    if (p->window) gtk_widget_destroy(p->window);
}

int main(int argc, char **argv) {
    bool native_controls = argc == 3 && !strcmp(argv[1], "--gtk-controls");
    if ((argc != 2 && !native_controls) || !g_file_test(argv[argc - 1], G_FILE_TEST_IS_REGULAR)) {
        fprintf(stderr, "Usage: harbor-linux-hdr-probe [--gtk-controls] LOCAL_VIDEO_FILE\n");
        return 2;
    }
    const char *path = argv[argc - 1];
    if (mpv_client_api_version() < MPV_MAKE_VERSION(2, 7)) {
        fprintf(stderr, "libmpv client API 2.7 or newer required.\n");
        return 1;
    }
    if (!gtk_init_check(NULL, NULL)) {
        fprintf(stderr, "GTK display unavailable.\n"); return 1;
    }
    Probe p = { .egl = EGL_NO_DISPLAY, .context = EGL_NO_CONTEXT, .target = EGL_NO_SURFACE };
    p.window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(p.window), "Harbor embedded HDR prototype");
    gtk_window_set_default_size(GTK_WINDOW(p.window), 960, 540);
    gtk_window_set_decorated(GTK_WINDOW(p.window), FALSE);
    GdkVisual *visual = gdk_screen_get_rgba_visual(gtk_widget_get_screen(p.window));
    if (!visual) { fail(&p, "No RGBA GTK visual."); cleanup(&p); return 1; }
    gtk_widget_set_visual(p.window, visual);
    gtk_widget_set_app_paintable(p.window, TRUE);
    g_signal_connect(p.window, "draw", G_CALLBACK(draw), &p);
    g_signal_connect(p.window, "delete-event", G_CALLBACK(close_window), &p);
    GtkWidget *overlay = gtk_overlay_new();
    GtkWidget *blank = gtk_drawing_area_new();
    gtk_container_add(GTK_CONTAINER(overlay), blank);
    gtk_container_add(GTK_CONTAINER(p.window), overlay);
    if (native_controls) {
        GtkWidget *bar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
        gtk_widget_set_halign(bar, GTK_ALIGN_CENTER);
        gtk_widget_set_valign(bar, GTK_ALIGN_END);
        gtk_widget_set_margin_bottom(bar, 16);
        GtkWidget *pause = gtk_button_new_with_label("Play / pause");
        GtkWidget *fullscreen = gtk_button_new_with_label("Fullscreen");
        GtkWidget *close = gtk_button_new_with_label("Close");
        gtk_box_pack_start(GTK_BOX(bar), pause, FALSE, FALSE, 0);
        gtk_box_pack_start(GTK_BOX(bar), fullscreen, FALSE, FALSE, 0);
        gtk_box_pack_start(GTK_BOX(bar), close, FALSE, FALSE, 0);
        gtk_overlay_add_overlay(GTK_OVERLAY(overlay), bar);
        g_signal_connect(pause, "clicked", G_CALLBACK(pause_clicked), &p);
        g_signal_connect(fullscreen, "clicked", G_CALLBACK(fullscreen_clicked), &p);
        g_signal_connect(close, "clicked", G_CALLBACK(close_clicked), &p);
    } else {
        GtkWidget *view = webkit_controls(&p);
        if (!view) { cleanup(&p); return 1; }
        gtk_overlay_add_overlay(GTK_OVERLAY(overlay), view);
        gtk_overlay_set_overlay_pass_through(GTK_OVERLAY(overlay), view, FALSE);
    }
    gtk_widget_show_all(p.window);
    EGLenum prev_api = eglQueryAPI();
    EGLDisplay prev_display = eglGetCurrentDisplay();
    EGLContext prev_context = eglGetCurrentContext();
    EGLSurface prev_draw = eglGetCurrentSurface(EGL_DRAW), prev_read = eglGetCurrentSurface(EGL_READ);
    bool ok = setup_wayland(&p) && setup_egl(&p) && setup_mpv(&p, path);
    restore_context(prev_api, prev_display, prev_context, prev_draw, prev_read, p.egl);
    if (ok) {
        gtk_widget_queue_draw(p.window); /* GTK commits parent stacking changes */
        p.timer = g_timeout_add(8, tick, &p);
        gtk_main();
    }
    cleanup(&p);
    return p.failed ? 1 : 0;
}
