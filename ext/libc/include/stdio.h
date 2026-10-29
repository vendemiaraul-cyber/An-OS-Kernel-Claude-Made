/* ConMon extension libc - stdio.h. Files live in memory: the data file
 * ConMon passed in (read-only) and RAM files the program writes. */
#ifndef _STDIO_H
#define _STDIO_H
#include <stddef.h>
#include <stdarg.h>
typedef struct _cmx_file FILE;
extern FILE *const stdin, *const stdout, *const stderr;
#define EOF (-1)
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2
#define FILENAME_MAX 256
#define BUFSIZ 1024
FILE  *fopen(const char *name, const char *mode);
int    fclose(FILE *f);
size_t fread(void *p, size_t size, size_t n, FILE *f);
size_t fwrite(const void *p, size_t size, size_t n, FILE *f);
int    fseek(FILE *f, long off, int whence);
long   ftell(FILE *f);
int    fflush(FILE *f);
int    feof(FILE *f);
int    fgetc(FILE *f);
char  *fgets(char *s, int n, FILE *f);
int    fputc(int c, FILE *f);
int    fputs(const char *s, FILE *f);
int    remove(const char *name);
int    rename(const char *from, const char *to);
int    printf(const char *fmt, ...);
int    fprintf(FILE *f, const char *fmt, ...);
int    vprintf(const char *fmt, va_list ap);
int    vfprintf(FILE *f, const char *fmt, va_list ap);
int    sprintf(char *s, const char *fmt, ...);
int    snprintf(char *s, size_t n, const char *fmt, ...);
int    vsnprintf(char *s, size_t n, const char *fmt, va_list ap);
int    vsprintf(char *s, const char *fmt, va_list ap);
int    sscanf(const char *s, const char *fmt, ...);
int    puts(const char *s);
int    putchar(int c);
#define putc fputc
#define getc fgetc
#endif
