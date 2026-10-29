/* ConMon - serial.c : COM1 output (run QEMU with -serial stdio to see it) */
#include "kernel.h"

#define COM1 0x3F8
static int serial_ok;

void serial_init(void) {
    outb(COM1 + 1, 0x00);   /* disable interrupts            */
    outb(COM1 + 3, 0x80);   /* enable DLAB                   */
    outb(COM1 + 0, 0x03);   /* divisor 3 -> 38400 baud       */
    outb(COM1 + 1, 0x00);
    outb(COM1 + 3, 0x03);   /* 8 bits, no parity, 1 stop bit */
    outb(COM1 + 2, 0xC7);   /* FIFO on, clear, 14-byte level */
    outb(COM1 + 4, 0x0B);   /* RTS/DSR set                   */

    /* Loopback self-test: if no UART answers, stay silent. */
    outb(COM1 + 4, 0x1E);
    outb(COM1 + 0, 0xAE);
    serial_ok = (inb(COM1 + 0) == 0xAE);
    outb(COM1 + 4, 0x0F);
}

void serial_putc(char c) {
    if (!serial_ok) return;
    if (c == '\n') serial_putc('\r');
    for (int spin = 0; spin < 100000 && !(inb(COM1 + 5) & 0x20); spin++) {}
    outb(COM1, (uint8_t)c);
}

void serial_write(const char *s) {
    while (*s) serial_putc(*s++);
}
