// ConMon - shell.cpp : the interactive command shell, written in C++.
//
// Each command is an object implementing the Command interface; the Shell
// owns a registry of them, a line editor with history, and the RAM
// filesystem.
#include "shell.hpp"
#include "calc.hpp"

namespace {
uint32_t rng_state = 0x12345678;
uint32_t rand32() {
    rng_state ^= rng_state << 13;
    rng_state ^= rng_state >> 17;
    rng_state ^= rng_state << 5;
    return rng_state;
}

} // namespace

// --- built-in command implementations ---

namespace cmd {

void help(Shell &sh, const Args &) {
    Color c(VGA_YELLOW);
    print("Available commands:\n");
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
    for (Command *k : sh.commands())
        kprintf("  %-20s %s\n", k->usage(), k->help());
}

void clear(Shell &, const Args &) { vga_clear(); }

void echo(Shell &, const Args &a) {
    String s = a.rest(1);
    kprintf("%s\n", s.c_str());
}

void about(Shell &, const Args &) {
    Color c(VGA_LIGHT_CYAN);
    kprintf("%s %s\n", CONMON_NAME, CONMON_VERSION);
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
    print("A hobby operating system for 32-bit x86.\n"
          "  Kernel, drivers, memory: C      Shell, filesystem: C++\n"
          "  Boot: Multiboot (GRUB / QEMU -kernel)\n");
}

void uptime(Shell &, const Args &) {
    uint32_t t = timer_ticks();
    uint32_t s = t / TIMER_HZ;
    kprintf("up %u:%02u:%02u  (%u ticks)\n", s / 3600, (s / 60) % 60, s % 60, t);
}

void mem(Shell &sh, const Args &) {
    size_t used = kheap_used(), total = kheap_total();
    kprintf("RAM detected : %u KiB\n", sys_mem_kb());
    kprintf("Kernel heap  : %u / %u KiB used (%u blocks)\n",
            (uint32_t)(used / 1024), (uint32_t)(total / 1024), (uint32_t)kheap_blocks());
    kprintf("RAM disk     : %u files, %u bytes\n",
            (uint32_t)sh.fs().files().size(), (uint32_t)sh.fs().total_bytes());
}

void cpu(Shell &, const Args &) {
    char vendor[13];
    sys_cpu_vendor(vendor);
    kprintf("CPU vendor: %s\n", vendor);
}

void color(Shell &, const Args &a) {
    if (a.count() < 2) {
        print("colors: 0 black 1 blue 2 green 3 cyan 4 red 5 magenta 6 brown 7 grey\n"
              "        8-15 bright versions (e.g. 10 light green, 14 yellow, 15 white)\n");
        return;
    }
    int fg = atoi(a[1]);
    int bg = a.count() > 2 ? atoi(a[2]) : 0;
    if (fg < 0 || fg > 15 || bg < 0 || bg > 7) { error("color: fg 0-15, bg 0-7"); return; }
    vga_set_color((uint8_t)fg, (uint8_t)bg);
}

void calc(Shell &, const Args &a) {
    String expr = a.rest(1);
    if (expr.empty()) { error("usage: calc <expression>   e.g. calc (2+3)*7"); return; }
    Calculator c;
    int32_t result;
    const char *err;
    if (c.eval(expr.c_str(), result, err))
        kprintf("%d  (0x%x)\n", result, (uint32_t)result);
    else
        error("calc: %s", err);
}

void ls(Shell &sh, const Args &) {
    const auto &files = sh.fs().files();
    if (files.empty()) { print("(no files - try: write hello.txt Hello world)\n"); return; }
    for (const auto &f : files)
        kprintf("  %-6u  %s\n", (uint32_t)f.data.size(), f.name.c_str());
}

void cat(Shell &sh, const Args &a) {
    if (a.count() < 2) { error("usage: cat <file>"); return; }
    RamFS::File *f = sh.fs().find(a[1]);
    if (!f) { error("cat: %s: no such file", a[1]); return; }
    print(f->data.c_str());
    if (f->data.empty() || f->data[f->data.size() - 1] != '\n') kputc('\n');
}

void write_impl(Shell &sh, const Args &a, bool append) {
    if (a.count() < 2) { error(append ? "usage: append <file> <text>" : "usage: write <file> <text>"); return; }
    String text = a.rest(2);
    text += '\n';
    if (!sh.fs().write(a[1], text.c_str(), append))
        error("invalid file name: %s", a[1]);
}
void write(Shell &sh, const Args &a)  { write_impl(sh, a, false); }
void append(Shell &sh, const Args &a) { write_impl(sh, a, true); }

void rm(Shell &sh, const Args &a) {
    if (a.count() < 2) { error("usage: rm <file>"); return; }
    if (!sh.fs().remove(a[1])) error("rm: %s: no such file", a[1]);
}

void mv(Shell &sh, const Args &a) {
    if (a.count() < 3) { error("usage: mv <from> <to>"); return; }
    if (!sh.fs().rename(a[1], a[2])) error("mv: cannot rename %s", a[1]);
}

void history(Shell &sh, const Args &) {
    const auto &h = sh.editor().history();
    for (size_t i = 0; i < h.size(); i++)
        kprintf("  %3u  %s\n", (uint32_t)(i + 1), h[i].c_str());
}

void sleep(Shell &, const Args &a) {
    int ms = a.count() > 1 ? atoi(a[1]) : 1000;
    if (ms < 0) ms = 0;
    timer_sleep((uint32_t)ms);
}

void beep(Shell &, const Args &a) {
    int f = a.count() > 1 ? atoi(a[1]) : 880;
    speaker_beep((uint32_t)(f > 0 ? f : 880), 200);
}

void guess(Shell &sh, const Args &) {
    rng_state ^= timer_ticks() * 2654435761u;
    int secret = (int)(rand32() % 100) + 1;
    print("I'm thinking of a number between 1 and 100. Empty line quits.\n");
    for (int tries = 1;; tries++) {
        String line = sh.editor().read("guess> ");
        if (line.empty()) { kprintf("It was %d.\n", secret); return; }
        int g = atoi(line.c_str());
        if (g < secret) print("Higher!\n");
        else if (g > secret) print("Lower!\n");
        else {
            Color c(VGA_YELLOW);
            kprintf("Correct! You got it in %d tries.\n", tries);
            return;
        }
    }
}

void crash(Shell &, const Args &) {
    print("Dividing by zero to test the exception handler...\n");
    // Done in assembly: in C, 1/0 is undefined behaviour and GCC is free to
    // optimise the division away instead of letting the CPU fault.
    __asm__ volatile ("xorl %%ecx, %%ecx\n\t"
                      "movl $1, %%eax\n\t"
                      "xorl %%edx, %%edx\n\t"
                      "divl %%ecx" : : : "eax", "ecx", "edx");
}

void reboot(Shell &, const Args &) { print("Rebooting...\n"); timer_sleep(300); sys_reboot(); }
void halt(Shell &, const Args &)   { sys_halt(); }

} // namespace cmd

