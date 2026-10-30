/* Pocket Arcade: minimal LHA (-lh5- / -lh0-) reader for old DOS archives,
   such as the self-extracting resource files in 1990s shareware releases.
   ArcadeLHA.list(u8) -> entries; ArcadeLHA.extract(u8, name) -> Uint8Array. */
(function (global) {
  'use strict';

  function crc16(u8) {
    var crc = 0;
    for (var i = 0; i < u8.length; i++) {
      crc ^= u8[i];
      for (var k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
    }
    return crc & 0xffff;
  }

  // Walk level-0/1/2 headers starting at the first "-lhX-" marker.
  function list(u8) {
    var out = [], pos = -1;
    for (var i = 2; i < u8.length - 5; i++) {
      if (u8[i] === 0x2d && u8[i + 1] === 0x6c && u8[i + 2] === 0x68 && u8[i + 4] === 0x2d) { pos = i - 2; break; }
    }
    if (pos < 0) throw new Error('No LHA data found.');
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    while (pos + 22 < u8.length && u8[pos] !== 0) {
      var level = u8[pos + 20], hsize, method, csize, osize, name = '', dir = '', data, extNext;
      method = String.fromCharCode.apply(null, u8.subarray(pos + 2, pos + 7));
      if (!/^-l[hz].-$/.test(method)) break;
      csize = dv.getUint32(pos + 7, true); osize = dv.getUint32(pos + 11, true);
      if (level === 0 || level === 1) {
        hsize = u8[pos] + 2;
        var nlen = u8[pos + 21];
        for (var c = 0; c < nlen; c++) name += String.fromCharCode(u8[pos + 22 + c]);
        var crc = dv.getUint16(pos + 22 + nlen, true);
        data = pos + hsize;
        if (level === 1) {
          extNext = dv.getUint16(pos + hsize - 2, true);
          var e = pos + hsize;
          while (extNext) {
            var type = u8[e];
            if (type === 2) for (var d = 1; d < extNext - 2; d++) dir += u8[e + d] === 0xff ? '/' : String.fromCharCode(u8[e + d]);
            if (type === 1) { name = ''; for (var n = 1; n < extNext - 2; n++) name += String.fromCharCode(u8[e + n]); }
            var size = extNext; extNext = dv.getUint16(e + size - 2, true); e += size; csize -= size;
          }
          data = e;
        }
        out.push({ name: (dir ? dir : '') + name.replace(/\\/g, '/'), method: method, csize: csize, osize: osize, data: data, crc: crc });
        pos = data + csize;
      } else if (level === 2) {
        hsize = dv.getUint16(pos, true);
        var crc2 = dv.getUint16(pos + 21, true), e2 = pos + 24, next = dv.getUint16(pos + 24, true);
        while (next) {
          var t = u8[e2 + 2];
          if (t === 1) { name = ''; for (var a = 3; a < next; a++) name += String.fromCharCode(u8[e2 + a]); }
          if (t === 2) { dir = ''; for (var b = 3; b < next; b++) dir += u8[e2 + b] === 0xff ? '/' : String.fromCharCode(u8[e2 + b]); }
          e2 += next; next = dv.getUint16(e2, true);
        }
        out.push({ name: dir + name, method: method, csize: csize, osize: osize, data: pos + hsize, crc: crc2 });
        pos = pos + hsize + csize;
      } else break;
    }
    return out;
  }

  // -lh5- decoder (8 KB window), after the classic LHa for UNIX algorithm.
  function lh5(src, osize, dicbit) {
    var NC = 510, CBIT = 9, NT = 19, TBIT = 5, NP = dicbit + 1, PBIT = dicbit >= 15 ? 5 : 4;
    var out = new Uint8Array(osize), op = 0, ip = 0;
    var bitbuf = 0, subbitbuf = 0, bitcount = 0;
    function fillbuf(n) {
      bitbuf = (bitbuf << n) & 0xffff;
      while (n > bitcount) {
        n -= bitcount;
        bitbuf |= (subbitbuf << n) & 0xffff;
        subbitbuf = ip < src.length ? src[ip++] : 0;
        bitcount = 8;
      }
      bitcount -= n;
      bitbuf |= subbitbuf >>> bitcount;
      bitbuf &= 0xffff;
    }
    function getbits(n) { var x = bitbuf >>> (16 - n); fillbuf(n); return x; }
    var left = new Uint16Array(2 * NC - 1), right = new Uint16Array(2 * NC - 1);
    var cLen = new Uint8Array(NC), ptLen = new Uint8Array(Math.max(NT, NP) + 1);
    var cTable = new Uint16Array(4096), ptTable = new Uint16Array(256);

    function makeTable(nchar, bitlen, tablebits, table) {
      var count = new Uint16Array(17), weight = new Uint16Array(17), start = new Uint32Array(18), i, k;
      for (i = 0; i < nchar; i++) count[bitlen[i]]++;
      start[1] = 0;
      for (i = 1; i <= 16; i++) start[i + 1] = start[i] + (count[i] << (16 - i));
      var jutbits = 16 - tablebits;
      for (i = 1; i <= tablebits; i++) { start[i] >>>= jutbits; weight[i] = 1 << (tablebits - i); }
      for (; i <= 16; i++) weight[i] = 1 << (16 - i);
      i = start[tablebits + 1] >>> jutbits;
      k = 1 << tablebits;
      if (i !== 0) while (i < k) table[i++] = 0;
      var avail = nchar, mask = 1 << (15 - tablebits);
      for (var ch = 0; ch < nchar; ch++) {
        var len = bitlen[ch];
        if (len === 0) continue;
        k = start[len];
        var nextcode = k + weight[len];
        if (len <= tablebits) {
          for (i = k; i < nextcode; i++) table[i] = ch;
        } else {
          // walk / grow the overflow tree
          var arr = table, idx = k >>> jutbits;
          i = len - tablebits;
          while (i-- !== 0) {
            if (arr[idx] === 0) { right[avail] = left[avail] = 0; arr[idx] = avail++; }
            var node = arr[idx];
            if (k & mask) { arr = right; idx = node; } else { arr = left; idx = node; }
            k = (k << 1) & 0xffff;
          }
          arr[idx] = ch;
        }
        start[len] = nextcode;
      }
    }
    function readPtLen(nn, nbit, special) {
      var n = getbits(nbit), i, c;
      if (n === 0) {
        c = getbits(nbit);
        for (i = 0; i < nn; i++) ptLen[i] = 0;
        for (i = 0; i < 256; i++) ptTable[i] = c;
        return;
      }
      i = 0;
      while (i < n) {
        c = bitbuf >>> 13;
        if (c === 7) {
          var mask = 1 << 12;
          while (bitbuf & mask) { mask >>>= 1; c++; }
        }
        fillbuf(c < 7 ? 3 : c - 3);
        ptLen[i++] = c;
        if (i === special) { c = getbits(2); while (--c >= 0) ptLen[i++] = 0; }
      }
      while (i < nn) ptLen[i++] = 0;
      makeTable(nn, ptLen, 8, ptTable);
    }
    function readCLen() {
      var n = getbits(CBIT), i, c;
      if (n === 0) {
        c = getbits(CBIT);
        for (i = 0; i < NC; i++) cLen[i] = 0;
        for (i = 0; i < 4096; i++) cTable[i] = c;
        return;
      }
      i = 0;
      while (i < n) {
        c = ptTable[bitbuf >>> 8];
        if (c >= NT) {
          var mask = 1 << 7;
          do { c = (bitbuf & mask) ? right[c] : left[c]; mask >>>= 1; } while (c >= NT);
        }
        fillbuf(ptLen[c]);
        if (c <= 2) {
          if (c === 0) c = 1; else if (c === 1) c = getbits(4) + 3; else c = getbits(CBIT) + 20;
          while (--c >= 0) cLen[i++] = 0;
        } else cLen[i++] = c - 2;
      }
      while (i < NC) cLen[i++] = 0;
      makeTable(NC, cLen, 12, cTable);
    }
    function decodeC() {
      var j = cTable[bitbuf >>> 4];
      if (j < NC) fillbuf(cLen[j]);
      else {
        fillbuf(12);
        var mask = 1 << 15;
        do { j = (bitbuf & mask) ? right[j] : left[j]; mask >>>= 1; } while (j >= NC);
        fillbuf(cLen[j] - 12);
      }
      return j;
    }
    function decodeP() {
      var j = ptTable[bitbuf >>> 8];
      if (j < NP) fillbuf(ptLen[j]);
      else {
        fillbuf(8);
        var mask = 1 << 15;
        do { j = (bitbuf & mask) ? right[j] : left[j]; mask >>>= 1; } while (j >= NP);
        fillbuf(ptLen[j] - 8);
      }
      if (j !== 0) j = (1 << (j - 1)) + getbits(j - 1);
      return j;
    }

    fillbuf(16);
    var blocksize = 0;
    while (op < osize) {
      if (blocksize === 0) {
        blocksize = getbits(16);
        readPtLen(NT, TBIT, 3);
        readCLen();
        readPtLen(NP, PBIT, -1);
      }
      blocksize--;
      var c = decodeC();
      if (c < 256) { out[op++] = c; }
      else {
        var len = c - 256 + 3, from = op - decodeP() - 1;
        if (from < 0) throw new Error('Corrupt LHA data.');
        while (len-- > 0 && op < osize) out[op++] = out[from++];
      }
    }
    return out;
  }

  function extract(u8, wanted) {
    var want = wanted.toLowerCase(), entries = list(u8);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i], n = e.name.toLowerCase();
      if (n !== want && n.slice(-want.length - 1) !== '/' + want && n.slice(-want.length - 1) !== '\\' + want) continue;
      var src = u8.subarray(e.data, e.data + e.csize), out;
      if (e.method === '-lh0-' || e.method === '-lz4-') out = src.slice();
      else if (e.method === '-lh5-') out = lh5(src, e.osize, 13);
      else if (e.method === '-lh6-') out = lh5(src, e.osize, 15);
      else if (e.method === '-lh7-') out = lh5(src, e.osize, 16);
      else throw new Error('Unsupported LHA method ' + e.method);
      if (crc16(out) !== e.crc) throw new Error('The unpacked file failed its checksum.');
      return out;
    }
    throw new Error(wanted + ' was not found in the archive.');
  }

  global.ArcadeLHA = { list: list, extract: extract, crc16: crc16 };
})(typeof window !== 'undefined' ? window : globalThis);
