/* ConMon - vbe.c : Bochs/QEMU/v86 VBE graphics ("DISPI") with a linear
 * framebuffer, plus the 256-colour VGA DAC. Text mode comes back intact
 * when VBE is switched off, because VBE draws into separate video memory. */
#include "kernel.h"

#define VBE_INDEX 0x1CE
#define VBE_DATA  0x1CF
enum { VBE_ID, VBE_XRES, VBE_YRES, VBE_BPP, VBE_ENABLE, VBE_BANK, VBE_VIRT_W, VBE_VIRT_H, VBE_X_OFF, VBE_Y_OFF };
#define VBE_ENABLED 0x01
#define VBE_LFB     0x40

static uint16_t inw_(uint16_t port) { uint16_t r; __asm__ volatile ("inw %1, %0" : "=a"(r) : "Nd"(port)); return r; }
static void vbe_write(int reg, uint16_t v) { outw(VBE_INDEX, (uint16_t)reg); outw(VBE_DATA, v); }
static uint16_t vbe_read(int reg) { outw(VBE_INDEX, (uint16_t)reg); return inw_(VBE_DATA); }

static uint32_t pci_read(int bus, int dev, int fn, int off) {
    uint32_t addr = 0x80000000u | (bus << 16) | (dev << 11) | (fn << 8) | (off & 0xFC);
    __asm__ volatile ("outl %0, %1" : : "a"(addr), "Nd"((uint16_t)0xCF8));
    uint32_t v;
    __asm__ volatile ("inl %1, %0" : "=a"(v) : "Nd"((uint16_t)0xCFC));
    return v;
}

/* The framebuffer is BAR0 of the 1234:1111 display device. */
static uint32_t find_lfb(void) {
    for (int dev = 0; dev < 32; dev++) {
        if (pci_read(0, dev, 0, 0) == 0x11111234u)
            return pci_read(0, dev, 0, 0x10) & 0xFFFFFFF0u;
    }
    return 0xE0000000u;                     /* the usual Bochs address */
}

static int active;

int vbe_available(void) {
    uint16_t id = vbe_read(VBE_ID);
    return id >= 0xB0C0 && id <= 0xB0C5;
}

uint8_t *vbe_set_mode(int w, int h, int bpp, int *pitch) {
    if (!vbe_available()) return 0;
    vbe_write(VBE_ENABLE, 0);
    vbe_write(VBE_XRES, (uint16_t)w);
    vbe_write(VBE_YRES, (uint16_t)h);
    vbe_write(VBE_BPP, (uint16_t)bpp);
    vbe_write(VBE_VIRT_W, (uint16_t)w);
    vbe_write(VBE_X_OFF, 0);
    vbe_write(VBE_Y_OFF, 0);
    vbe_write(VBE_ENABLE, VBE_ENABLED | VBE_LFB);
    if (vbe_read(VBE_XRES) != w || vbe_read(VBE_YRES) != h) { vbe_text_mode(); return 0; }
    active = 1;
    if (pitch) *pitch = w * ((bpp + 7) / 8);
    return (uint8_t *)(uintptr_t)find_lfb();
}

void vbe_text_mode(void) {
    vbe_write(VBE_ENABLE, 0);
    active = 0;
    vga_reset_palette();
}

int vbe_active(void) { return active; }

void vga_set_palette256(const uint8_t *rgb, int first, int count) {
    outb(0x3C8, (uint8_t)first);
    for (int i = 0; i < count * 3; i++) outb(0x3C9, rgb[i] >> 2);
}
