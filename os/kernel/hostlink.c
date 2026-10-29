/* ConMon - hostlink.c : a tiny message protocol over COM1.
 *
 * When ConMon runs inside ConMon Lab (the browser), the page on the other
 * end of the serial port acts as a "host": it can download packages, decode
 * MP4 video and run language models on the GPU, things a 32-bit hobby OS
 * can't do on its own.
 *
 * ConMon -> host:  ESC ']' "CM;" <type> ';' <payload> BEL      (text)
 * host -> ConMon:  STX <type byte> <len lo> <len hi> <payload>  (binary-safe)
 *
 * Everything else ConMon writes to the serial port is ordinary console
 * output, which the host shows in its serial panel. */
#include "kernel.h"

#define STX 0x02

static uint8_t  pkt[HOSTLINK_MAX + 1];
static int      state;                  /* 0 idle, 1 type, 2 len lo, 3 len hi, 4 payload */
static uint8_t  pkt_type;
static uint32_t pkt_len, pkt_pos;

int hostlink_poll(struct hl_packet *out) {
    int c;
    while ((c = serial_read()) >= 0) {
        switch (state) {
        case 0: if (c == STX) state = 1; break;
        case 1: pkt_type = (uint8_t)c; state = 2; break;
        case 2: pkt_len = (uint32_t)c; state = 3; break;
        case 3:
            pkt_len |= (uint32_t)c << 8;
            pkt_pos = 0;
            state = 4;
            if (pkt_len == 0) goto done;
            break;
        case 4:
            if (pkt_pos < HOSTLINK_MAX) pkt[pkt_pos] = (uint8_t)c;
            if (++pkt_pos == pkt_len) goto done;
            break;
        }
        continue;
    done:
        state = 0;
        out->type = (char)pkt_type;
        out->len  = pkt_len < HOSTLINK_MAX ? pkt_len : HOSTLINK_MAX;
        pkt[out->len] = 0;
        out->data = pkt;
        return 1;
    }
    return 0;
}

void hostlink_send(const char *type, const char *payload) {
    serial_putc_raw(0x1B);
    serial_putc_raw(']');
    serial_putc_raw('C');
    serial_putc_raw('M');
    serial_putc_raw(';');
    for (; *type; type++) serial_putc_raw(*type);
    serial_putc_raw(';');
    for (; payload && *payload; payload++) {
        char ch = *payload;
        if (ch == 0x1B || ch == 0x07) continue;     /* never break the frame */
        serial_putc_raw(ch == '\n' ? ' ' : ch);
    }
    serial_putc_raw(0x07);
}

void hostlink_reset(void) {
    struct hl_packet p;
    while (hostlink_poll(&p)) {}        /* discard anything stale */
    state = 0;
}
