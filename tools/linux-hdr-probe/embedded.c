/* Optional in-process backend. Harbor owns the mpv core and its event queue.
 * All functions and GTK/EGL operations are confined to the GTK main thread. */
#include "surface.inc"

typedef struct {
    Probe p;
    WebKitWebView *web;
    GdkRGBA web_background;
    gboolean window_paintable, web_paintable;
    gulong draw_id, map_id;
} Embedded;

static gboolean clear_parent(GtkWidget *widget, cairo_t *cr, gpointer data) {
    (void)widget; (void)data;
    cairo_save(cr);
    cairo_set_operator(cr, CAIRO_OPERATOR_SOURCE);
    cairo_set_source_rgba(cr, 0, 0, 0, 0);
    cairo_paint(cr);
    cairo_restore(cr);
    return FALSE;
}

static gboolean remap(GtkWidget *widget, GdkEvent *event, gpointer data) {
    (void)widget; (void)event;
    Embedded *e = data;
    e->p.shown = false;
    return FALSE;
}

static gboolean embedded_tick(gpointer data) {
    Embedded *e = data;
    Probe *p = &e->p;
    if (wl_display_dispatch_queue_pending(p->display, p->queue) >= 0 &&
        render_frame(p) == G_SOURCE_CONTINUE)
        return G_SOURCE_CONTINUE;
    p->timer = 0;
    fprintf(stderr, "[harbor::linux_hdr] rendering stopped; stopping media\n");
    const char *stop[] = {"stop", NULL};
    mpv_command_async(p->mpv, 0, stop);
    return G_SOURCE_REMOVE;
}

/* Do not free the borrowed mpv core, destroy Harbor's window, disconnect GDK,
 * or terminate the app on a lost context. Retain ownership on detach failure. */
