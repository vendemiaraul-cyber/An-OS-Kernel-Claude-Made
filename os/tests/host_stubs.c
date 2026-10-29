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
