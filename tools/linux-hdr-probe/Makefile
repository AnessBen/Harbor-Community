CC ?= cc
PKGS = gtk+-3.0 gdk-wayland-3.0 webkit2gtk-4.1 wayland-client wayland-egl egl gl mpv
PROTOCOL_DIR ?= $(shell pkg-config --variable=pkgdatadir wayland-protocols)
COLOR_XML ?= $(PROTOCOL_DIR)/staging/color-management/color-management-v1.xml
CFLAGS ?= -O2 -g
.PHONY: all check clean
all: harbor-linux-hdr-probe
color-management-v1-client-protocol.h: $(COLOR_XML)
	wayland-scanner client-header $< $@
color-management-v1-protocol.c: $(COLOR_XML)
	wayland-scanner private-code $< $@
harbor-linux-hdr-probe: main.c policy.h color-management-v1-client-protocol.h color-management-v1-protocol.c
	$(CC) $(CFLAGS) -std=c11 -Wall -Wextra $(shell pkg-config --cflags $(PKGS)) main.c color-management-v1-protocol.c -o $@ $(shell pkg-config --libs $(PKGS)) -ldl
test_policy: test_policy.c policy.h
	$(CC) $(CFLAGS) -std=c11 -Wall -Wextra -Werror test_policy.c -o $@
check: test_policy
	./test_policy
clean:
	rm -f harbor-linux-hdr-probe test_policy color-management-v1-client-protocol.h color-management-v1-protocol.c
