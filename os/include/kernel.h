/* ConMon - kernel.h
 * Shared kernel API, usable from both C and C++. */
#ifndef CONMON_KERNEL_H
#define CONMON_KERNEL_H

#include <stdint.h>
#include <stddef.h>
#include <stdarg.h>

#ifdef __cplusplus
extern "C" {
#endif

#define CONMON_NAME    "ConMon"
#define CONMON_VERSION "0.1.0"

/* ---------- port I/O ---------- */
static inline void outb(uint16_t port, uint8_t val) {
    __asm__ volatile ("outb %0, %1" : : "a"(val), "Nd"(port));
}
static inline uint8_t inb(uint16_t port) {
    uint8_t r;
    __asm__ volatile ("inb %1, %0" : "=a"(r) : "Nd"(port));
    return r;
}
static inline void outw(uint16_t port, uint16_t val) {
    __asm__ volatile ("outw %0, %1" : : "a"(val), "Nd"(port));
}
static inline void io_wait(void) { outb(0x80, 0); }
#ifndef CONMON_HOST_TEST
static inline void cpu_halt(void) { __asm__ volatile ("hlt"); }
#else
void cpu_halt(void);                    /* host tests: a no-op stub */
#endif
static inline void irq_enable(void) { __asm__ volatile ("sti"); }
static inline void irq_disable(void) { __asm__ volatile ("cli"); }

/* ---------- strings / memory (lib/string.c) ---------- */
void  *memset(void *dst, int c, size_t n);
void  *memcpy(void *dst, const void *src, size_t n);
void  *memmove(void *dst, const void *src, size_t n);
int    memcmp(const void *a, const void *b, size_t n);
size_t strlen(const char *s);
int    strcmp(const char *a, const char *b);
int    strncmp(const char *a, const char *b, size_t n);
char  *strcpy(char *dst, const char *src);
char  *strncpy(char *dst, const char *src, size_t n);
int    atoi(const char *s);

/* ---------- VGA text console (drivers/vga.c) ---------- */
enum vga_color {
    VGA_BLACK, VGA_BLUE, VGA_GREEN, VGA_CYAN, VGA_RED, VGA_MAGENTA,
    VGA_BROWN, VGA_LIGHT_GREY, VGA_DARK_GREY, VGA_LIGHT_BLUE,
    VGA_LIGHT_GREEN, VGA_LIGHT_CYAN, VGA_LIGHT_RED, VGA_LIGHT_MAGENTA,
    VGA_YELLOW, VGA_WHITE
};
#define VGA_WIDTH  80
#define VGA_HEIGHT 25

void    vga_init(void);
void    vga_clear(void);
void    vga_putc(char c);
void    vga_write(const char *s);
void    vga_set_color(uint8_t fg, uint8_t bg);
uint8_t vga_get_color(void);
void    vga_put_at(char c, uint8_t color, int x, int y);
void    vga_cursor_visible(int on);
void    vga_disable_blink(void);        /* attribute bit 7 = bright background */

/* ---------- serial port COM1 (drivers/serial.c) ---------- */
void serial_init(void);
void serial_enable_rx(void);            /* interrupt-driven receive (IRQ4) */
int  serial_read(void);                 /* next received byte, or -1 */
int  serial_available(void);
void serial_putc(char c);               /* '\n' becomes "\r\n" */
void serial_putc_raw(char c);
void serial_write(const char *s);

/* ---------- host link over COM1 (kernel/hostlink.c) ---------- */
#define HOSTLINK_MAX 8192
struct hl_packet {
    char           type;                /* e.g. 'P' progress, 'T' text, 'F' frame */
    uint32_t       len;
    const uint8_t *data;                /* NUL-terminated, valid until next poll */
};
int  hostlink_poll(struct hl_packet *out);      /* 1 when a packet is ready */
void hostlink_send(const char *type, const char *payload);
void hostlink_reset(void);

/* ---------- formatted output (lib/kprintf.c) ---------- */
/* Supports %c %s %d %i %u %x %X %p %% with optional '-' (left align),
 * '0' pad and width. */
int  kvsnprintf(char *buf, size_t size, const char *fmt, va_list ap);
int  ksnprintf(char *buf, size_t size, const char *fmt, ...);
void kprintf(const char *fmt, ...);
void kputs(const char *s);              /* console + serial */
void kputc(char c);

/* ---------- CPU tables (cpu/gdt.c, cpu/idt.c) ---------- */
struct regs {
    uint32_t gs, fs, es, ds;
    uint32_t edi, esi, ebp, esp_dummy, ebx, edx, ecx, eax;
    uint32_t int_no, err_code;
    uint32_t eip, cs, eflags, useresp, ss;
};
typedef void (*irq_handler_t)(struct regs *r);

void gdt_init(void);
void idt_init(void);
void irq_install_handler(int irq, irq_handler_t handler);

/* ---------- PIT timer (drivers/timer.c) ---------- */
#define TIMER_HZ 100
void     timer_init(void);
uint32_t timer_ticks(void);
void     timer_sleep(uint32_t ms);
void     speaker_beep(uint32_t freq, uint32_t ms);

/* ---------- PS/2 keyboard (drivers/keyboard.c) ---------- */
/* Special keys come back as values >= 0x80. */
#define KEY_UP    0x80
#define KEY_DOWN  0x81
#define KEY_LEFT  0x82
#define KEY_RIGHT 0x83
void keyboard_init(void);
int  keyboard_getchar(void);            /* blocks until a key is pressed */
int  keyboard_poll(void);               /* -1 if no key waiting */

/* ---------- kernel heap (mm/kheap.c) ---------- */
void   kheap_init(uintptr_t start, size_t size);
void  *kmalloc(size_t size);
void  *kcalloc(size_t n, size_t size);
void   kfree(void *ptr);
size_t kheap_total(void);
size_t kheap_used(void);
size_t kheap_blocks(void);

/* ---------- misc system (kernel/kernel.c) ---------- */
uint32_t sys_mem_kb(void);              /* RAM reported by the bootloader */
void     sys_cpu_vendor(char out[13]);
void     sys_reboot(void);
void     sys_halt(void);
void     kpanic(const char *msg);

/* ---------- C++ runtime + shell (shell directory) ---------- */
void cxx_init(void);                    /* run global constructors */
void shell_main(void);

#ifdef __cplusplus
}
#endif

#endif