static bool release_native(Probe *p) {
    if (p->timer) {
        g_source_remove(p->timer);
        p->timer = 0;
    }
    EGLenum api = eglQueryAPI();
    EGLDisplay display = eglGetCurrentDisplay();
    EGLContext context = eglGetCurrentContext();
    EGLSurface draw = eglGetCurrentSurface(EGL_DRAW), read = eglGetCurrentSurface(EGL_READ);
    if (p->render) {
        mpv_render_context_set_update_callback(p->render, NULL, NULL);
        if (!eglBindAPI(EGL_OPENGL_API) ||
            !eglMakeCurrent(p->egl, p->target, p->target, p->context)) {
            restore_context(api, display, context, draw, read, p->egl);
            return false;
        }
        mpv_render_context_free(p->render);
        p->render = NULL;
    }
    if (p->egl != EGL_NO_DISPLAY) {
        /* If the saved context belongs to this backend, do not restore it. */
        if (context == p->context) context = EGL_NO_CONTEXT;
        restore_context(api, display, context, draw, read, p->egl);
        if (p->target != EGL_NO_SURFACE) eglDestroySurface(p->egl, p->target);
        if (p->context != EGL_NO_CONTEXT) eglDestroyContext(p->egl, p->context);
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
    return true;
}

/* ABI 1: attach returns an owned token, or NULL without a live renderer.
 * A failed detach leaves the token valid for a retry. */
__attribute__((visibility("default"))) unsigned harbor_hdr_abi(void) { return 1; }

/* Non-mutating capability check: no subsurface, EGL context, or MPV session.
 * Actual framebuffer validation still happens during attach. */
__attribute__((visibility("default"))) int harbor_hdr_supported(GtkWidget *window) {
    if (!GTK_IS_WINDOW(window) ||
        !GDK_IS_WAYLAND_DISPLAY(gtk_widget_get_display(window)) ||
        !gtk_widget_get_visual(window) ||
        gdk_visual_get_depth(gtk_widget_get_visual(window)) != 32 ||
        mpv_client_api_version() < MPV_MAKE_VERSION(2, 7))
        return 0;
    Probe p = { .window = window, .egl = EGL_NO_DISPLAY,
                .context = EGL_NO_CONTEXT, .target = EGL_NO_SURFACE };
    bool ok = discover_wayland(&p);
    release_native(&p);
    return ok;
}

__attribute__((visibility("default"))) int harbor_hdr_detach(void *token) {
    if (!token) return 1;
    Embedded *e = token;
    if (!release_native(&e->p)) return 0;
    if (e->draw_id) g_signal_handler_disconnect(e->p.window, e->draw_id);
    if (e->map_id) g_signal_handler_disconnect(e->p.window, e->map_id);
    webkit_web_view_set_background_color(e->web, &e->web_background);
    gtk_widget_set_app_paintable(GTK_WIDGET(e->web), e->web_paintable);
    gtk_widget_set_app_paintable(e->p.window, e->window_paintable);
    gtk_widget_queue_draw(e->p.window);
    g_object_unref(e->web);
    g_object_unref(e->p.window);
    g_free(e);
    return 1;
}

__attribute__((visibility("default"))) void *harbor_hdr_attach(
    GtkWidget *window, GtkWidget *web, mpv_handle *mpv) {
    if (!GTK_IS_WINDOW(window) || !WEBKIT_IS_WEB_VIEW(web) || !mpv ||
        !gtk_widget_get_realized(window) ||
        !GDK_IS_WAYLAND_DISPLAY(gtk_widget_get_display(window)) ||
        gdk_visual_get_depth(gtk_widget_get_visual(window)) != 32 ||
        mpv_client_api_version() < MPV_MAKE_VERSION(2, 7)) {
        fprintf(stderr, "[harbor::linux_hdr] needs realized RGBA Wayland window and libmpv 2.7+\n");
        return NULL;
    }
    Embedded *e = g_new0(Embedded, 1);
    Probe *p = &e->p;
    p->window = g_object_ref(window);
    p->mpv = mpv;
    p->egl = EGL_NO_DISPLAY;
    p->context = EGL_NO_CONTEXT;
    p->target = EGL_NO_SURFACE;
    e->web = g_object_ref(WEBKIT_WEB_VIEW(web));
    webkit_web_view_get_background_color(e->web, &e->web_background);
    e->window_paintable = gtk_widget_get_app_paintable(window);
    e->web_paintable = gtk_widget_get_app_paintable(web);

    /* Before installing render context or loading media, enforce matching
     * output transfer/primaries. No silent fallback to an SDR GLArea. */
    const char *options[][2] = {
        {"vo", "libmpv"}, {"hwdec", "no"}, {"target-trc", "pq"},
        {"target-prim", "bt.2020"}, {"target-colorspace-hint", "no"},
        {"target-peak", "1000"}, {"video-output-levels", "full"},
        {"dither-depth", "10"}, {"video-timing-offset", "0"}
    };
    for (size_t i = 0; i < G_N_ELEMENTS(options); ++i) {
        if (mpv_set_property_string(mpv, options[i][0], options[i][1]) < 0) {
            fprintf(stderr, "[harbor::linux_hdr] required option rejected: %s\n", options[i][0]);
            harbor_hdr_detach(e);
            return NULL;
        }
    }
    EGLenum api = eglQueryAPI();
    EGLDisplay display = eglGetCurrentDisplay();
    EGLContext context = eglGetCurrentContext();
    EGLSurface draw = eglGetCurrentSurface(EGL_DRAW), read = eglGetCurrentSurface(EGL_READ);
    bool ok = setup_wayland(p) && setup_egl(p) && setup_render(p);
    restore_context(api, display, context, draw, read, p->egl);
    if (!ok) {
        harbor_hdr_detach(e);
        return NULL;
    }
    GdkRGBA transparent = {0, 0, 0, 0};
    gtk_widget_set_app_paintable(window, TRUE);
    gtk_widget_set_app_paintable(web, TRUE);
    webkit_web_view_set_background_color(e->web, &transparent);
    e->draw_id = g_signal_connect(window, "draw", G_CALLBACK(clear_parent), NULL);
    e->map_id = g_signal_connect(window, "map-event", G_CALLBACK(remap), e);
    gtk_widget_queue_draw(window);
    p->timer = g_timeout_add(8, embedded_tick, e);
    fprintf(stderr, "[harbor::linux_hdr] embedded PQ/BT.2020 gpu-next attached\n");
    return e;
}
