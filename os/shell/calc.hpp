// ConMon - calc.hpp : integer expression evaluator used by the `calc` command
#ifndef CONMON_CALC_HPP
#define CONMON_CALC_HPP

#include "kernel.h"

// Grammar:  expr   := term (('+'|'-') term)*
//           term   := unary (('*'|'/'|'%') unary)*
//           unary  := ('-'|'+') unary | primary
//           primary:= number | '(' expr ')'
// Numbers are decimal or 0x-prefixed hex. Returns false and sets *err on error.
class Calculator {
public:
    bool eval(const char *expr, int32_t &out, const char *&err);

private:
    int32_t expr();
    int32_t term();
    int32_t unary();
    int32_t primary();
    void    skip_ws();
    void    fail(const char *msg) { if (!err_) err_ = msg; }

    const char *p_   = nullptr;
    const char *err_ = nullptr;
    int         depth_ = 0;
};

#endif
