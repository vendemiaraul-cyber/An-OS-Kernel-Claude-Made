/* ConMon - kernel.c : kmain, boot sequence and system helpers */
#include "kernel.h"

#define MULTIBOOT_BOOTLOADER_MAGIC 0x2BADB002u

struct multiboot_info {
    uint32_t flags;
    uint32_t mem_lower;     /* KiB below 1 MiB  (flags bit 0) */
    uint32_t mem_upper;     /* KiB above 1 MiB  (flags bit 0) */
    /* ...remaining fields unused... */
};

extern char __kernel_end[];
static uint32_t total_mem_kb;

static void status(const char *what) {
    uint8_t old = vga_get_color();
    kputs("  [");
    vga_set_color(VGA_LIGHT_GREEN, VGA_BLACK);
    kputs(" OK ");
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
    kprintf("] %s\n", what);
    vga_set_color(old & 0x0F, old >> 4);
}

static void banner(void) {
    vga_set_color(VGA_LIGHT_CYAN, VGA_BLACK);
    kputs("\n");
    kputs("   ####   ####   #   #  #   #   ####   #   #\n");
    kputs("  #      #    #  ##  #  ## ##  #    #  ##  #\n");
    kputs("  #      #    #  # # #  # # #  #    #  # # #\n");
    kputs("  #      #    #  #  ##  #   #  #    #  #  ##\n");
    kputs("   ####   ####   #   #  #   #   ####   #   #\n\n");
    vga_set_color(VGA_WHITE, VGA_BLACK);
    kprintf("  %s %s  -  a tiny x86 operating system in C and C++\n\n",
            CONMON_NAME, CONMON_VERSION);
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
}

void kmain(uint32_t magic, struct multiboot_info *mbi) {
    serial_init();
    vga_init();
    banner();

    if (magic != MULTIBOOT_BOOTLOADER_MAGIC)
        kpanic("not booted by a Multiboot-compliant loader");

    if (mbi->flags & 1)
        total_mem_kb = 1024 + mbi->mem_upper;
    else
        total_mem_kb = 32 * 1024;           /* conservative guess */

    gdt_init();
    status("Global Descriptor Table");

    idt_init();
    status("Interrupts (IDT + 8259 PIC remapped to 32-47)");

    /* Heap starts right after the kernel image and gets up to 16 MiB,
     * never more than the RAM actually present. */
    uintptr_t heap_start = ((uintptr_t)__kernel_end + 0xFFF) & ~(uintptr_t)0xFFF;
    uintptr_t ram_end    = (uintptr_t)total_mem_kb * 1024;
    size_t heap_size     = 16u * 1024 * 1024;
    if (heap_start + heap_size > ram_end)
        heap_size = ram_end > heap_start + 0x10000 ? ram_end - heap_start : 0x10000;
    kheap_init(heap_start, heap_size);
    kprintf("  [");
    vga_set_color(VGA_LIGHT_GREEN, VGA_BLACK); kputs(" OK ");
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
    kprintf("] Kernel heap: %u KiB at %p\n", (uint32_t)(heap_size / 1024), (void *)heap_start);

    cxx_init();
    status("C++ runtime (global constructors)");

    timer_init();
    status("PIT timer at 100 Hz");

    keyboard_init();
    status("PS/2 keyboard");

    irq_enable();
    status("Interrupts enabled");

    kprintf("\n  Memory: %u MiB    Type 'help' to get started.\n\n", total_mem_kb / 1024);

    shell_main();                           /* C++ shell, never returns */
    kpanic("shell exited");
}

uint32_t sys_mem_kb(void) { return total_mem_kb; }

void sys_cpu_vendor(char out[13]) {
    uint32_t a, b, c, d;
    __asm__ volatile ("cpuid" : "=a"(a), "=b"(b), "=c"(c), "=d"(d) : "a"(0));
    memcpy(out, &b, 4);
    memcpy(out + 4, &d, 4);
    memcpy(out + 8, &c, 4);
    out[12] = 0;
}

void sys_reboot(void) {
    irq_disable();
    while (inb(0x64) & 2) {}                /* wait for input buffer empty */
    outb(0x64, 0xFE);                       /* pulse CPU reset line        */
    for (;;) cpu_halt();
}

void sys_halt(void) {
    kputs("\nSystem halted. It is now safe to turn off your computer.\n");
    outw(0x604, 0x2000);                    /* QEMU (q35/i440fx) power off */
    outw(0xB004, 0x2000);                   /* Bochs / older QEMU          */
    outw(0x4004, 0x3400);                   /* VirtualBox                  */
    irq_disable();
    for (;;) cpu_halt();
}

void kpanic(const char *msg) {
    irq_disable();
    vga_set_color(VGA_WHITE, VGA_RED);
    kprintf("\n KERNEL PANIC: %s \n", msg);
    for (;;) cpu_halt();
}
