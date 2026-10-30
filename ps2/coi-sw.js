// ConMon PS2 - cross-origin isolation for hosts that can't send headers. (v2)
//
// Play!'s threads need SharedArrayBuffer, which browsers only allow on a
// page served with COOP/COEP headers. Netlify can send them (netlify.toml,
// _headers); GitHub Pages can't, so this service worker adds them to the
// page and its scripts (the emulator's worker threads load Play.js too).
// Everything else (the emulator's .wasm, the game, its data) is same-origin,
// which COEP allows as it is, so those downloads go straight to the network.
// That matters on Safari: re-wrapping a compressed download there copied
// "Content-Encoding: gzip" onto already-unpacked bytes and broke it.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const r = e.request;
  const url = new URL(r.url);
  const isPageOrScript = r.mode === "navigate" || r.destination === "script" || r.destination === "worker" ||
    r.destination === "sharedworker" || url.pathname.endsWith(".js");
  if (!isPageOrScript || url.origin !== self.location.origin) return;     // the browser handles it
  const req = r.mode === "navigate" ? r : new Request(r, { cache: "no-cache" });
  e.respondWith(fetch(req).then((res) => {
    if (res.status === 0) return res;
    const h = new Headers(res.headers);
    h.delete("Content-Encoding");          // the body below is already unpacked
    h.delete("Content-Length");
    h.set("Cross-Origin-Embedder-Policy", "require-corp");
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Resource-Policy", "same-origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }));
});
