# ConMon extensions. `make` builds ../site/doom/ndoom.cmx (native DOOM).
# Needs gcc with -m32 support and python3; no C library is needed: libc/ is ours.

CC      ?= gcc
ARCH     = -m32 -march=i686 -mfpmath=387 -mno-sse
CFLAGS   = $(ARCH) -O2 -ffreestanding -fno-pic -fno-pie -fno-stack-protector \
           -fno-asynchronous-unwind-tables -fno-builtin-printf -nostdinc \
           -Ilibc/include -isystem $(shell $(CC) -print-file-name=include) -I../os/include -w
DOOMDEFS = -DCMAP256 -DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200 -DNORMALUNIX -DLINUX -D_DEFAULT_SOURCE

LIBC    = libc/libc.c libc/stdio.c libc/malloc.c libc/libgcc.c
DOOM_C  = $(wildcard doom/doomgeneric/*.c) doom/conmon_doom.c
OBJ     = build/crt0.o $(patsubst %.c,build/%.o,$(LIBC) $(DOOM_C))
OUT     = ../site/doom/ndoom.cmx

all: $(OUT)

build/crt0.o: libc/crt0.S
	@mkdir -p $(dir $@)
	$(CC) $(ARCH) -DCMX_NAME='"doom"' -c $< -o $@

build/libc/%.o: libc/%.c libc/cmx.h ../os/include/conmon_ext.h
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

build/doom/%.o: doom/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(DOOMDEFS) -Idoom/doomgeneric -c $< -o $@

build/doom.elf: $(OBJ) cmx.ld
	$(CC) $(ARCH) -nostdlib -static -no-pie -Wl,-T,cmx.ld -Wl,--gc-sections -Wl,--build-id=none -o $@ $(OBJ)

$(OUT): build/doom.elf tools/cmxpack.py
	objcopy -O binary build/doom.elf build/doom.bin
	python3 tools/cmxpack.py build/doom.elf build/doom.bin $@

clean:
	rm -rf build

.PHONY: all clean
