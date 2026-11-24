#include <mpv/client.h>
#include <dlfcn.h>
#include <stdio.h>

int main(int argc, char **argv) {
    unsigned long version = mpv_client_api_version();
    if (argc != 2 || version < MPV_MAKE_VERSION(2, 7)) {
        fprintf(stderr, "libmpv API 2.7+ and renderer path required (loaded %lu.%lu)\n",
                version >> 16, version & 65535);
        return 1;
    }
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!library) {
        fprintf(stderr, "%s\n", dlerror());
        return 1;
    }
    unsigned (*abi)(void) = (unsigned (*)(void))dlsym(library, "harbor_hdr_abi");
    int ok = abi && abi() == 1 &&
        dlsym(library, "harbor_hdr_attach") && dlsym(library, "harbor_hdr_detach") && dlsym(library, "harbor_hdr_supported") &&
        dlsym(library, "mpv_client_api_version") == (void *)mpv_client_api_version;
    dlclose(library);
    if (!ok) {
        fprintf(stderr, "Renderer ABI or libmpv instance mismatch\n");
        return 1;
    }
    printf("Native HDR ABI 1 / libmpv API %lu.%lu verified\n", version >> 16, version & 65535);
    return 0;
}
