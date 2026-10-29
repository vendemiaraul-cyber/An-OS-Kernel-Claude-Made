// ConMon Lab - YouTube Test App (YouTube Data API v3)
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ui = {
    mode: $("mode"), modeText: $("mode-text"), btnKey: $("btn-key"),
    keyPanel: $("key-panel"), keyInput: $("key-input"), keySave: $("key-save"), keyClear: $("key-clear"),
    form: $("search-form"), q: $("q"), order: $("order"), duration: $("duration"), max: $("max"),
    safe: $("safe"), region: $("region"), trending: $("btn-trending"), notice: $("notice"),
    player: $("player"), frame: $("frame"), details: $("details"),
    grid: $("grid"), empty: $("empty"), more: $("btn-more"),
    resultsTitle: $("results-title"), resultsSub: $("results-sub"),
    logList: $("log-list"), quota: $("quota"),
  };

  const GOOGLE_API = "https://www.googleapis.com/youtube/v3/";
  const PARTS = { search: "snippet", videos: "snippet,contentDetails,statistics", channels: "snippet,statistics" };
  const KEY_STORE = "conmonlab.ytkey";
  const QUOTA_STORE = "conmonlab.ytquota";

  let mode = "none";                 // "server" | "browser" | "none"
  let lastQuery = null;              // { kind: "search"|"trending", params, nextPageToken }
  const videoCache = new Map();      // id -> video resource
  let playingId = null;

  // ------------------------------------------------------------ storage

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };

  function today() { return new Date().toISOString().slice(0, 10); }
  function quota() {
    let q;
    try { q = JSON.parse(store.get(QUOTA_STORE) || "null"); } catch (_) { q = null; }
    if (!q || q.date !== today()) q = { date: today(), search: 0, units: 0 };
    return q;
  }
  function addQuota(endpoint) {
    const q = quota();
    if (endpoint === "search") q.search++; else q.units++;
    store.set(QUOTA_STORE, JSON.stringify(q));
    renderQuota();
  }
  function renderQuota() {
    const q = quota();
    ui.quota.textContent = `today: ${q.search}/100 searches · ${q.units}/10,000 units`;
  }

  // --------------------------------------------------------------- mode

  function setMode(m) {
    mode = m;
    const map = {
      server: ["server key (Netlify Function)", "ok"],
      browser: ["your key (this browser)", "ok"],
      none: ["no API key", "err"],
    };
    ui.modeText.textContent = map[m][0];
    ui.mode.className = "badge " + map[m][1];
    if (m === "none") {
      ui.keyPanel.classList.remove("hidden");
      notice("No API key is configured. Set YOUTUBE_API_KEY in Netlify's environment variables and redeploy, or paste a key above to test from this browser.", "warn");
    } else {
      hideNotice();
    }
  }

  async function detectMode() {
    try {
      const res = await fetch("/api/youtube?endpoint=status", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.serverKey) return setMode("server");
      }
    } catch (_) { /* no function available (static hosting or local file) */ }
    setMode(store.get(KEY_STORE) ? "browser" : "none");
  }

  ui.btnKey.addEventListener("click", () => {
    ui.keyPanel.classList.toggle("hidden");
    ui.keyInput.value = store.get(KEY_STORE) || "";
  });
  ui.keySave.addEventListener("click", () => {
    const k = ui.keyInput.value.trim();
    if (!k) return;
    store.set(KEY_STORE, k);
    if (mode !== "server") setMode("browser");
    ui.keyPanel.classList.add("hidden");
  });
  ui.keyClear.addEventListener("click", () => {
    store.del(KEY_STORE);
    ui.keyInput.value = "";
    if (mode !== "server") setMode("none");
  });

  // ---------------------------------------------------------------- API

  function buildUrl(endpoint, params) {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    if (mode === "server") {
      return "/api/youtube?" + new URLSearchParams({ endpoint, ...clean });
    }
    return GOOGLE_API + endpoint + "?" + new URLSearchParams({ part: PARTS[endpoint], ...clean, key: store.get(KEY_STORE) || "" });
  }

  async function api(endpoint, params) {
    if (mode === "none") throw new Error("Add an API key first (button at the top right).");
    const url = buildUrl(endpoint, params);
    const shown = url.replace(/([?&]key=)[^&]+/, "$1•••");
    const t0 = performance.now();
    let res, body, text = "";
    try {
      res = await fetch(url);
      text = await res.text();
      try { body = JSON.parse(text); } catch (_) { body = null; }
    } catch (err) {
      logRequest(endpoint, shown, "network error", 0, String(err), false);
      throw new Error("Network error talking to the API.");
    }
    const ms = Math.round(performance.now() - t0);
    logRequest(endpoint, shown, res.status, ms, body ? JSON.stringify(body, null, 2) : text, res.ok);
    if (res.status !== 503 || !(body && body.error && body.error.code === "NO_SERVER_KEY")) addQuota(endpoint);

    if (!res.ok) {
      const e = body && body.error;
      const reason = e && e.errors && e.errors[0] && e.errors[0].reason;
      let msg = (e && e.message) || `HTTP ${res.status}`;
      msg = msg.replace(/<[^>]+>/g, "");
      if (reason === "quotaExceeded") msg = "Daily quota used up for this API key. It resets at midnight Pacific time.";
      if (reason === "keyInvalid" || /API key not valid/i.test(msg)) msg = "That API key isn't valid for the YouTube Data API v3.";
      throw new Error(msg);
    }
    return body;
  }

  // ----------------------------------------------------------- API log

  function logRequest(endpoint, url, status, ms, payload, ok) {
    const item = document.createElement("details");
    item.className = "log-item";
    const sum = document.createElement("summary");
    const code = document.createElement("span");
    code.className = "code " + (ok ? "ok" : "bad");
    code.textContent = status;
    const ep = document.createElement("b");
    ep.textContent = endpoint;
    const time = document.createElement("span");
    time.className = "muted";
    time.textContent = `${ms} ms · ${new Date().toLocaleTimeString()}`;
    sum.append(code, ep, time);
    const pre = document.createElement("pre");
    pre.textContent = "GET " + url + "\n\n" + (payload.length > 60000 ? payload.slice(0, 60000) + "\n…(truncated)" : payload);
    item.append(sum, pre);
    ui.logList.prepend(item);
    while (ui.logList.children.length > 30) ui.logList.lastElementChild.remove();
  }

  // ------------------------------------------------------------ helpers

  const decoder = document.createElement("textarea");
  function decode(html) { decoder.innerHTML = html || ""; return decoder.value; }

  function isoDuration(iso) {
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
    if (!m) return "";
    const d = +(m[1] || 0), h = +(m[2] || 0) + d * 24, min = +(m[3] || 0), s = +(m[4] || 0);
    if (!h && !min && !s) return "LIVE";
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
  }

  function compact(n) {
    if (n == null) return "–";
    n = Number(n);
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    const units = [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
    for (const [sec, name] of units) {
      const v = Math.floor(s / sec);
      if (v >= 1) return `${v} ${name}${v > 1 ? "s" : ""} ago`;
    }
    return "just now";
  }

  function notice(text, tone) {
    ui.notice.textContent = text;
    ui.notice.className = "notice" + (tone === "err" ? " err" : "");
  }
  function hideNotice() { ui.notice.className = "notice hidden"; }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------------------------------------------------------- rendering

  function renderCard(v) {
    const card = el("button", "card");
    card.type = "button";
    card.dataset.id = v.id;
    if (v.id === playingId) card.classList.add("playing");
    const thumb = el("div", "thumb");
    const img = document.createElement("img");
    const t = v.snippet.thumbnails || {};
    img.src = (t.medium || t.high || t.default || {}).url || "";
    img.alt = "";
    img.loading = "lazy";
    thumb.append(img);
    const dur = isoDuration(v.contentDetails && v.contentDetails.duration);
    if (dur) thumb.append(el("span", "dur", dur));
    const body = el("div", "body");
    body.append(el("div", "title", decode(v.snippet.title)));
    const views = v.statistics ? compact(v.statistics.viewCount) + " views · " : "";
    body.append(el("div", "meta", decode(v.snippet.channelTitle)));
    body.append(el("div", "meta", views + ago(v.snippet.publishedAt)));
    card.append(thumb, body);
    card.addEventListener("click", () => play(v.id));
    return card;
  }

  function renderResults(videos, append) {
    if (!append) ui.grid.innerHTML = "";
    for (const v of videos) ui.grid.append(renderCard(v));
    ui.empty.classList.toggle("hidden", ui.grid.children.length > 0);
    if (!ui.grid.children.length) ui.empty.textContent = "No videos found.";
    ui.more.classList.toggle("hidden", !(lastQuery && lastQuery.nextPageToken));
  }

  function play(id) {
    const v = videoCache.get(id);
    if (!v) return;
    playingId = id;
    for (const c of ui.grid.querySelectorAll(".card")) c.classList.toggle("playing", c.dataset.id === id);

    ui.frame.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&modestbranding=1`;
    iframe.title = decode(v.snippet.title);
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    ui.frame.append(iframe);

    const d = ui.details;
    d.innerHTML = "";
    d.append(el("h2", null, decode(v.snippet.title)));
    d.append(el("div", "muted", decode(v.snippet.channelTitle) + " · " + new Date(v.snippet.publishedAt).toLocaleDateString()));
    const stats = el("div", "stats");
    const s = v.statistics || {};
    const add = (label, val) => { const span = el("span"); const b = el("b", null, val); span.append(b, " " + label); stats.append(span); };
    add("views", compact(s.viewCount));
    add("likes", compact(s.likeCount));
    add("comments", compact(s.commentCount));
    const dur = isoDuration(v.contentDetails && v.contentDetails.duration);
    if (dur) add("long", dur);
    d.append(stats);
    d.append(el("p", "desc", decode(v.snippet.description) || "No description."));
    const links = el("div", "row");
    links.style.marginTop = "12px";
    const a = el("a", "btn", "Open on YouTube");
    a.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(id);
    a.target = "_blank"; a.rel = "noopener";
    const c = el("a", "btn", "Channel");
    c.href = "https://www.youtube.com/channel/" + encodeURIComponent(v.snippet.channelId);
    c.target = "_blank"; c.rel = "noopener";
    links.append(a, c);
    d.append(links);

    ui.player.classList.remove("hidden");
    ui.player.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ------------------------------------------------------------ actions

  async function fetchDetails(ids) {
    if (!ids.length) return [];
    const data = await api("videos", { id: ids.join(","), maxResults: 50 });
    const byId = new Map((data.items || []).map((v) => [v.id, v]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  function setBusy(busy) {
    for (const b of [ui.form.querySelector("button"), ui.trending, ui.more]) b.disabled = busy;
    document.body.style.cursor = busy ? "progress" : "";
  }

  async function runSearch(append) {
    setBusy(true);
    hideNotice();
    try {
      const p = { ...lastQuery.params };
      if (append && lastQuery.nextPageToken) p.pageToken = lastQuery.nextPageToken;
      let videos;
      if (lastQuery.kind === "search") {
        const data = await api("search", p);
        lastQuery.nextPageToken = data.nextPageToken || null;
        const ids = (data.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
        videos = await fetchDetails(ids);
        ui.resultsSub.textContent = data.pageInfo ? `about ${compact(data.pageInfo.totalResults)} results` : "";
      } else {
        const data = await api("videos", p);
        lastQuery.nextPageToken = data.nextPageToken || null;
        videos = data.items || [];
        ui.resultsSub.textContent = p.regionCode ? `region ${p.regionCode}` : "";
      }
      for (const v of videos) videoCache.set(v.id, v);
      renderResults(videos, append);
    } catch (err) {
      notice(err.message, "err");
      if (!append && !ui.grid.children.length) ui.empty.textContent = "Nothing to show yet.";
    } finally {
      setBusy(false);
    }
  }

  ui.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = ui.q.value.trim();
    if (!q) return;
    lastQuery = {
      kind: "search",
      params: {
        q, type: "video", order: ui.order.value, maxResults: ui.max.value,
        safeSearch: ui.safe.value, regionCode: ui.region.value,
        videoDuration: ui.duration.value === "any" ? "" : ui.duration.value,
        videoEmbeddable: "true",
      },
      nextPageToken: null,
    };
    ui.resultsTitle.textContent = `Results for “${q}”`;
    runSearch(false);
    try { history.replaceState(null, "", "?q=" + encodeURIComponent(q)); } catch (_) {}
  });

  ui.trending.addEventListener("click", () => {
    lastQuery = {
      kind: "trending",
      params: { chart: "mostPopular", regionCode: ui.region.value || "US", maxResults: ui.max.value },
      nextPageToken: null,
    };
    ui.resultsTitle.textContent = "Trending";
    runSearch(false);
  });

  ui.more.addEventListener("click", () => { if (lastQuery) runSearch(true); });

  // --------------------------------------------------------------- init

  renderQuota();
  detectMode().then(() => {
    const q = new URLSearchParams(location.search).get("q");
    if (q && mode !== "none") { ui.q.value = q; ui.form.requestSubmit(); }
  });
})();
