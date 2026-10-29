// ConMon Lab - host link.
//
// ConMon talks to this page over its serial port (COM1). This file is the
// "host" side: it installs packages, decodes MP4 video into VGA text-mode
// frames, and runs language models with WebLLM on the GPU, then streams the
// results back into the OS.
//
//   ConMon -> host:  ESC ] "CM;" <type> ";" <payload> BEL
//   host -> ConMon:  STX <type> <len lo> <len hi> <payload bytes>
(() => {
  "use strict";

  const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.86";
  const VIDEOS = {
    ep1: { file: "/videos/ConMon-1-booting-up.mp4", title: "Episode 1: Booting up", name: "ep1.mp4" },
    ep2: { file: "/videos/ConMon-2-the-shell.mp4", title: "Episode 2: The shell", name: "ep2.mp4" },
    ep3: { file: "/videos/ConMon-3-files-in-ram.mp4", title: "Episode 3: Files in RAM", name: "ep3.mp4" },
    ep4: { file: "/videos/ConMon-4-hardware-and-crashes.mp4", title: "Episode 4: Hardware and crashes", name: "ep4.mp4" },
  };
  // Model families offered, smallest first. The best quantisation that this
  // device supports is picked from WebLLM's own model list at runtime.
  const FAMILIES = [
    ["SmolLM2-360M-Instruct", "SmolLM2 360M (tiny, fast)"],
    ["Qwen2.5-0.5B-Instruct", "Qwen2.5 0.5B"],
    ["Qwen3-0.6B", "Qwen3 0.6B"],
    ["gemma3-1b-it", "Gemma 3 1B"],
    ["Llama-3.2-1B-Instruct", "Llama 3.2 1B"],
    ["TinyLlama-1.1B-Chat-v1.0", "TinyLlama 1.1B"],
    ["Qwen2.5-1.5B-Instruct", "Qwen2.5 1.5B"],
    ["SmolLM2-1.7B-Instruct", "SmolLM2 1.7B"],
    ["Qwen3-1.7B", "Qwen3 1.7B"],
    ["Llama-3.2-3B-Instruct", "Llama 3.2 3B"],
    ["Phi-3.5-mini-instruct", "Phi 3.5 mini"],
    ["Qwen3-4B", "Qwen3 4B (best answers)"],
  ];
  const SYSTEM_PROMPT =
    "You are a helpful assistant running inside ConMon, a tiny hobby operating system " +
    "shown on an 80-column text screen. Answer in plain text without markdown, " +
    "tables or emoji. Keep answers short unless asked for detail.";
  const VGA = [
    [0, 0, 0], [0, 0, 170], [0, 170, 0], [0, 170, 170], [170, 0, 0], [170, 0, 170], [170, 85, 0], [170, 170, 170],
    [85, 85, 85], [85, 85, 255], [85, 255, 85], [85, 255, 255], [255, 85, 85], [255, 85, 255], [255, 255, 85], [255, 255, 255],
  ];
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.5) * 48);

  let emu = null;
  let onState = () => {};
  const state = { mp4: false, llm: false, gpu: "unknown", model: null, busy: "" };
  const blobs = {};                     // video id -> object URL (prefetched)
  const userVideos = {};                // id -> { url, title, name }
  let userCount = 0;

  // ------------------------------------------------------------ framing

  let mode = 0, frame = "";              // 0 text, 1 saw ESC, 2 inside a message
  let emitText = () => {};

  function onByte(b) {
    if (mode === 0) {
      if (b === 0x1B) { mode = 1; return; }
      emitText(b);
    } else if (mode === 1) {
      if (b === 0x5D) { mode = 2; frame = ""; return; }   // ']'
      mode = 0; emitText(0x1B); emitText(b);
    } else {
      if (b === 0x07) {
        mode = 0;
        if (frame.startsWith("CM;")) handle(frame.slice(3));
        else for (const c of "\x1b]" + frame + "\x07") emitText(c.charCodeAt(0));
        return;
      }
      frame += String.fromCharCode(b);
      if (frame.length > 4096) { mode = 0; frame = ""; }
    }
  }

  function send(type, payload) {
    if (!emu) return;
    let data = typeof payload === "string" ? payload : String.fromCharCode.apply(null, payload || []);
    if (data.length > 8000) data = data.slice(0, 8000);
    const header = String.fromCharCode(0x02, type.charCodeAt(0), data.length & 0xFF, (data.length >> 8) & 0xFF);
    emu.serial0_send(header + data);
  }

  const sendText = (type, text) => send(type, toCp437(text));

  // CP437 text screen: fold typography to ASCII and drop the rest.
  function toCp437(s) {
    return String(s)
      .replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"')
      .replace(/[–—−]/g, "-").replace(/…/g, "...").replace(/[•●]/g, "*")
      .replace(/ /g, " ").replace(/\t/g, "  ").replace(/\r/g, "")
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^\n\x20-\x7E]/g, "");
  }

  function progress(pct, text) { sendText("P", `${Math.max(0, Math.min(100, Math.round(pct)))}|${String(text).slice(0, 40)}`); }
  function setBusy(text) { state.busy = text; onState(state); }

  // -------------------------------------------------------- dispatcher

  async function handle(msg) {
    const i = msg.indexOf(";");
    const type = i < 0 ? msg : msg.slice(0, i);
    const arg = i < 0 ? "" : msg.slice(i + 1);
    try {
      switch (type) {
        case "hello": sendText("H", "ConMon Lab 1"); break;
        case "pkg.install":
          if (arg === "mp4") await installMp4();
          else if (arg === "llm") await installLlm();
          else sendText("E", `Unknown package ${arg}`);
          break;
        case "cancel": cancelled = true; break;
        case "llm.models": await listModels(); break;
        case "llm.download": case "llm.load": await loadModel(arg); break;
        case "llm.chat": await chat(arg); break;
        case "llm.stop": if (engine) engine.interruptGenerate(); break;
        case "llm.reset": history = []; break;
        case "mp4.play": await playVideo(arg); break;
        case "mp4.ack": player.acked = true; break;
        case "mp4.stop": stopVideo(); break;
        case "mp4.pause": togglePause(); break;
        default: break;
      }
    } catch (err) {
      console.error(err);
      sendText("E", (err && err.message ? err.message : String(err)).slice(0, 160));
      setBusy("");
    }
  }

  // ---------------------------------------------------------------- mp4

  let cancelled = false;

  async function fetchWithProgress(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
    const total = Number(res.headers.get("content-length")) || 0;
    if (!res.body || !total) { const b = await res.blob(); onProgress(1); return b; }
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (cancelled) { reader.cancel(); throw new Error("Cancelled."); }
      parts.push(value); got += value.length;
      onProgress(got / total);
    }
    return new Blob(parts, { type: res.headers.get("content-type") || "video/mp4" });
  }

  function describe(v, meta) {
    return `${v.name}\nMP4 video (streamed from ConMon Lab)\nid: ${meta.id}\ntitle: ${v.title}\nlength: ${meta.length}\nsize: ${meta.size}\n`;
  }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function duration(url) {
    return new Promise((resolve) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => resolve(v.duration);
      v.onerror = () => resolve(0);
      v.src = url;
    });
  }

  async function installMp4() {
    cancelled = false;
    setBusy("installing mp4");
    progress(0, "Checking the video decoder");
    const probe = document.createElement("video");
    if (!probe.canPlayType('video/mp4; codecs="avc1.42E01E"')) {
      sendText("E", "This browser can't decode MP4 (H.264) video.");
      setBusy("");
      return;
    }
    const ids = Object.keys(VIDEOS);
    for (let n = 0; n < ids.length; n++) {
      const id = ids[n], v = VIDEOS[id];
      if (!blobs[id]) {
        const blob = await fetchWithProgress(v.file, (f) => progress(((n + f) / ids.length) * 100, `Downloading ${v.name}`));
        blobs[id] = { url: URL.createObjectURL(blob), size: blob.size };
      }
      const len = await duration(blobs[id].url);
      progress(((n + 1) / ids.length) * 100, `Installed ${v.name}`);
      sendText("W", describe(v, { id, length: fmtTime(len), size: Math.round(blobs[id].size / 1024) + " KB" }));
    }
    state.mp4 = true;
    setBusy("");
    send("D", "mp4");
  }

  // Lets the page hand ConMon a video the user picked (after install mp4).
  async function addUserVideo(file) {
    if (!emu || !state.mp4) return false;
    const id = "user" + (++userCount);
    let base = file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || "video";
    const name = base + ".mp4";
    const url = URL.createObjectURL(file);
    userVideos[id] = { url, title: file.name, name };
    const len = await duration(url);
    sendText("W", describe({ name, title: file.name }, { id, length: fmtTime(len), size: Math.round(file.size / 1024) + " KB" }));
    return name;
  }

  const player = { video: null, timer: 0, acked: true, name: "", paused: false, canvas: null, ctx: null };

  async function playVideo(id) {
    stopVideo(true);
    const src = blobs[id] ? blobs[id].url : (userVideos[id] ? userVideos[id].url : (VIDEOS[id] ? VIDEOS[id].file : null));
    if (!src) { sendText("E", "That video isn't available any more. Run install mp4 again."); return; }
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = src;
    player.video = v;
    player.name = (VIDEOS[id] || userVideos[id] || { name: id }).name;
    player.paused = false;
    player.acked = true;
    if (!player.canvas) {
      player.canvas = document.createElement("canvas");
      player.canvas.width = 80; player.canvas.height = 48;
      player.ctx = player.canvas.getContext("2d", { willReadFrequently: true });
    }
    v.addEventListener("ended", () => { finishVideo(); });
    try { await v.play(); } catch (e) { sendText("E", "The browser refused to play the video."); return; }
    setBusy("playing " + player.name);
    player.timer = setInterval(tick, 1000 / 12);
  }

  function tick() {
    const v = player.video;
    if (!v || !player.acked || v.readyState < 2) return;
    send("F", frameBytes(v));
    send("S", statusLine(v));             // raw: keeps the CP437 play symbol
    player.acked = false;
  }

  function statusLine(v) {
    const icon = player.paused ? "||" : "\x10";
    let s = ` ${icon} ${player.name}   ${fmtTime(v.currentTime)} / ${fmtTime(v.duration)}`;
    const keys = "q quit   space pause ";
    s = s.padEnd(80 - keys.length) + keys;
    return s.slice(0, 80);
  }

  // Draws the frame at 80x48 "pixels": each text cell shows two of them
  // with the upper-half-block character (fg = top, bg = bottom).
  function frameBytes(v) {
    const ctx = player.ctx, W = 80, H = 48;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const ar = (v.videoWidth / v.videoHeight) || 16 / 9;
    // Cells are about 8x16 px, so each half-cell pixel is roughly square.
    let w = W, h = Math.round(W / ar);
    if (h > H) { h = H; w = Math.round(H * ar); }
    ctx.drawImage(v, Math.floor((W - w) / 2), Math.floor((H - h) / 2), w, h);
    const px = ctx.getImageData(0, 0, W, H).data;
    const out = new Uint8Array(W * 24);
    for (let row = 0; row < 24; row++) {
      for (let x = 0; x < W; x++) {
        const top = nearest(px, x, row * 2), bottom = nearest(px, x, row * 2 + 1);
        out[row * W + x] = (bottom << 4) | top;
      }
    }
    return out;
  }

  function nearest(px, x, y) {
    const i = (y * 80 + x) * 4, d = BAYER[(y & 3) * 4 + (x & 3)];
    const r = px[i] + d, g = px[i + 1] + d, b = px[i + 2] + d;
    let best = 0, bestDist = Infinity;
    for (let c = 0; c < 16; c++) {
      const p = VGA[c];
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
      const dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (dist < bestDist) { bestDist = dist; best = c; }
    }
    return best;
  }

  function togglePause() {
    const v = player.video;
    if (!v) return;
    player.paused = !player.paused;
    if (player.paused) v.pause(); else v.play();
    send("S", statusLine(v));
  }

  function finishVideo() {
    if (!player.video) return;
    stopVideo(true);
    send("X", "");
  }

  function stopVideo(silent) {
    clearInterval(player.timer);
    player.timer = 0;
    if (player.video) {
      player.video.pause();
      player.video.removeAttribute("src");
      player.video.load();
      player.video = null;
      if (!silent) send("X", "");
    }
    setBusy("");
  }

  // ---------------------------------------------------------------- llm

  let webllm = null, engine = null, history = [];
  let adapterInfo = null;

  async function gpuAdapter() {
    if (!("gpu" in navigator)) return null;
    try { return await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }); } catch (_) { return null; }
  }

  async function checkGpu() {
    const a = await gpuAdapter();
    state.gpu = a ? "available" : "not available";
    onState(state);
    return a;
  }

  async function installLlm() {
    setBusy("installing llm");
    progress(5, "Looking for a WebGPU graphics card");
    const adapter = await checkGpu();
    if (!adapter) {
      sendText("E", "WebGPU isn't available here. Use Chrome or Edge on a computer (or Chrome on a recent Android).");
      setBusy("");
      return;
    }
    adapterInfo = adapter.info || {};
    progress(35, "Downloading the WebLLM runtime");
    if (!webllm) webllm = await import(WEBLLM_URL);
    progress(100, "WebLLM runtime ready");
    const gpuName = [adapterInfo.vendor, adapterInfo.architecture].filter(Boolean).join(" ") || "WebGPU device";
    sendText("M", `GPU: ${gpuName}   half precision (f16): ${adapter.features.has("shader-f16") ? "yes" : "no"}`);
    state.llm = true;
    setBusy("");
    send("D", "llm");
  }

  async function workingModels() {
    const adapter = await gpuAdapter();
    if (!adapter) throw new Error("WebGPU isn't available in this browser.");
    if (!webllm) webllm = await import(WEBLLM_URL);
    const f16 = adapter.features.has("shader-f16");
    const maxStorage = adapter.limits.maxStorageBufferBindingSize || 0;
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    const mem = navigator.deviceMemory || 8;
    const budgetMB = mobile ? 1500 : mem <= 4 ? 2600 : 4500;
    const list = webllm.prebuiltAppConfig.model_list;
    const byId = new Map(list.map((m) => [m.model_id, m]));
    const out = [];
    for (const [family, label] of FAMILIES) {
      const ids = f16 ? [`${family}-q4f16_1-MLC`, `${family}-q4f32_1-MLC`] : [`${family}-q4f32_1-MLC`];
      for (const id of ids) {
        const m = byId.get(id);
        if (!m) continue;
        const needs = new Set(m.required_features || []);
        if (/f16/.test(id)) needs.add("shader-f16");
        if ([...needs].some((f) => !adapter.features.has(f))) continue;
        if ((m.vram_required_MB || 0) > budgetMB) continue;
        if (mobile && !m.low_resource_required) continue;
        if (m.buffer_size_required_bytes && maxStorage && m.buffer_size_required_bytes > maxStorage) continue;
        let cached = false;
        try { cached = await webllm.hasModelInCache(id); } catch (_) {}
        out.push({ id, label, mb: Math.round(m.vram_required_MB || 0), cached });
        break;
      }
    }
    return out;
  }

  let lastModels = [];
  async function listModels() {
    setBusy("checking models");
    const models = await workingModels();
    lastModels = models;
    const letters = "ABCDEFGHIJKL";
    const lines = models.map((m, i) => `${letters[i]}|${m.id}|${m.mb >= 1000 ? (m.mb / 1000).toFixed(1) + " GB" : m.mb + " MB"}|${m.label}|${m.cached ? "cached" : ""}`);
    setBusy("");
    if (!lines.length) sendText("E", "None of the WebLLM models fit this device's GPU.");
    else sendText("L", lines.join("\n"));
  }

  async function loadModel(id) {
    if (!webllm) webllm = await import(WEBLLM_URL);
    if (engine && state.model === id) { send("D", ""); return; }
    setBusy("loading " + id);
    const report = (r) => {
      const text = (r.text || "").replace(/\s+/g, " ");
      const m = /(\d+)MB/i.exec(text);
      progress((r.progress || 0) * 100, /Fetching|Loading model from cache/i.test(text) ? (m ? `Downloading ${m[1]} MB` : "Downloading") : "Loading onto the GPU");
    };
    if (!engine) engine = new webllm.MLCEngine({ initProgressCallback: report });
    else engine.setInitProgressCallback(report);
    await engine.reload(id);
    state.model = id;
    history = [];
    setBusy("");
    send("D", "");
  }

  async function chat(text) {
    if (!engine || !state.model) { sendText("E", "No model is loaded. Type models to pick one."); return; }
    history.push({ role: "user", content: text });
    if (history.length > 16) history = history.slice(-16);
    setBusy("thinking");
    const request = {
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
      stream: true,
      temperature: 0.7,
      max_tokens: 512,
    };
    if (/^Qwen3/i.test(state.model)) request.extra_body = { enable_thinking: false };
    let reply = "", pending = "", lastSend = 0, inThink = false;
    const flush = () => { if (pending) { sendText("T", pending); pending = ""; } lastSend = performance.now(); };
    const stream = await engine.chat.completions.create(request);
    for await (const chunk of stream) {
      let piece = (chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || "";
      // Hide any <think>...</think> reasoning some models emit.
      if (piece.includes("<think>")) { inThink = true; piece = piece.split("<think>")[0]; }
      if (inThink) {
        if (!piece.includes("</think>")) continue;
        inThink = false; piece = piece.split("</think>").pop();
      }
      reply += piece;
      pending += piece;
      if (performance.now() - lastSend > 60) flush();
    }
    flush();
    history.push({ role: "assistant", content: reply });
    setBusy("");
    send("X", "");
  }

  // ------------------------------------------------------------ public

  window.ConMonHost = {
    attach(emulator, textSink) {
      emu = emulator;
      emitText = textSink;
      mode = 0; frame = "";
      stopVideo(true);
      state.mp4 = false; state.llm = false;   // a fresh ConMon has nothing installed
      history = [];
      onState(state);
    },
    detach() { stopVideo(true); emu = null; },
    onByte,
    addUserVideo,
    checkGpu,
    onStateChange(fn) { onState = fn; fn(state); },
    get state() { return state; },
    // test hook: lets automated tests swap in a fake WebLLM module
    _setWebLLM(mod) { webllm = mod; },
  };
})();
