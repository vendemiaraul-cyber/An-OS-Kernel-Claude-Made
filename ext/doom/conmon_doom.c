/* DOOM for ConMon: the doomgeneric platform layer.
 * 320x200, 256 colours through ConMon's VBE driver; keys are raw PS/2
 * scancodes from ConMon's keyboard driver. F12 goes back to ConMon.
 * GPL-2.0, like doomgeneric. */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "doomkeys.h"
#include "doomgeneric.h"
#include "conmon_ext.h"
#include "../libc/cmx.h"

struct color { uint32_t b:8, g:8, r:8, a:8; };
extern struct color colors[256];
extern int palette_changed;            /* boolean in i_video.c */

static uint8_t *fb;
static int pitch;

void DG_Init(void) {
    fb = cmx_api->gfx_open(DOOMGENERIC_RESX, DOOMGENERIC_RESY, 8, &pitch);
    if (!fb) {
        fprintf(stderr, "No VBE graphics card found.\n");
        exit(1);
    }
}

void DG_DrawFrame(void) {
    if (palette_changed) {
        uint8_t rgb[768];
        for (int i = 0; i < 256; i++) { rgb[i * 3] = colors[i].r; rgb[i * 3 + 1] = colors[i].g; rgb[i * 3 + 2] = colors[i].b; }
        cmx_api->gfx_palette(rgb, 0, 256);
        palette_changed = 0;
    }
    const uint8_t *src = DG_ScreenBuffer;
    for (int y = 0; y < DOOMGENERIC_RESY; y++)
        memcpy(fb + y * pitch, src + y * DOOMGENERIC_RESX, DOOMGENERIC_RESX);
    cmx_api->frames++;
}

void DG_SleepMs(uint32_t ms) {
    uint32_t end = cmx_api->ticks_ms() + ms;
    while ((int32_t)(end - cmx_api->ticks_ms()) > 0) cmx_api->idle();
}

uint32_t DG_GetTicksMs(void) { return cmx_api->ticks_ms(); }

void DG_SetWindowTitle(const char *title) { (void)title; }

static unsigned char key_for(int sc, int ext) {
    if (ext) {
        switch (sc) {
        case 0x48: return KEY_UPARROW;   case 0x50: return KEY_DOWNARROW;
        case 0x4B: return KEY_LEFTARROW; case 0x4D: return KEY_RIGHTARROW;
        case 0x1D: return KEY_FIRE;      case 0x38: return KEY_RALT;
        case 0x1C: return KEY_ENTER;     case 0x47: return KEY_HOME;
        case 0x4F: return KEY_END;       case 0x49: return KEY_PGUP;
        case 0x51: return KEY_PGDN;      case 0x52: return KEY_INS;
        case 0x53: return KEY_DEL;
        default: return 0;
        }
    }
    static const char chars[0x3A] = {
        0, 0, '1','2','3','4','5','6','7','8','9','0','-','=', 0, 0,
        'q','w','e','r','t','y','u','i','o','p','[',']', 0, 0,
        'a','s','d','f','g','h','j','k','l',';','\'','`', 0, '\\',
        'z','x','c','v','b','n','m', 0, 0, '/', 0, '*', 0, ' ' };
    switch (sc) {
    case 0x01: return KEY_ESCAPE;   case 0x0E: return KEY_BACKSPACE;
    case 0x0F: return KEY_TAB;      case 0x1C: return KEY_ENTER;
    case 0x1D: return KEY_FIRE;     case 0x39: return KEY_USE;
    case 0x2A: case 0x36: return KEY_RSHIFT;
    case 0x38: return KEY_RALT;
    case 0x33: return KEY_STRAFE_L; case 0x34: return KEY_STRAFE_R;
    case 0x48: return KEY_UPARROW;  case 0x50: return KEY_DOWNARROW;   /* keypad */
    case 0x4B: return KEY_LEFTARROW; case 0x4D: return KEY_RIGHTARROW;
    case 0x57: return KEY_F11;
    }
    if (sc >= 0x3B && sc <= 0x44) return KEY_F1 + (sc - 0x3B);
    if (sc < 0x3A && chars[sc]) return (unsigned char)chars[sc];
    return 0;
}

int DG_GetKey(int *pressed, unsigned char *key) {
    static int ext;
    for (;;) {
        int sc = cmx_api->scancode();
        if (sc < 0) return 0;
        if (sc == 0xE0) { ext = 1; continue; }
        int down = !(sc & 0x80), code = sc & 0x7F, e = ext;
        ext = 0;
        if (code == 0x58 && !e) {          /* F12: back to ConMon */
            if (down) exit(0);
            continue;
        }
        unsigned char k = key_for(code, e);
        if (!k) continue;
        *pressed = down;
        *key = k;
        return 1;
    }
}

int main(int argc, char **argv) {
    char *args[] = { argv[0], "-iwad", (char *)cmx_api->data_name, NULL };
    (void)argc;
    doomgeneric_Create(3, args);
    for (;;) doomgeneric_Tick();
}
