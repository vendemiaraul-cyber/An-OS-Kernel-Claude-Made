/* ConMon - host_stubs.c
 * Fake "hardware" so the portable kernel code (printf, heap, C++ shell,
 * RAM filesystem, calculator) can be run and tested as a normal Linux
 * program. Screen output is captured into a buffer; keyboard input comes
 * from a scripted string. Built only by `make test`. */
#include "kernel.h"
#include <stdio.h>
#include <stdlib.h>
#include <setjmp.h>

char     test_out[1 << 16];
size_t   test_out_len;
const char *test_keys;          /* scripted keyboard input */
jmp_buf  test_done;             /* jumped to when input runs out */
int      test_panicked;
uint32_t test_ticks;

static uint8_t color = 0x07;

void vga_putc(char c) {
    if (c == '\b') { if (test_out_len) test_out_len--; return; }
    if (test_out_len + 1 < sizeof test_out) test_out[test_out_len++] = c;
    test_out[test_out_len] = 0;
}
void vga_clear(void) { test_out_len = 0; test_out[0] = 0; }
void vga_set_color(uint8_t fg, uint8_t bg) { color = (uint8_t)(fg | (bg << 4)); }
uint8_t vga_get_color(void) { return color; }
void serial_putc(char c) { (void)c; }

uint32_t timer_ticks(void) { return test_ticks += 7; }
void timer_sleep(uint32_t ms) { test_ticks += ms / 10; }
void speaker_beep(uint32_t f, uint32_t ms) { (void)f; (void)ms; }

int keyboard_poll(void) {           /* never -1: the shell would execute hlt */
    if (!test_keys || !*test_keys) longjmp(test_done, 1);
    return (unsigned char)*test_keys++;
}
int keyboard_peek(void) {
    if (!test_keys || !*test_keys) longjmp(test_done, 1);
    return (unsigned char)*test_keys;
}
int serial_read(void) { return -1; }
void cpu_halt(void) {}
int serial_available(void) { return 0; }
void serial_putc_raw(char c) { (void)c; }
void vga_put_at(char c, uint8_t col, int x, int y) { (void)c; (void)col; (void)x; (void)y; }
void vga_cursor_visible(int on) { (void)on; }
void vga_set_cursor(int x, int y) { (void)x; (void)y; }

int keyboard_getchar(void) {
    if (!test_keys || !*test_keys) longjmp(test_done, 1);
    return (unsigned char)*test_keys++;
}

uint32_t sys_mem_kb(void) { return 65536; }
void sys_cpu_vendor(char out[13]) { memcpy(out, "HostTestCPU!", 13); }
void sys_reboot(void) { longjmp(test_done, 2); }
void sys_halt(void)   { longjmp(test_done, 3); }
void kpanic(const char *msg) {
    test_panicked = 1;
    fprintf(stderr, "kpanic: %s\n", msg);
    longjmp(test_done, 4);
}
