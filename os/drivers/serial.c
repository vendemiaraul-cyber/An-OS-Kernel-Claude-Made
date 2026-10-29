/* ConMon - serial.c : COM1 output and interrupt-driven input.
 * Output mirrors the console (run QEMU with -serial stdio to see it).
 * Input lands in a ring buffer; ConMon Lab uses it as the host link. */
#include "kernel.h"

#define COM1     0x3F8
#define RX_SIZE  32768u                 /* power of two */

static int serial_ok;
static volatile uint8_t  rx_buf[RX_SIZE];
static volatile uint32_t rx_head, rx_tail;

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
    outb(COM1 + 4, 0x0F);   /* normal mode, OUT2 on so the IRQ reaches the PIC */
}

/* Move everything the UART has into the ring buffer. */
static void drain_uart(void) {
    while (inb(COM1 + 5) & 0x01) {
        uint8_t b = inb(COM1);
        uint32_t next = (rx_head + 1) & (RX_SIZE - 1);
        if (next == rx_tail) continue;  /* full: drop byte */
        rx_buf[rx_head] = b;
        rx_head = next;
    }
}

static void serial_irq(struct regs *r) {
    (void)r;
    drain_uart();
}

void serial_enable_rx(void) {
    if (!serial_ok) return;
    irq_install_handler(4, serial_irq);
    outb(COM1 + 1, 0x01);               /* interrupt on received data */
    drain_uart();
}

int serial_read(void) {
    if (!serial_ok) return -1;
    if (rx_head == rx_tail) {
        /* Also poll, in case an interrupt was missed. */
        irq_disable();
        drain_uart();
        irq_enable();
        if (rx_head == rx_tail) return -1;
    }
    uint8_t b = rx_buf[rx_tail];
    rx_tail = (rx_tail + 1) & (RX_SIZE - 1);
    return b;
}

int serial_available(void) {
    return serial_ok && rx_head != rx_tail;
}

void serial_putc_raw(char c) {
    if (!serial_ok) return;
    for (int spin = 0; spin < 100000 && !(inb(COM1 + 5) & 0x20); spin++) {}
    outb(COM1, (uint8_t)c);
}

void serial_putc(char c) {
    if (c == '\n') serial_putc_raw('\r');
    serial_putc_raw(c);
}

void serial_write(const char *s) {
    while (*s) serial_putc(*s++);
}
