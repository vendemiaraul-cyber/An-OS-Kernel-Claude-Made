// ConMon Lab - host link.
//
// ConMon talks to this page over its serial port (COM1). This file is the
// "host" side: it installs packages, runs language models (SmartestChild,
// Transformers.js, WebLLM or Ollama), looks up model info, and fetches weather
// from Open-Meteo with an animated ASCII map, then streams it all back into
// the OS.
//
//   ConMon -> host:  ESC ] "CM;" <type> ";" <payload> BEL
//   host -> ConMon:  STX <type> <len lo> <len hi> <payload bytes>
(() => {
  "use strict";

  const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.86";
  const TFJS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";
  const OLLAMA_URL = "http://localhost:11434";
  // Offline preview (preview/preview-data.js): no internet, so only
  // SmartestChild and a built-in city list with SAMPLE weather.
  const PREVIEW = window.CONMON_PREVIEW || null;
  // Transformers.js models (ONNX, 4-bit): [Hugging Face id, label, approx. download MB]
  const TFJS_MODELS = [
    ["onnx-community/LFM2.5-350M-ONNX", "LFM2.5 350M (tiny, fast)", 260],
    ["HuggingFaceTB/SmolLM2-360M-Instruct", "SmolLM2 360M", 270],
    ["onnx-community/Qwen2.5-0.5B-Instruct", "Qwen2.5 0.5B", 400],
    ["onnx-community/Qwen3-0.6B-ONNX", "Qwen3 0.6B (best answers)", 570],
  ];
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
  // Systems for `run v86`: small, permissively licensed images bundled with
  // the site (see /guests/SOURCES.txt), opened in a second emulator window.
  const GUESTS = [
    { id: "mikeos", label: "MikeOS 4.5", kind: "floppy", file: "/guests/mikeos.flp", size: "1.4 MB",
      about: "Small OS with apps, BASIC, games", hint: "Press Enter for the program menu, or Esc for the command line.",
      credit: "MikeOS Developers, BSD-3-Clause" },
    { id: "tetros", label: "Tetros", kind: "floppy", file: "/guests/tetros.img", size: "512 B",
      about: "Tetris in a 512-byte boot sector", hint: "Left and right move, Up rotates, Down drops.",
      credit: "daniel-e, MIT" },
    { id: "bootbasic", label: "bootBASIC", kind: "floppy", file: "/guests/bootbasic.img", size: "512 B",
      about: "BASIC interpreter in 512 bytes", hint: "Lowercase only. Try: 10 print 6*7 then run",
      credit: "Oscar Toledo G., BSD-2-Clause" },
    { id: "bootos", label: "bootOS", kind: "floppy", file: "/guests/bootos.img", size: "512 B",
      about: "A whole OS in one boot sector", hint: "Type format first (it sets up the disk), then dir.",
      credit: "Oscar Toledo G., BSD-2-Clause" },
    { id: "sectorlisp", label: "SectorLISP", kind: "floppy", file: "/guests/sectorlisp.img", size: "512 B",
      about: "LISP in a 512-byte boot sector", hint: "Use capitals. Try: (CONS (QUOTE X) (QUOTE Y))",
      credit: "Justine Tunney and Alain Greppin, ISC" },
    { id: "hello", label: "Hello boot sector", kind: "floppy", file: "/kernels/hello-floppy.img", size: "512 B",
      about: "ConMon Lab's own 512-byte demo", hint: "Type anything and it echoes back.",
      credit: "ConMon Lab" },
    { id: "conmon", label: "ConMon (again)", kind: "kernel", file: "/kernels/conmon.bin", size: "65 KB",
      about: "A second ConMon, inside ConMon", hint: "A complete second ConMon. Try help or guess.",
      credit: "ConMon Lab" },
  ];
  let guestOpener = null, guestOpen = null;

  const SYSTEM_PROMPT =
    "You are a helpful assistant running inside ConMon, a tiny hobby operating system " +
    "shown on an 80-column text screen. Answer in plain text without markdown, " +
    "tables or emoji. Keep answers short unless asked for detail.";
  let emu = null;
  let onState = () => {};
  const state = { meteo: false, llm: false, gpu: "unknown", model: null, modelLabel: "", busy: "" };

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
          if (arg === "solmeteo") await installMeteo();
          else if (arg === "llm") await installLlm();
          else sendText("E", `Unknown package ${arg}`);
          break;
        case "cancel": cancelled = true; break;
        case "llm.models": await listModels(); break;
        case "llm.download": case "llm.load": await loadModel(arg); break;
        case "llm.chat": await chat(arg); break;
        case "llm.stop": stopGeneration(); break;
        case "llm.reset": history = []; for (const k in smartestMemory) delete smartestMemory[k]; break;
        case "llm.info": await modelInfo(arg); break;
        case "meteo.show": await showMeteo(arg); break;
        case "v86.list": listGuests(); break;
        case "v86.open": await openGuest(arg); break;
        case "meteo.stop": meteoRun++; setBusy(""); break;
        default: break;
      }
    } catch (err) {
      console.error(err);
      sendText("E", (err && err.message ? err.message : String(err)).slice(0, 160));
      setBusy("");
    }
  }

  // ------------------------------------------------------------ downloads

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
    return new Blob(parts, { type: res.headers.get("content-type") || "application/octet-stream" });
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
    if (PREVIEW) {
      progress(100, "SmartestChild ready");
      sendText("M", "Engines:\n  SmartestChild    built in, ready\n" +
        "This preview has no internet, so Transformers.js, WebLLM and Ollama are\n" +
        "switched off here. All four work on your Netlify site.");
      state.llm = true;
      setBusy("");
      send("D", "llm");
      return;
    }
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
  // Builds the model list across engines. Setup hints go to notes.
  async function gatherModels(notes = []) {
    const adapter = await gpuAdapter();
    const groups = [];

    groups.push({ engine: "SmartestChild - built-in retro chatbot, instant", models: [
      { id: "smartest:child", label: "SmartestChild", size: "built in", status: "ready" },
    ] });
    if (PREVIEW) {
      notes.push("Preview: only SmartestChild runs here. The other engines need internet.");
      return finishList(groups);
    }

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
        notes.push("WebLLM: couldn't load its model list (" + (err.message || err) + ").");
      }
    } else {
      notes.push("WebLLM: needs WebGPU (Chrome or Edge on a computer), so it's hidden here.");
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
        notes.push("Ollama: running, but no models yet. On your PC run: ollama pull llama3.2");
      }
    } catch (_) {
      notes.push(...ollamaHelp());
    }

    return finishList(groups);
  }

  function finishList(groups) {
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
    return lines;
  }

  async function listModels() {
    setBusy("checking models");
    const notes = [];
    const lines = await gatherModels(notes);
    for (const n of notes) sendText("M", n);
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

  // ---------------------------------------------------------- mp finder
  //
  // `mp finder` in ConMon: an overview of every model, or one model's card.
  // Curated facts are merged with live data from Hugging Face (downloads,
  // likes, licence, last update) or from Ollama's /api/show on the user's PC.

  const CATALOG = [
    { re: /^smartest:/, maker: "ConMon Lab", params: "rules", context: "remembers your name",
      good: "jokes, quick math, the time and ConMon facts",
      about: "A retro rule-based chatbot. No neural network: it matches patterns, like the messenger bots of the early 2000s." },
    { re: /LFM2/i, maker: "Liquid AI", good: "fast, short answers on small devices",
      about: "A compact model family designed to run well on phones and laptops." },
    { re: /SmolLM2/i, maker: "Hugging Face", context: "8K tokens", license: "apache-2.0",
      good: "small talk, simple questions, rewriting text",
      about: "A family of small open models trained by Hugging Face to run on-device." },
    { re: /Qwen3/i, maker: "Alibaba (Qwen team)", context: "32K tokens", license: "apache-2.0",
      good: "step-by-step reasoning, many languages, some coding",
      about: "Can 'think' before answering; ConMon switches that off so replies come faster." },
    { re: /Qwen2\.5/i, maker: "Alibaba (Qwen team)", context: "32K tokens", license: "apache-2.0",
      good: "general questions, many languages, a little coding",
      about: "A widely used open model family that is strong for its size." },
    { re: /gemma/i, maker: "Google", context: "32K tokens", license: "Gemma terms of use",
      good: "general chat and summaries",
      about: "Google's open-weights family, built from the same research as Gemini." },
    { re: /llama-?3\.2/i, maker: "Meta", context: "128K tokens", license: "Llama 3.2 Community License",
      good: "general chat, summaries, following instructions",
      about: "Meta's small Llama models, tuned to follow instructions." },
    { re: /TinyLlama/i, maker: "TinyLlama project", context: "2K tokens", license: "apache-2.0",
      good: "quick experiments; answers can be shaky",
      about: "A 1.1B model trained on a huge amount of text for its size." },
    { re: /Phi-3\.5/i, maker: "Microsoft", context: "128K tokens", license: "mit",
      good: "reasoning, math and code for its size",
      about: "Microsoft's small model trained mostly on carefully filtered and synthetic data." },
  ];

  const ENGINE_NAME = { smartest: "built in", tfjs: "Transformers.js", webllm: "WebLLM", ollama: "Ollama" };

  function catalogFor(m) {
    const key = m.id + " " + m.label;
    return CATALOG.find((c) => c.re.test(key)) || {};
  }

  function paramsOf(m) {
    const c = catalogFor(m);
    if (c.params) return c.params;
    const x = /(\d+(?:\.\d+)?)\s*([BM])\b/i.exec(m.label) || /(\d+(?:\.\d+)?)([BM])/i.exec(m.id);
    if (!x) return "?";
    const v = parseFloat(x[1]);
    return x[2].toUpperCase() === "M" ? (v / 1000).toFixed(2).replace(/0$/, "") + "B" : v + "B";
  }

  function fit(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "." : s.padEnd(n); }

  function wrapText(text, width) {
    const out = [];
    let line = "";
    for (const w of String(text).split(/\s+/)) {
      if (line && (line + " " + w).length > width) { out.push(line); line = w; }
      else line = line ? line + " " + w : w;
    }
    if (line) out.push(line);
    return out;
  }

  async function hfInfo(repo) {
    const res = await fetch("https://huggingface.co/api/models/" + repo, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    const lic = (j.tags || []).find((t) => t.startsWith("license:"));
    return {
      license: lic ? lic.slice(8) : (j.cardData && j.cardData.license) || "",
      downloads: j.downloads, likes: j.likes,
      updated: (j.lastModified || "").slice(0, 10),
    };
  }

  async function ollamaShow(name) {
    const res = await fetch(OLLAMA_URL + "/api/show", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: name }), signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function modelInfo(target) {
    if (!lastModels.length) await gatherModels();
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lines = [];

    if (!target) {
      setBusy("finding model info");
      lines.push("  #  Model                        Maker                Size    Engine");
      lastModels.forEach((m, i) => {
        const { name } = engineOf(m.id);
        lines.push(`  ${letters[i]}  ${fit(m.label, 28)} ${fit(catalogFor(m).maker || (name === "ollama" ? "(see details)" : "?"), 20)} ${fit(paramsOf(m), 7)} ${ENGINE_NAME[name] || name}`);
      });
      lines.push("");
      lines.push("Type mp finder <letter> for one model's details, with live stats.");
      for (const l of lines) sendText("M", l);
      setBusy("");
      send("D", "");
      return;
    }

    const idx = lastModels.findIndex((m) => m.id === target);
    if (idx < 0) throw new Error("That model isn't in the list any more. Type models to refresh it.");
    const m = lastModels[idx];
    const { name, model } = engineOf(m.id);
    const c = catalogFor(m);
    setBusy("finding info on " + m.label);
    const adapter = await gpuAdapter();

    let live = null, liveNote = "", source = "", contextNote = "", runs = "", license = c.license || "";
    let maker = c.maker || "", params = paramsOf(m);
    if (name === "tfjs" || name === "webllm") {
      const repo = name === "tfjs" ? model : "mlc-ai/" + model;
      source = "huggingface.co/" + repo;
      try { live = await hfInfo(repo); } catch (_) { liveNote = "(live stats unavailable: no connection to Hugging Face)"; }
      if (live && live.license) license = live.license;
      runs = name === "tfjs"
        ? "in this browser tab, " + (adapter ? "on your GPU (WebGPU)" : "on the CPU (WebAssembly)")
        : "in this browser tab, on your GPU (WebGPU)";
      if (name === "webllm" && webllm) {
        const rec = webllm.prebuiltAppConfig.model_list.find((x) => x.model_id === model);
        const ctx = rec && rec.overrides && rec.overrides.context_window_size;
        if (ctx) contextNote = `${Math.round(ctx / 1024)}K tokens in this WebLLM build`;
      }
    } else if (name === "ollama") {
      runs = "on your PC, served by Ollama at localhost:11434";
      try {
        const s = await ollamaShow(model);
        const d = s.details || {};
        if (d.parameter_size) params = d.parameter_size;
        if (!maker && d.family) maker = d.family + " family";
        if (d.quantization_level) runs += ` (${d.quantization_level})`;
        const mi = s.model_info || {};
        const arch = mi["general.architecture"];
        const ctx = arch && mi[arch + ".context_length"];
        if (ctx) contextNote = `${Math.round(ctx / 1024)}K tokens`;
        if (s.license) license = String(s.license).split("\n").find((l) => l.trim()) || license;
        live = { fromOllama: true };
      } catch (_) { liveNote = "(Ollama didn't answer, so these details are partial)"; }
      source = "ollama.com/library/" + model.split(":")[0];
    } else {
      runs = "inside this page; nothing to download";
    }

    const status = m.status === "downloaded" ? "already downloaded" : m.status === "ready" ? "ready" : m.status === "on your PC" ? "installed on your PC" : "not downloaded yet";
    const row = (k, v) => ` ${k.padEnd(12)} ${v}`;
    const head = ` ${m.label}`;
    const tag = `${letters[idx]} - ${ENGINE_NAME[name] || name} `;
    lines.push(head + " ".repeat(Math.max(1, 79 - head.length - tag.length)) + tag);
    lines.push(" " + "-".repeat(77));
    if (maker) lines.push(row("Maker", maker));
    lines.push(row("Size", `${params} parameters, ${m.size} (${status})`));
    lines.push(row("Runs", runs));
    if (contextNote || c.context) lines.push(row("Context", contextNote || c.context));
    if (license) lines.push(row("Licence", fit(license, 64)));
    if (live && !live.fromOllama) {
      lines.push(row("Popularity", `${(live.downloads || 0).toLocaleString("en-US")} downloads last month, ${(live.likes || 0).toLocaleString("en-US")} likes  (live)`));
      if (live.updated) lines.push(row("Updated", live.updated + "  (live)"));
    }
    if (c.good) lines.push(row("Good at", c.good));
    if (c.about) wrapText(c.about, 64).forEach((l, i) => lines.push(row(i ? "" : "About", l)));
    if (source) lines.push(row("Source", source));
    if (liveNote) lines.push(" " + liveNote);
    for (const l of lines) sendText("M", l);
    setBusy("");
    send("D", "");
  }

  // ----------------------------------------------------------- solMeteo
  //
  // `meteo <place>` in ConMon: geocode the place with Open-Meteo, fetch the
  // forecast, and stream a full-screen animation: an ASCII world map (from
  // GeoJSON country outlines) zooming in on the place, then the weather.
  // Frames go to ConMon as 'A' packets: <rows> byte, rows*80 chars, rows*80 attrs.

  const GEOJSON_URL = "/meteo/countries.geo.json";
  const GEO_API = "https://geocoding-api.open-meteo.com/v1/search";
  const WX_API = "https://api.open-meteo.com/v1/forecast";
  const ROWS = 22, MAP_TOP = 1, MAP_ROWS = 13, PANEL = MAP_TOP + MAP_ROWS;
  let world = null;                       // [{ name, polys: [{ bbox, rings }] }]
  let meteoRun = 0;                       // bumps to cancel a running animation

  const WMO = {
    0: ["Clear sky", "sun"], 1: ["Mainly clear", "sun"], 2: ["Partly cloudy", "partly"], 3: ["Overcast", "cloud"],
    45: ["Fog", "fog"], 48: ["Freezing fog", "fog"],
    51: ["Light drizzle", "rain"], 53: ["Drizzle", "rain"], 55: ["Heavy drizzle", "rain"],
    56: ["Freezing drizzle", "rain"], 57: ["Freezing drizzle", "rain"],
    61: ["Light rain", "rain"], 63: ["Rain", "rain"], 65: ["Heavy rain", "rain"],
    66: ["Freezing rain", "rain"], 67: ["Freezing rain", "rain"],
    71: ["Light snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"], 77: ["Snow grains", "snow"],
    80: ["Rain showers", "rain"], 81: ["Rain showers", "rain"], 82: ["Violent showers", "rain"],
    85: ["Snow showers", "snow"], 86: ["Heavy snow showers", "snow"],
    95: ["Thunderstorm", "storm"], 96: ["Thunderstorm, hail", "storm"], 99: ["Thunderstorm, hail", "storm"],
  };
  const ICONS = {
    sun:    [14, ["  \\ | /  ", "  - O -  ", "  / | \\  "]],
    moon:   [7,  ["   .-.   ", "  (   )  ", "   `-'   "]],
    partly: [14, [" \\ /     ", "-O .--.  ", " (      )"]],
    cloud:  [7,  ["   .--.  ", " (      )", "  `----' "]],
    rain:   [9,  ["   .--.  ", " (      )", "  ' ' '  "]],
    snow:   [15, ["   .--.  ", " (      )", "  * * *  "]],
    storm:  [14, ["   .--.  ", " (      )", "   /_/_  "]],
    fog:    [8,  [" _ - _ - ", "  _ - _  ", " _ - _ - "]],
  };
  const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  async function loadWorld(onProgress) {
    if (world) return world;
    const blob = await fetchWithProgress(GEOJSON_URL, onProgress || (() => {}));
    const geo = JSON.parse(await blob.text());
    world = geo.features.map((f) => {
      const g = f.geometry || {};
      const polys = (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []).map((rings) => {
        let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
        for (const [x, y] of rings[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        return { bbox: [x0, y0, x1, y1], rings };
      });
      return { name: (f.properties && f.properties.name) || f.id || "", polys };
    });
    return world;
  }

  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Index of the country under (lon, lat), or -1 for sea.
  function countryAt(lon, lat) {
    for (let c = 0; c < world.length; c++) {
      for (const p of world[c].polys) {
        const b = p.bbox;
        if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
        if (!inRing(lon, lat, p.rings[0])) continue;
        let hole = false;
        for (let h = 1; h < p.rings.length; h++) if (inRing(lon, lat, p.rings[h])) { hole = true; break; }
        if (!hole) return c;
      }
    }
    return -1;
  }

  // CP437 screen buffer helpers.
  function newScreen() { return { ch: new Uint8Array(ROWS * 80).fill(32), at: new Uint8Array(ROWS * 80).fill(0x07) }; }
  function cp437(c) {
    if (c === "°") return 0xF8;
    if (c === "·") return 0xFA;
    const code = c.charCodeAt(0);
    return code >= 32 && code < 127 ? code : 63;
  }
  function put(scr, row, col, text, attr) {
    text = String(text).normalize("NFKD").replace(/[̀-ͯ]/g, "");
    for (let i = 0; i < text.length; i++) {
      const x = col + i;
      if (x < 0 || x >= 80 || row < 0 || row >= ROWS) continue;
      scr.ch[row * 80 + x] = cp437(text[i]);
      if (attr != null) scr.at[row * 80 + x] = attr;
    }
  }
  function fill(scr, row, attr, ch) {
    for (let x = 0; x < 80; x++) { scr.ch[row * 80 + x] = ch || 32; scr.at[row * 80 + x] = attr; }
  }
  function sendScreen(scr) {
    const out = new Uint8Array(1 + ROWS * 160);
    out[0] = ROWS;
    out.set(scr.ch, 1);
    out.set(scr.at, 1 + ROWS * 80);
    send("A", out);
  }

  const wrapLon = (l) => ((((l + 180) % 360) + 360) % 360) - 180;

  // Draws the map rows for a view centred on (lon0, lat0) with `s` degrees
  // of longitude per column. Cells are about twice as tall as wide.
  function drawMap(scr, lon0, lat0, s, t, target, place, markerOn) {
    const rowDeg = 2 * s * Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
    for (let r = 0; r < MAP_ROWS; r++) {
      const lat = lat0 - (r - (MAP_ROWS - 1) / 2) * rowDeg;
      for (let c = 0; c < 80; c++) {
        const lon = wrapLon(lon0 + (c - 39.5) * s);
        const i = (MAP_TOP + r) * 80 + c;
        const k = lat > 85 || lat < -85 ? -1 : countryAt(lon, lat);
        if (k < 0) {
          const wave = (c * 7 + r * 13 + t) % 11 === 0;
          scr.ch[i] = wave ? 0x7E : 32;              // ~
          scr.at[i] = 0x01;                          // blue on black
        } else if (k === target) {
          scr.ch[i] = 0xB2; scr.at[i] = 0x0A;        // dark shade, light green
        } else {
          scr.ch[i] = 0xB1; scr.at[i] = 0x02;        // medium shade, green
        }
      }
    }
    if (!place) return;
    // Marker and label at the place.
    let dl = wrapLon(place.lon - lon0);
    const mc = Math.round(39.5 + dl / s);
    const mr = Math.round((MAP_ROWS - 1) / 2 + (lat0 - place.lat) / rowDeg);
    if (mc < 0 || mc > 79 || mr < 0 || mr >= MAP_ROWS) return;
    const row = MAP_TOP + mr;
    put(scr, row, mc, "@", markerOn ? 0x4E : 0x0C);  // yellow on red / light red
    const label = " " + place.name + " ";
    if (mc + 2 + label.length <= 80) put(scr, row, mc + 2, label, 0x70);
    else put(scr, row, mc - 1 - label.length, label, 0x70);
  }

  function header(scr, text) {
    fill(scr, 0, 0x1F);
    put(scr, 0, 1, "solMeteo", 0x1E);
    put(scr, 0, 11, text, 0x1F);
    if (PREVIEW) put(scr, 0, 63, "SAMPLE WEATHER", 0x1E);
    else put(scr, 0, 68, "Open-Meteo", 0x1B);
  }

  function fmtLat(v) { return Math.abs(v).toFixed(2) + "°" + (v >= 0 ? "N" : "S"); }
  function fmtLon(v) { return Math.abs(v).toFixed(2) + "°" + (v >= 0 ? "E" : "W"); }
  function placeTitle(p) { return [p.name, p.admin1 && p.admin1 !== p.name ? p.admin1 : "", p.country].filter(Boolean).join(", "); }

  function drawPanel(scr, place, wx, t) {
    for (let r = PANEL; r < ROWS; r++) fill(scr, r, 0x07);
    // Divider with the place details.
    for (let x = 0; x < 80; x++) { scr.ch[PANEL * 80 + x] = 0xC4; scr.at[PANEL * 80 + x] = 0x08; }
    const info = ` ${placeTitle(place)} · ${fmtLat(place.lat)} ${fmtLon(place.lon)}${place.elevation != null ? " · " + Math.round(place.elevation) + " m" : ""} `;
    put(scr, PANEL, 2, info.slice(0, 76), 0x0E);

    if (!wx) {
      const spin = "|/-\\"[t % 4];
      put(scr, PANEL + 2, 4, `${spin} Fetching the forecast from Open-Meteo...`, 0x0B);
      return;
    }
    const cur = wx.current, d = wx.daily;
    const [desc, iconKey0] = WMO[cur.weather_code] || ["Unknown", "cloud"];
    const iconKey = iconKey0 === "sun" && cur.is_day === 0 ? "moon" : iconKey0;
    const [iconColor, icon] = ICONS[iconKey];
    icon.forEach((l, i) => put(scr, PANEL + 1 + i, 1, l, iconColor));

    const temp = `${Math.round(cur.temperature_2m * 10) / 10}°C`;
    put(scr, PANEL + 1, 12, temp, 0x0F);
    put(scr, PANEL + 1, 12 + temp.length + 2, desc, 0x0E);
    const localTime = String(cur.time || "").slice(11, 16);   // place's local clock
    put(scr, PANEL + 1, 50, `Local time ${localTime}`, 0x07);
    const wind = `${Math.round(cur.wind_speed_10m)} km/h ${COMPASS[Math.round(((cur.wind_direction_10m || 0) % 360) / 45) % 8]}`;
    put(scr, PANEL + 2, 12, `Feels like ${Math.round(cur.apparent_temperature)}°C   Humidity ${cur.relative_humidity_2m}%   Wind ${wind}`, 0x07);
    put(scr, PANEL + 3, 12, `Precipitation ${cur.precipitation} mm   ${wx.timezone || ""}`, 0x07);

    for (let i = 0; i < 3 && d && i < d.time.length; i++) {
      const row = PANEL + 4 + i;
      const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(d.time[i] + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
      const [ddesc] = WMO[d.weather_code[i]] || ["?"];
      const hi = Math.round(d.temperature_2m_max[i]), lo = Math.round(d.temperature_2m_min[i]);
      put(scr, row, 2, label.padEnd(10), 0x0F);
      put(scr, row, 13, `${hi}°/${lo}°`.padEnd(10), 0x0B);
      put(scr, row, 24, ddesc.padEnd(22), 0x07);
      const pp = d.precipitation_probability_max && d.precipitation_probability_max[i];
      if (pp != null) put(scr, row, 47, `rain chance ${pp}%`, pp >= 50 ? 0x09 : 0x08);
    }
    if (wx.sample) put(scr, ROWS - 1, 2, "SAMPLE weather: no internet in this preview. Live data on your site.", 0x0E);
    else put(scr, ROWS - 1, 2, "Weather data: Open-Meteo.com (CC BY 4.0) · Places: GeoNames", 0x08);
  }

  async function geocode(name) {
    if (PREVIEW) return PREVIEW.geocode(name);
    const url = `${GEO_API}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
    let res;
    try { res = await fetch(url, { signal: AbortSignal.timeout(10000) }); } catch (_) {
      throw new Error("Couldn't reach Open-Meteo. Check your internet connection.");
    }
    if (!res.ok) throw new Error(`Open-Meteo place search answered ${res.status}.`);
    const j = await res.json();
    const r = j.results && j.results[0];
    if (!r) throw new Error(`No place called "${name}". Try a city name, like Rome or Tokyo.`);
    return { name: r.name, admin1: r.admin1, country: r.country, lat: r.latitude, lon: r.longitude, elevation: r.elevation, timezone: r.timezone };
  }

  async function forecast(p) {
    if (PREVIEW) return PREVIEW.forecast(p);
    const q = new URLSearchParams({
      latitude: p.lat, longitude: p.lon, timezone: "auto", forecast_days: "3",
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    });
    const res = await fetch(`${WX_API}?${q}`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`Open-Meteo forecast answered ${res.status}.`);
    return res.json();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  async function showMeteo(text) {
    const run = ++meteoRun;
    const query = String(text).trim();
    if (query.length < 2) throw new Error("Type at least two letters of a place name.");
    setBusy("solMeteo: " + query);
    await loadWorld();
    const place = await geocode(query);
    const target = countryAt(place.lon, place.lat);
    let wx = null, wxErr = null;
    const wxPromise = forecast(place).then((v) => { wx = v; }, (e) => { wxErr = e; });

    // Fly from a world view to the place: zoom in on a log scale.
    const FRAMES = 16;
    const s0 = 4.5, s1 = 0.6;          // degrees of longitude per column: world -> region
    const lonStart = 0, latStart = 20;
    const dLon = wrapLon(place.lon - lonStart);
    const latEnd = Math.max(-60, Math.min(70, place.lat));
    const title = `${placeTitle(place)}`.slice(0, 55);
    for (let f = 0; f <= FRAMES; f++) {
      if (run !== meteoRun) return;
      const k = ease(f / FRAMES);
      const s = Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * k);
      const scr = newScreen();
      header(scr, f < FRAMES ? `Flying to ${title}...` : title);
      drawMap(scr, wrapLon(lonStart + dLon * k), latStart + (latEnd - latStart) * k, s, f, target, f > FRAMES * 0.6 ? place : null, true);
      drawPanel(scr, place, null, f);
      sendScreen(scr);
      await sleep(110);
    }
    // Pulse the marker until the forecast has arrived (and a little after).
    let t = FRAMES, pulses = 0;
    for (;;) {
      if (run !== meteoRun) return;
      const done = wx || wxErr;
      const scr = newScreen();
      header(scr, title);
      drawMap(scr, wrapLon(lonStart + dLon), latEnd, s1, t, target, place, t % 2 === 0);
      if (wxErr) throw new Error(wxErr.message || "The forecast didn't arrive.");
      drawPanel(scr, place, wx, t);
      sendScreen(scr);
      if (done && ++pulses >= 4) break;
      if (t - FRAMES > 120) throw new Error("The forecast is taking too long. Try again.");
      t++;
      await sleep(260);
    }
    await wxPromise;
    // Final frame: marker steady.
    const scr = newScreen();
    header(scr, title);
    drawMap(scr, wrapLon(lonStart + dLon), latEnd, s1, t, target, place, true);
    drawPanel(scr, place, wx, t);
    sendScreen(scr);
    setBusy("");
    send("D", "");
  }

  async function installMeteo() {
    cancelled = false;
    setBusy("installing solMeteo");
    progress(0, "Downloading the world map (GeoJSON)");
    await loadWorld((f) => progress(f * 90, "Downloading the world map (GeoJSON)"));
    progress(100, `Map ready: ${world.length} countries`);
    state.meteo = true;
    setBusy("");
    send("D", "solmeteo");
  }

  // ------------------------------------------------------------ run v86

  function listGuests() {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    sendText("L", GUESTS.map((g, i) => `${letters[i]}|${g.id}|${g.label}|${g.kind}|${g.size}|${g.about.slice(0, 36)}`).join("\n"));
  }

  async function openGuest(id) {
    const g = GUESTS.find((x) => x.id === id);
    if (!g) throw new Error("That system isn't in the list.");
    if (!guestOpener) throw new Error("This page can't open windows.");
    const replaced = guestOpen && guestOpen.id !== g.id ? guestOpen.label : "";
    await guestOpener(g);
    guestOpen = g;
    if (replaced) sendText("M", `Closed ${replaced} to make room.`);
    sendText("M", `Opened ${g.label} in a window. ConMon keeps running here.`);
    sendText("M", `Tip: ${g.hint}`);
    sendText("M", `(${g.credit})`);
    send("D", "");
  }

  // Called by the page when the user closes the window.
  function guestClosed() {
    if (!guestOpen) return;
    const label = guestOpen.label;
    guestOpen = null;
    sendText("M", `${label} window closed.`);
  }

  // ------------------------------------------------------------ public

  window.ConMonHost = {
    attach(emulator, textSink) {
      emu = emulator;
      emitText = textSink;
      mode = 0; frame = "";
      meteoRun++;
      state.meteo = false; state.llm = false;   // a fresh ConMon has nothing installed
      state.model = null; state.modelLabel = "";
      history = [];
      onState(state);
    },
    detach() { meteoRun++; emu = null; },
    onByte,
    checkGpu,
    onStateChange(fn) { onState = fn; fn(state); },
    get state() { return state; },
    onGuestOpen(fn) { guestOpener = fn; },
    guestClosed,
    // test hooks: let automated tests swap in fake engines
    _setWebLLM(mod) { webllm = mod; },
    _setTransformers(mod) { tfjs = mod; },
  };
})();
