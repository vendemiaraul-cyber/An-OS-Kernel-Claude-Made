// ConMon - shell.hpp : shared pieces of the C++ shell (arguments, line
// editor, the Command interface and the Shell itself).
#ifndef CONMON_SHELL_HPP
#define CONMON_SHELL_HPP

#include "kstd.hpp"
#include "ramfs.hpp"

using kstd::String;
using kstd::Vector;

// ---------------------------------------------------------------- helpers

struct Color {
    explicit Color(uint8_t fg) : saved_(vga_get_color()) {
        vga_set_color(fg, saved_ >> 4);
    }
    ~Color() { vga_set_color(saved_ & 0x0F, saved_ >> 4); }
private:
    uint8_t saved_;
};

inline void print(const char *s) { kputs(s); }

inline void error(const char *fmt, const char *arg = "") {
    Color c(VGA_LIGHT_RED);
    kprintf(fmt, arg);
    kputc('\n');
}

// -------------------------------------------------------------- arguments

class Args {
public:
    // Splits a line into words; "double quotes" group words together.
    explicit Args(const String &line) {
        const char *p = line.c_str();
        while (*p) {
            while (*p == ' ') p++;
            if (!*p) break;
            String word;
            if (*p == '"') {
                p++;
                while (*p && *p != '"') word += *p++;
                if (*p == '"') p++;
            } else {
                while (*p && *p != ' ') word += *p++;
            }
            words_.push_back(kstd::move(word));
        }
    }

    size_t count() const { return words_.size(); }
    const char *operator[](size_t i) const { return i < words_.size() ? words_[i].c_str() : ""; }

    // Everything from word `from` onward, joined by single spaces.
    String rest(size_t from) const {
        String s;
        for (size_t i = from; i < words_.size(); i++) {
            if (i > from) s += ' ';
            s += words_[i];
        }
        return s;
    }

private:
    Vector<String> words_;
};

// ------------------------------------------------------------ line editor

// Called while the shell waits for a key. Returns true if it printed
// something, so the editor knows to redraw the prompt and current line.
inline bool (*shell_idle_hook)() = nullptr;

class LineEditor {
public:
    // remember=false keeps the line out of history (chat, menus).
    String read(const char *prompt, bool remember = true, size_t max_len = 200) {
        {
            Color c(VGA_LIGHT_GREEN);
            print(prompt);
        }
        String line;
        size_t hist_pos = history_.size();

        for (;;) {
            int ch = keyboard_poll();
            if (ch < 0) {
                if (shell_idle_hook && shell_idle_hook()) {
                    Color c(VGA_LIGHT_GREEN);
                    print(prompt);
                    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
                    print(line.c_str());
                }
                cpu_halt();
                continue;
            }
            if (ch == '\n') {
                kputc('\n');
                break;
            } else if (ch == '\b') {
                if (!line.empty()) { line.pop_back(); kputc('\b'); }
            } else if (ch == 3) {                  // Ctrl+C: abandon line
                print("^C\n");
                line.clear();
                break;
            } else if (ch == 12) {                 // Ctrl+L: clear screen
                vga_clear();
                Color c(VGA_LIGHT_GREEN);
                print(prompt);
                vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
                print(line.c_str());
            } else if (ch == KEY_UP || ch == KEY_DOWN) {
                if (history_.empty()) continue;
                if (ch == KEY_UP && hist_pos > 0) hist_pos--;
                else if (ch == KEY_DOWN && hist_pos < history_.size()) hist_pos++;
                while (!line.empty()) { line.pop_back(); kputc('\b'); }
                if (hist_pos < history_.size()) line = history_[hist_pos];
                print(line.c_str());
            } else if (ch >= 32 && ch < 127 && line.size() < max_len) {
                line += (char)ch;
                kputc((char)ch);
            }
        }

        if (remember && !line.empty() && (history_.empty() || history_[history_.size() - 1] != line.c_str())) {
            if (history_.size() >= 32) history_.erase(0);
            history_.push_back(line);
        }
        return line;
    }

    const Vector<String> &history() const { return history_; }

private:
    Vector<String> history_;
};

// --------------------------------------------------------------- commands

class Shell;

class Command {
public:
    virtual ~Command() = default;
    virtual const char *name() const = 0;
    virtual const char *usage() const { return name(); }
    virtual const char *help() const = 0;
    virtual void run(Shell &sh, const Args &args) = 0;
};

class Shell {
public:
    Shell();
    [[noreturn]] void run();
    void execute(const String &line);

    const Vector<Command *> &commands() const { return commands_; }
    RamFS &fs() { return fs_; }
    LineEditor &editor() { return editor_; }

    void add(Command *c) { commands_.push_back(c); }
    bool has(const char *name) const {
        for (Command *c : commands_) if (strcmp(c->name(), name) == 0) return true;
        return false;
    }

private:
    Vector<Command *> commands_;
    LineEditor        editor_;
    RamFS             fs_;
};

// A lightweight command defined by a name, help text and a function.
class FnCommand : public Command {
public:
    using Fn = void (*)(Shell &, const Args &);
    FnCommand(const char *name, const char *usage, const char *help, Fn fn)
        : name_(name), usage_(usage), help_(help), fn_(fn) {}
    const char *name() const override { return name_; }
    const char *usage() const override { return usage_; }
    const char *help() const override { return help_; }
    void run(Shell &sh, const Args &a) override { fn_(sh, a); }

private:
    const char *name_, *usage_, *help_;
    Fn fn_;
};

// Package manager entry points (packages.cpp).
void packages_register(Shell &sh);
bool packages_idle(Shell &sh);

#endif
