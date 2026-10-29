/* ConMon extension libc - start-up, memory, strings, ctype, stdlib.
 *
 * Just enough C library for programs like DOOM to run inside ConMon. The
 * program's main() is called by cmx_entry(), which ConMon calls with the
 * API table from os/include/conmon_ext.h. */
#include <stddef.h>
#include <stdint.h>
#include <stdarg.h>
#include <string.h>
#include <stdlib.h>
#include <ctype.h>
#include <errno.h>
#include <stdio.h>
#include <math.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>
#include "conmon_ext.h"
#include "cmx.h"

struct conmon_api *cmx_api;

int  cmx_setjmp(int buf[6]);
void cmx_longjmp(int buf[6], int v) __attribute__((noreturn));
int  main(int argc, char **argv);

static int exit_buf[6];
static int exit_code;
static void (*atexit_fns[16])(void);
static int atexit_count;

/* ------------------------------------------------------------- start-up */

static char  arg_copy[256];
static char *argv_list[24];

static int split_args(const char *name, const char *args) {
    int argc = 0;
    argv_list[argc++] = (char *)name;
    strncpy(arg_copy, args ? args : "", sizeof arg_copy - 1);
    char *p = arg_copy;
    while (*p && argc < 23) {
        while (*p == ' ') p++;
        if (!*p) break;
        argv_list[argc++] = p;
        while (*p && *p != ' ') p++;
        if (*p) *p++ = 0;
    }
    argv_list[argc] = NULL;
    return argc;
}

void cmx_heap_init(void *base, size_t size);

int cmx_entry(struct conmon_api *api) {
    cmx_api = api;
    if (api->version < 1) return -1;
    cmx_heap_init(api->heap, api->heap_size);
    cmx_stdio_init();
    int argc = split_args("cmx", api->args);
    if (cmx_setjmp(exit_buf) == 0)
        exit_code = main(argc, argv_list);
    fflush(stdout);
    fflush(stderr);
    return exit_code;
}

int atexit(void (*fn)(void)) {
    if (atexit_count >= 16) return -1;
    atexit_fns[atexit_count++] = fn;
    return 0;
}

void exit(int code) {
    while (atexit_count > 0) atexit_fns[--atexit_count]();
    exit_code = code;
    cmx_longjmp(exit_buf, 1);
}

void abort(void) {
    fputs("abort()\n", stderr);
    exit(134);
}

void __cmx_assert(const char *expr, const char *file, int line) {
    fprintf(stderr, "assertion failed: %s (%s:%d)\n", expr, file, line);
    exit(134);
}

static int errno_value;
int *__errno_location(void) { return &errno_value; }

char *strerror(int e) {
    switch (e) {
    case 0: return "no error";
    case ENOENT: return "no such file";
    case ENOMEM: return "out of memory";
    case ENOSPC: return "no space left";
    case EINVAL: return "invalid argument";
    default: return "error";
    }
}

/* -------------------------------------------------------------- memory */

void *memcpy(void *d, const void *s, size_t n) {
    void *ret = d;
    size_t words = n >> 2, rest = n & 3;
    __asm__ volatile ("cld; rep movsl" : "+D"(d), "+S"(s), "+c"(words) : : "memory");
    __asm__ volatile ("rep movsb" : "+D"(d), "+S"(s), "+c"(rest) : : "memory");
    return ret;
}

void *memmove(void *d, const void *s, size_t n) {
    unsigned char *dp = d;
    const unsigned char *sp = s;
    if (dp == sp || n == 0) return d;
    if (dp < sp || dp >= sp + n) {
        while (n--) *dp++ = *sp++;
    } else {
        dp += n; sp += n;
        while (n--) *--dp = *--sp;
    }
    return d;
}

void *memset(void *d, int c, size_t n) {
    unsigned char *p = d;
    while (n && ((uintptr_t)p & 3)) { *p++ = (unsigned char)c; n--; }
    uint32_t v = (unsigned char)c * 0x01010101u;
    uint32_t *w = (uint32_t *)p;
    for (; n >= 4; n -= 4) *w++ = v;
    p = (unsigned char *)w;
    while (n--) *p++ = (unsigned char)c;
    return d;
}

int memcmp(const void *a, const void *b, size_t n) {
    const unsigned char *x = a, *y = b;
    for (; n; n--, x++, y++) if (*x != *y) return *x - *y;
    return 0;
}

void *memchr(const void *s, int c, size_t n) {
    const unsigned char *p = s;
    for (; n; n--, p++) if (*p == (unsigned char)c) return (void *)p;
    return NULL;
}

