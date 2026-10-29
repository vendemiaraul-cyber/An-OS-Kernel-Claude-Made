/* ConMon - ext.c : runs extensions (.cmx). See include/conmon_ext.h.
 * The host has already written the image and its data file into memory;
 * this checks them, sets up the FPU, a stack and the API, and calls in. */
#include "kernel.h"
#include "conmon_ext.h"

static uint32_t crc32(const uint8_t *p, uint32_t n) {
    uint32_t c = 0xFFFFFFFFu;
    for (uint32_t i = 0; i < n; i++) {
        c ^= p[i];
        for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & -(c & 1));
    }
    return ~c;
}

static uint32_t api_ticks(void) { return timer_ticks() * (1000 / TIMER_HZ); }
static void api_idle(void) { cpu_halt(); }
static void api_log(const char *s) {
    if (vbe_active()) serial_write(s);
    else kputs(s);
}
static uint8_t *api_gfx_open(int w, int h, int bpp, int *pitch) { return vbe_set_mode(w, h, bpp, pitch); }
static void api_gfx_close(void) { vbe_text_mode(); }

static int call_on_stack(int (*fn)(struct conmon_api *), struct conmon_api *api, uint32_t stack_top) {
    int ret;
    __asm__ volatile (
        "mov %%esp, %%ebx\n\t"
        "mov %3, %%esp\n\t"
        "push %2\n\t"
        "call *%1\n\t"
        "mov %%ebx, %%esp\n\t"
        : "=a"(ret)
        : "r"(fn), "r"(api), "r"(stack_top)
        : "ebx", "ecx", "edx", "memory", "cc");
    return ret;
}

static void fpu_on(void) {
    uint32_t cr0;
    __asm__ volatile ("mov %%cr0, %0" : "=r"(cr0));
    cr0 &= ~((1u << 2) | (1u << 3));        /* EM off, TS off */
    cr0 |= (1u << 1) | (1u << 5);           /* MP, NE */
    __asm__ volatile ("mov %0, %%cr0; fninit" : : "r"(cr0));
}

static struct conmon_api api;

int ext_check(uint32_t data_size, char *err, int errlen) {
    const struct cmx_header *h = (const struct cmx_header *)CMX_LOAD_ADDR;
    if (h->magic != CMX_MAGIC) { ksnprintf(err, errlen, "no extension in memory"); return 0; }
    if (h->api_version != CMX_API_VERSION || h->load_addr != CMX_LOAD_ADDR) { ksnprintf(err, errlen, "extension built for another ConMon"); return 0; }
    if (h->image_size + h->bss_size > CMX_IMAGE_MAX || data_size > CMX_DATA_MAX) { ksnprintf(err, errlen, "extension too big"); return 0; }
    uint32_t want = h->crc32;
    struct cmx_header *w = (struct cmx_header *)CMX_LOAD_ADDR;
    w->crc32 = 0;
    uint32_t got = crc32((const uint8_t *)CMX_LOAD_ADDR, h->image_size);
    w->crc32 = want;
    if (got != want) { ksnprintf(err, errlen, "extension damaged (CRC %x, expected %x)", got, want); return 0; }
    return 1;
}

int ext_run(uint32_t data_size, const char *data_name, const char *args, uint32_t *frames, char *msg, int msglen) {
    const struct cmx_header *h = (const struct cmx_header *)CMX_LOAD_ADDR;
    uint32_t ram_end = sys_mem_kb() * 1024;
    uint32_t stack_top = (ram_end - 0x10000) & ~15u;
    memset((void *)(CMX_LOAD_ADDR + h->image_size), 0, h->bss_size);
    memset(&api, 0, sizeof api);
    api.version = CMX_API_VERSION;
    api.size = sizeof api;
    api.ticks_ms = api_ticks;
    api.idle = api_idle;
    api.scancode = keyboard_poll;
    api.log = api_log;
    api.gfx_open = api_gfx_open;
    api.gfx_palette = vga_set_palette256;
    api.gfx_close = api_gfx_close;
    api.heap = (void *)CMX_HEAP_ADDR;
    api.heap_size = stack_top - 0x80000 - CMX_HEAP_ADDR;     /* 512 KiB of stack above */
    api.data = (const uint8_t *)CMX_DATA_ADDR;
    api.data_size = data_size;
    api.data_name = data_name;
    api.args = args;
    fpu_on();
    keyboard_set_raw(1);
    int r = call_on_stack((int (*)(struct conmon_api *))(uintptr_t)h->entry, &api, stack_top);
    keyboard_set_raw(0);
    if (vbe_active()) vbe_text_mode();
    if (frames) *frames = api.frames;
    if (msg) { strncpy(msg, api.message, msglen - 1); msg[msglen - 1] = 0; }
    return r;
}
