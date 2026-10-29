#!/usr/bin/env python3
"""Add (or replace) a file in the root directory of a FAT12 floppy image.

The file goes first in the directory.

    python3 tools/fat12_add.py site/guests/mikeos.flp tools/doom.bas DOOM.BAS
"""
import struct, sys


def add(image_path, src_path, name83):
    img = bytearray(open(image_path, "rb").read())
    data = open(src_path, "rb").read().replace(b"\r\n", b"\n")     # MikeOS BASIC wants LF
    bps, spc, reserved, nfats, nroot, total, _, spf = struct.unpack_from("<HBHBHHBH", img, 11)
    fat_off = reserved * bps
    root_off = fat_off + nfats * spf * bps
    data_off = root_off + nroot * 32
    csize = spc * bps
    nclusters = (total * bps - data_off) // csize

    def fat_get(n):
        v = struct.unpack_from("<H", img, fat_off + n * 3 // 2)[0]
        return v >> 4 if n & 1 else v & 0xFFF

    def fat_set(n, val):
        for f in range(nfats):
            o = fat_off + f * spf * bps + n * 3 // 2
            v = struct.unpack_from("<H", img, o)[0]
            v = (v & 0x000F) | (val << 4) if n & 1 else (v & 0xF000) | val
            struct.pack_into("<H", img, o, v)

    base, _, ext = name83.upper().partition(".")
    entry_name = base.ljust(8)[:8].encode() + ext.ljust(3)[:3].encode()

    # Read the directory, dropping an older copy of this file (and its chain).
    entries = []
    for i in range(nroot):
        e = bytes(img[root_off + i * 32:root_off + i * 32 + 32])
        if e[0] == 0x00:
            break
        if e[:11] == entry_name:
            c = struct.unpack_from("<H", e, 26)[0]
            while 2 <= c < 0xFF8:
                nxt = fat_get(c); fat_set(c, 0); c = nxt
            continue
        entries.append(e)
    if len(entries) + 1 > nroot:
        sys.exit("root directory is full")

    need = max(1, -(-len(data) // csize))
    free = [c for c in range(2, nclusters + 2) if fat_get(c) == 0][:need]
    if len(free) < need:
        sys.exit("floppy is full")
    for i, c in enumerate(free):
        fat_set(c, free[i + 1] if i + 1 < len(free) else 0xFFF)
        chunk = data[i * csize:(i + 1) * csize]
        o = data_off + (c - 2) * csize
        img[o:o + csize] = chunk.ljust(csize, b"\0")

    entry = bytearray(32)
    entry[0:11] = entry_name
    entry[11] = 0x20                                  # archive
    struct.pack_into("<HH", entry, 22, 0, (2026 - 1980) << 9 | 10 << 5 | 29)
    struct.pack_into("<HI", entry, 26, free[0], len(data))
    # Put the new file first, so menus that list files in directory order
    # (like MikeOS's program menu) show and highlight it first.
    entries.insert(0, bytes(entry))
    for i in range(nroot):
        o = root_off + i * 32
        img[o:o + 32] = entries[i] if i < len(entries) else bytes(32)
    open(image_path, "wb").write(img)
    print(f"{name83}: {len(data)} bytes in clusters {free[0]}..{free[-1]}")


if __name__ == "__main__":
    add(*sys.argv[1:4])
