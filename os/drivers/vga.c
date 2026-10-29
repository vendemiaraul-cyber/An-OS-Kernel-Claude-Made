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

void vga_init(void) {
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
    enable_cursor();
    vga_clear();
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
