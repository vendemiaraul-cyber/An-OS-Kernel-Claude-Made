# ConMon build
#
#   make          build conmon.bin (Multiboot ELF kernel)
#   make run      boot it in QEMU
#   make iso      build a bootable GRUB ISO (needs grub-mkrescue + xorriso)
#   make clean
#
# Works with the host gcc/g++ (-m32, needs gcc-multilib) or a cross compiler:
#   make CC=i686-elf-gcc CXX=i686-elf-g++

CC   ?= gcc
CXX  ?= g++
AS    = nasm
QEMU ?= qemu-system-i386

ARCH     = -m32 -march=i686 -mgeneral-regs-only
COMMON   = $(ARCH) -ffreestanding -O2 -Wall -Wextra -Iinclude \
           -fno-stack-protector -fno-pic -fno-pie -fno-omit-frame-pointer \
           -fno-asynchronous-unwind-tables -fno-tree-loop-distribute-patterns
CFLAGS   = $(COMMON) -std=gnu11
CXXFLAGS = $(COMMON) -std=gnu++17 -fno-exceptions -fno-rtti \
           -fno-threadsafe-statics -fno-use-cxa-atexit -nostdinc++
# libgcc is only linked if a 32-bit copy exists (we don't need its helpers today)
LIBGCC  := $(wildcard $(shell $(CC) $(ARCH) -print-libgcc-file-name 2>/dev/null))
LDFLAGS  = $(ARCH) -T linker.ld -nostdlib -ffreestanding -no-pie -Wl,--build-id=none

ASM_SRC = boot/boot.asm boot/interrupts.asm
C_SRC   = kernel/kernel.c kernel/hostlink.c cpu/gdt.c cpu/idt.c drivers/vga.c drivers/serial.c \
          drivers/timer.c drivers/keyboard.c mm/kheap.c lib/string.c lib/kprintf.c
CXX_SRC = shell/cxxrt.cpp shell/shell.cpp shell/ramfs.cpp shell/calc.cpp shell/packages.cpp

OBJ = $(patsubst %,build/%.o,$(ASM_SRC) $(C_SRC) $(CXX_SRC))

.PHONY: all run iso test samples clean

all: conmon.bin

conmon.bin: $(OBJ) linker.ld
	$(CC) $(LDFLAGS) -o $@ $(OBJ) $(LIBGCC)
	@echo "Built $@ ($$(stat -c %s $@) bytes)"

build/%.asm.o: %.asm
	@mkdir -p $(dir $@)
	$(AS) -f elf32 $< -o $@

build/%.c.o: %.c include/kernel.h
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

build/%.cpp.o: %.cpp include/kernel.h $(wildcard shell/*.hpp)
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -c $< -o $@

run: conmon.bin
	$(QEMU) -kernel conmon.bin -m 64M -serial stdio

iso: conmon.bin
	mkdir -p build/iso/boot/grub
	cp conmon.bin build/iso/boot/conmon.bin
	printf 'set timeout=0\nset default=0\nmenuentry "ConMon" {\n  multiboot /boot/conmon.bin\n  boot\n}\n' > build/iso/boot/grub/grub.cfg
	grub-mkrescue -o conmon.iso build/iso

# Host-side tests: runs printf, heap, calculator, RAM fs and the whole C++
# shell (with scripted keystrokes) as a normal Linux program under ASan/UBSan.
HOST_FLAGS = -g -O1 -Wall -Wextra -Iinclude -DCONMON_HOST_TEST -fsanitize=address,undefined -fno-sanitize-recover
test:
	@mkdir -p build/host
	gcc $(HOST_FLAGS) -c lib/kprintf.c  -o build/host/kprintf.o
	gcc $(HOST_FLAGS) -c mm/kheap.c     -o build/host/kheap.o
	gcc $(HOST_FLAGS) -c tests/host_stubs.c -o build/host/stubs.o
	gcc $(HOST_FLAGS) -c kernel/hostlink.c -o build/host/hostlink.o
	g++ $(HOST_FLAGS) -std=gnu++17 -fno-exceptions -fno-rtti tests/host_test.cpp \
	    shell/shell.cpp shell/ramfs.cpp shell/calc.cpp shell/packages.cpp \
	    build/host/kprintf.o build/host/kheap.o build/host/stubs.o build/host/hostlink.o -o build/host/conmon_test
	ASAN_OPTIONS=detect_leaks=0 ./build/host/conmon_test

clean:
	rm -rf build conmon.bin conmon.iso

# Sample boot-sector "kernel" as a 1.44 MB floppy image (used by Kernel Lab).
samples: samples/hello-floppy.img
samples/hello-floppy.img: samples/hello-boot.asm
	@mkdir -p build
	$(AS) -f bin $< -o build/hello-boot.bin
	dd if=/dev/zero of=$@ bs=1024 count=1440 status=none
	dd if=build/hello-boot.bin of=$@ conv=notrunc status=none
