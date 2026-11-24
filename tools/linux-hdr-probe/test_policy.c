#include "policy.h"
#include <assert.h>
int main(void) {
    assert(hdr_protocol_ready(true,true,true,true,true,true));
    assert(!hdr_protocol_ready(false,true,true,true,true,true));
    assert(!hdr_protocol_ready(true,false,true,true,true,true));
    assert(!hdr_protocol_ready(true,true,false,true,true,true));
    assert(!hdr_protocol_ready(true,true,true,false,true,true));
    assert(!hdr_protocol_ready(true,true,true,true,false,true));
    assert(!hdr_protocol_ready(true,true,true,true,true,false));
    assert(hdr_rgb10a2_format(10,10,10,2));
    assert(hdr_rgb10a2_format(10,10,10,0));
    assert(!hdr_rgb10a2_format(16,16,16,16));
    assert(!hdr_rgb10a2_format(10,8,10,2));
    assert(!hdr_rgb10a2_format(8,8,8,8));
    assert(!hdr_rgb10a2_format(10,10,10,8));
    int w = 0, h = 0;
    assert(hdr_dimensions(960,540,2,&w,&h) && w == 1920 && h == 1080);
    assert(!hdr_dimensions(0,540,1,&w,&h));
    assert(!hdr_dimensions(960,540,0,&w,&h));
    assert(!hdr_dimensions(INT_MAX,540,2,&w,&h));
    return 0;
}
