; ConMon - boot.asm
; Multiboot (v1) entry point. GRUB or QEMU (-kernel) loads us in 32-bit
; protected mode with paging off; we set up a stack and jump into the C
; kernel. (kmain runs the C++ global constructors once the heap exists.)

MB_ALIGN    equ 1 << 0              ; align modules on page boundaries
MB_MEMINFO  equ 1 << 1              ; ask for a memory map
MB_FLAGS    equ MB_ALIGN | MB_MEMINFO
MB_MAGIC    equ 0x1BADB002
MB_CHECKSUM equ -(MB_MAGIC + MB_FLAGS)

section .multiboot
align 4
    dd MB_MAGIC
    dd MB_FLAGS
    dd MB_CHECKSUM

section .bss
align 16
stack_bottom:
    resb 32768                      ; 32 KiB kernel stack
stack_top:

section .text
global _start
extern kmain

_start:
    cli
    mov esp, stack_top
    xor ebp, ebp

    push ebx                        ; kmain(magic, mbi)
    push eax
    call kmain

    ; kmain should never return; if it does, halt forever.
.hang:
    cli
    hlt
    jmp .hang

section .note.GNU-stack noalloc noexec nowrite progbits