// ------------------------------------------------------------------ shell

Shell::Shell() {
    add(new FnCommand("help",    "help",              "list commands", cmd::help));
    add(new FnCommand("clear",   "clear",             "clear the screen (or Ctrl+L)", cmd::clear));
    add(new FnCommand("echo",    "echo <text>",       "print text", cmd::echo));
    add(new FnCommand("about",   "about",             "about ConMon", cmd::about));
    add(new FnCommand("uptime",  "uptime",            "time since boot", cmd::uptime));
    add(new FnCommand("mem",     "mem",               "memory usage", cmd::mem));
    add(new FnCommand("cpu",     "cpu",               "CPU vendor string", cmd::cpu));
    add(new FnCommand("color",   "color <fg> [bg]",   "change text colors", cmd::color));
    add(new FnCommand("calc",    "calc <expr>",       "integer calculator", cmd::calc));
    add(new FnCommand("ls",      "ls",                "list files", cmd::ls));
    add(new FnCommand("cat",     "cat <file>",        "show a file", cmd::cat));
    add(new FnCommand("write",   "write <file> <txt>","create/overwrite a file", cmd::write));
    add(new FnCommand("append",  "append <file> <txt>","add a line to a file", cmd::append));
    add(new FnCommand("rm",      "rm <file>",         "delete a file", cmd::rm));
    add(new FnCommand("mv",      "mv <from> <to>",    "rename a file", cmd::mv));
    add(new FnCommand("history", "history",           "previous commands", cmd::history));
    add(new FnCommand("sleep",   "sleep <ms>",        "wait", cmd::sleep));
    add(new FnCommand("beep",    "beep [hz]",         "PC speaker beep", cmd::beep));
    add(new FnCommand("guess",   "guess",             "number guessing game", cmd::guess));
    add(new FnCommand("crash",   "crash",             "trigger a CPU exception", cmd::crash));
    add(new FnCommand("reboot",  "reboot",            "restart the machine", cmd::reboot));
    add(new FnCommand("halt",    "halt",              "power off", cmd::halt));

    fs_.write("readme.txt",
              "Welcome to ConMon!\n"
              "This file lives on the RAM disk. Try: ls, cat readme.txt,\n"
              "write notes.txt hello, append notes.txt more, calc 6*7\n", false);

    packages_register(*this);
}

void Shell::execute(const String &line) {
    Args args(line);
    if (args.count() == 0) return;
    for (Command *c : commands_) {
        if (strcmp(c->name(), args[0]) == 0) {
            c->run(*this, args);
            return;
        }
    }
    error("unknown command: %s  (type 'help')", args[0]);
}

void Shell::run() {
    for (;;) {
        String line = editor_.read("conmon> ");
        execute(line);
    }
}

static Shell *the_shell;

extern "C" void shell_main(void) {
    the_shell = new Shell();
    shell_idle_hook = [] { return packages_idle(*the_shell); };
    the_shell->run();
}
