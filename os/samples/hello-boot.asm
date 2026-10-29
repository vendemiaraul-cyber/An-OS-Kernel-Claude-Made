; ConMon Lab - hello-boot.asm
; A 512-byte boot sector: the smallest "kernel" there is. The BIOS loads it
; at 0x7C00 in 16-bit real mode. It prints a banner, then echoes keys.
;
;   nasm -f bin hello-boot.asm -o hello-boot.bin
;   (pad to 1.44 MB to use as a floppy image: see Makefile `samples` target)

bits 16
org 0x7C00

start:
    cli
    xor ax, ax
    mov ds, ax
    mov es, ax
    mov ss, ax
    mov sp, 0x7C00
    sti

    mov ax, 0x0003          ; 80x25 colour text mode, clears the screen
    int 0x10

    mov si, banner
    call print

.loop:
    xor ah, ah              ; wait for a key
    int 0x16
    cmp al, 13
    je .newline
    cmp al, 8
    je .backspace
    mov ah, 0x0E            ; teletype output
    mov bx, 0x000A
    int 0x10
    jmp .loop
.newline:
    mov si, crlf_prompt
    call print
    jmp .loop
.backspace:
    mov si, bs_seq
    call print
    jmp .loop

; print zero-terminated string at DS:SI
print:
    mov ah, 0x0E
    mov bx, 0x000A          ; page 0, light green
.next:
    lodsb
    test al, al
    jz .done
    int 0x10
    jmp .next
.done:
    ret

banner:
    db "Hello from a 512-byte boot sector!", 13, 10
    db "Loaded by the BIOS from a floppy, running in 16-bit real mode.", 13, 10
    db "Type something:", 13, 10
crlf_prompt:
    db 13, 10, "> ", 0
bs_seq:
    db 8, " ", 8, 0

times 510 - ($ - $$) db 0
dw 0xAA55
