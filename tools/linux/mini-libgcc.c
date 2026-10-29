/* The few libgcc helpers a 32-bit userland needs: 64-bit division,
   bit counting. (This box has no 32-bit libgcc.) */
typedef unsigned long long u64; typedef long long s64;
u64 __udivmoddi4(u64 n, u64 d, u64 *rem) {
    u64 q = 0, r = 0;
    if (d == 0) { volatile int z = 0; return 1 / z; }
    if (!(d >> 32) && !(n >> 32)) { unsigned a = n, b = d; if (rem) *rem = a % b; return a / b; }
    for (int i = 63; i >= 0; i--) { r = (r << 1) | ((n >> i) & 1); if (r >= d) { r -= d; q |= 1ULL << i; } }
    if (rem) *rem = r;
    return q;
}
u64 __udivdi3(u64 n, u64 d) { return __udivmoddi4(n, d, 0); }
u64 __umoddi3(u64 n, u64 d) { u64 r; __udivmoddi4(n, d, &r); return r; }
s64 __divdi3(s64 a, s64 b) { int neg = (a < 0) ^ (b < 0); u64 q = __udivmoddi4(a < 0 ? -(u64)a : a, b < 0 ? -(u64)b : b, 0); return neg ? -(s64)q : (s64)q; }
s64 __moddi3(s64 a, s64 b) { u64 r; __udivmoddi4(a < 0 ? -(u64)a : a, b < 0 ? -(u64)b : b, &r); return a < 0 ? -(s64)r : (s64)r; }
s64 __divmoddi4(s64 a, s64 b, s64 *rem) { s64 q = __divdi3(a, b); if (rem) *rem = a - q * b; return q; }
int __popcountsi2(unsigned x) { int n = 0; while (x) { n += x & 1; x >>= 1; } return n; }
int __popcountdi2(u64 x) { return __popcountsi2(x) + __popcountsi2(x >> 32); }
int __clzdi2(u64 x) { return (x >> 32) ? __builtin_clz(x >> 32) : 32 + __builtin_clz((unsigned)x); }
int __ctzdi2(u64 x) { return (unsigned)x ? __builtin_ctz((unsigned)x) : 32 + __builtin_ctz(x >> 32); }
int __ffsdi2(s64 x) { return x ? __ctzdi2(x) + 1 : 0; }
u64 __lshrdi3(u64 a, int b) { return a >> b; }
u64 __ashldi3(u64 a, int b) { return a << b; }
s64 __ashrdi3(s64 a, int b) { return a >> b; }
int __ucmpdi2(u64 a, u64 b) { return a < b ? 0 : a > b ? 2 : 1; }
int __cmpdi2(s64 a, s64 b) { return a < b ? 0 : a > b ? 2 : 1; }
u64 __bswapdi2(u64 x) { return ((u64)__builtin_bswap32(x) << 32) | __builtin_bswap32(x >> 32); }
unsigned __bswapsi2(unsigned x) { return __builtin_bswap32(x); }
