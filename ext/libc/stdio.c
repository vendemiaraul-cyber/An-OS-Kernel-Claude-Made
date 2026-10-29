/* ConMon extension libc - stdio: printf family, sscanf and in-memory files.
 * stdout/stderr go to ConMon's log. Files: the data file ConMon passed in
 * (read-only, matched by name) and RAM files the program writes. */
#include <stddef.h>
#include <stdint.h>
#include <stdarg.h>
#include <string.h>
#include <stdlib.h>
#include <ctype.h>
#include <errno.h>
#include <stdio.h>
#include "cmx.h"

#define MAX_RAMFILES 16
struct ramfile { char name[64]; unsigned char *data; size_t size, cap; int used; };
static struct ramfile ramfiles[MAX_RAMFILES];

struct _cmx_file {
    int used, console, writable, eof;
    const unsigned char *data;      /* read-only data file */
    struct ramfile *ram;            /* or a RAM file */
    size_t size, pos;
    char line[160]; size_t len;     /* console line buffer */
};

#define MAX_FILES 12
static struct _cmx_file files[MAX_FILES], con_out, con_err;
FILE *const stdin = NULL;
FILE *const stdout = &con_out;
FILE *const stderr = &con_err;

void cmx_stdio_init(void) {
    memset(&con_out, 0, sizeof con_out);
    memset(&con_err, 0, sizeof con_err);
    con_out.used = con_err.used = con_out.console = con_err.console = 1;
    for (int i = 0; i < MAX_FILES; i++) files[i].used = 0;
}

static const char *base_name(const char *p) {
    const char *b = p;
    for (; *p; p++) if (*p == '/' || *p == '\\') b = p + 1;
    return b;
}

static struct ramfile *find_ram(const char *name) {
    for (int i = 0; i < MAX_RAMFILES; i++)
        if (ramfiles[i].used && !strcasecmp(ramfiles[i].name, base_name(name))) return &ramfiles[i];
    return NULL;
}

FILE *fopen(const char *name, const char *mode) {
    FILE *f = NULL;
    for (int i = 0; i < MAX_FILES; i++) if (!files[i].used) { f = &files[i]; break; }
    if (!f) { errno = ENOMEM; return NULL; }
    memset(f, 0, sizeof *f);
    int write = mode[0] == 'w' || mode[0] == 'a';
    if (!write && cmx_api->data_name && !strcasecmp(base_name(name), cmx_api->data_name)) {
        f->data = cmx_api->data; f->size = cmx_api->data_size;
        f->used = 1;
        return f;
    }
    struct ramfile *r = find_ram(name);
    if (!r && !write) { errno = ENOENT; return NULL; }
    if (!r) {
        for (int i = 0; i < MAX_RAMFILES; i++) if (!ramfiles[i].used) { r = &ramfiles[i]; break; }
        if (!r) { errno = ENOSPC; return NULL; }
        memset(r, 0, sizeof *r);
        strncpy(r->name, base_name(name), sizeof r->name - 1);
        r->used = 1;
    }
    if (mode[0] == 'w') r->size = 0;
    f->ram = r; f->writable = write; f->used = 1;
    f->size = r->size;
    f->pos = mode[0] == 'a' ? r->size : 0;
    return f;
}

static void con_flush(FILE *f) {
    if (!f->len) return;
    f->line[f->len] = 0;
    cmx_api->log(f->line);
    if (f == stderr) {          /* keep the last error line for ConMon to show */
        char *s = f->line;
        while (*s == '\n') s++;
        if (*s) {
            strncpy(cmx_api->message, s, sizeof cmx_api->message - 1);
            size_t n = strlen(cmx_api->message);
            while (n && cmx_api->message[n - 1] == '\n') cmx_api->message[--n] = 0;
        }
    }
    f->len = 0;
}

int fflush(FILE *f) {
    if (f && f->console) con_flush(f);
    return 0;
}

int fclose(FILE *f) {
    if (!f || f->console) return 0;
    f->used = 0;
    return 0;
}

size_t fread(void *p, size_t size, size_t n, FILE *f) {
    if (!f || f->console || !size) return 0;
    const unsigned char *src = f->ram ? f->ram->data : f->data;
    size_t total = f->ram ? f->ram->size : f->size;
    size_t want = size * n, left = f->pos < total ? total - f->pos : 0;
    if (want > left) { want = left - left % size; f->eof = 1; }
    memcpy(p, src + f->pos, want);
    f->pos += want;
    return want / size;
}

size_t fwrite(const void *p, size_t size, size_t n, FILE *f) {
    size_t total = size * n;
    if (!f) return 0;
    if (f->console) {
        const char *s = p;
        for (size_t i = 0; i < total; i++) {
            f->line[f->len++] = s[i];
            if (s[i] == '\n' || f->len >= sizeof f->line - 1) con_flush(f);
        }
        return n;
    }
    if (!f->writable || !f->ram) return 0;
    struct ramfile *r = f->ram;
    if (f->pos + total > r->cap) {
        size_t cap = (f->pos + total) * 2 + 256;
        unsigned char *d = realloc(r->data, cap);
        if (!d) { errno = ENOSPC; return 0; }
        r->data = d; r->cap = cap;
    }
    memcpy(r->data + f->pos, p, total);
    f->pos += total;
    if (f->pos > r->size) r->size = f->pos;
    return n;
}

