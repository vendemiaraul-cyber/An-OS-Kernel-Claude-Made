/* ConMon - kprintf.c : tiny printf for the kernel */
#include "kernel.h"

struct out { char *buf; size_t size; size_t pos; };

static void emit(struct out *o, char c) {
    if (o->pos + 1 < o->size) o->buf[o->pos] = c;
    o->pos++;
}

static void emit_num(struct out *o, uint32_t v, unsigned base, int upper,
                     int neg, int width, char pad, int left) {
    const char *digits = upper ? "0123456789ABCDEF" : "0123456789abcdef";
    char tmp[16];
    int n = 0;
    do { tmp[n++] = digits[v % base]; v /= base; } while (v);
    int len = n + (neg ? 1 : 0);
    if (left) {
        if (neg) emit(o, '-');
        while (n) emit(o, tmp[--n]);
        for (; len < width; len++) emit(o, ' ');
        return;
    }
    if (neg && pad == '0') emit(o, '-');
    for (; len < width; len++) emit(o, pad);
    if (neg && pad != '0') emit(o, '-');
    while (n) emit(o, tmp[--n]);
}

int kvsnprintf(char *buf, size_t size, const char *fmt, va_list ap) {
    struct out o = { buf, size, 0 };
    for (; *fmt; fmt++) {
        if (*fmt != '%') { emit(&o, *fmt); continue; }
        fmt++;
        char pad = ' ';
        int width = 0, left = 0;
        if (*fmt == '-') { left = 1; fmt++; }
        if (*fmt == '0' && !left) { pad = '0'; fmt++; }
        while (*fmt >= '0' && *fmt <= '9') width = width * 10 + (*fmt++ - '0');
        switch (*fmt) {
        case 'c': emit(&o, (char)va_arg(ap, int)); break;
        case 's': {
            const char *s = va_arg(ap, const char *);
            if (!s) s = "(null)";
            int len = (int)strlen(s);
            if (!left) for (; len < width; len++) emit(&o, ' ');
            while (*s) emit(&o, *s++);
            if (left) for (; len < width; len++) emit(&o, ' ');
            break;
        }
        case 'd': case 'i': {
            int v = va_arg(ap, int);
            uint32_t u = v < 0 ? 0u - (uint32_t)v : (uint32_t)v;
            emit_num(&o, u, 10, 0, v < 0, width, pad, left);
            break;
        }
        case 'u': emit_num(&o, va_arg(ap, uint32_t), 10, 0, 0, width, pad, left); break;
        case 'x': emit_num(&o, va_arg(ap, uint32_t), 16, 0, 0, width, pad, left); break;
        case 'X': emit_num(&o, va_arg(ap, uint32_t), 16, 1, 0, width, pad, left); break;
        case 'p':
            emit(&o, '0'); emit(&o, 'x');
            emit_num(&o, (uint32_t)(uintptr_t)va_arg(ap, void *), 16, 0, 0, 8, '0', 0);
            break;
        case '%': emit(&o, '%'); break;
        case 0: fmt--; break;
        default: emit(&o, '%'); emit(&o, *fmt); break;
        }
    }
    if (size) buf[o.pos < size ? o.pos : size - 1] = 0;
    return (int)o.pos;
}

int ksnprintf(char *buf, size_t size, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int n = kvsnprintf(buf, size, fmt, ap);
    va_end(ap);
    return n;
}

void kputc(char c) {
    vga_putc(c);
    serial_putc(c);
}

void kputs(const char *s) {
    while (*s) kputc(*s++);
}

void kprintf(const char *fmt, ...) {
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    kvsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    kputs(buf);
}
