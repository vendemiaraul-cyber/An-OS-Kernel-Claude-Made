#ifndef _ERRNO_H
#define _ERRNO_H
int *__errno_location(void);
#define errno (*__errno_location())
#define ENOENT 2
#define EIO 5
#define ENOMEM 12
#define EACCES 13
#define EEXIST 17
#define EISDIR 21
#define EINVAL 22
#define ENOSPC 28
#define ERANGE 34
#endif
