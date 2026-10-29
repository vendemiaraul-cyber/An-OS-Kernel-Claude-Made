// ConMon - host_test.cpp : runs ConMon's portable code on the host.
//   make test
#include "kernel.h"
#include "../shell/calc.hpp"
#include "../shell/ramfs.hpp"
#include <stdio.h>
#include <stdlib.h>
#include <setjmp.h>

extern "C" {
extern char test_out[];
extern size_t test_out_len;
extern const char *test_keys;
extern jmp_buf test_done;
extern int test_panicked;
}

static int failures, checks;

#define CHECK(cond) do { checks++; if (!(cond)) { failures++; \
    printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); } } while (0)

static bool contains(const char *hay, const char *needle) {
    size_t n = strlen(needle);
    for (; *hay; hay++) if (strncmp(hay, needle, n) == 0) return true;
    return false;
}

static void test_printf() {
    char b[128];
    ksnprintf(b, sizeof b, "%d %u %x %X %s %c %%", -42, 7u, 0xbeefu, 0xbeefu, "hi", 'z');
    CHECK(strcmp(b, "-42 7 beef BEEF hi z %") == 0);
    ksnprintf(b, sizeof b, "[%5d][%-5d][%05d][%-6s][%6s]", 42, 42, -42, "ab", "ab");
    CHECK(strcmp(b, "[   42][42   ][-0042][ab    ][    ab]") == 0);
    ksnprintf(b, sizeof b, "%d", (int)0x80000000);
    CHECK(strcmp(b, "-2147483648") == 0);
    ksnprintf(b, sizeof b, "%p", (void *)0x1234);
    CHECK(strcmp(b, "0x00001234") == 0);
    int n = ksnprintf(b, 6, "hello world");
    CHECK(n == 11 && strcmp(b, "hello") == 0);          // truncation
}

static void test_heap() {
    static uint8_t arena[256 * 1024];
    kheap_init((uintptr_t)arena, sizeof arena);
    size_t base_used = kheap_used();

    void *a = kmalloc(100), *b = kmalloc(200), *c = kmalloc(300);
    CHECK(a && b && c && a != b && b != c);
    CHECK(((uintptr_t)a & 15) == 0);
    memset(a, 0xAA, 100); memset(b, 0xBB, 200); memset(c, 0xCC, 300);
    kfree(b);
    void *d = kmalloc(150);                  // fits in b's hole
    CHECK(d == b);
    kfree(a); kfree(d); kfree(c);
    CHECK(kheap_blocks() == 1);              // everything coalesced
    CHECK(kheap_used() == base_used);
    CHECK(kmalloc(sizeof arena) == nullptr); // too big
    CHECK(kmalloc(0) == nullptr);

    // Random stress test with content verification.
    void *ptrs[200] = {};
    size_t sizes[200] = {};
    srand(1234);
    for (int round = 0; round < 20000; round++) {
        int i = rand() % 200;
        if (ptrs[i]) {
            uint8_t *p = (uint8_t *)ptrs[i];
            for (size_t k = 0; k < sizes[i]; k++)
                if (p[k] != (uint8_t)i) { CHECK(!"heap corruption"); return; }
            kfree(ptrs[i]); ptrs[i] = nullptr;
        } else {
            sizes[i] = 1 + rand() % 1500;
            ptrs[i] = kmalloc(sizes[i]);
            if (ptrs[i]) memset(ptrs[i], i, sizes[i]);
        }
    }
    for (auto &p : ptrs) kfree(p);
    CHECK(kheap_blocks() == 1);
    CHECK(kheap_used() == base_used);
}

static void test_calc() {
    struct { const char *e; int32_t v; } ok[] = {
        {"1+2*3", 7}, {"(1+2)*3", 9}, {"-5 + 2", -3}, {"10/3", 3}, {"10%3", 1},
        {"0x10 + 1", 17}, {"-(-(4))", 4}, {"2*(3+(4-1))*2", 24}, {"  42  ", 42},
        {"2147483647+1", INT32_MIN},
    };
    for (auto &t : ok) {
        Calculator c; int32_t v = 0; const char *err = nullptr;
        bool r = c.eval(t.e, v, err);
        CHECK(r && v == t.v);
        if (!r || v != t.v) printf("    expr '%s' -> %d (%s)\n", t.e, v, err ? err : "ok");
    }
    const char *bad[] = {"1/0", "5%0", "(1+2", "1+", "abc", "1 2", "", "-2147483648/-1"};
    for (auto e : bad) {
        Calculator c; int32_t v; const char *err = nullptr;
        CHECK(!c.eval(e, v, err) && err);
    }
}

