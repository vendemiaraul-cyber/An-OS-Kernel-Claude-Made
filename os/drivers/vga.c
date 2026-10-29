/* ConMon - vga.c : 80x25 VGA text-mode console with scrolling */
#include "kernel.h"

static volatile uint16_t *const VGA = (volatile uint16_t *)0xB8000;
static int cx, cy;
static uint8_t color;

static inline uint16_t cell(char c, uint8_t col) {
    return (uint16_t)(uint8_t)c | ((uint16_t)col << 8);
}

static void move_cursor(void) {
    uint16_t pos = (uint16_t)(cy * VGA_WIDTH + cx);
    outb(0x3D4, 0x0F); outb(0x3D5, (uint8_t)(pos & 0xFF));
    outb(0x3D4, 0x0E); outb(0x3D5, (uint8_t)(pos >> 8));
}

static void enable_cursor(void) {
    outb(0x3D4, 0x0A); outb(0x3D5, (inb(0x3D5) & 0xC0) | 13);
    outb(0x3D4, 0x0B); outb(0x3D5, (inb(0x3D5) & 0xE0) | 15);
}

static void scroll(void) {
    for (int i = 0; i < (VGA_HEIGHT - 1) * VGA_WIDTH; i++)
        VGA[i] = VGA[i + VGA_WIDTH];
    for (int x = 0; x < VGA_WIDTH; x++)
        VGA[(VGA_HEIGHT - 1) * VGA_WIDTH + x] = cell(' ', color);
    cy = VGA_HEIGHT - 1;
}

void vga_set_color(uint8_t fg, uint8_t bg) { color = (uint8_t)(fg | (bg << 4)); }
uint8_t vga_get_color(void) { return color; }

void vga_clear(void) {
    for (int i = 0; i < VGA_WIDTH * VGA_HEIGHT; i++) VGA[i] = cell(' ', color);
    cx = cy = 0;
    move_cursor();
}

void vga_cursor_visible(int on) {
    outb(0x3D4, 0x0A);
    uint8_t v = inb(0x3D5);
    outb(0x3D5, on ? (v & ~0x20) : (v | 0x20));
}

/* Attribute controller register 0x10, bit 3: 1 = blink, 0 = 16 background
 * colours. ConMon never blinks, and the MP4 player wants all 16. */
void vga_disable_blink(void) {
    inb(0x3DA);                         /* reset the address/data flip-flop */
    outb(0x3C0, 0x30);                  /* index 0x10, keep palette enabled */
    uint8_t mode = inb(0x3C1);
    outb(0x3C0, mode & ~0x08);
}

void vga_init(void) {
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
    enable_cursor();
    vga_disable_blink();
    vga_clear();
}

/* Text mode colours 0-15 go through the attribute controller to these DAC
 * entries (the standard EGA mapping), so reprogramming them recolours the
 * whole screen. Values are 6-bit (0-63) RGB triples. */
static const uint8_t dac_index[16] = { 0, 1, 2, 3, 4, 5, 20, 7, 56, 57, 58, 59, 60, 61, 62, 63 };
static const uint8_t default_rgb[48] = {
     0, 0, 0,   0, 0,42,   0,42, 0,   0,42,42,  42, 0, 0,  42, 0,42,  42,21, 0,  42,42,42,
    21,21,21,  21,21,63,  21,63,21,  21,63,63,  63,21,21,  63,21,63,  63,63,21,  63,63,63,
};

void vga_set_palette16(const uint8_t *rgb) {
    for (int i = 0; i < 16; i++) {
        outb(0x3C8, dac_index[i]);
        outb(0x3C9, rgb[i * 3] & 63);
        outb(0x3C9, rgb[i * 3 + 1] & 63);
        outb(0x3C9, rgb[i * 3 + 2] & 63);
    }
}

void vga_reset_palette(void) { vga_set_palette16(default_rgb); }

void vga_set_cursor(int x, int y) {
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x >= VGA_WIDTH) x = VGA_WIDTH - 1;
    if (y >= VGA_HEIGHT) y = VGA_HEIGHT - 1;
    cx = x; cy = y;
    move_cursor();
}

void vga_put_at(char c, uint8_t col, int x, int y) {
    if (x >= 0 && x < VGA_WIDTH && y >= 0 && y < VGA_HEIGHT)
        VGA[y * VGA_WIDTH + x] = cell(c, col);
}

void vga_putc(char c) {
    switch (c) {
    case '\n': cx = 0; cy++; break;
    case '\r': cx = 0; break;
    case '\t': cx = (cx + 4) & ~3; break;
    case '\b':
        if (cx > 0) cx--;
        else if (cy > 0) { cy--; cx = VGA_WIDTH - 1; }
        VGA[cy * VGA_WIDTH + cx] = cell(' ', color);
        break;
    default:
        VGA[cy * VGA_WIDTH + cx] = cell(c, color);
        cx++;
    }
    if (cx >= VGA_WIDTH) { cx = 0; cy++; }
    if (cy >= VGA_HEIGHT) scroll();
    move_cursor();
}

void vga_write(const char *s) {
    while (*s) vga_putc(*s++);
}
