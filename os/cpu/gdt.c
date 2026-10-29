/* ConMon - gdt.c : flat 4 GiB code/data segments for ring 0 and ring 3 */
#include "kernel.h"

struct gdt_entry {
    uint16_t limit_low;
    uint16_t base_low;
    uint8_t  base_mid;
    uint8_t  access;
    uint8_t  gran;
    uint8_t  base_high;
} __attribute__((packed));

struct gdt_ptr {
    uint16_t limit;
    uint32_t base;
} __attribute__((packed));

static struct gdt_entry gdt[5];
static struct gdt_ptr   gp;

extern void gdt_flush(struct gdt_ptr *p);

static void set_gate(int i, uint32_t base, uint32_t limit, uint8_t access, uint8_t gran) {
    gdt[i].base_low  = base & 0xFFFF;
    gdt[i].base_mid  = (base >> 16) & 0xFF;
    gdt[i].base_high = (base >> 24) & 0xFF;
    gdt[i].limit_low = limit & 0xFFFF;
    gdt[i].gran      = (uint8_t)(((limit >> 16) & 0x0F) | (gran & 0xF0));
    gdt[i].access    = access;
}

void gdt_init(void) {
    gp.limit = sizeof(gdt) - 1;
    gp.base  = (uint32_t)(uintptr_t)&gdt;

    set_gate(0, 0, 0, 0, 0);                 /* null           */
    set_gate(1, 0, 0xFFFFFFFF, 0x9A, 0xCF);  /* kernel code 08 */
    set_gate(2, 0, 0xFFFFFFFF, 0x92, 0xCF);  /* kernel data 10 */
    set_gate(3, 0, 0xFFFFFFFF, 0xFA, 0xCF);  /* user code   18 */
    set_gate(4, 0, 0xFFFFFFFF, 0xF2, 0xCF);  /* user data   20 */

    gdt_flush(&gp);
}
