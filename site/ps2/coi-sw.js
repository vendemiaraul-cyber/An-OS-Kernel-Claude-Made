// ConMon PS2 - cross-origin isolation for hosts that can't send headers.
//
// Play!'s threads need SharedArrayBuffer, which browsers only allow on a
// page served with COOP/COEP headers. Netlify can send them (netlify.toml,
// _headers); GitHub Pages can't, so this service worker adds them to every
// response in /ps2/ instead. ps2.js registers it only when the page isn't
// isolated already.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;
  // Revalidate every file, so a new version of the site is never hidden by
  // a stale copy in the browser's cache.
  const req = r.mode === "navigate" ? r : new Request(r, { cache: "no-cache" });
  e.respondWith(fetch(req).then((res) => {
    if (res.status === 0) return res;        // opaque: leave it alone
    const h = new Headers(res.headers);
    h.set("Cross-Origin-Embedder-Policy", "require-corp");
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Resource-Policy", "same-origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }));
});
