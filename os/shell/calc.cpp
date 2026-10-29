// ConMon - calc.cpp
#include "calc.hpp"

bool Calculator::eval(const char *expr_text, int32_t &out, const char *&err) {
    p_ = expr_text;
    err_ = nullptr;
    depth_ = 0;
    int32_t v = expr();
    skip_ws();
    if (!err_ && *p_) fail("unexpected character");
    err = err_;
    if (err_) return false;
    out = v;
    return true;
}

void Calculator::skip_ws() {
    while (*p_ == ' ' || *p_ == '\t') p_++;
}

int32_t Calculator::expr() {
    int32_t v = term();
    for (;;) {
        skip_ws();
        if (err_) return 0;
        if (*p_ == '+')      { p_++; v = (int32_t)((uint32_t)v + (uint32_t)term()); }
        else if (*p_ == '-') { p_++; v = (int32_t)((uint32_t)v - (uint32_t)term()); }
        else return v;
    }
}

int32_t Calculator::term() {
    int32_t v = unary();
    for (;;) {
        skip_ws();
        if (err_) return 0;
        char op = *p_;
        if (op != '*' && op != '/' && op != '%') return v;
        p_++;
        int32_t r = unary();
        if (err_) return 0;
        if (op == '*') {
            v = (int32_t)((uint32_t)v * (uint32_t)r);
        } else {
            if (r == 0) { fail("division by zero"); return 0; }
            if (v == INT32_MIN && r == -1) { fail("overflow"); return 0; }
            v = op == '/' ? v / r : v % r;
        }
    }
}

int32_t Calculator::unary() {
    skip_ws();
    if (*p_ == '-') { p_++; return (int32_t)(0u - (uint32_t)unary()); }
    if (*p_ == '+') { p_++; return unary(); }
    return primary();
}

int32_t Calculator::primary() {
    skip_ws();
    if (*p_ == '(') {
        if (++depth_ > 32) { fail("nesting too deep"); return 0; }
        p_++;
        int32_t v = expr();
        skip_ws();
        if (*p_ != ')') { fail("missing ')'"); return 0; }
        p_++;
        depth_--;
        return v;
    }
    uint32_t v = 0;
    bool any = false;
    if (p_[0] == '0' && (p_[1] == 'x' || p_[1] == 'X')) {
        p_ += 2;
        for (;; p_++, any = true) {
            char c = *p_;
            uint32_t d;
            if (c >= '0' && c <= '9') d = (uint32_t)(c - '0');
            else if (c >= 'a' && c <= 'f') d = (uint32_t)(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') d = (uint32_t)(c - 'A' + 10);
            else break;
            v = v * 16 + d;
        }
    } else {
        for (; *p_ >= '0' && *p_ <= '9'; p_++, any = true)
            v = v * 10 + (uint32_t)(*p_ - '0');
    }
    if (!any) { fail("expected a number"); return 0; }
    return (int32_t)v;
}
