/* ConMon extension libc - malloc on the heap ConMon hands over.
 * First fit over a list of blocks in address order; neighbours merge on free. */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <errno.h>

struct block {
    size_t size;                /* payload bytes */
    size_t free;
    struct block *next;
    size_t pad;                 /* keeps payloads 16-byte aligned */
};

static struct block *first;

void cmx_heap_init(void *base, size_t size) {
    uintptr_t b = ((uintptr_t)base + 15) & ~(uintptr_t)15;
    size -= b - (uintptr_t)base;
    first = (struct block *)b;
    first->size = size - sizeof(struct block);
    first->free = 1;
    first->next = NULL;
}

void *malloc(size_t n) {
    if (n == 0) n = 1;
    n = (n + 15) & ~(size_t)15;
    for (struct block *b = first; b; b = b->next) {
        if (!b->free || b->size < n) continue;
        if (b->size >= n + sizeof(struct block) + 64) {          /* split */
            struct block *rest = (struct block *)((char *)(b + 1) + n);
            rest->size = b->size - n - sizeof(struct block);
            rest->free = 1;
            rest->next = b->next;
            b->next = rest;
            b->size = n;
        }
        b->free = 0;
        return b + 1;
    }
    errno = ENOMEM;
    return NULL;
}

void free(void *p) {
    if (!p) return;
    struct block *b = (struct block *)p - 1;
    b->free = 1;
    /* merge with following free blocks, then sweep once for earlier ones */
    while (b->next && b->next->free) {
        b->size += sizeof(struct block) + b->next->size;
        b->next = b->next->next;
    }
    for (struct block *a = first; a && a->next; a = a->next) {
        if (a->free && a->next == b) {
            a->size += sizeof(struct block) + b->size;
            a->next = b->next;
            break;
        }
    }
}

void *calloc(size_t n, size_t size) {
    size_t total = n * size;
    void *p = malloc(total);
    if (p) memset(p, 0, total);
    return p;
}

void *realloc(void *p, size_t n) {
    if (!p) return malloc(n);
    struct block *b = (struct block *)p - 1;
    if (b->size >= n) return p;
    void *q = malloc(n);
    if (!q) return NULL;
    memcpy(q, p, b->size);
    free(p);
    return q;
}
