// ConMon - ramfs.hpp : a flat, in-memory filesystem (lost on reboot)
#ifndef CONMON_RAMFS_HPP
#define CONMON_RAMFS_HPP

#include "kstd.hpp"

class RamFS {
public:
    struct File {
        kstd::String name;
        kstd::String data;
        uint32_t     created_tick = 0;
    };

    static constexpr size_t kMaxNameLen = 32;

    File *find(const char *name);
    bool  write(const char *name, const char *text, bool append);
    bool  remove(const char *name);
    bool  rename(const char *from, const char *to);
    const kstd::Vector<File> &files() const { return files_; }
    size_t total_bytes() const;

private:
    kstd::Vector<File> files_;
};

#endif