static void test_ramfs() {
    RamFS fs;
    CHECK(fs.write("a.txt", "hello", false));
    CHECK(fs.write("a.txt", " world", true));
    CHECK(fs.find("a.txt") && fs.find("a.txt")->data == "hello world");
    CHECK(!fs.write("bad name", "x", false));
    CHECK(!fs.write("", "x", false));
    for (int i = 0; i < 50; i++) {
        char n[16]; ksnprintf(n, sizeof n, "f%d", i);
        CHECK(fs.write(n, n, false));
    }
    CHECK(fs.files().size() == 51);
    CHECK(fs.remove("f10") && !fs.find("f10") && fs.find("f11"));
    CHECK(fs.rename("f11", "eleven") && fs.find("eleven")->data == "f11");
    CHECK(!fs.rename("f12", "eleven"));      // target exists
    CHECK(!fs.remove("nope"));
    CHECK(fs.total_bytes() == fs.find("a.txt")->data.size() + 10 * 2 + 38 * 3 + 3);
}

// Feed keystrokes to the real C++ shell and capture what it prints.
static const char *run_shell(const char *keys) {
    test_out_len = 0; test_out[0] = 0;
    test_keys = keys;
    if (setjmp(test_done) == 0) shell_main();
    return test_out;
}

static void test_shell() {
    const char *o;

    o = run_shell("help\n");
    CHECK(contains(o, "calc <expr>") && contains(o, "write <file> <txt>"));

    o = run_shell("echo Hello   ConMon\ncalc (2+3)*7\ncalc 1/0\nfoo\n");
    CHECK(contains(o, "Hello ConMon\n"));
    CHECK(contains(o, "35  (0x23)"));
    CHECK(contains(o, "calc: division by zero"));
    CHECK(contains(o, "unknown command: foo"));

    o = run_shell("ls\ncat readme.txt\nwrite notes.txt first line\n"
                  "append notes.txt \"second   line\"\ncat notes.txt\n"
                  "mv notes.txt n.txt\nrm readme.txt\nls\ncat readme.txt\n");
    CHECK(contains(o, "readme.txt"));
    CHECK(contains(o, "Welcome to ConMon!"));
    CHECK(contains(o, "first line\nsecond   line\n"));
    CHECK(contains(o, "n.txt"));
    CHECK(contains(o, "cat: readme.txt: no such file"));

    o = run_shell("echo typo\b\b\b\bok\nhistory\n");    // backspace editing
    CHECK(contains(o, "ok\n"));
    CHECK(contains(o, "1  echo ok"));

    o = run_shell("echo one\necho two\n\x80\n");         // KEY_UP recalls "echo two"
    CHECK(contains(o, "two\nconmon> echo two\ntwo\n"));

    o = run_shell("mem\ncpu\nuptime\nabout\ncolor 99\ncolor 14 1\nsleep 10\nbeep\n");
    CHECK(contains(o, "Kernel heap"));
    CHECK(contains(o, "HostTestCPU!"));
    CHECK(contains(o, "up 0:00:"));
    CHECK(contains(o, "C++"));
    CHECK(contains(o, "color: fg 0-15"));

    // Without a host link, install explains instead of hanging.
    o = run_shell("install\ninstall mp4\nplay x\n");
    CHECK(contains(o, "mp4   MP4 video player"));
    CHECK(contains(o, "No host link found."));
    CHECK(contains(o, "unknown command: play"));

    o = run_shell("reboot\n");
    CHECK(contains(o, "Rebooting"));

    CHECK(!test_panicked);
}

int main() {
    test_printf();
    test_heap();

    static uint8_t arena[4 * 1024 * 1024];   // heap used by the C++ code below
    kheap_init((uintptr_t)arena, sizeof arena);

    test_calc();
    test_ramfs();
    test_shell();

    printf("%d checks, %d failures\n", checks, failures);
    return failures ? 1 : 0;
}
