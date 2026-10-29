/* ConMon - timer.c : 8253/8254 PIT on IRQ0, plus PC speaker beeps */
#include "kernel.h"

#define PIT_BASE_HZ 1193182u
static volatile uint32_t ticks;

static void timer_irq(struct regs *r) {
    (void)r;
    ticks++;
}

void timer_init(void) {
    uint32_t divisor = PIT_BASE_HZ / TIMER_HZ;
    outb(0x43, 0x36);                       /* channel 0, lo/hi, mode 3 */
    outb(0x40, (uint8_t)(divisor & 0xFF));
    outb(0x40, (uint8_t)(divisor >> 8));
    irq_install_handler(0, timer_irq);
}

uint32_t timer_ticks(void) { return ticks; }

void timer_sleep(uint32_t ms) {
    uint32_t wait = (ms * TIMER_HZ + 999) / 1000;
    uint32_t end = ticks + wait;
    while ((int32_t)(end - ticks) > 0) cpu_halt();
}

void speaker_beep(uint32_t freq, uint32_t ms) {
    if (freq < 20) freq = 20;
    uint32_t div = PIT_BASE_HZ / freq;
    outb(0x43, 0xB6);                       /* channel 2, square wave */
    outb(0x42, (uint8_t)(div & 0xFF));
    outb(0x42, (uint8_t)(div >> 8));
    outb(0x61, inb(0x61) | 0x03);           /* gate speaker on  */
    timer_sleep(ms);
    outb(0x61, inb(0x61) & 0xFC);           /* gate speaker off */
}
