/* ConMon extension start: the .cmx header (see os/include/conmon_ext.h)
 * and setjmp/longjmp, used by exit(). CMX_NAME comes from the Makefile. */
    .section .cmxhdr, "a"
    .globl __cmx_header
__cmx_header:
    .long 0x31584D43                    /* "CMX1" */
    .long 1                             /* API version */
    .long __image_start
    .long __image_size
    .long __bss_size
    .long cmx_entry
    .long 0                             /* CRC-32, patched by tools/cmxpack.py */
1:  .ascii CMX_NAME
    .fill 16 - (. - 1b), 1, 0

    .text
    .globl cmx_setjmp
cmx_setjmp:                             /* int cmx_setjmp(int buf[6]) */
    mov 4(%esp), %eax
    mov %ebx, 0(%eax)
    mov %esi, 4(%eax)
    mov %edi, 8(%eax)
    mov %ebp, 12(%eax)
    lea 4(%esp), %ecx
    mov %ecx, 16(%eax)
    mov (%esp), %ecx
    mov %ecx, 20(%eax)
    xor %eax, %eax
    ret

    .globl cmx_longjmp
cmx_longjmp:                            /* void cmx_longjmp(int buf[6], int v) */
    mov 4(%esp), %edx
    mov 8(%esp), %eax
    test %eax, %eax
    jnz 1f
    inc %eax
1:  mov 0(%edx), %ebx
    mov 4(%edx), %esi
    mov 8(%edx), %edi
    mov 12(%edx), %ebp
    mov 16(%edx), %esp
    jmp *20(%edx)
.section .note.GNU-stack,"",@progbits
