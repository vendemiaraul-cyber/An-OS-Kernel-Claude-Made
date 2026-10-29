/* ConMon - conmon_ext.h : the interface between ConMon and an extension.
 *
 * An extension (.cmx) is a flat 32-bit binary linked to run at a fixed
 * address. It starts with struct cmx_header. ConMon checks the header and
 * its CRC-32, clears the bss, gives the extension its own stack and calls
 * entry(api) in ring 0. When entry returns, ConMon takes the screen back.
 *
 * Memory map while an extension runs (needs 48 MiB of RAM or more):
 *   CMX_LOAD_ADDR  20 MiB   extension image, then its bss
 *   CMX_DATA_ADDR  22 MiB   data file the host sent with it (e.g. a WAD)
 *   CMX_HEAP_ADDR  30 MiB   heap + stack, up to the end of RAM
 *
 * This header is shared by ConMon (C) and the extension libc (ext/). */
#ifndef CONMON_EXT_H
#define CONMON_EXT_H

#include <stdint.h>

#define CMX_MAGIC        0x31584D43u    /* "CMX1" */
#define CMX_API_VERSION  1
#define CMX_LOAD_ADDR    0x01400000u
#define CMX_IMAGE_MAX    0x00200000u    /* 2 MiB, image + bss */
#define CMX_DATA_ADDR    0x01600000u
#define CMX_DATA_MAX     0x00800000u    /* 8 MiB */
#define CMX_HEAP_ADDR    0x01E00000u
#define CMX_MIN_RAM_KB   (48u * 1024)

struct cmx_header {
    uint32_t magic;             /* CMX_MAGIC */
    uint32_t api_version;       /* CMX_API_VERSION it was built for */
    uint32_t load_addr;         /* must be CMX_LOAD_ADDR */
    uint32_t image_size;        /* bytes in the file, header included */
    uint32_t bss_size;          /* zeroed bytes right after the image */
    uint32_t entry;             /* int entry(struct conmon_api *) */
    uint32_t crc32;             /* of the image with this field set to 0 */
    char     name[16];
};

struct conmon_api {
    uint32_t version, size;
    /* time and input */
    uint32_t (*ticks_ms)(void);             /* milliseconds since boot (10 ms steps) */
    void     (*idle)(void);                 /* sleep until the next interrupt */
    int      (*scancode)(void);             /* next raw set-1 scancode, or -1 */
    /* text output: the console before graphics start, the serial port always */
    void     (*log)(const char *text);
    /* graphics (Bochs/QEMU/v86 VBE) */
    uint8_t *(*gfx_open)(int width, int height, int bpp, int *pitch);
    void     (*gfx_palette)(const uint8_t *rgb, int first, int count);  /* 8-bit r,g,b */
    void     (*gfx_close)(void);
    /* memory and the data file */
    void          *heap;
    uint32_t       heap_size;
    const uint8_t *data;
    uint32_t       data_size;
    const char    *data_name;               /* e.g. "doom1.wad" */
    const char    *args;                    /* the rest of the command line */
    /* filled in by the extension for ConMon to report */
    uint32_t       frames;
    char           message[160];
};

#endif
