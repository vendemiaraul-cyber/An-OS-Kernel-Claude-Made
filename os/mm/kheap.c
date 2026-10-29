/* ConMon - kheap.c : first-fit free-list allocator with block splitting
 * and coalescing of neighbours on free. */
#include "kernel.h"

#define HEAP_MAGIC 0xC0DEC0DEu
#define ALIGN      16u

typedef struct block {
    uint32_t      magic;
    uint32_t      size;     /* payload size in bytes */
    uint32_t      free;
    struct block *next;     /* next block in address order */
} __attribute__((aligned(ALIGN))) block_t;   /* 16 bytes on i386: payload stays 16-aligned */

static block_t  *heap_head;
static size_t    heap_size;

static inline size_t align_up(size_t n) { return (n + ALIGN - 1) & ~(size_t)(ALIGN - 1); }

void kheap_init(uintptr_t start, size_t size) {
    start = align_up(start);
    heap_head = (block_t *)start;
    heap_size = size;
    heap_head->magic = HEAP_MAGIC;
    heap_head->size  = (uint32_t)(size - sizeof(block_t));
    heap_head->free  = 1;
    heap_head->next  = 0;
}

void *kmalloc(size_t size) {
    if (!size || !heap_head) return 0;
    size = align_up(size);
    for (block_t *b = heap_head; b; b = b->next) {
        if (!b->free || b->size < size) continue;
        if (b->size >= size + sizeof(block_t) + ALIGN) {   /* split */
            block_t *rest = (block_t *)((uint8_t *)(b + 1) + size);
            rest->magic = HEAP_MAGIC;
            rest->size  = (uint32_t)(b->size - size - sizeof(block_t));
            rest->free  = 1;
            rest->next  = b->next;
            b->next = rest;
            b->size = (uint32_t)size;
        }
        b->free = 0;
        return b + 1;
    }
    return 0;   /* out of memory */
}

void *kcalloc(size_t n, size_t size) {
    size_t total = n * size;
    if (size && total / size != n) return 0;
    void *p = kmalloc(total);
    if (p) memset(p, 0, total);
    return p;
}

void kfree(void *ptr) {
    if (!ptr) return;
    block_t *b = (block_t *)ptr - 1;
    if (b->magic != HEAP_MAGIC || b->free) {
        kpanic("kfree: bad pointer or double free");
        return;
    }
    b->free = 1;
    /* Coalesce every run of adjacent free blocks. */
    for (block_t *c = heap_head; c; c = c->next) {
        while (c->free && c->next && c->next->free) {
            c->size += (uint32_t)sizeof(block_t) + c->next->size;
            c->next = c->next->next;
        }
    }
}

size_t kheap_total(void) { return heap_size; }

size_t kheap_used(void) {
    size_t used = 0;
    for (block_t *b = heap_head; b; b = b->next)
        used += sizeof(block_t) + (b->free ? 0 : b->size);
    return used;
}

size_t kheap_blocks(void) {
    size_t n = 0;
    for (block_t *b = heap_head; b; b = b->next) n++;
    return n;
}