int fseek(FILE *f, long off, int whence) {
    if (!f || f->console) return -1;
    long size = (long)(f->ram ? f->ram->size : f->size);
    long base = whence == SEEK_SET ? 0 : whence == SEEK_CUR ? (long)f->pos : size;
    if (base + off < 0) { errno = EINVAL; return -1; }
    f->pos = base + off;
    f->eof = 0;
    return 0;
}

long ftell(FILE *f) { return f && !f->console ? (long)f->pos : -1; }
int  feof(FILE *f) { return f && f->eof; }
int  fgetc(FILE *f) { unsigned char c; return fread(&c, 1, 1, f) == 1 ? c : EOF; }
int  fputc(int c, FILE *f) { unsigned char ch = c; return fwrite(&ch, 1, 1, f) == 1 ? c : EOF; }
int  fputs(const char *s, FILE *f) { return fwrite(s, 1, strlen(s), f) ? 0 : EOF; }
int  puts(const char *s) { fputs(s, stdout); fputc('\n', stdout); return 0; }
int  putchar(int c) { return fputc(c, stdout); }

char *fgets(char *s, int n, FILE *f) {
    int i = 0;
    while (i < n - 1) {
        int c = fgetc(f);
        if (c == EOF) break;
        s[i++] = c;
        if (c == '\n') break;
    }
    if (!i) return NULL;
    s[i] = 0;
    return s;
}

int remove(const char *name) {
    struct ramfile *r = find_ram(name);
    if (!r) { errno = ENOENT; return -1; }
    free(r->data);
    memset(r, 0, sizeof *r);
    return 0;
}

int rename(const char *from, const char *to) {
    struct ramfile *r = find_ram(from);
    if (!r) { errno = ENOENT; return -1; }
    struct ramfile *old = find_ram(to);
    if (old && old != r) remove(to);
    strncpy(r->name, base_name(to), sizeof r->name - 1);
    return 0;
}

/* --------------------------------------------------------------- printf */

struct out { char *buf; size_t cap, len; FILE *f; };

static void emit(struct out *o, char c) {
    if (o->f) { fputc(c, o->f); o->len++; return; }
    if (o->len + 1 < o->cap) o->buf[o->len] = c;
    o->len++;
}

static void emit_padded(struct out *o, const char *s, size_t n, int width, int left, char pad) {
    int fill = width > (int)n ? width - (int)n : 0;
    if (!left && pad == '0' && n && (*s == '-' || *s == '+')) { emit(o, *s++); n--; }
    if (!left) while (fill--) emit(o, pad);
    while (n--) emit(o, *s++);
    if (left) while (fill-- > 0) emit(o, ' ');
}

