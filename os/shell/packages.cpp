// ConMon - packages.cpp : the package manager and the commands it adds.
//
//   install            list packages
//   install mp4        MP4 player + sample videos      -> adds `play`
//   install llm        chat with an AI model           -> adds `models`, `load`
//                      engines: SmartestChild, Transformers.js, WebLLM, Ollama
//
// ConMon can't decode video or run a neural network itself, so packages work
// through the host link (kernel/hostlink.c): ConMon Lab, the browser page
// around the emulator, does the heavy lifting and streams results back over
// the serial port. On QEMU or a real PC there is no host, and install says so.
#include "shell.hpp"

namespace {

bool host_ok;
bool mp4_installed, llm_installed;

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

// Splits "a|b|c" in place-free style: returns field n (0-based) as a String.
String field(const char *s, int n, char sep = '|') {
    for (int i = 0; i < n && *s; s++) if (*s == sep) i++;
    String out;
    while (*s && *s != sep && *s != '\n') out += *s++;
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

// Sends a request and follows the host's progress until it finishes.
bool host_job(Shell &sh, const char *type, const char *payload) {
    hostlink_send(type, payload);
    bool showed_bar = false, cancelled = false;
    hl_packet p;
    for (;;) {
        if (!wait_packet(p, 0, &cancelled)) {
            if (cancelled) {
                hostlink_send("cancel", type);
                if (showed_bar) kputc('\n');
                error("Cancelled.");
                return false;
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
            return true;
        case 'E':
            if (showed_bar) kputc('\n');
            error("%s", d);
            return false;
        default:
            break;
        }
    }
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

// --------------------------------------------------------------- commands

void cmd_play(Shell &sh, const Args &a);
void cmd_models(Shell &sh, const Args &a);
void cmd_load(Shell &sh, const Args &a);

void list_packages() {
    Color c(VGA_YELLOW);
    print("Packages (delivered by ConMon Lab):\n");
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
    kprintf("  mp4   MP4 video player + 4 sample videos          %s\n", mp4_installed ? "[installed]" : "");
    kprintf("  llm   AI chat: SmartestChild, Transformers.js, WebLLM, Ollama %s\n",
            llm_installed ? "[installed]" : "");
    print("Usage: install <name>    e.g. install mp4\n");
}

bool pick_model(Shell &sh) {
    hostlink_send("llm.models", "");
    hl_packet p;
    for (;;) {
        bool cancelled;
        if (!wait_packet(p, 60000, &cancelled)) { error(cancelled ? "Cancelled." : "The host did not answer."); return false; }
        if (p.type == 'M') { kprintf("%s\n", reinterpret_cast<const char *>(p.data)); continue; }
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

    String choice = sh.editor().read("Type a letter to choose (Enter to skip): ", false, 2);
    if (choice.empty()) { print("No model chosen. Type models to see the list again.\n"); return false; }
    char want = choice[0];
    if (want >= 'a' && want <= 'z') want = (char)(want - 32);
    for (const auto &m : models) {
        if (m.letter != want) continue;
        if (m.status.empty())
            kprintf("Downloading %s (%s). This runs once; it's cached in your browser.\n",
                    m.label.c_str(), m.size.c_str());
        else
            kprintf("Getting %s ready...\n", m.label.c_str());
        if (!host_job(sh, "llm.download", m.id.c_str())) return false;
        ready_id = m.id;
        ready_label = m.label;
        Color c(VGA_LIGHT_GREEN);
        kprintf("%s is ready. Type load to talk with it.\n", m.label.c_str());
        return true;
    }
    error("No model with letter %s.", choice.c_str());
    return false;
}

void cmd_install(Shell &sh, const Args &a) {
    if (a.count() < 2) { list_packages(); return; }
    String name;
    for (const char *s = a[1]; *s; s++) name += (*s >= 'A' && *s <= 'Z') ? (char)(*s + 32) : *s;
    bool mp4 = name == "mp4";
    bool llm = name == "llm";
    if (!mp4 && !llm) { error("No package named %s. Type install to see the list.", a[1]); return; }
    if (!host_available()) { no_host(); return; }

    if (mp4) {
        if (!host_job(sh, "pkg.install", "mp4")) return;
        mp4_installed = true;
        if (!sh.has("play"))
            sh.add(new FnCommand("play", "play <file.mp4>", "play a video (mp4 package)", cmd_play));
        Color c(VGA_LIGHT_GREEN);
        print("Installed mp4. ");
        vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
        print("New command: play. Sample videos are on the RAM disk:\n");
        for (const auto &f : sh.fs().files()) {
            const char *n = f.name.c_str();
            size_t l = strlen(n);
            if (l > 4 && strcmp(n + l - 4, ".mp4") == 0) kprintf("  %s\n", n);
        }
        print("Try: play ep1.mp4   (q to stop, space to pause)\n");
        return;
    }

    if (!host_job(sh, "pkg.install", "llm")) return;
    llm_installed = true;
    if (!sh.has("load")) {
        sh.add(new FnCommand("models", "models", "pick an AI model (llm package)", cmd_models));
        sh.add(new FnCommand("load", "load [letter]", "talk to the AI model (llm package)", cmd_load));
    }
    Color c(VGA_LIGHT_GREEN);
    print("Installed llm. ");
    vga_set_color(VGA_LIGHT_GREY, VGA_BLACK);
    print("New commands: models, load.\n");
    pick_model(sh);
}

void cmd_models(Shell &sh, const Args &) {
    if (!host_available()) { no_host(); return; }
    pick_model(sh);
}

void chat(Shell &sh) {
    {
        Color c(VGA_YELLOW);
        kprintf("Talking to %s. ", ready_label.c_str());
    }
    print("Type exit to leave, reset for a new conversation.\n"
          "Ctrl+C stops a long answer.\n\n");
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
        char want = a[1][0];
        if (want >= 'a' && want <= 'z') want = (char)(want - 32);
        bool found = false;
        for (const auto &m : models) {
            if (m.letter != want) continue;
            found = true;
            if (m.id != ready_id.c_str()) {
                kprintf("Loading %s (%s)...\n", m.label.c_str(), m.size.c_str());
                if (!host_job(sh, "llm.download", m.id.c_str())) return;
                ready_id = m.id;
                ready_label = m.label;
            }
        }
        if (!found) { error("No model with letter %s. Type models to see the list.", a[1]); return; }
    }
    if (ready_id.empty()) {
        error("No model downloaded yet. Type models and pick one with its letter.");
        return;
    }
    if (!host_job(sh, "llm.load", ready_id.c_str())) return;
    chat(sh);
}

// ------------------------------------------------------------------ play

String mp4_id(const String &content) {
    // Sample files contain a line "id: ep1"
    const char *s = content.c_str();
    if (strncmp(s, "MP4", 3) != 0) return String();
    for (; *s; s++) {
        if ((s == content.c_str() || s[-1] == '\n') && strncmp(s, "id: ", 4) == 0) {
            String id;
            for (s += 4; *s && *s != '\n'; s++) id += *s;
            return id;
        }
    }
    return String();
}

void cmd_play(Shell &sh, const Args &a) {
    if (a.count() < 2) {
        print("usage: play <file.mp4>   Videos on the RAM disk:\n");
        for (const auto &f : sh.fs().files()) {
            const char *n = f.name.c_str();
            size_t l = strlen(n);
            if (l > 4 && strcmp(n + l - 4, ".mp4") == 0) kprintf("  %s\n", n);
        }
        return;
    }
    RamFS::File *f = sh.fs().find(a[1]);
    if (!f) { error("play: %s: no such file", a[1]); return; }
    String id = mp4_id(f->data);
    if (id.empty()) { error("play: %s is not an MP4 video", a[1]); return; }
    if (!host_available()) { no_host(); return; }

    hostlink_send("mp4.play", id.c_str());
    vga_cursor_visible(0);
    bool started = false, ended = false;
    String err;
    hl_packet p;
    uint32_t last = now_ms();
    while (!ended) {
        if (hostlink_poll(&p)) {
            last = now_ms();
            if (p.type == 'F' && p.len >= 80 * 24) {
                if (!started) { vga_clear(); started = true; }
                for (int i = 0; i < 80 * 24; i++)
                    vga_put_at((char)0xDF, p.data[i], i % 80, i / 80);   // upper half block
                hostlink_send("mp4.ack", "");
            } else if (p.type == 'S') {
                for (int x = 0; x < 80; x++) {
                    char ch = x < (int)p.len ? (char)p.data[x] : ' ';
                    vga_put_at(ch, 0x70, x, 24);
                }
            } else if (p.type == 'X') {
                ended = true;
            } else if (p.type == 'E') {
                err = reinterpret_cast<const char *>(p.data);
                ended = true;
            }
            continue;
        }
        int k = keyboard_poll();
        if (k == 'q' || k == 'Q' || k == 27 || k == 3) hostlink_send("mp4.stop", "");
        else if (k == ' ') hostlink_send("mp4.pause", "");
        if (now_ms() - last > 8000) { err = "The host stopped sending video."; break; }
        cpu_halt();
    }
    vga_cursor_visible(1);
    if (started) vga_clear();
    if (!err.empty()) error("play: %s", err.c_str());
    else kprintf("Finished playing %s.\n", a[1]);
}

} // namespace

void packages_register(Shell &sh) {
    sh.add(new FnCommand("install", "install [mp4|llm]", "install a package", cmd_install));
}

// Handles messages the host sends on its own (for example a video the user
// dropped onto the Kernel Lab page) while the shell waits for input.
bool packages_idle(Shell &sh) {
    if (!serial_available()) return false;
    hl_packet p;
    bool printed = false;
    while (hostlink_poll(&p)) {
        if (p.type == 'W') {
            save_file(sh, p);
            String name;
            for (const uint8_t *d = p.data; *d && *d != '\n'; d++) name += (char)*d;
            Color c(VGA_LIGHT_CYAN);
            kprintf("\n[ConMon Lab] received %s - type: play %s\n", name.c_str(), name.c_str());
            printed = true;
        } else if (p.type == 'M') {
            kprintf("\n[ConMon Lab] %s\n", reinterpret_cast<const char *>(p.data));
            printed = true;
        }
    }
    return printed;
}
