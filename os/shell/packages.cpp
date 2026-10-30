// ConMon - packages.cpp : the package manager and the commands it adds.
//
//   install                  list packages
//   install ps2              PS2 games (Play! emulator) -> lists them, adds `run game`
//   install solMeteo         live weather + ASCII map  -> adds `meteo`
//   install doom             DOOM on the text screen   -> adds `doom`
//   install doomy            a DOOM-style game in Python (Pyodide) -> adds `doomy`
//   install native doom      DOOM run by ConMon itself, 320x200 -> adds `native doom`
//
// ConMon can't emulate a PS2 or reach the internet itself, so
// packages work through the host link (kernel/hostlink.c): ConMon Lab, the
// browser page around the emulator, does the heavy lifting and streams
// results back over the serial port. On QEMU or a real PC there is no host,
// and install says so.
#include "shell.hpp"
#include "conmon_ext.h"

namespace {

bool host_ok;
bool ps2_installed, meteo_installed, doom_installed, doomy_installed, ndoom_installed;

// ------------------------------------------------------------- utilities

uint32_t now_ms() { return timer_ticks() * (1000 / TIMER_HZ); }

// Waits for the next packet. Returns false on timeout (0 = wait forever) or
// when the user presses Ctrl+C / Esc (then *cancelled is set).
bool wait_packet(hl_packet &p, uint32_t timeout_ms, bool *cancelled = nullptr) {
    uint32_t start = now_ms();
    if (cancelled) *cancelled = false;
    for (;;) {
        if (hostlink_poll(&p)) return true;
        if (cancelled) {
            // Only take Ctrl+C / Esc; anything else stays queued so text typed
            // while an answer streams in isn't lost.
            int k = keyboard_peek();
            if (k == 3 || k == 27) { keyboard_poll(); *cancelled = true; return false; }
        }
        if (timeout_ms && now_ms() - start > timeout_ms) return false;
        cpu_halt();
    }
}

// Returns field n (0-based) of "a|b|c" as a String.
String field(const char *s, int n, char sep = '|') {
    for (int i = 0; i < n && *s; s++) if (*s == sep) i++;
    String out;
    while (*s && *s != sep && *s != '\n') out += *s++;
    return out;
}

String lower(const char *s) {
    String out;
    for (; *s; s++) out += (*s >= 'A' && *s <= 'Z') ? (char)(*s + 32) : *s;
    return out;
}

void save_file(Shell &sh, const hl_packet &p, bool append = false) {
    // payload: "<name>\n<content>"; 'Y' packets append the next part
    const char *d = reinterpret_cast<const char *>(p.data);
    String name;
    while (*d && *d != '\n') name += *d++;
    if (*d == '\n') d++;
    sh.fs().write(name.c_str(), d, append);
}

bool host_available() {
    if (host_ok) return true;
    hostlink_reset();
    hostlink_send("hello", CONMON_VERSION);
    hl_packet p;
    uint32_t start = now_ms();
    while (now_ms() - start < 800) {
        if (wait_packet(p, 800) && p.type == 'H') { host_ok = true; return true; }
    }
    return false;
}

void no_host() {
    Color c(VGA_YELLOW);
    print("No host link found.\n");
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
    print("Packages are delivered by ConMon Lab, the browser page that runs ConMon.\n"
          "Open the Kernel Lab page and try again. (QEMU and real PCs have no host.)\n");
}

void draw_progress(int pct, const char *text) {
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    char line[81];
    int filled = pct * 30 / 100, n = 0;
    line[n++] = ' '; line[n++] = '[';
    for (int i = 0; i < 30; i++) line[n++] = i < filled ? '#' : '.';
    line[n++] = ']';
    n += ksnprintf(line + n, sizeof line - n, " %3d%% ", pct);
    for (; *text && n < 79; text++) line[n++] = *text;
    while (n < 79) line[n++] = ' ';
    line[n] = 0;
    kputc('\r');
    Color c(VGA_LIGHT_CYAN);
    print(line);
}

enum JobResult { JOB_OK, JOB_ERROR, JOB_CANCELLED };

// Sends a request and follows the host's progress until it finishes.
// The host sends a keep-alive ('K') every 4 s while it works, so this much
// silence means the page is gone or stuck.
const uint32_t HOST_SILENCE_MS = 30000;

void host_gone(bool showed_bar) {
    if (showed_bar) kputc('\n');
    error("ConMon Lab stopped answering. If the page froze, reload it.");
    hostlink_reset();
}

JobResult host_job_ex(Shell &sh, const char *type, const char *payload, String *done = nullptr) {
    hostlink_send(type, payload);
    bool showed_bar = false, cancelled = false;
    hl_packet p;
    for (;;) {
        if (!wait_packet(p, HOST_SILENCE_MS, &cancelled)) {
            if (cancelled) {
                hostlink_send("cancel", type);
                if (showed_bar) kputc('\n');
                error("Cancelled.");
                return JOB_CANCELLED;
            }
            host_gone(showed_bar);
            return JOB_ERROR;
        }
        const char *d = reinterpret_cast<const char *>(p.data);
        switch (p.type) {
        case 'P':                                   // "<percent>|<text>"
            draw_progress(atoi(field(d, 0).c_str()), field(d, 1).c_str());
            showed_bar = true;
            break;
        case 'W':
            save_file(sh, p);
            break;
        case 'Y':
            save_file(sh, p, true);
            break;
        case 'M':
            if (showed_bar) { kputc('\n'); showed_bar = false; }
            kprintf("%s\n", d);
            break;
        case 'D':
            if (showed_bar) kputc('\n');
            if (done) *done = d;
            return JOB_OK;
        case 'E':
            if (showed_bar) kputc('\n');
            error("%s", d);
            return JOB_ERROR;
        default:
            break;
        }
    }
}

bool host_job(Shell &sh, const char *type, const char *payload, String *done = nullptr) {
    return host_job_ex(sh, type, payload, done) == JOB_OK;
}

// ------------------------------------------------------------- packages

void cmd_meteo(Shell &sh, const Args &a);
void cmd_doom(Shell &sh, const Args &a);
void cmd_doomy(Shell &sh, const Args &a);

void list_packages() {
    Color c(VGA_YELLOW);
    print("Packages (delivered by ConMon Lab):\n");
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
    kprintf("  ps2        PS2 games (Quake II) in the Play! PS2 emulator      %s\n",
            ps2_installed ? "[installed]" : "");
    kprintf("  solMeteo   Live weather from Open-Meteo with an ASCII world map  %s\n",
            meteo_installed ? "[installed]" : "");
    kprintf("  doom       DOOM (shareware Episode 1) on ConMon's text screen    %s\n",
            doom_installed ? "[installed]" : "");
    kprintf("  doomy      A DOOM-style game written in Python (runs in Pyodide)  %s\n",
            doomy_installed ? "[installed]" : "");
    kprintf("  native doom  DOOM run by ConMon itself, 320x200 in 256 colours  %s\n",
            ndoom_installed ? "[installed]" : "");
    print("Usage: install <name>    e.g. install ps2\n");
}

// ------------------------------------------------------------------- ps2
//
// A PlayStation 2 can't run on ConMon's 486, so ConMon Lab opens the Play!
// PS2 emulator next to it. ConMon picks the game; the page plays it.

void cmd_run(Shell &sh, const Args &a) {
    String what = lower(a[1]);
    if (a.count() < 2 || what != "game") { error("Usage: run game <letter>   (type install ps2 for the list)"); return; }
    if (!host_available()) { no_host(); return; }
    if (a.count() < 3) { host_job(sh, "ps2.list", ""); return; }
    host_job(sh, "ps2.run", a[2]);
}

// ------------------------------------------------------------------ meteo

// Draws a full-screen frame from the host: a <rows> byte, rows*80 characters,
// then rows*80 colour attributes. Returns the number of rows drawn.
int draw_frame(const hl_packet &p) {
    if (p.len < 1) return 0;
    int rows = p.data[0];
    if (rows < 1 || rows > 25 || p.len < (uint32_t)(1 + rows * 160)) return 0;
    const uint8_t *ch = p.data + 1, *at = ch + rows * 80;
    for (int i = 0; i < rows * 80; i++) vga_put_at((char)ch[i], at[i], i % 80, i / 80);
    return rows;
}

// Looks up one place: the host geocodes it, fetches the forecast from
// Open-Meteo and animates a map zooming in on it.
void show_place(const char *place) {
    {
        Color c(VGA_LIGHT_CYAN);
        kprintf("Looking up %s...\n", place);
    }
    hostlink_send("meteo.show", place);
    bool cleared = false, cancelled = false;
    int rows = 0;
    hl_packet p;
    for (;;) {
        if (!wait_packet(p, 30000, &cancelled)) {
            if (cancelled) { hostlink_send("meteo.stop", ""); error("Cancelled."); }
            else error("No answer from the weather service.");
            break;
        }
        if (p.type == 'A') {
            if (!cleared) { vga_clear(); vga_cursor_visible(0); cleared = true; }
            rows = draw_frame(p);
        } else if (p.type == 'M') {
            kprintf("%s\n", reinterpret_cast<const char *>(p.data));
        } else if (p.type == 'E') {
            error("%s", reinterpret_cast<const char *>(p.data));
            break;
        } else if (p.type == 'D') {
            break;
        }
    }
    if (cleared) {
        vga_cursor_visible(1);
        vga_set_cursor(0, rows < 25 ? rows : 24);
    }
}

// "cities" or "cities <country>": browse the built-in city list.
bool is_cities(const char *text) {
    return strncmp(lower(text).c_str(), "cities", 6) == 0 && (text[6] == 0 || text[6] == ' ');
}

void meteo_input(Shell &sh, const char *text) {
    if (is_cities(text)) {
        const char *arg = text + 6;
        while (*arg == ' ') arg++;
        host_job(sh, "meteo.cities", arg);
    } else {
        show_place(text);
    }
}

void meteo_loop(Shell &sh, const char *first) {
    if (first && *first) meteo_input(sh, first);
    else print("Type a place (a city, town or region), or cities to browse the built-in list.\n"
               "Empty line or exit to leave.\n");
    for (;;) {
        String place = sh.editor().read("location> ", false, 60);
        if (place.empty() || place == "exit" || place == "quit") { print("Bye from solMeteo!\n"); return; }
        meteo_input(sh, place.c_str());
    }
}

void cmd_meteo(Shell &sh, const Args &a) {
    if (!host_available()) { no_host(); return; }
    String place = a.rest(1);
    meteo_loop(sh, place.c_str());
}

// ------------------------------------------------------------------- doom

// A game the host runs: ConMon sends raw key presses and releases out of the
// serial port and draws the full-screen frames the host sends back ('A'
// packets, half-block "pixels"). F12 returns to the shell.
void play_hosted_game(const char *name, const char *start, const char *keys_msg, const char *stop,
                      const char *arg = "") {
    hostlink_send(start, arg);
    keyboard_set_raw(1);
    vga_cursor_visible(0);
    bool drew = false, ended = false;
    String err;
    hl_packet p;
    uint32_t last = now_ms();
    char keys[96];
    while (!ended) {
        // Forward every scancode, batched as hex pairs: "1d 9d e048"
        int n = 0, k;
        bool quit = false;
        while ((k = keyboard_poll()) >= 0 && n < 90) {
            if (k == 0x58) { quit = true; break; }            /* F12 pressed */
            static const char hx[] = "0123456789abcdef";
            keys[n++] = hx[(k >> 4) & 15];
            keys[n++] = hx[k & 15];
        }
        if (n) { keys[n] = 0; hostlink_send(keys_msg, keys); }
        if (quit) { hostlink_send(stop, ""); break; }

        if (hostlink_poll(&p)) {
            last = now_ms();
            if (p.type == 'A') {
                draw_frame(p);
                drew = true;
                hostlink_send("game.ack", "");
            } else if (p.type == 'Q' && p.len >= 48) {
                vga_set_palette16(p.data);
            } else if (p.type == 'X') {
                ended = true;
            } else if (p.type == 'E') {
                err = reinterpret_cast<const char *>(p.data);
                ended = true;
            }
            continue;
        }
        if (now_ms() - last > (drew ? 8000u : 30000u)) { err = "The game stopped sending frames."; break; }
        cpu_halt();
    }
    keyboard_set_raw(0);
    vga_reset_palette();
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
    vga_clear();
    vga_cursor_visible(1);
    if (!err.empty()) {
        String msg = name;
        msg += ": ";
        msg += err;
        error("%s", msg.c_str());
    }
    else kprintf("Back in ConMon. Type %s to play again.\n", name);
}

// doom: half-block pixels.  doom ascii: the same game drawn in ASCII art,
// one character per text cell, its density following the brightness.
void cmd_doom(Shell &, const Args &a) {
    bool ascii = a.count() > 1 && lower(a[1]) == "ascii";
    if (a.count() > 1 && !ascii) { error("Usage: doom [ascii]"); return; }
    if (!host_available()) { no_host(); return; }
    play_hosted_game(ascii ? "doom ascii" : "doom", "doom.start", "doom.k", "doom.stop", ascii ? "ascii" : "");
}

void cmd_doomy(Shell &, const Args &) {
    if (!host_available()) { no_host(); return; }
    play_hosted_game("doomy", "doomy.start", "doomy.k", "doomy.stop");
}

// native doom: DOOM compiled for ConMon (ext/ in the repo). The host writes
// the extension and the WAD straight into memory; ConMon checks and runs it.
void cmd_native(Shell &sh, const Args &a) {
    if (a.count() < 2 || lower(a[1]) != "doom") { error("Usage: native doom"); return; }
    if (!host_available()) { no_host(); return; }
    if (sys_mem_kb() < CMX_MIN_RAM_KB) {
        char m[100];
        ksnprintf(m, sizeof m, "native doom needs 48 MB of RAM; this PC has %u MB. Pick 64 MB and boot again.", sys_mem_kb() / 1024);
        error("%s", m);
        return;
    }
    if (!vbe_available()) { error("No VBE graphics card found."); return; }
    char req[96];
    ksnprintf(req, sizeof req, "doom|%x|%x|%x|%x", CMX_LOAD_ADDR, CMX_IMAGE_MAX, CMX_DATA_ADDR, CMX_DATA_MAX);
    String done;
    if (!host_job(sh, "ext.load", req, &done)) return;
    uint32_t data_size = (uint32_t)atoi(field(done.c_str(), 1).c_str());
    char err[96];
    if (!ext_check(data_size, err, sizeof err)) { error("%s", err); return; }
    print("Starting DOOM. F12 comes back to ConMon.\n");
    timer_sleep(400);
    uint32_t start = timer_ticks(), frames = 0;
    char msg[160];
    int r = ext_run(data_size, "doom1.wad", "", &frames, msg, sizeof msg);
    hostlink_send("ext.done", "doom");
    uint32_t secs10 = (timer_ticks() - start) * 10 / TIMER_HZ;
    vga_clear();
    vga_cursor_visible(1);
    if (r != 0 && msg[0]) { String m("DOOM stopped: "); m += msg; error("%s", m.c_str()); }
    if (secs10) {
        uint32_t fps10 = frames * 100 / secs10;
        kprintf("Native DOOM drew %u frames in %u.%u s: %u.%u frames a second", frames,
                secs10 / 10, secs10 % 10, fps10 / 10, fps10 % 10);
        print(fps10 >= 350 ? " (full speed: DOOM's game runs at 35).\n" : ".\n");
    }
    print("Back in ConMon. Type native doom to play again.\n");
}

void doom_controls() {
    print("  Arrows move and turn    Ctrl fire    Space open doors    Shift run\n"
          "  Alt+arrows or , . strafe    1-7 weapons    Tab map    Esc menu\n"
          "  F12 goes back to ConMon. On a phone, use the DOOM pad under the screen.\n");
}

// apple: facts the ConMon XNU iPhone app read from the phone's XNU kernel.
// android: opens the window that links to Android on your own server.
void cmd_apple(Shell &sh, const Args &) {
    if (!host_available()) { no_host(); return; }
    host_job(sh, "apple.info", "");
}

void cmd_android(Shell &sh, const Args &) {
    if (!host_available()) { no_host(); return; }
    if (host_job(sh, "window.android", ""))
        print("Opened the Android window in ConMon Lab: real Android 12 runs on your\n"
              "own server (android-server/ in the repo) and streams to the browser.\n");
}

// ---------------------------------------------------------------- install

void cmd_install(Shell &sh, const Args &a) {
    if (a.count() < 2) { list_packages(); return; }
    String name = lower(a[1]);
    bool ps2 = name == "ps2";
    bool meteo = name == "solmeteo" || name == "meteo";
    bool doom = name == "doom";
    bool doomy = name == "doomy";
    bool ndoom = name == "native" && a.count() > 2 && lower(a[2]) == "doom";
    if (name == "native" && !ndoom) { error("Did you mean install native doom?"); return; }
    if (ndoom) doom = false;
    if (!ps2 && !meteo && !doom && !doomy && !ndoom) { error("No package named %s. Type install to see the list.", a[1]); return; }
    if (!host_available()) { no_host(); return; }

    if (ndoom) {
        if (!host_job(sh, "pkg.install", "nativedoom")) return;
        ndoom_installed = true;
        if (!sh.has("native"))
            sh.add(new FnCommand("native", "native doom", "DOOM run by ConMon itself (F12 quits)", cmd_native));
        {
            Color c(VGA_LIGHT_GREEN);
            print("Installed native doom. ");
        }
        print("New command: native doom. Here ConMon's own CPU runs DOOM and draws\n"
              "320x200 in 256 colours (the doom command lets the page run it instead).\n"
              "  Arrows move   Ctrl fire   Space use/open   Shift run   F12 back\n");
        return;
    }

    if (doomy) {
        if (!host_job(sh, "pkg.install", "doomy")) return;
        doomy_installed = true;
        if (!sh.has("doomy"))
            sh.add(new FnCommand("doomy", "doomy", "play doomy, the Python game (F12 quits)", cmd_doomy));
        {
            Color c(VGA_LIGHT_GREEN);
            print("Installed doomy. ");
        }
        print("New command: doomy. A DOOM-style game written in Python.\n"
              "  Arrows or WASD move and turn   Q/E strafe   Ctrl or Space fire\n"
              "  Shift run   Enter start   F12 back to ConMon\n");
        return;
    }

    if (doom) {
        if (!host_job(sh, "pkg.install", "doom")) return;
        doom_installed = true;
        if (!sh.has("doom"))
            sh.add(new FnCommand("doom", "doom [ascii]", "play DOOM, or DOOM in ASCII art (F12 quits)", cmd_doom));
        {
            Color c(VGA_LIGHT_GREEN);
            print("Installed doom. ");
        }
        print("New command: doom. Controls:\n");
        doom_controls();
        print("Type doom to play, or doom ascii for DOOM drawn in ASCII characters.\n");
        return;
    }

    if (meteo) {
        if (!host_job(sh, "pkg.install", "solmeteo")) return;
        meteo_installed = true;
        if (!sh.has("meteo"))
            sh.add(new FnCommand("meteo", "meteo [place]", "weather and map (solMeteo package)", cmd_meteo));
        {
            Color c(VGA_LIGHT_GREEN);
            print("Installed solMeteo. ");
        }
        print("New command: meteo. Weather data by Open-Meteo.com.\n");
        String place = a.rest(2);
        meteo_loop(sh, place.c_str());
        return;
    }

    if (!host_job(sh, "pkg.install", "ps2")) return;
    ps2_installed = true;
    if (!sh.has("run"))
        sh.add(new FnCommand("run", "run game <letter>", "play a PS2 game (ps2 package)", cmd_run));
    {
        Color c(VGA_LIGHT_GREEN);
        print("Installed ps2. ");
    }
    print("New command: run game <letter>, e.g. run game A\n");
}

} // namespace

void packages_register(Shell &sh) {
    sh.add(new FnCommand("install", "install <package>", "install ps2, solMeteo, doom, doomy or native doom", cmd_install));
    sh.add(new FnCommand("apple", "apple", "iPhone kernel (XNU) info from the ConMon XNU app", cmd_apple));
    sh.add(new FnCommand("android", "android", "open Android running on your own server", cmd_android));
}

// Handles messages the host sends on its own while the shell waits for input.
bool packages_idle(Shell &) {
    if (!serial_available()) return false;
    hl_packet p;
    bool printed = false;
    while (hostlink_poll(&p)) {
        if (p.type == 'M') {
            kprintf("\n[ConMon Lab] %s\n", reinterpret_cast<const char *>(p.data));
            printed = true;
        }
    }
    return printed;
}
