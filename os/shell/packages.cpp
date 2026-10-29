// ConMon - packages.cpp : the package manager and the commands it adds.
//
//   install                  list packages
//   install llm              chat with an AI model     -> adds `models`, `load`, `mp`
//   install llm all          ...and download every model right away
//   install solMeteo         live weather + ASCII map  -> adds `meteo`
//   install doom             DOOM on the text screen   -> adds `doom`
//   install doomy            a DOOM-style game in Python (Pyodide) -> adds `doomy`
//
// ConMon can't run a neural network or reach the internet itself, so
// packages work through the host link (kernel/hostlink.c): ConMon Lab, the
// browser page around the emulator, does the heavy lifting and streams
// results back over the serial port. On QEMU or a real PC there is no host,
// and install says so.
#include "shell.hpp"

namespace {

bool host_ok;
bool llm_installed, meteo_installed, doom_installed, doomy_installed;

struct Model {
    char   letter;
    String id, size, label;
    String status;                      // "downloaded", "ready", "on your PC" or empty
    String engine;                      // section heading, e.g. "Ollama - on your PC"
};
Vector<Model> models;
String ready_id, ready_label;           // model downloaded and loaded this session

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

void save_file(Shell &sh, const hl_packet &p) {
    // payload: "<name>\n<content>"
    const char *d = reinterpret_cast<const char *>(p.data);
    String name;
    while (*d && *d != '\n') name += *d++;
    if (*d == '\n') d++;
    sh.fs().write(name.c_str(), d, false);
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
JobResult host_job_ex(Shell &sh, const char *type, const char *payload) {
    hostlink_send(type, payload);
    bool showed_bar = false, cancelled = false;
    hl_packet p;
    for (;;) {
        if (!wait_packet(p, 0, &cancelled)) {
            if (cancelled) {
                hostlink_send("cancel", type);
                if (showed_bar) kputc('\n');
                error("Cancelled.");
                return JOB_CANCELLED;
            }
            continue;
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
        case 'M':
            if (showed_bar) { kputc('\n'); showed_bar = false; }
            kprintf("%s\n", d);
            break;
        case 'D':
            if (showed_bar) kputc('\n');
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

bool host_job(Shell &sh, const char *type, const char *payload) {
    return host_job_ex(sh, type, payload) == JOB_OK;
}

// -------------------------------------------------------------- word wrap

class Wrapper {
public:
    explicit Wrapper(int indent) : indent_(indent), col_(indent) {}
    void put(const char *s) {
        for (; *s; s++) {
            if (*s == '\n') { flush(); kputc('\n'); pad(); continue; }
            if (*s == ' ') { flush(); if (col_ < 79) { kputc(' '); col_++; } continue; }
            if ((unsigned char)*s < 32) continue;
            word_ += *s;
            if (word_.size() > 60) flush();
        }
    }
    void flush() {
        if (word_.empty()) return;
        if (col_ + (int)word_.size() > 79) { kputc('\n'); pad(); }
        print(word_.c_str());
        col_ += (int)word_.size();
        word_.clear();
    }

private:
    void pad() { for (col_ = 0; col_ < indent_; col_++) kputc(' '); }
    int indent_, col_;
    String word_;
};

// ----------------------------------------------------------------- models

void cmd_models(Shell &sh, const Args &a);
void cmd_load(Shell &sh, const Args &a);
void cmd_mp(Shell &sh, const Args &a);
void cmd_meteo(Shell &sh, const Args &a);
void cmd_doom(Shell &sh, const Args &a);
void cmd_doomy(Shell &sh, const Args &a);

void list_packages() {
    Color c(VGA_YELLOW);
    print("Packages (delivered by ConMon Lab):\n");
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
    kprintf("  llm        AI chat: SmartestChild, Transformers.js, WebLLM, Ollama %s\n",
            llm_installed ? "[installed]" : "");
    kprintf("  solMeteo   Live weather from Open-Meteo with an ASCII world map  %s\n",
            meteo_installed ? "[installed]" : "");
    kprintf("  doom       DOOM (shareware Episode 1) on ConMon's text screen    %s\n",
            doom_installed ? "[installed]" : "");
    kprintf("  doomy      A DOOM-style game written in Python (runs in Pyodide)  %s\n",
            doomy_installed ? "[installed]" : "");
    print("Usage: install <name>    e.g. install solMeteo\n"
          "       install llm all   installs llm and downloads every model\n");
}

// Asks the host for the model list. Messages the host sends first (setup
// hints for engines that aren't available) are printed unless quiet.
bool fetch_models(bool quiet = false) {
    hostlink_send("llm.models", "");
    hl_packet p;
    for (;;) {
        bool cancelled;
        if (!wait_packet(p, 60000, &cancelled)) { error(cancelled ? "Cancelled." : "The host did not answer."); return false; }
        if (p.type == 'M') { if (!quiet) kprintf("%s\n", reinterpret_cast<const char *>(p.data)); continue; }
        if (p.type == 'E') { error("%s", reinterpret_cast<const char *>(p.data)); return false; }
        if (p.type == 'L') break;
    }

    // One model per line: "A|engine:model-id|879 MB|Llama 3.2 1B|status|Engine heading"
    models.clear();
    const char *d = reinterpret_cast<const char *>(p.data);
    while (*d) {
        Model m;
        m.letter = *d;
        m.id     = field(d, 1);
        m.size   = field(d, 2);
        m.label  = field(d, 3);
        m.status = field(d, 4);
        m.engine = field(d, 5);
        models.push_back(kstd::move(m));
        while (*d && *d != '\n') d++;
        if (*d == '\n') d++;
    }
    if (models.empty()) { error("No models can run on this device."); return false; }
    return true;
}

void show_models() {
    {
        Color c(VGA_YELLOW);
        print("\nAI models that can run here:\n");
    }
    const char *heading = "";
    for (const auto &m : models) {
        if (m.engine != heading) {                  // new engine section
            heading = m.engine.c_str();
            Color c(VGA_LIGHT_CYAN);
            kprintf(" %s\n", heading);
        }
        Color c(m.status.empty() ? VGA_LIGHT_GREY : VGA_LIGHT_GREEN);
        kprintf("   %c  %-30s %9s  %s\n", m.letter, m.label.c_str(), m.size.c_str(), m.status.c_str());
    }
    print("\n");
}

const Model *find_model(const char *text) {
    char want = text[0];
    if (want >= 'a' && want <= 'z') want = (char)(want - 32);
    if (text[0] && !text[1]) {
        for (const auto &m : models) if (m.letter == want) return &m;
    }
    return nullptr;
}

// Downloads (if needed) and loads a model so `load` can chat with it.
bool prepare_model(Shell &sh, const Model &m) {
    if (m.status.empty())
        kprintf("Downloading %s (%s). This runs once; it's cached in your browser.\n",
                m.label.c_str(), m.size.c_str());
    else
        kprintf("Getting %s ready...\n", m.label.c_str());
    if (!host_job(sh, "llm.download", m.id.c_str())) return false;
    ready_id = m.id;
    ready_label = m.label;
    return true;
}

bool pick_model(Shell &sh) {
    if (!fetch_models()) return false;
    show_models();
    String choice = sh.editor().read("Type a letter to choose (Enter to skip): ", false, 2);
    if (choice.empty()) { print("No model chosen. Type models to see the list again.\n"); return false; }
    const Model *m = find_model(choice.c_str());
    if (!m) { error("No model with letter %s.", choice.c_str()); return false; }
    if (!prepare_model(sh, *m)) return false;
    Color c(VGA_LIGHT_GREEN);
    kprintf("%s is ready. Type load to talk with it.\n", m->label.c_str());
    return true;
}

// "~270 MB" / "1.4 GB" -> megabytes (rough; only used for the total).
uint32_t size_mb(const String &s) {
    const char *p = s.c_str();
    while (*p && (*p < '0' || *p > '9')) p++;
    uint32_t whole = 0, frac = 0, fdiv = 1;
    while (*p >= '0' && *p <= '9') whole = whole * 10 + (uint32_t)(*p++ - '0');
    if (*p == '.') for (p++; *p >= '0' && *p <= '9' && fdiv < 1000; p++) { frac = frac * 10 + (uint32_t)(*p - '0'); fdiv *= 10; }
    bool gb = false;
    for (; *p; p++) if (*p == 'G') gb = true;
    return gb ? whole * 1000 + frac * 1000 / fdiv : whole;
}

// install llm all: download every browser model in one go.
void install_all_models(Shell &sh) {
    if (!fetch_models(true)) return;
    Vector<size_t> todo;
    uint32_t total = 0;
    for (size_t i = 0; i < models.size(); i++) {
        const Model &m = models[i];
        bool browser = strncmp(m.id.c_str(), "tfjs:", 5) == 0 || strncmp(m.id.c_str(), "webllm:", 7) == 0;
        if (browser && m.status.empty()) { todo.push_back(i); total += size_mb(m.size); }
    }
    if (todo.empty()) {
        Color c(VGA_LIGHT_GREEN);
        print("Every model is already downloaded or ready. Type models to pick one.\n");
        return;
    }
    {
        Color c(VGA_YELLOW);
        kprintf("This downloads %u models, about %u.%u GB, into your browser's storage.\n",
                (uint32_t)todo.size(), total / 1000, (total % 1000) / 100);
    }
    print("SmartestChild and Ollama models need no download. Ctrl+C stops at any time.\n");
    String yes = sh.editor().read("Download them all? (y/N): ", false, 3);
    if (yes.empty() || (yes[0] != 'y' && yes[0] != 'Y')) { print("Skipped. Type models to pick just one.\n"); return; }

    uint32_t ok = 0;
    for (size_t n = 0; n < todo.size(); n++) {
        const Model &m = models[todo[n]];
        {
            Color c(VGA_WHITE);
            kprintf("[%u/%u] %c  %s (%s)\n", (uint32_t)(n + 1), (uint32_t)todo.size(), m.letter, m.label.c_str(), m.size.c_str());
        }
        JobResult r = host_job_ex(sh, "llm.download", m.id.c_str());
        if (r == JOB_CANCELLED) break;
        if (r == JOB_OK) { ok++; ready_id = m.id; ready_label = m.label; }
    }
    Color c(ok ? VGA_LIGHT_GREEN : VGA_YELLOW);
    kprintf("Downloaded %u of %u models. Type models to see them, or load <letter> to chat.\n",
            ok, (uint32_t)todo.size());
}

void cmd_models(Shell &sh, const Args &) {
    if (!host_available()) { no_host(); return; }
    pick_model(sh);
}

void chat(Shell &sh) {
    {
        Color c(VGA_YELLOW);
        kprintf("Talking to %s.\n", ready_label.c_str());
    }
    print("Type exit to leave, reset for a new conversation. Ctrl+C stops an answer.\n\n");
    for (;;) {
        String line = sh.editor().read("you> ", false, 300);
        if (line.empty()) continue;
        if (line == "exit" || line == "quit") { print("Bye!\n"); return; }
        if (line == "reset") {
            hostlink_send("llm.reset", "");
            print("(new conversation)\n");
            continue;
        }
        hostlink_send("llm.chat", line.c_str());
        {
            Color c(VGA_LIGHT_CYAN);
            print("ai> ");
        }
        Wrapper w(4);
        Color c(VGA_WHITE);
        hl_packet p;
        bool stopped = false;
        for (;;) {
            bool cancelled;
            if (!wait_packet(p, 0, &cancelled)) {
                if (cancelled && !stopped) { hostlink_send("llm.stop", ""); stopped = true; }
                continue;
            }
            if (p.type == 'T') w.put(reinterpret_cast<const char *>(p.data));
            else if (p.type == 'X') break;
            else if (p.type == 'E') { w.flush(); kputc('\n'); error("%s", reinterpret_cast<const char *>(p.data)); break; }
            else if (p.type == 'P') { /* model still loading: ignore */ }
        }
        w.flush();
        if (stopped) print(" [stopped]");
        print("\n\n");
    }
}

void cmd_load(Shell &sh, const Args &a) {
    if (!host_available()) { no_host(); return; }
    if (a.count() > 1) {
        if (models.empty() && !fetch_models(true)) return;
        const Model *m = find_model(a[1]);
        if (!m) { error("No model with letter %s. Type models to see the list.", a[1]); return; }
        if (m->id != ready_id.c_str()) {
            kprintf("Loading %s (%s)...\n", m->label.c_str(), m->size.c_str());
            if (!host_job(sh, "llm.download", m->id.c_str())) return;
            ready_id = m->id;
            ready_label = m->label;
        }
    }
    if (ready_id.empty()) {
        error("No model chosen yet. Type models and pick one with its letter.");
        return;
    }
    if (!host_job(sh, "llm.load", ready_id.c_str())) return;
    chat(sh);
}

// mp finder [letter]: facts about the AI models (some fetched live).
void cmd_mp(Shell &sh, const Args &a) {
    if (a.count() < 2 || lower(a[1]) != "finder") {
        print("usage: mp finder           overview of every AI model\n"
              "       mp finder <letter>  details for one model, e.g. mp finder E\n");
        return;
    }
    if (!host_available()) { no_host(); return; }
    if (models.empty() && !fetch_models(true)) return;
    String target;
    if (a.count() > 2) {
        const Model *m = find_model(a[2]);
        if (!m) { error("No model with letter %s. Type mp finder to see the letters.", a[2]); return; }
        target = m->id;
        Color c(VGA_LIGHT_CYAN);
        kprintf("Finding info on %s...\n", m->label.c_str());
    }
    host_job(sh, "llm.info", target.c_str());
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
void play_hosted_game(const char *name, const char *start, const char *keys_msg, const char *stop) {
    hostlink_send(start, "");
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

void cmd_doom(Shell &, const Args &) {
    if (!host_available()) { no_host(); return; }
    play_hosted_game("doom", "doom.start", "doom.k", "doom.stop");
}

void cmd_doomy(Shell &, const Args &) {
    if (!host_available()) { no_host(); return; }
    play_hosted_game("doomy", "doomy.start", "doomy.k", "doomy.stop");
}

void doom_controls() {
    print("  Arrows move and turn    Ctrl fire    Space open doors    Shift run\n"
          "  Alt+arrows or , . strafe    1-7 weapons    Tab map    Esc menu\n"
          "  F12 goes back to ConMon. On a phone, use the DOOM pad under the screen.\n");
}

// ---------------------------------------------------------------- install

void cmd_install(Shell &sh, const Args &a) {
    if (a.count() < 2) { list_packages(); return; }
    String name = lower(a[1]);
    bool llm = name == "llm";
    bool meteo = name == "solmeteo" || name == "meteo";
    bool doom = name == "doom";
    bool doomy = name == "doomy";
    if (!llm && !meteo && !doom && !doomy) { error("No package named %s. Type install to see the list.", a[1]); return; }
    if (!host_available()) { no_host(); return; }

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
            sh.add(new FnCommand("doom", "doom", "play DOOM (doom package; F12 quits)", cmd_doom));
        {
            Color c(VGA_LIGHT_GREEN);
            print("Installed doom. ");
        }
        print("New command: doom. Controls:\n");
        doom_controls();
        print("Type doom to play.\n");
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

    String opt = lower(a[2]);
    bool all = opt == "all" || opt == "{all}";
    if (a.count() > 2 && !all) { error("Unknown option %s. Try: install llm all", a[2]); return; }

    if (!host_job(sh, "pkg.install", "llm")) return;
    llm_installed = true;
    if (!sh.has("load")) {
        sh.add(new FnCommand("models", "models", "pick an AI model (llm package)", cmd_models));
        sh.add(new FnCommand("load", "load [letter]", "talk to the AI model (llm package)", cmd_load));
        sh.add(new FnCommand("mp", "mp finder [letter]", "info on the AI models (llm package)", cmd_mp));
    }
    {
        Color c(VGA_LIGHT_GREEN);
        print("Installed llm. ");
    }
    print("New commands: models, load, mp finder.\n");
    if (all) install_all_models(sh);
    else pick_model(sh);
}

} // namespace

void packages_register(Shell &sh) {
    sh.add(new FnCommand("install", "install <package>", "install llm, solMeteo, doom or doomy", cmd_install));
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
