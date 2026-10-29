// ConMon - cxxrt.cpp : the minimum C++ runtime a freestanding kernel needs.
// No exceptions, no RTTI: just new/delete, pure-virtual trap and the
// global-constructor walk.
#include "kernel.h"

void *operator new(size_t n)                    { return kmalloc(n); }
void *operator new[](size_t n)                  { return kmalloc(n); }
void  operator delete(void *p) noexcept         { kfree(p); }
void  operator delete[](void *p) noexcept       { kfree(p); }
void  operator delete(void *p, size_t) noexcept { kfree(p); }
void  operator delete[](void *p, size_t) noexcept { kfree(p); }

// Placement new is declared inline in kstd.hpp.

extern "C" {

void __cxa_pure_virtual() { kpanic("pure virtual function called"); }

// Kernel never exits, so destructors of globals never need to run.
void *__dso_handle = nullptr;
int __cxa_atexit(void (*)(void *), void *, void *) { return 0; }

typedef void (*ctor_t)();
extern ctor_t __init_array_start[];
extern ctor_t __init_array_end[];

void cxx_init(void) {
    for (ctor_t *c = __init_array_start; c != __init_array_end; ++c)
        (*c)();
}

}
