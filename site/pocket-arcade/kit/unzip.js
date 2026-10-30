/* Pocket Arcade: extract one file from a ZIP or a self-extracting ZIP (.exe)
   entirely in the browser. Uses the built-in DecompressionStream. */
(function (global) {
  'use strict';

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // Find a central-directory entry by name (case-insensitive, path suffix allowed).
  function findEntry(buf, wanted) {
    var dv = new DataView(buf), len = buf.byteLength, eocd = -1;
    for (var i = len - 22; i >= Math.max(0, len - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This file is not a ZIP archive.');
    var cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
    var shift = eocd - (cdOff + cdSize); // self-extractors prepend an EXE stub
    var p = cdOff + shift, count = dv.getUint16(eocd + 10, true);
    var want = wanted.toLowerCase();
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The archive directory is damaged.');
      var method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true);
      var csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      var nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      var local = dv.getUint32(p + 42, true) + shift;
      var name = new TextDecoder('latin1').decode(new Uint8Array(buf, p + 46, nlen)).replace(/\\/g, '/');
      var lname = name.toLowerCase();
      if (lname === want || lname.slice(-want.length - 1) === '/' + want) {
        return { name: name, method: method, crc: crc, csize: csize, usize: usize, local: local };
      }
      p += 46 + nlen + xlen + clen;
    }
    throw new Error(wanted + ' was not found in the archive.');
  }

  async function extract(buf, wanted, onProgress) {
    var e = findEntry(buf, wanted), dv = new DataView(buf);
    if (dv.getUint32(e.local, true) !== 0x04034b50) throw new Error('The archive entry is damaged.');
    var start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
    if (start + e.csize > buf.byteLength) throw new Error('The archive is incomplete. Try the download again.');
    var data = new Uint8Array(buf, start, e.csize), out;
    if (e.method === 0) {
      out = data.slice();
    } else if (e.method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack archives. Update iOS or Safari and try again.');
      out = new Uint8Array(e.usize);
      var ds = new DecompressionStream('deflate-raw');
      var writer = ds.writable.getWriter();
      var step = 1 << 20;
      (async function () {
        for (var o = 0; o < data.length; o += step) await writer.write(data.subarray(o, Math.min(data.length, o + step)));
        await writer.close();
      })().catch(function () {});
      var reader = ds.readable.getReader(), got = 0;
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        if (got + r.value.length > out.length) throw new Error('Unpacked data is larger than expected.');
        out.set(r.value, got); got += r.value.length;
        if (onProgress) onProgress(got / e.usize);
      }
      if (got !== e.usize) throw new Error('Unpacked data is incomplete.');
    } else {
      throw new Error('Unsupported compression method ' + e.method + '.');
    }
    if (crc32(out) !== e.crc) throw new Error('The unpacked file failed its checksum. Try the download again.');
    return out;
  }

  // Download one or more URLs (parts of one file) with progress, joined in order.
  async function download(urls, total, onProgress) {
    var all = new Uint8Array(total), got = 0;
    for (var i = 0; i < urls.length; i++) {
      var res = await fetch(urls[i]);
      if (!res.ok) throw new Error('Download failed (' + res.status + ') for ' + urls[i]);
      var reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (reader) {
        for (;;) {
          var r = await reader.read();
          if (r.done) break;
          if (got + r.value.length > total) throw new Error('The download is larger than expected.');
          all.set(r.value, got); got += r.value.length;
          if (onProgress) onProgress(got / total);
        }
      } else {
        var b = new Uint8Array(await res.arrayBuffer());
        all.set(b, got); got += b.length;
        if (onProgress) onProgress(got / total);
      }
    }
    if (got !== total) throw new Error('The download stopped early (' + got + ' of ' + total + ' bytes). Check your connection and try again.');
    return all.buffer;
  }

  global.ArcadeZip = { extract: extract, download: download, crc32: crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
