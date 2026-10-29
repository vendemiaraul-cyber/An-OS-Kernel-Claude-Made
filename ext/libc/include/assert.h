#ifndef _ASSERT_H
#define _ASSERT_H
void __cmx_assert(const char *expr, const char *file, int line) __attribute__((noreturn));
#ifdef NDEBUG
#define assert(x) ((void)0)
#else
#define assert(x) ((x) ? (void)0 : __cmx_assert(#x, __FILE__, __LINE__))
#endif
#endif