/* -------------------------------------------------------------- strings */

size_t strlen(const char *s) { const char *p = s; while (*p) p++; return p - s; }
size_t strnlen(const char *s, size_t n) { size_t i = 0; while (i < n && s[i]) i++; return i; }

int strcmp(const char *a, const char *b) {
    while (*a && *a == *b) { a++; b++; }
    return (unsigned char)*a - (unsigned char)*b;
}

int strncmp(const char *a, const char *b, size_t n) {
    for (; n; n--, a++, b++) {
        if (*a != *b) return (unsigned char)*a - (unsigned char)*b;
        if (!*a) return 0;
    }
    return 0;
}

int strcasecmp(const char *a, const char *b) {
    while (*a && tolower((unsigned char)*a) == tolower((unsigned char)*b)) { a++; b++; }
    return tolower((unsigned char)*a) - tolower((unsigned char)*b);
}

int strncasecmp(const char *a, const char *b, size_t n) {
    for (; n; n--, a++, b++) {
        int x = tolower((unsigned char)*a), y = tolower((unsigned char)*b);
        if (x != y) return x - y;
        if (!x) return 0;
    }
    return 0;
}

char *strcpy(char *d, const char *s) { char *r = d; while ((*d++ = *s++)) {} return r; }

char *strncpy(char *d, const char *s, size_t n) {
    size_t i = 0;
    for (; i < n && s[i]; i++) d[i] = s[i];
    for (; i < n; i++) d[i] = 0;
    return d;
}

char *strcat(char *d, const char *s) { strcpy(d + strlen(d), s); return d; }

char *strncat(char *d, const char *s, size_t n) {
    char *p = d + strlen(d);
    while (n-- && *s) *p++ = *s++;
    *p = 0;
    return d;
}

char *strchr(const char *s, int c) {
    for (;; s++) {
        if (*s == (char)c) return (char *)s;
        if (!*s) return NULL;
    }
}

char *strrchr(const char *s, int c) {
    const char *last = NULL;
    for (;; s++) {
        if (*s == (char)c) last = s;
        if (!*s) return (char *)last;
    }
}

char *strstr(const char *h, const char *n) {
    size_t len = strlen(n);
    if (!len) return (char *)h;
    for (; *h; h++) if (*h == *n && !strncmp(h, n, len)) return (char *)h;
    return NULL;
}

size_t strspn(const char *s, const char *a) { size_t i = 0; while (s[i] && strchr(a, s[i])) i++; return i; }
size_t strcspn(const char *s, const char *r) { size_t i = 0; while (s[i] && !strchr(r, s[i])) i++; return i; }
char *strpbrk(const char *s, const char *a) { s += strcspn(s, a); return *s ? (char *)s : NULL; }

char *strdup(const char *s) {
    size_t n = strlen(s) + 1;
    char *d = malloc(n);
    if (d) memcpy(d, s, n);
    return d;
}

char *strndup(const char *s, size_t n) {
    n = strnlen(s, n);
    char *d = malloc(n + 1);
    if (d) { memcpy(d, s, n); d[n] = 0; }
    return d;
}

/* ---------------------------------------------------------------- ctype */

