/* ConMon - keyboard.c : PS/2 keyboard on IRQ1, scancode set 1, US layout */
#include "kernel.h"

#define KBD_BUF 128
static volatile uint8_t buf[KBD_BUF];
static volatile uint32_t head, tail;
static int shift, caps, ctrl, extended;

static const char keymap[128] = {
    0, 27, '1','2','3','4','5','6','7','8','9','0','-','=','\b',
    '\t','q','w','e','r','t','y','u','i','o','p','[',']','\n',
    0, 'a','s','d','f','g','h','j','k','l',';','\'','`',
    0, '\\','z','x','c','v','b','n','m',',','.','/', 0,
    '*', 0, ' ',
};

static const char keymap_shift[128] = {
    0, 27, '!','@','#','$','%','^','&','*','(',')','_','+','\b',
    '\t','Q','W','E','R','T','Y','U','I','O','P','{','}','\n',
    0, 'A','S','D','F','G','H','J','K','L',':','"','~',
    0, '|','Z','X','C','V','B','N','M','<','>','?', 0,
    '*', 0, ' ',
};

static void push(uint8_t c) {
    uint32_t next = (head + 1) % KBD_BUF;
    if (next == tail) return;               /* buffer full: drop key */
    buf[head] = c;
    head = next;
}

static void keyboard_irq(struct regs *r) {
    (void)r;
    uint8_t sc = inb(0x60);

    if (sc == 0xE0) { extended = 1; return; }

    int released = sc & 0x80;
    uint8_t code = sc & 0x7F;

    if (extended) {
        extended = 0;
        if (code == 0x1D) { ctrl = !released; return; }   /* right ctrl */
        if (released) return;
        switch (code) {
        case 0x48: push(KEY_UP); break;
        case 0x50: push(KEY_DOWN); break;
        case 0x4B: push(KEY_LEFT); break;
        case 0x4D: push(KEY_RIGHT); break;
        }
        return;
    }

    switch (code) {
    case 0x2A: case 0x36: shift = !released; return;     /* shifts    */
    case 0x1D: ctrl = !released; return;                 /* left ctrl */
    case 0x3A: if (!released) caps = !caps; return;      /* caps lock */
    }
    if (released) return;

    char c = shift ? keymap_shift[code] : keymap[code];
    if (!c) return;
    if (caps && c >= 'a' && c <= 'z' && !shift) c -= 32;
    else if (caps && c >= 'A' && c <= 'Z' && shift) c += 32;
    if (ctrl && c >= 'a' && c <= 'z') c = (char)(c - 'a' + 1);  /* ^A..^Z */
    else if (ctrl && c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 1);
    push((uint8_t)c);
}

void keyboard_init(void) {
    while (inb(0x64) & 1) inb(0x60);        /* flush stale bytes */
    irq_install_handler(1, keyboard_irq);
}

int keyboard_poll(void) {
    if (head == tail) return -1;
    uint8_t c = buf[tail];
    tail = (tail + 1) % KBD_BUF;
    return c;
}

int keyboard_peek(void) {
    return head == tail ? -1 : buf[tail];
}

int keyboard_getchar(void) {
    int c;
    while ((c = keyboard_poll()) < 0) cpu_halt();
    return c;
}