static int vformat(struct out *o, const char *fmt, va_list ap) {
    char tmp[72];
    for (; *fmt; fmt++) {
        if (*fmt != '%') { emit(o, *fmt); continue; }
        fmt++;
        int left = 0, plus = 0, space = 0, alt = 0, width = 0, prec = -1, lng = 0;
        char pad = ' ';
        for (;; fmt++) {
            if (*fmt == '-') left = 1;
            else if (*fmt == '0') pad = '0';
            else if (*fmt == '+') plus = 1;
            else if (*fmt == ' ') space = 1;
            else if (*fmt == '#') alt = 1;
            else break;
        }
        if (*fmt == '*') { width = va_arg(ap, int); if (width < 0) { left = 1; width = -width; } fmt++; }
        else while (isdigit((unsigned char)*fmt)) width = width * 10 + (*fmt++ - '0');
        if (*fmt == '.') {
            fmt++; prec = 0;
            if (*fmt == '*') { prec = va_arg(ap, int); fmt++; }
            else while (isdigit((unsigned char)*fmt)) prec = prec * 10 + (*fmt++ - '0');
        }
        while (*fmt == 'l' || *fmt == 'h' || *fmt == 'z' || *fmt == 't' || *fmt == 'j') { if (*fmt == 'l') lng++; fmt++; }
        if (left) pad = ' ';
        char c = *fmt;
        if (c == 0) break;
        switch (c) {
        case 'c': tmp[0] = (char)va_arg(ap, int); emit_padded(o, tmp, 1, width, left, ' '); break;
        case 's': {
            const char *s = va_arg(ap, const char *);
            if (!s) s = "(null)";
            size_t n = prec >= 0 ? strnlen(s, prec) : strlen(s);
            emit_padded(o, s, n, width, left, ' ');
            break;
        }
        case 'd': case 'i': case 'u': case 'x': case 'X': case 'o': case 'p': {
            unsigned long long v;
            int neg = 0, base = c == 'x' || c == 'X' || c == 'p' ? 16 : c == 'o' ? 8 : 10;
            if (c == 'p') { v = (uintptr_t)va_arg(ap, void *); alt = 1; }
            else if (c == 'd' || c == 'i') {
                long long s = lng >= 2 ? va_arg(ap, long long) : lng ? va_arg(ap, long) : va_arg(ap, int);
                if (s < 0) { neg = 1; v = -(unsigned long long)s; } else v = s;
            } else v = lng >= 2 ? va_arg(ap, unsigned long long) : lng ? va_arg(ap, unsigned long) : va_arg(ap, unsigned);
            char digits[24]; int n = 0;
            const char *set = c == 'X' ? "0123456789ABCDEF" : "0123456789abcdef";
            do { digits[n++] = set[v % base]; v /= base; } while (v);
            while (prec > n) digits[n++] = '0';
            int t = 0;
            if (neg) tmp[t++] = '-'; else if (plus) tmp[t++] = '+'; else if (space) tmp[t++] = ' ';
            if (alt && base == 16) { tmp[t++] = '0'; tmp[t++] = c == 'X' ? 'X' : 'x'; }
            while (n) tmp[t++] = digits[--n];
            emit_padded(o, tmp, t, width, left, prec >= 0 ? ' ' : pad);
            break;
        }
        case 'f': case 'F': case 'g': case 'G': case 'e': {
            double v = va_arg(ap, double);
            if (prec < 0) prec = 6;
            if (prec > 9) prec = 9;
            int t = 0;
            if (v < 0) { tmp[t++] = '-'; v = -v; } else if (plus) tmp[t++] = '+';
            double r = 0.5;
            for (int i = 0; i < prec; i++) r /= 10;
            v += r;
            unsigned long long ip = (unsigned long long)v;
            double frac = v - (double)ip;
            char digits[24]; int n = 0;
            do { digits[n++] = '0' + ip % 10; ip /= 10; } while (ip);
            while (n) tmp[t++] = digits[--n];
            if (prec > 0) {
                tmp[t++] = '.';
                for (int i = 0; i < prec; i++) { frac *= 10; int d = (int)frac; tmp[t++] = '0' + d; frac -= d; }
            }
            emit_padded(o, tmp, t, width, left, pad);
            break;
        }
        case '%': emit(o, '%'); break;
        default: emit(o, '%'); emit(o, c); break;
        }
    }
    return (int)o->len;
}

int vsnprintf(char *s, size_t n, const char *fmt, va_list ap) {
    struct out o = { s, n, 0, NULL };
    int r = vformat(&o, fmt, ap);
    if (n) s[o.len < n ? o.len : n - 1] = 0;
    return r;
}
int vsprintf(char *s, const char *fmt, va_list ap) { return vsnprintf(s, (size_t)-1 >> 1, fmt, ap); }
int snprintf(char *s, size_t n, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = vsnprintf(s, n, fmt, ap); va_end(ap); return r; }
int sprintf(char *s, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = vsprintf(s, fmt, ap); va_end(ap); return r; }
int vfprintf(FILE *f, const char *fmt, va_list ap) { struct out o = { NULL, 0, 0, f }; return vformat(&o, fmt, ap); }
int vprintf(const char *fmt, va_list ap) { return vfprintf(stdout, fmt, ap); }
int fprintf(FILE *f, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = vfprintf(f, fmt, ap); va_end(ap); return r; }
int printf(const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = vfprintf(stdout, fmt, ap); va_end(ap); return r; }

/* --------------------------------------------------------------- sscanf */

int sscanf(const char *s, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int count = 0;
    for (; *fmt; fmt++) {
        if (isspace((unsigned char)*fmt)) { while (isspace((unsigned char)*s)) s++; continue; }
        if (*fmt != '%') { if (*s != *fmt) break; s++; continue; }
        fmt++;
        int width = 0;
        while (isdigit((unsigned char)*fmt)) width = width * 10 + (*fmt++ - '0');
        while (*fmt == 'l' || *fmt == 'h') fmt++;
        char c = *fmt;
        if (c == 'c') { if (!*s) break; *va_arg(ap, char *) = *s++; count++; continue; }
        while (isspace((unsigned char)*s)) s++;
        if (!*s) break;
        if (c == 's') {
            char *d = va_arg(ap, char *);
            int n = 0;
            while (*s && !isspace((unsigned char)*s) && (!width || n < width)) d[n++] = *s++;
            d[n] = 0; count++;
            continue;
        }
        int base = c == 'x' || c == 'X' ? 16 : c == 'o' ? 8 : c == 'i' ? 0 : 10;
        if (c == 'd' || c == 'i' || c == 'u' || c == 'x' || c == 'X' || c == 'o') {
            char *end;
            long v = strtol(s, &end, base);
            if (end == s) break;
            *va_arg(ap, int *) = (int)v;
            s = end; count++;
            continue;
        }
        if (c == 'f') {
            char *end;
            double v = strtod(s, &end);
            if (end == s) break;
            *va_arg(ap, float *) = (float)v;
            s = end; count++;
            continue;
        }
        break;
    }
    va_end(ap);
    return count;
}
