#!/usr/bin/env python3
"""Turns a linked extension ELF into a ConMon .cmx file: flat binary from
the load address, with the header's CRC-32 filled in.

    python3 tools/cmxpack.py build/doom.elf build/doom.bin ../site/doom/ndoom.cmx
"""
import struct, sys, zlib

MAGIC, LOAD, IMAGE_MAX = 0x31584D43, 0x01400000, 0x00200000

def main(elf, flat, out):
    data = bytearray(open(flat, "rb").read())
    magic, ver, load, size, bss, entry, _crc = struct.unpack_from("<7I", data, 0)
    assert magic == MAGIC, "no CMX1 header at the start"
    assert load == LOAD, hex(load)
    data = data[:size]
    assert len(data) == size, (len(data), size)
    assert size + bss <= IMAGE_MAX, f"image + bss = {size + bss} bytes, over {IMAGE_MAX}"
    assert load <= entry < load + size
    struct.pack_into("<I", data, 24, 0)
    struct.pack_into("<I", data, 24, zlib.crc32(data) & 0xFFFFFFFF)
    open(out, "wb").write(data)
    name = data[28:44].split(b"\0")[0].decode()
    print(f"{out}: {name}, {size} bytes + {bss} bss, entry {entry:#x}")

if __name__ == "__main__":
    main(*sys.argv[1:4])
