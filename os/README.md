# ConMon

A small 32-bit x86 hobby operating system. The kernel and drivers are written in
**C**, the shell and filesystem in **C++**, with two short NASM files for the
boot entry and interrupt stubs.

```
   ####   ####   #   #  #   #   ####   #   #
  #      #    #  ##  #  ## ##  #    #  ##  #
  #      #    #  # # #  # # #  #    #  # # #
  #      #    #  #  ##  #   #  #    #  #  ##
   ####   ####   #   #  #   #   ####   #   #
```

## Features

| Layer | What it does | Language |
|---|---|---|
| Boot | Multiboot v1 header, 32 KiB stack, jumps to `kmain` | asm |
| CPU | GDT (flat ring 0/3 segments), IDT, 8259 PIC remap, exception screen | C + asm |
| Drivers | VGA 80x25 text console with scrolling and hardware cursor, PIT timer (100 Hz), PS/2 keyboard (shift, caps, ctrl, arrows), COM1 serial mirror, PC speaker | C |
| Memory | First-fit kernel heap with block splitting and coalescing | C |
| C++ runtime | `new`/`delete`, global constructors, pure-virtual trap; small `String` and `Vector<T>` | C++ |
| Shell | Line editor with history (↑/↓), Ctrl+C, Ctrl+L, quoted arguments, 22 commands | C++ |
| RAM disk | Flat in-memory filesystem: `ls cat write append rm mv` | C++ |
| Host link | Message protocol over COM1 (interrupt-driven receive) | C |
| Packages | `install llm` adds `models`, `load` and `mp finder`; `install solMeteo` adds `meteo`; `install doom` / `install doomy` add the games | C++ |

Shell commands: `help clear echo about uptime mem cpu color calc ls cat write
append rm mv history sleep beep guess crash reboot halt install`, plus `models`,
`load`, `mp`, `meteo`, `doom` and `doomy` once their packages are installed.

## Packages and the host link

ConMon can't reach the internet or run a neural network by itself, so packages lean
on a *host*: ConMon Lab, the web page running the emulator. They talk over the
serial port (`kernel/hostlink.c`):

```
ConMon -> host:  ESC ] "CM;" <type> ";" <payload> BEL
host -> ConMon:  STX <type> <len lo> <len hi> <payload>
```

- `install llm`: the host lists models from four engines, each with a letter:
  SmartestChild (a built-in retro chatbot), Transformers.js and WebLLM (in the
  browser tab) and Ollama (on your PC at localhost:11434). Type a letter to
  download or prepare it, then `load` to chat. `install llm all` downloads
  every browser model in one go (after asking). `mp finder` lists every model
  with its maker and size; `mp finder E` shows one model's details, with live
  licence, downloads and likes from Hugging Face (or Ollama's own info).
- `install solMeteo`: adds `meteo`. Type a place: ConMon clears the screen and
  the host draws full-screen frames: an ASCII world map built from GeoJSON
  country outlines flies to the place, then the current weather and a 3-day
  forecast from Open-Meteo appear underneath. `cities Italy` lists the
  built-in cities of a country. `exit` leaves.
- `install doom`: adds `doom`. ConMon switches its keyboard driver to raw
  mode and forwards every key press and release to the host, which runs DOOM
  and sends back 80x50 "pixel" frames drawn with half-block characters,
  using a 16-colour palette ConMon loads into the VGA DAC. F12 quits.
- `install doomy`: adds `doomy`, the same idea with a small game written in
  Python that the host runs with Pyodide.

On QEMU or a real PC there is no host, and `install` says so.

## Build

Needs `nasm`, and `gcc`/`g++` that can target 32-bit (on Debian/Ubuntu:
`sudo apt install build-essential nasm gcc-multilib g++-multilib`).
A cross compiler works too: `make CC=i686-elf-gcc CXX=i686-elf-g++`.

```sh
make            # -> conmon.bin (Multiboot ELF kernel)
make run        # boot in QEMU (apt install qemu-system-x86)
make iso        # bootable GRUB ISO for VirtualBox / USB (needs grub-pc-bin, xorriso)
make test       # run printf, heap, calc, RAM fs and the whole shell on your host
```

`make run` mirrors all console output to your terminal via the serial port.
A prebuilt `conmon.bin` is included, so `qemu-system-i386 -kernel conmon.bin`
works without building.

## Try it

```
conmon> help
conmon> calc (2+3)*7
conmon> write notes.txt hello from ConMon
conmon> append notes.txt "a second   line"
conmon> cat notes.txt
conmon> mem
conmon> guess
conmon> crash        # shows the CPU exception handler
```

## Layout

```
boot/        boot.asm (Multiboot entry), interrupts.asm (GDT/IDT load, ISR stubs)
cpu/         gdt.c, idt.c (PIC remap + interrupt dispatch)
drivers/     vga.c, serial.c, timer.c, keyboard.c
mm/          kheap.c
lib/         string.c, kprintf.c
kernel/      kernel.c (kmain, boot sequence, reboot/halt/panic)
shell/       cxxrt.cpp, kstd.hpp, shell.cpp, ramfs.*, calc.*
include/     kernel.h (the C API shared with C++)
tests/       host-side test harness (fake hardware + scripted keystrokes)
linker.ld    loads the kernel at 1 MiB
```

## Ideas for what's next

Paging and a physical page allocator, a real filesystem on an ATA disk,
user mode (ring 3) processes with system calls, multitasking with the PIT,
and a framebuffer console via the Multiboot video fields.
