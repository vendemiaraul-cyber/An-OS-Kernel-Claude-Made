/* ConMon extensions are loaded at CMX_LOAD_ADDR (os/include/conmon_ext.h). */
ENTRY(cmx_entry)
SECTIONS
{
    . = 0x01400000;
    __image_start = .;
    .text : { KEEP(*(.cmxhdr)) *(.text .text.*) }
    .rodata : ALIGN(16) { *(.rodata .rodata.*) }
    .data : ALIGN(16) { *(.data .data.*) }
    . = ALIGN(16);
    __image_end = .;
    .bss (NOLOAD) : ALIGN(16) { __bss_start = .; *(.bss .bss.*) *(COMMON) . = ALIGN(16); __bss_end = .; }
    __image_size = __image_end - __image_start;
    __bss_size = __bss_end - __bss_start;
    /DISCARD/ : { *(.comment) *(.eh_frame) *(.note*) *(.note.GNU-stack) }
}
