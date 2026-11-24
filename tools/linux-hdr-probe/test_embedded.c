#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <mpv/client.h>
#include <dlfcn.h>
#include <locale.h>
#include <stdio.h>
#include <stdbool.h>

static GtkWidget *window, *web;
static mpv_handle *mpv;
static void *token;
static void *(*attach)(GtkWidget *, GtkWidget *, mpv_handle *);
static int (*detach)(void *);
static int (*supported)(GtkWidget *);
static const char *path;
static int cycle, stage, polls, status=1;
static double pos;
static int paused;
static GdkRGBA original;

static gboolean step(gpointer data) {
    (void)data;
    if (++polls > 60) { fprintf(stderr,"SMOKE timeout stage=%d\n",stage); gtk_main_quit(); return G_SOURCE_REMOVE; }
    if (!mpv) {
        ++cycle; stage=1; polls=0; pos=0; paused=0;
        setlocale(LC_NUMERIC,"C");
        mpv=mpv_create();
        if(!mpv || mpv_set_option_string(mpv,"config","no")<0 || mpv_initialize(mpv)<0) goto fail;
        if (!supported(window)) goto fail;
        token=attach(window,web,mpv);
        if(!token) goto fail;
        mpv_observe_property(mpv,10,"time-pos",MPV_FORMAT_DOUBLE);
        mpv_observe_property(mpv,11,"pause",MPV_FORMAT_FLAG);
        const char *cmd[]={"loadfile",path,"replace",NULL};
        if(mpv_command_async(mpv,1,cmd)<0) goto fail;
        return G_SOURCE_CONTINUE;
    }
    for (;;) {
        mpv_event *event=mpv_wait_event(mpv,0);
        if(event->event_id==MPV_EVENT_NONE) break;
        if(event->event_id==MPV_EVENT_PROPERTY_CHANGE) {
            mpv_event_property *prop=event->data;
            if(prop->format==MPV_FORMAT_DOUBLE && !strcmp(prop->name,"time-pos"))pos=*(double*)prop->data;
            if(prop->format==MPV_FORMAT_FLAG && !strcmp(prop->name,"pause"))paused=*(int*)prop->data;
        }
        if(event->event_id==MPV_EVENT_END_FILE && ((mpv_event_end_file*)event->data)->reason==MPV_END_FILE_REASON_ERROR) goto fail;
    }
    if(stage==1 && pos>.25) {
        fprintf(stderr,"SMOKE PASS session %d host event queue pos %.2f\n",cycle,pos);
        const char *cmd[]={"set","pause","yes",NULL};mpv_command_async(mpv,2,cmd);stage=2;
    } else if(stage==2 && paused) {
        const char *cmd[]={"seek","5","absolute+exact",NULL};mpv_command_async(mpv,3,cmd);stage=3;
    } else if(stage==3 && pos>4.8 && pos<5.2) {
        fprintf(stderr,"SMOKE PASS session %d pause/seek %.2f\n",cycle,pos);
        if(!detach(token))goto fail;
        token=NULL;
        GdkRGBA now;webkit_web_view_get_background_color(WEBKIT_WEB_VIEW(web),&now);
        if(!gdk_rgba_equal(&now,&original))goto fail;
        fprintf(stderr,"SMOKE PASS session %d detach and restore WebKit\n",cycle);
        mpv_terminate_destroy(mpv);mpv=NULL;
        if(cycle==2){status=0;gtk_main_quit();return G_SOURCE_REMOVE;}
    }
    return G_SOURCE_CONTINUE;
fail:
    fprintf(stderr,"SMOKE FAIL session=%d stage=%d\n",cycle,stage); gtk_main_quit();return G_SOURCE_REMOVE;
}
static void loaded(WebKitWebView *v,WebKitLoadEvent e,gpointer d){
    (void)v;(void)d;
    if(e==WEBKIT_LOAD_FINISHED){
        fprintf(stderr,"SMOKE existing WebKit loaded; visual depth %d\n",gdk_visual_get_depth(gtk_widget_get_visual(window)));
        g_timeout_add(250,step,NULL);
    }
}
static gboolean stop(gpointer d){(void)d;gtk_main_quit();return G_SOURCE_REMOVE;}
int main(int argc,char **argv){
    if(argc!=2)return 2;
    path=argv[1];
    void *lib=dlopen("./libharbor-linux-hdr.so",RTLD_NOW|RTLD_LOCAL);
    if(!lib){fprintf(stderr,"%s\n",dlerror());return 2;}
    attach=dlsym(lib,"harbor_hdr_attach");detach=dlsym(lib,"harbor_hdr_detach");
    supported=dlsym(lib,"harbor_hdr_supported");
    if(!attach||!detach||!supported)return 2;
    gtk_init(NULL,NULL);
    window=gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_default_size(GTK_WINDOW(window),960,540);
    web=webkit_web_view_new();
    gtk_container_add(GTK_CONTAINER(window),web);
    webkit_web_view_get_background_color(WEBKIT_WEB_VIEW(web),&original);
    g_signal_connect(web,"load-changed",G_CALLBACK(loaded),NULL);
    gtk_widget_show_all(window);
    webkit_web_view_load_html(WEBKIT_WEB_VIEW(web),"<html><body style='background:transparent'>Existing WebKit host</body></html>",NULL);
    g_timeout_add_seconds(35,stop,NULL);
    gtk_main();
    if(token&&!detach(token))return 1;
    if(mpv)mpv_terminate_destroy(mpv);
    gtk_widget_destroy(window);dlclose(lib);
    return status;
}
