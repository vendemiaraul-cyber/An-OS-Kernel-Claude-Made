// ConMon - kstd.hpp : tiny freestanding "standard library" for the C++ side:
// a growable String and a Vector<T> template, both backed by kmalloc.
#ifndef CONMON_KSTD_HPP
#define CONMON_KSTD_HPP

#include "kernel.h"

inline void *operator new(size_t, void *p) noexcept { return p; }

namespace kstd {

template <typename T> inline T &&move(T &v) { return static_cast<T &&>(v); }

class String {
public:
    String() { reserve(15); }
    String(const char *s) { assign(s, strlen(s)); }
    String(const char *s, size_t n) { assign(s, n); }
    String(const String &o) { assign(o.data_, o.len_); }
    String(String &&o) noexcept : data_(o.data_), len_(o.len_), cap_(o.cap_) {
        o.data_ = nullptr; o.len_ = o.cap_ = 0;
    }
    ~String() { delete[] data_; }

    String &operator=(const String &o) {
        if (this != &o) { delete[] data_; data_ = nullptr; cap_ = 0; assign(o.data_, o.len_); }
        return *this;
    }
    String &operator=(String &&o) noexcept {
        if (this != &o) {
            delete[] data_;
            data_ = o.data_; len_ = o.len_; cap_ = o.cap_;
            o.data_ = nullptr; o.len_ = o.cap_ = 0;
        }
        return *this;
    }

    const char *c_str() const { return data_ ? data_ : ""; }
    size_t size() const { return len_; }
    bool empty() const { return len_ == 0; }
    char operator[](size_t i) const { return data_[i]; }

    void push_back(char c) {
        if (len_ + 1 > cap_) reserve(cap_ ? cap_ * 2 : 16);
        data_[len_++] = c;
        data_[len_] = 0;
    }
    void pop_back() { if (len_) data_[--len_] = 0; }
    void clear() { len_ = 0; if (data_) data_[0] = 0; }

    String &operator+=(const char *s) { while (*s) push_back(*s++); return *this; }
    String &operator+=(const String &s) { return *this += s.c_str(); }
    String &operator+=(char c) { push_back(c); return *this; }

    bool operator==(const char *s) const { return strcmp(c_str(), s) == 0; }
    bool operator==(const String &s) const { return strcmp(c_str(), s.c_str()) == 0; }
    bool operator!=(const char *s) const { return !(*this == s); }

    void reserve(size_t cap) {
        if (cap <= cap_ && data_) return;
        char *n = new char[cap + 1];
        if (data_) memcpy(n, data_, len_);
        n[len_] = 0;
        delete[] data_;
        data_ = n;
        cap_ = cap;
    }

private:
    void assign(const char *s, size_t n) {
        len_ = 0;
        reserve(n > 15 ? n : 15);
        memcpy(data_, s, n);
        len_ = n;
        data_[n] = 0;
    }

    char  *data_ = nullptr;
    size_t len_  = 0;
    size_t cap_  = 0;
};

template <typename T>
class Vector {
public:
    Vector() = default;
    Vector(const Vector &) = delete;
    Vector &operator=(const Vector &) = delete;
    ~Vector() { clear(); kfree(items_); }

    size_t size() const { return count_; }
    bool empty() const { return count_ == 0; }
    T &operator[](size_t i) { return items_[i]; }
    const T &operator[](size_t i) const { return items_[i]; }
    T *begin() { return items_; }
    T *end() { return items_ + count_; }
    const T *begin() const { return items_; }
    const T *end() const { return items_ + count_; }

    void push_back(const T &v) { grow(); new (&items_[count_++]) T(v); }
    void push_back(T &&v) { grow(); new (&items_[count_++]) T(move(v)); }

    void erase(size_t i) {
        if (i >= count_) return;
        for (size_t j = i; j + 1 < count_; j++) items_[j] = move(items_[j + 1]);
        items_[--count_].~T();
    }

    void clear() {
        for (size_t i = 0; i < count_; i++) items_[i].~T();
        count_ = 0;
    }

private:
    void grow() {
        if (count_ < cap_) return;
        size_t ncap = cap_ ? cap_ * 2 : 8;
        T *n = static_cast<T *>(kmalloc(ncap * sizeof(T)));
        if (!n) kpanic("Vector: out of memory");
        for (size_t i = 0; i < count_; i++) {
            new (&n[i]) T(move(items_[i]));
            items_[i].~T();
        }
        kfree(items_);
        items_ = n;
        cap_ = ncap;
    }

    T     *items_ = nullptr;
    size_t count_ = 0;
    size_t cap_   = 0;
};

} // namespace kstd

#endif
