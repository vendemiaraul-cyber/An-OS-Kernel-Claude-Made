/* ConMon - idt.c : interrupt descriptor table, PIC remap and dispatch */
#include "kernel.h"

struct idt_entry {
    uint16_t base_low;
    uint16_t sel;
    uint8_t  zero;
    uint8_t  flags;
    uint16_t base_high;
} __attribute__((packed));

struct idt_ptr {
    uint16_t limit;
    uint32_t base;
} __attribute__((packed));

static struct idt_entry idt[256];
static struct idt_ptr   ip;
static irq_handler_t    irq_handlers[16];

extern void idt_load(struct idt_ptr *p);

#define DECL(n) extern void isr##n(void);
DECL(0) DECL(1) DECL(2) DECL(3) DECL(4) DECL(5) DECL(6) DECL(7)
DECL(8) DECL(9) DECL(10) DECL(11) DECL(12) DECL(13) DECL(14) DECL(15)
DECL(16) DECL(17) DECL(18) DECL(19) DECL(20) DECL(21) DECL(22) DECL(23)
DECL(24) DECL(25) DECL(26) DECL(27) DECL(28) DECL(29) DECL(30) DECL(31)
#undef DECL
#define DECL(n) extern void irq##n(void);
DECL(0) DECL(1) DECL(2) DECL(3) DECL(4) DECL(5) DECL(6) DECL(7)
DECL(8) DECL(9) DECL(10) DECL(11) DECL(12) DECL(13) DECL(14) DECL(15)
#undef DECL

static void (*const isr_table[32])(void) = {
    isr0, isr1, isr2, isr3, isr4, isr5, isr6, isr7,
    isr8, isr9, isr10, isr11, isr12, isr13, isr14, isr15,
    isr16, isr17, isr18, isr19, isr20, isr21, isr22, isr23,
    isr24, isr25, isr26, isr27, isr28, isr29, isr30, isr31,
};
static void (*const irq_table[16])(void) = {
    irq0, irq1, irq2, irq3, irq4, irq5, irq6, irq7,
    irq8, irq9, irq10, irq11, irq12, irq13, irq14, irq15,
};

static const char *const exception_names[32] = {
    "Division by zero", "Debug", "Non-maskable interrupt", "Breakpoint",
    "Overflow", "Bound range exceeded", "Invalid opcode", "Device not available",
    "Double fault", "Coprocessor segment overrun", "Invalid TSS",
    "Segment not present", "Stack-segment fault", "General protection fault",
    "Page fault", "Reserved", "x87 floating-point", "Alignment check",
    "Machine check", "SIMD floating-point", "Virtualization",
    "Control protection", "Reserved", "Reserved", "Reserved", "Reserved",
    "Reserved", "Reserved", "Hypervisor injection", "VMM communication",
    "Security", "Reserved",
};

static void set_gate(int n, void (*handler)(void)) {
    uint32_t base = (uint32_t)(uintptr_t)handler;
    idt[n].base_low  = base & 0xFFFF;
    idt[n].base_high = (base >> 16) & 0xFFFF;
    idt[n].sel       = 0x08;
    idt[n].zero      = 0;
    idt[n].flags     = 0x8E;            /* present, ring 0, 32-bit interrupt gate */
}

/* Move the 8259 PICs so IRQ 0-15 land on vectors 32-47 instead of
 * colliding with CPU exceptions. */
static void pic_remap(void) {
    uint8_t m1 = inb(0x21), m2 = inb(0xA1);
    outb(0x20, 0x11); io_wait();
    outb(0xA0, 0x11); io_wait();
    outb(0x21, 0x20); io_wait();        /* master offset 32 */
    outb(0xA1, 0x28); io_wait();        /* slave offset 40  */
    outb(0x21, 0x04); io_wait();        /* slave on IRQ2    */
    outb(0xA1, 0x02); io_wait();
    outb(0x21, 0x01); io_wait();        /* 8086 mode        */
    outb(0xA1, 0x01); io_wait();
    outb(0x21, m1);
    outb(0xA1, m2);
}

static void irq_unmask(int irq) {
    uint16_t port = irq < 8 ? 0x21 : 0xA1;
    if (irq >= 8) { irq -= 8; outb(0x21, inb(0x21) & ~(1 << 2)); }
    outb(port, inb(port) & ~(1 << irq));
}

void irq_install_handler(int irq, irq_handler_t handler) {
    if (irq < 0 || irq > 15) return;
    irq_handlers[irq] = handler;
    irq_unmask(irq);
}

void idt_init(void) {
    ip.limit = sizeof(idt) - 1;
    ip.base  = (uint32_t)(uintptr_t)&idt;
    memset(idt, 0, sizeof idt);

    pic_remap();
    outb(0x21, 0xFF);                   /* mask everything until a driver asks */
    outb(0xA1, 0xFF);

    for (int i = 0; i < 32; i++) set_gate(i, isr_table[i]);
    for (int i = 0; i < 16; i++) set_gate(32 + i, irq_table[i]);

    idt_load(&ip);
}

void isr_dispatch(struct regs *r) {
    if (r->int_no < 32) {
        uint32_t cr2;
        __asm__ volatile ("mov %%cr2, %0" : "=r"(cr2));
        vga_set_color(VGA_WHITE, VGA_RED);
        kprintf("\n *** CPU EXCEPTION %u: %s ***\n", r->int_no, exception_names[r->int_no]);
        kprintf(" err=%08x eip=%08x cs=%04x eflags=%08x cr2=%08x\n",
                r->err_code, r->eip, r->cs, r->eflags, cr2);
        kprintf(" eax=%08x ebx=%08x ecx=%08x edx=%08x\n", r->eax, r->ebx, r->ecx, r->edx);
        kpanic("unhandled exception");
    }

    int irq = (int)r->int_no - 32;
    if (irq >= 0 && irq < 16) {
        /* Ignore spurious IRQ7 / IRQ15 (in-service bit not set). */
        if (irq == 7 || irq == 15) {
            uint16_t cmd = irq == 7 ? 0x20 : 0xA0;
            outb(cmd, 0x0B);
            if (!(inb(cmd) & 0x80)) {
                if (irq == 15) outb(0x20, 0x20);
                return;
            }
        }
        if (irq_handlers[irq]) irq_handlers[irq](r);
        if (irq >= 8) outb(0xA0, 0x20);   /* EOI to slave  */
        outb(0x20, 0x20);                 /* EOI to master */
    }
}
