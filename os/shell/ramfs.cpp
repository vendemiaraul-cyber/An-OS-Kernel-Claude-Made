// ConMon - ramfs.cpp
#include "ramfs.hpp"

static bool valid_name(const char *n) {
    size_t len = strlen(n);
    if (len == 0 || len > RamFS::kMaxNameLen) return false;
    for (; *n; n++)
        if (*n == '/' || *n == ' ') return false;
    return true;
}

RamFS::File *RamFS::find(const char *name) {
    for (auto &f : files_)
        if (f.name == name) return &f;
    return nullptr;
}

bool RamFS::write(const char *name, const char *text, bool append) {
    if (!valid_name(name)) return false;
    File *f = find(name);
    if (!f) {
        File nf;
        nf.name = name;
        nf.created_tick = timer_ticks();
        files_.push_back(kstd::move(nf));
        f = &files_[files_.size() - 1];
    }
    if (!append) f->data.clear();
    f->data += text;
    return true;
}

bool RamFS::remove(const char *name) {
    for (size_t i = 0; i < files_.size(); i++) {
        if (files_[i].name == name) { files_.erase(i); return true; }
    }
    return false;
}

bool RamFS::rename(const char *from, const char *to) {
    if (!valid_name(to) || find(to)) return false;
    File *f = find(from);
    if (!f) return false;
    f->name = to;
    return true;
}

size_t RamFS::total_bytes() const {
    size_t n = 0;
    for (const auto &f : files_) n += f.data.size();
    return n;
}