int isdigit(int c)  { return c >= '0' && c <= '9'; }
int isupper(int c)  { return c >= 'A' && c <= 'Z'; }
int islower(int c)  { return c >= 'a' && c <= 'z'; }
int isalpha(int c)  { return isupper(c) || islower(c); }
int isalnum(int c)  { return isalpha(c) || isdigit(c); }
int isxdigit(int c) { return isdigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
int isspace(int c)  { return c == ' ' || (c >= '\t' && c <= '\r'); }
int isprint(int c)  { return c >= 32 && c < 127; }
int isgraph(int c)  { return c > 32 && c < 127; }
int iscntrl(int c)  { return (c >= 0 && c < 32) || c == 127; }
int ispunct(int c)  { return isgraph(c) && !isalnum(c); }
int toupper(int c)  { return islower(c) ? c - 32 : c; }
int tolower(int c)  { return isupper(c) ? c + 32 : c; }

/* --------------------------------------------------------------- stdlib */

int  abs(int x)   { return x < 0 ? -x : x; }
long labs(long x) { return x < 0 ? -x : x; }

unsigned long strtoul(const char *s, char **end, int base) {
    const char *p = s;
    while (isspace((unsigned char)*p)) p++;
    int neg = 0;
    if (*p == '+' || *p == '-') neg = *p++ == '-';
    if ((base == 0 || base == 16) && p[0] == '0' && (p[1] == 'x' || p[1] == 'X') && isxdigit((unsigned char)p[2])) {
        p += 2; base = 16;
    } else if (base == 0) {
        base = p[0] == '0' ? 8 : 10;
    }
    unsigned long v = 0;
    const char *start = p;
    for (;; p++) {
        int c = (unsigned char)*p, d;
        if (isdigit(c)) d = c - '0';
        else if (isalpha(c)) d = tolower(c) - 'a' + 10;
        else break;
        if (d >= base) break;
        v = v * base + d;
    }
    if (end) *end = (char *)(p == start ? s : p);
    return neg ? -v : v;
}

long strtol(const char *s, char **end, int base) { return (long)strtoul(s, end, base); }
int  atoi(const char *s) { return (int)strtol(s, NULL, 10); }
long atol(const char *s) { return strtol(s, NULL, 10); }

double strtod(const char *s, char **end) {
    const char *p = s;
    while (isspace((unsigned char)*p)) p++;
    int neg = 0;
    if (*p == '+' || *p == '-') neg = *p++ == '-';
    double v = 0, scale = 1;
    int any = 0;
    while (isdigit((unsigned char)*p)) { v = v * 10 + (*p++ - '0'); any = 1; }
    if (*p == '.') {
        p++;
        while (isdigit((unsigned char)*p)) { scale /= 10; v += (*p++ - '0') * scale; any = 1; }
    }
    if (any && (*p == 'e' || *p == 'E')) {
        char *e;
        long x = strtol(p + 1, &e, 10);
        if (e != p + 1) {
            p = e;
            while (x > 0) { v *= 10; x--; }
            while (x < 0) { v /= 10; x++; }
        }
    }
    if (end) *end = (char *)(any ? p : s);
    return neg ? -v : v;
}

double atof(const char *s) { return strtod(s, NULL); }

char *getenv(const char *name) { (void)name; return NULL; }
int   system(const char *cmd) { (void)cmd; return -1; }

static uint32_t rand_state = 1;
int  rand(void) { rand_state = rand_state * 1103515245u + 12345u; return (rand_state >> 1) & RAND_MAX; }
void srand(unsigned seed) { rand_state = seed; }

void qsort(void *base, size_t n, size_t size, int (*cmp)(const void *, const void *)) {
    /* insertion sort: small inputs only */
    unsigned char *b = base, tmp[64];
    if (size > sizeof tmp) return;
    for (size_t i = 1; i < n; i++) {
        memcpy(tmp, b + i * size, size);
        size_t j = i;
        while (j > 0 && cmp(b + (j - 1) * size, tmp) > 0) {
            memcpy(b + j * size, b + (j - 1) * size, size);
            j--;
        }
        memcpy(b + j * size, tmp, size);
    }
}

time_t time(time_t *t) {
    time_t v = (time_t)(cmx_api->ticks_ms() / 1000);
    if (t) *t = v;
    return v;
}

/* ----------------------------------------------------------------- math */

double fabs(double x)  { return x < 0 ? -x : x; }
float  fabsf(float x)  { return x < 0 ? -x : x; }
double floor(double x) { long long i = (long long)x; return (double)(i > x ? i - 1 : i); }
double ceil(double x)  { long long i = (long long)x; return (double)(i < x ? i + 1 : i); }
double sqrt(double x)  { double r; __asm__ ("fsqrt" : "=t"(r) : "0"(x)); return r; }
double sin(double x)   { double r; __asm__ ("fsin" : "=t"(r) : "0"(x)); return r; }
double cos(double x)   { double r; __asm__ ("fcos" : "=t"(r) : "0"(x)); return r; }
double atan2(double y, double x) { double r; __asm__ ("fpatan" : "=t"(r) : "0"(x), "u"(y) : "st(1)"); return r; }
double pow(double x, double y) {
    /* integer powers only, which is all DOOM's code paths need */
    double r = 1;
    long n = (long)y;
    int neg = n < 0;
    if (neg) n = -n;
    while (n--) r *= x;
    return neg ? 1 / r : r;
}

/* ------------------------------------------------------- files and dirs */

int access(const char *path, int mode) { (void)mode; FILE *f = fopen(path, "rb"); if (!f) return -1; fclose(f); return 0; }
int unlink(const char *path) { return remove(path); }
int mkdir(const char *path, mode_t mode) { (void)path; (void)mode; return 0; }

int stat(const char *path, struct stat *st) {
    FILE *f = fopen(path, "rb");
    if (!f) { errno = ENOENT; return -1; }
    fseek(f, 0, SEEK_END);
    st->st_size = ftell(f);
    st->st_mode = S_IFREG;
    fclose(f);
    return 0;
}
