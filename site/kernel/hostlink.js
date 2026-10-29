// ConMon Lab - host link.
//
// ConMon talks to this page over its serial port (COM1). This file is the
// "host" side: it installs packages, decodes MP4 video into VGA text-mode
// frames, and runs language models (SmartestChild, Transformers.js, WebLLM or
// Ollama), then streams the results back into the OS.
//
//   ConMon -> host:  ESC ] "CM;" <type> ";" <payload> BEL
//   host -> ConMon:  STX <type> <len lo> <len hi> <payload bytes>
(() => {
  "use strict";

  const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.86";
  const TFJS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";
  const OLLAMA_URL = "http://localhost:11434";
  // Transformers.js models (ONNX, 4-bit): [Hugging Face id, label, approx. download MB]
  const TFJS_MODELS = [
    ["onnx-community/LFM2.5-350M-ONNX", "LFM2.5 350M (tiny, fast)", 260],
    ["HuggingFaceTB/SmolLM2-360M-Instruct", "SmolLM2 360M", 270],
    ["onnx-community/Qwen2.5-0.5B-Instruct", "Qwen2.5 0.5B", 400],
    ["onnx-community/Qwen3-0.6B-ONNX", "Qwen3 0.6B (best answers)", 570],
  ];
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
        case "llm.stop": stopGeneration(); break;
        case "llm.reset": history = []; for (const k in smartestMemory) delete smartestMemory[k]; break;
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
  //
  // Four engines, all behind the same ConMon commands (models / load):
  //   smartest  SmartestChild, a built-in rule-based chatbot (instant, any device)
  //   tfjs      Transformers.js: ONNX models in this tab, WebGPU or WebAssembly
  //   webllm    WebLLM: MLC models on WebGPU (fastest in the browser)
  //   ollama    Ollama: models running on the user's own PC (localhost:11434)
  // Model ids sent to ConMon are "<engine>:<model>".

  let webllm = null, engine = null, history = [];
  let tfjs = null, tfjsPipe = null, tfjsModel = "", tfjsStopper = null;
  let ollamaAbort = null, smartestStop = false;
  const smartestMemory = {};
  let adapterInfo = null;

  async function gpuAdapter() {
    if (!("gpu" in navigator) || !navigator.gpu) return null;
    try { return await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }); } catch (_) { return null; }
  }

  async function checkGpu() {
    const a = await gpuAdapter();
    state.gpu = a ? "available" : "not available";
    onState(state);
    return a;
  }

  function engineOf(id) {
    const i = String(id).indexOf(":");
    return i < 0 ? { name: "webllm", model: id } : { name: id.slice(0, i), model: id.slice(i + 1) };
  }

  function mbText(mb) { return mb >= 1000 ? (mb / 1000).toFixed(1) + " GB" : Math.round(mb) + " MB"; }

  async function ollamaTags(timeoutMs) {
    const res = await fetch(OLLAMA_URL + "/api/tags", { signal: AbortSignal.timeout(timeoutMs || 1500) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return (data.models || []).filter((m) => !/embed/i.test(m.name));
  }

  function ollamaHelp() {
    return [
      "Ollama: not reachable at localhost:11434. To use models on your PC:",
      "  1. Install Ollama from ollama.com and run: ollama pull llama3.2",
      `  2. Allow this page: set OLLAMA_ORIGINS=${location.origin}`,
      "     and restart Ollama. Then type models again.",
    ];
  }

  async function installLlm() {
    setBusy("installing llm");
    progress(10, "Starting SmartestChild");
    if (!window.SmartestChild) throw new Error("SmartestChild is missing from this page.");
    progress(40, "Looking for a WebGPU graphics card");
    const adapter = await checkGpu();
    adapterInfo = adapter ? adapter.info || {} : null;
    progress(70, "Looking for Ollama on this PC");
    let ollama = null;
    try { ollama = await ollamaTags(1200); } catch (_) { ollama = null; }
    progress(100, "Engines checked");
    const gpuName = adapter ? ([adapterInfo.vendor, adapterInfo.architecture].filter(Boolean).join(" ") || "WebGPU device") : "";
    const lines = [
      "Engines:",
      "  SmartestChild    built in, ready",
      "  Transformers.js  " + (adapter ? `in this tab on your GPU (${gpuName})` : "in this tab on the CPU (WebAssembly, slower)"),
      "  WebLLM           " + (adapter ? `in this tab on your GPU, half precision: ${adapter.features.has("shader-f16") ? "yes" : "no"}` : "needs WebGPU (Chrome or Edge), not available here"),
      "  Ollama           " + (ollama ? `found on this PC with ${ollama.length} model${ollama.length === 1 ? "" : "s"}` : "not running on this PC (optional)"),
    ];
    sendText("M", lines.join("\n"));
    state.llm = true;
    setBusy("");
    send("D", "llm");
  }

  async function webllmModels(adapter) {
    if (!webllm) webllm = await import(WEBLLM_URL);
    const f16 = adapter.features.has("shader-f16");
    const maxStorage = adapter.limits.maxStorageBufferBindingSize || 0;
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    const mem = navigator.deviceMemory || 8;
    const budgetMB = mobile ? 1500 : mem <= 4 ? 2600 : 4500;
    const byId = new Map(webllm.prebuiltAppConfig.model_list.map((m) => [m.model_id, m]));
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
        out.push({ id: "webllm:" + id, label, size: mbText(m.vram_required_MB || 0), status: cached ? "downloaded" : "" });
        break;
      }
    }
    return out;
  }

  async function tfjsCached(model) {
    try {
      const cache = await caches.open("transformers-cache");
      const keys = await cache.keys();
      return keys.some((r) => r.url.includes("/" + model + "/"));
    } catch (_) { return false; }
  }

  let lastModels = [];
  async function listModels() {
    setBusy("checking models");
    const adapter = await gpuAdapter();
    const groups = [];

    groups.push({ engine: "SmartestChild - built-in retro chatbot, instant", models: [
      { id: "smartest:child", label: "SmartestChild", size: "built in", status: "ready" },
    ] });

    const tf = [];
    for (const [model, label, mb] of TFJS_MODELS) {
      if (!adapter && mb > 450) continue;               // keep CPU-only devices to the small ones
      tf.push({ id: "tfjs:" + model, label, size: "~" + mbText(mb), status: (await tfjsCached(model)) ? "downloaded" : "" });
    }
    groups.push({ engine: "Transformers.js - in this tab, " + (adapter ? "on your GPU" : "on the CPU (slower)"), models: tf });

    if (adapter) {
      try {
        const w = await webllmModels(adapter);
        if (w.length) groups.push({ engine: "WebLLM - in this tab on your GPU, fastest", models: w });
      } catch (err) {
        sendText("M", "WebLLM: couldn't load its model list (" + (err.message || err) + ").");
      }
    } else {
      sendText("M", "WebLLM: needs WebGPU (Chrome or Edge on a computer), so it's hidden here.");
    }

    try {
      const tags = await ollamaTags(1500);
      if (tags.length) {
        groups.push({ engine: "Ollama - on your PC (localhost:11434)", models: tags.map((t) => ({
          id: "ollama:" + t.name,
          label: t.name.replace(/:latest$/, "") + (t.details && t.details.parameter_size ? " " + t.details.parameter_size : ""),
          size: mbText((t.size || 0) / 1e6),
          status: "on your PC",
        })) });
      } else {
        sendText("M", "Ollama: running, but no models yet. On your PC run: ollama pull llama3.2");
      }
    } catch (_) {
      sendText("M", ollamaHelp().join("\n"));
    }

    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lines = [];
    lastModels = [];
    for (const g of groups) {
      for (const m of g.models) {
        if (lines.length >= letters.length) break;
        lines.push(`${letters[lines.length]}|${m.id}|${m.size}|${m.label}|${m.status}|${g.engine}`);
        lastModels.push(m);
      }
    }
    setBusy("");
    sendText("L", lines.join("\n"));
  }

  function labelFor(id) {
    const m = lastModels.find((x) => x.id === id);
    return m ? m.label : engineOf(id).model;
  }

  async function loadModel(id) {
    const { name, model } = engineOf(id);
    if (state.model === id && (name !== "webllm" || engine) && (name !== "tfjs" || tfjsPipe)) { send("D", ""); return; }
    setBusy("loading " + labelFor(id));

    if (name === "smartest") {
      progress(100, "SmartestChild is built in");
    } else if (name === "ollama") {
      progress(30, "Asking Ollama on your PC");
      let tags;
      try { tags = await ollamaTags(2500); } catch (_) { throw new Error("Ollama isn't reachable at localhost:11434. Is it running, with OLLAMA_ORIGINS set?"); }
      if (!tags.some((t) => t.name === model)) throw new Error(`Ollama doesn't have ${model}. On your PC run: ollama pull ${model}`);
      progress(100, "Ollama is ready");
    } else if (name === "tfjs") {
      if (!tfjs) { progress(2, "Downloading Transformers.js"); tfjs = await import(TFJS_URL); }
      const adapter = await gpuAdapter();
      const device = adapter ? "webgpu" : "wasm";
      const dtype = adapter && adapter.features.has("shader-f16") ? "q4f16" : "q4";
      const files = {};
      const report = (p) => {
        if (p.status === "progress" && p.file) {
          files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
          const all = Object.values(files);
          const total = all.reduce((s, f) => s + f.total, 0), loaded = all.reduce((s, f) => s + f.loaded, 0);
          progress(total ? (loaded / total) * 95 : 5, `Downloading ${Math.round(total / 1e6)} MB`);
        } else if (p.status === "ready") progress(97, device === "webgpu" ? "Loading onto the GPU" : "Loading into memory");
      };
      if (tfjsPipe && tfjsPipe.dispose) { try { await tfjsPipe.dispose(); } catch (_) {} }
      tfjsPipe = null;
      tfjsPipe = await tfjs.pipeline("text-generation", model, { device, dtype, progress_callback: report });
      tfjsModel = model;
    } else if (name === "webllm") {
      if (!webllm) webllm = await import(WEBLLM_URL);
      const report = (r) => {
        const text = (r.text || "").replace(/\s+/g, " ");
        const m = /(\d+)MB/i.exec(text);
        progress((r.progress || 0) * 100, /Fetching|Loading model from cache/i.test(text) ? (m ? `Downloading ${m[1]} MB` : "Downloading") : "Loading onto the GPU");
      };
      if (!engine) engine = new webllm.MLCEngine({ initProgressCallback: report });
      else engine.setInitProgressCallback(report);
      await engine.reload(model);
    } else {
      throw new Error("Unknown engine " + name);
    }
    state.model = id;
    state.modelLabel = labelFor(id);
    history = [];
    setBusy("");
    send("D", "");
  }

  // Streams text to ConMon in small batches and hides <think>...</think>.
  function makeStreamer() {
    let pending = "", lastSend = 0, inThink = false, reply = "";
    const flush = () => { if (pending) { sendText("T", pending); pending = ""; } lastSend = performance.now(); };
    return {
      push(piece) {
        let s = piece, visible = "";
        while (s) {
          if (inThink) {
            const e = s.indexOf("</think>");
            if (e < 0) s = ""; else { s = s.slice(e + 8); inThink = false; }
          } else {
            const b = s.indexOf("<think>");
            if (b < 0) { visible += s; s = ""; } else { visible += s.slice(0, b); s = s.slice(b + 7); inThink = true; }
          }
        }
        if (!reply) visible = visible.replace(/^\s+/, "");
        if (!visible) return;
        reply += visible; pending += visible;
        if (performance.now() - lastSend > 60) flush();
      },
      done() { flush(); return reply; },
    };
  }

  function stopGeneration() {
    smartestStop = true;
    if (engine && engineOf(state.model || "").name === "webllm") engine.interruptGenerate();
    if (tfjsStopper) tfjsStopper.interrupt();
    if (ollamaAbort) ollamaAbort.abort();
  }

  async function chat(text) {
    if (!state.model) { sendText("E", "No model is loaded. Type models to pick one."); return; }
    const { name, model } = engineOf(state.model);
    history.push({ role: "user", content: text });
    if (history.length > 16) history = history.slice(-16);
    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history];
    setBusy("thinking");
    const out = makeStreamer();

    if (name === "smartest") {
      smartestStop = false;
      const answer = window.SmartestChild.reply(text, smartestMemory);
      await new Promise((r) => setTimeout(r, 250));               // "is typing..."
      for (let i = 0; i < answer.length && !smartestStop; i += 3) {
        out.push(answer.slice(i, i + 3));
        await new Promise((r) => setTimeout(r, 18));
      }
    } else if (name === "tfjs") {
      if (!tfjsPipe || tfjsModel !== model) throw new Error("The model isn't loaded. Type load to load it again.");
      tfjsStopper = tfjs.InterruptableStoppingCriteria ? new tfjs.InterruptableStoppingCriteria() : null;
      const streamer = new tfjs.TextStreamer(tfjsPipe.tokenizer, {
        skip_prompt: true, skip_special_tokens: true, callback_function: (t) => out.push(t),
      });
      // Qwen3 thinks out loud by default; /no_think asks it to answer directly.
      const msgs = /qwen3/i.test(model)
        ? messages.map((m, i) => (i === messages.length - 1 ? { ...m, content: m.content + " /no_think" } : m))
        : messages;
      const opts = { max_new_tokens: 384, do_sample: false, streamer };
      if (tfjsStopper) opts.stopping_criteria = tfjsStopper;
      await tfjsPipe(msgs, opts);
      tfjsStopper = null;
    } else if (name === "webllm") {
      const request = { messages, stream: true, temperature: 0.7, max_tokens: 512 };
      if (/^Qwen3/i.test(model)) request.extra_body = { enable_thinking: false };
      const stream = await engine.chat.completions.create(request);
      for await (const chunk of stream) {
        out.push((chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || "");
      }
    } else if (name === "ollama") {
      ollamaAbort = new AbortController();
      let res;
      try {
        res = await fetch(OLLAMA_URL + "/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, messages, stream: true, think: false }),
          signal: ollamaAbort.signal,
        });
      } catch (err) {
        ollamaAbort = null;
        if (err.name === "AbortError") { out.done(); history.pop(); setBusy(""); send("X", ""); return; }
        throw new Error("Lost contact with Ollama at localhost:11434.");
      }
      if (!res.ok) { ollamaAbort = null; throw new Error(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 100)}`); }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const msg = JSON.parse(line);
            if (msg.error) throw new Error("Ollama: " + msg.error);
            if (msg.message && msg.message.content) out.push(msg.message.content);
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") throw err;
      } finally {
        ollamaAbort = null;
      }
    }

    const reply = out.done();
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
      state.model = null; state.modelLabel = "";
      history = [];
      onState(state);
    },
    detach() { stopVideo(true); emu = null; },
    onByte,
    addUserVideo,
    checkGpu,
    onStateChange(fn) { onState = fn; fn(state); },
    get state() { return state; },
    // test hooks: let automated tests swap in fake engines
    _setWebLLM(mod) { webllm = mod; },
    _setTransformers(mod) { tfjs = mod; },
  };
})();
