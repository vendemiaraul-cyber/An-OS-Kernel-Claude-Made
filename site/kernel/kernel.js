// ConMon Lab - Kernel Lab: boots kernels in the v86 x86 emulator.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ui = {
    status: $("status"), statusText: $("status-text"), name: $("current-name"),
    screen: $("screen"), fit: $("screen-fit"), overlay: $("overlay"),
    overlayText: $("overlay-text"), progress: $("progress"),
    pause: $("btn-pause"), restart: $("btn-restart"), cad: $("btn-cad"), full: $("btn-full"),
    boot: $("btn-boot"), bootOverlay: $("btn-boot-overlay"), samples: $("samples"),
    file: $("file"), drop: $("drop"), fileInfo: $("file-info"), url: $("url"),
    kind: $("kind"), ram: $("ram"),
    typebar: $("typebar"), typeInput: $("type-input"), chips: $("chips"),
    pkgPanel: $("pkg-panel"), pkgMeteo: $("pkg-meteo"), pkgLlm: $("pkg-llm"), pkgGpu: $("pkg-gpu"),
    pkgModel: $("pkg-model"), pkgBusy: $("pkg-busy"),
    serial: $("serial"), serialClear: $("btn-serial-clear"),
    gamePad: $("game-pad"), keys: $("keys"), zoom: $("btn-zoom"), monitor: $("monitor"), taskbar: $("taskbar"), hint: $("screen-hint"),
  };

  // Bundled systems. All permissively licensed; see /guests/SOURCES.txt.
  const SAMPLES = {
    conmon: { name: "conmon.bin", url: "/kernels/conmon.bin", label: "ConMon" },
    desktop: { name: "linux-desktop.bzimage", url: "/guests/linux-desktop.bzimage", label: "Linux Desktop",
      hint: "Linux Desktop (Nano-X): tap or click a program in the menu at the top right. Drag windows by their title bar; x closes them. DOOM is in the menu too." },
    linux: { name: "linux.bzimage", url: "/guests/linux.bzimage", label: "Linux 6.6",
      hint: "Linux 6.6 with BusyBox: a real shell. Try ls /, uname -a, top (q quits), vi notes.txt, or doom to open DOOM in a window." },
    mikeos: { name: "mikeos.flp", url: "/guests/mikeos.flp", label: "MikeOS 4.5",
      hint: "MikeOS: press Enter for the program menu, then Enter again to run DOOM.BAS (it is at the top). For the command line, press → then Enter at the welcome box." },
    tetros: { name: "tetros.img", url: "/guests/tetros.img", label: "Tetros",
      hint: "Tetros: Left and Right move, Up rotates, Down drops. Tap the screen first on a phone, then use the arrow keys below." },
    bootbasic: { name: "bootbasic.img", url: "/guests/bootbasic.img", label: "bootBASIC",
      hint: "bootBASIC: lowercase only. Try 10 print 6*7, then run." },
    bootos: { name: "bootos.img", url: "/guests/bootos.img", label: "bootOS",
      hint: "bootOS: type format first (it sets up the disk), then dir." },
    sectorlisp: { name: "sectorlisp.img", url: "/guests/sectorlisp.img", label: "SectorLISP",
      hint: "SectorLISP: use capitals. Try (CONS (QUOTE X) (QUOTE Y))" },
    hello: { name: "hello-floppy.img", url: "/kernels/hello-floppy.img", label: "Hello boot sector",
      hint: "Hello boot sector: type anything and it echoes back." },
  };
  let sample = "conmon";                 // bundled kernel used when no file/URL is chosen
  const FLOPPY_MAX = 2949120;            // 2.88 MB
  const KIND_LABEL = { bzimage: "Linux bzImage", multiboot: "Multiboot kernel", fda: "floppy", cdrom: "CD-ROM", hda: "hard disk" };

  // Emulator files. The offline preview packs them into images.js instead.
  const packed = (name) => window.CONMON_IMAGES && window.CONMON_IMAGES.has(name);
  function emuFiles() {
    return {
      wasm_path: "/v86/v86.wasm",
      bios: packed("seabios.bin") ? { buffer: window.CONMON_IMAGES.get("seabios.bin") } : { url: "/v86/seabios.bin" },
      vga_bios: packed("vgabios.bin") ? { buffer: window.CONMON_IMAGES.get("vgabios.bin") } : { url: "/v86/vgabios.bin" },
    };
  }
  async function loadImage(url) {
    const name = url.split("/").pop();
    if (packed(name)) return window.CONMON_IMAGES.get(name);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status}).`);
    return res.arrayBuffer();
  }

  let emulator = null;
  let selected = null;                   // { name, buffer } chosen by the user
  let booting = false;

  // ---------------------------------------------------------------- status

  function setStatus(text, tone) {
    ui.statusText.textContent = text;
    ui.status.className = "badge" + (tone ? " " + tone : "");
  }

  function setRunningControls(on) {
    for (const b of [ui.pause, ui.restart, ui.cad, ui.full]) b.disabled = !on;
    ui.pause.textContent = "Pause";
  }

  function showOverlay(text, withButton) {
    ui.overlay.classList.remove("hidden");
    ui.overlayText.textContent = text;
    ui.bootOverlay.classList.toggle("hidden", !withButton);
  }

  function setProgress(fraction) {
    if (fraction == null) { ui.progress.classList.add("hidden"); return; }
    ui.progress.classList.remove("hidden");
    ui.progress.firstElementChild.style.width = Math.round(fraction * 100) + "%";
  }

  // --------------------------------------------------------- image detection

  function hasMultibootHeader(buf) {
    const n = Math.min(buf.byteLength, 8192) & ~3;
    const v = new DataView(buf, 0, n);
    for (let i = 0; i + 12 <= n; i += 4) {
      const magic = v.getUint32(i, true);
      if (magic === 0x1BADB002) {
        const flags = v.getUint32(i + 4, true), sum = v.getUint32(i + 8, true);
        if (((magic + flags + sum) >>> 0) === 0) return 1;
      }
      if (magic === 0xE85250D6) return 2;            // Multiboot2
    }
    return 0;
  }

  function isIso(buf) {
    if (buf.byteLength < 0x8006) return false;
    const b = new Uint8Array(buf, 0x8001, 5);
    return String.fromCharCode(...b) === "CD001";
  }

  // A Linux kernel: "HdrS" (the x86 boot protocol header) at 0x202.
  function isBzImage(buf) {
    if (buf.byteLength < 0x206) return false;
    const u = new Uint8Array(buf, 0x202, 4);
    return u[0] === 0x48 && u[1] === 0x64 && u[2] === 0x72 && u[3] === 0x53;
  }

  function detectKind(name, buf, size = buf.byteLength) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (isIso(buf) || ext === "iso") return "cdrom";
    const mb = hasMultibootHeader(buf);
    if (mb === 1) return "multiboot";
    if (mb === 2) throw new Error("This is a Multiboot2 kernel. v86 only boots Multiboot v1 kernels directly; wrap it in a GRUB ISO instead.");
    if (isBzImage(buf)) return "bzimage";
    if (size <= FLOPPY_MAX) return "fda";
    return "hda";
  }

  function formatSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  // --------------------------------------------------------------- screen

  function resetScreen() {
    ui.screen.innerHTML = "";
    const text = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.style.display = "none";
    ui.screen.append(text, canvas);
    ui.screen.style.transform = "";
    ui.fit.style.height = "";
  }

  // Scale whatever v86 draws (80x25 text or a graphics canvas) to fit the box.
  function fitScreen() {
    const visible = [...ui.screen.children].find((el) => el.style.display !== "none" && el.offsetWidth > 0);
    if (!visible) return;
    const w = visible.offsetWidth, h = visible.offsetHeight;
    if (!w || !h) return;
    const avail = ui.fit.clientWidth;
    // Zoomed: never smaller than a readable size; the box scrolls sideways.
    const scale = zoomed ? Math.max(Math.min(avail / w, 2), 0.95) : Math.min(avail / w, 2);
    ui.screen.style.transform = `scale(${scale})`;
    ui.fit.scrollTop = 0;
    if (!zoomed) ui.fit.scrollLeft = 0;
    ui.screen.style.width = w + "px";
    ui.fit.style.setProperty("--content-w", Math.ceil(w * scale) + "px");
    ui.fit.style.height = Math.ceil(h * scale) + "px";
  }
  let zoomed = false;
  ui.zoom.addEventListener("click", () => {
    zoomed = !zoomed;
    ui.fit.classList.toggle("zoomed", zoomed);
    ui.zoom.setAttribute("aria-pressed", String(zoomed));
    ui.zoom.textContent = zoomed ? "Fit" : "Zoom";
    fitScreen();
  });
  setInterval(fitScreen, 400);
  window.addEventListener("resize", fitScreen);

  // ----------------------------------------------------------- keyboard focus

  function setKeyboard(on) {
    if (emulator) try { emulator.keyboard_set_enabled(on); } catch (_) {}
    ui.fit.classList.toggle("focused", on);
  }
  ui.fit.addEventListener("pointerdown", () => ui.fit.focus({ preventScroll: true }));

  // Taps on a graphical screen (the Linux desktop) become mouse clicks. v86
  // turns finger movement into pointer motion, but a tap alone never clicks,
  // so move the pointer to the finger first, then press until it lifts.
  function tapToClick(e, down) {
    if (!emulator || !emulator.bus) return;
    const canvas = ui.screen.querySelector("canvas");
    if (!canvas || canvas.style.display === "none") return;
    const t = (e.changedTouches || [])[0];
    if (!t) return;
    const r = canvas.getBoundingClientRect();
    if (t.clientX < r.left || t.clientX > r.right || t.clientY < r.top || t.clientY > r.bottom) return;
    if (down) {
      emulator.bus.send("mouse-absolute", [t.clientX - r.left, t.clientY - r.top, r.width, r.height]);
      emulator.bus.send("mouse-delta", [0, 0]);
      setTimeout(() => emulator && emulator.bus.send("mouse-click", [true, false, false]), 60);
    } else {
      setTimeout(() => emulator && emulator.bus.send("mouse-click", [false, false, false]), 120);
    }
  }
  ui.fit.addEventListener("touchstart", (e) => tapToClick(e, true), { passive: true });
  ui.fit.addEventListener("touchend", (e) => tapToClick(e, false), { passive: true });
  ui.fit.addEventListener("focus", () => setKeyboard(true));
  ui.fit.addEventListener("blur", () => setKeyboard(false));

  // v86 drops simulated keys while its keyboard is disabled, so switch it on
  // for the duration of the (synchronous) send, then restore the focus state.
  function sendText(text) {
    if (!emulator) return;
    emulator.keyboard_set_enabled(true);
    emulator.keyboard_send_text(text);
    emulator.keyboard_set_enabled(document.activeElement === ui.fit);
  }

  ui.typebar.addEventListener("submit", (e) => {
    e.preventDefault();
    sendText(ui.typeInput.value + "\n");
    ui.typeInput.value = "";
  });
  ui.chips.addEventListener("click", (e) => {
    const cmd = e.target.closest("[data-cmd]");
    if (cmd) sendText(cmd.dataset.cmd + "\n");
  });

  // Keys a phone keyboard doesn't have, as PS/2 scancodes (press, release).
  const SCANCODES = {
    esc: [0x01, 0x81], tab: [0x0F, 0x8F], enter: [0x1C, 0x9C], space: [0x39, 0xB9], bksp: [0x0E, 0x8E],
    up: [0xE0, 0x48, 0xE0, 0xC8], down: [0xE0, 0x50, 0xE0, 0xD0],
    left: [0xE0, 0x4B, 0xE0, 0xCB], right: [0xE0, 0x4D, 0xE0, 0xCD],
    ctrlc: [0x1D, 0x2E, 0xAE, 0x9D], ctrll: [0x1D, 0x26, 0xA6, 0x9D],
  };
  function sendKey(emu, key) {
    if (!emu || !SCANCODES[key]) return;
    emu.keyboard_send_scancodes(SCANCODES[key]);
  }
  ui.keys.addEventListener("click", (e) => {
    const k = e.target.closest("[data-key]");
    if (k) sendKey(emulator, k.dataset.key);
  });

  // ---------------------------------------------------------------- serial

  let serialBuf = "", serialTimer = 0;
  function serialByte(b) {
    if (b === 13) return;
    serialBuf += String.fromCharCode(b);
    if (!serialTimer) serialTimer = setTimeout(flushSerial, 50);
  }
  function flushSerial() {
    serialTimer = 0;
    const atBottom = ui.serial.scrollHeight - ui.serial.scrollTop - ui.serial.clientHeight < 30;
    ui.serial.textContent += serialBuf;
    serialBuf = "";
    if (ui.serial.textContent.length > 200000) ui.serial.textContent = ui.serial.textContent.slice(-150000);
    if (atBottom) ui.serial.scrollTop = ui.serial.scrollHeight;
  }
  ui.serialClear.addEventListener("click", () => { ui.serial.textContent = ""; });

  // ------------------------------------------------------------------ boot

  // ------------------------------------------------------------ packages

  const host = window.ConMonHost;
  host.onStateChange((st) => {
    ui.pkgMeteo.textContent = st.meteo ? "installed" : "not installed";
    ui.pkgMeteo.className = "pill" + (st.meteo ? " on" : "");
    ui.pkgLlm.textContent = st.llm ? "installed" : "not installed";
    ui.pkgLlm.className = "pill" + (st.llm ? " on" : "");
    ui.pkgGpu.textContent = st.gpu === "available" ? "WebGPU available" : st.gpu === "not available" ? "no WebGPU in this browser" : "WebGPU: checking…";
    ui.pkgModel.textContent = st.model ? "model: " + (st.modelLabel || st.model.replace(/-MLC$/, "")) : "no model loaded";
    for (const name of ["doom", "doomy", "nativedoom"]) {
      const el = document.getElementById("pkg-" + name);
      if (el) { el.textContent = st[name] ? "installed" : "not installed"; el.className = "pill" + (st[name] ? " on" : ""); }
    }
    ui.pkgBusy.textContent = st.busy ? "host: " + st.busy + "…" : "";
    // While a game runs on ConMon's screen, swap the key row for the game pad.
    // Starting a game also gives the screen the keyboard, so a PC's keys play.
    if (st.game && ui.gamePad.hidden) ui.fit.focus({ preventScroll: true });
    ui.gamePad.hidden = !st.game;
    ui.keys.hidden = !!st.game;
  });
  host.checkGpu();

  // Game pad: hold-able buttons that send real press/release scancodes to
  // the emulated keyboard, so ConMon (in raw mode) forwards them to the game.
  function padSend(btn, down) {
    if (!emulator) return;
    const code = parseInt(btn.dataset.sc, 16) | (down ? 0 : 0x80);
    emulator.keyboard_send_scancodes(btn.hasAttribute("data-e0") ? [0xE0, code] : [code]);
    btn.classList.toggle("held", down);
  }
  ui.gamePad.addEventListener("pointerdown", (e) => {
    const b = e.target.closest("[data-sc]");
    if (!b) return;
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId); } catch (_) {}
    padSend(b, true);
  });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) {
    ui.gamePad.addEventListener(t, (e) => {
      const b = e.target.closest("[data-sc]");
      if (b && b.classList.contains("held")) padSend(b, false);
    });
  }
  ui.gamePad.addEventListener("contextmenu", (e) => e.preventDefault());

  // ------------------------------------------------------- DOOM window
  //
  // MikeOS is a 16-bit OS and can't run DOOM, so its DOOM.BAS program sends
  // ESC ] CM;window.doom BEL out of COM1 and the page opens DOOM here, in a
  // window over the guest's screen. The guest keeps running underneath.

  const doomUi = { win: $("doom-window"), screen: $("doom-screen"), canvas: $("doom-canvas"),
    state: $("doom-state"), close: $("doom-close"), pad: $("doom-pad") };
  let doomRun = null;                       // { doom, timer, run }
  let doomRunId = 0;
  const DOOM_KEYS = { ArrowUp: "UPARROW", ArrowDown: "DOWNARROW", ArrowLeft: "LEFTARROW", ArrowRight: "RIGHTARROW",
    Control: "FIRE", " ": "USE", Shift: "SHIFT", Alt: "ALT", Tab: "TAB", Escape: "ESCAPE", Enter: "ENTER",
    Backspace: "BACKSPACE", ",": "STRAFE_L", ".": "STRAFE_R", "<": "STRAFE_L", ">": "STRAFE_R" };

  function doomKey(name, down) {
    if (!doomRun || !doomRun.doom) return;
    if (name === "QUIT") { if (down) closeDoomWindow(); return; }
    const d = doomRun.doom;
    let k = null;
    if (name.length === 1) k = name.toLowerCase().charCodeAt(0);
    else try { k = d.keyCode(name); } catch (_) {}
    if (k != null) d.press(k, down);
  }

  async function openDoomWindow() {
    if (doomRun) { doomUi.screen.focus({ preventScroll: true }); return; }
    const run = ++doomRunId;
    doomRun = { run, doom: null, timer: 0 };
    doomUi.win.hidden = false;
    doomUi.win.classList.remove("running");
    doomUi.state.textContent = "loading…";
    doomUi.screen.focus({ preventScroll: true });
    const ctx = doomUi.canvas.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, doomUi.canvas.width, doomUi.canvas.height);
    let image = null, pixels = null;
    try {
      await host.loadDoomModule((f) => { if (doomRun && doomRun.run === run) doomUi.state.textContent = `downloading ${Math.round(f * 100)}%`; });
      if (!doomRun || doomRun.run !== run) return;
      const doom = await host.startDoomInstance((bgra, w, h) => {
        if (!image || image.width !== w || image.height !== h) {
          doomUi.canvas.width = w; doomUi.canvas.height = h;
          image = ctx.createImageData(w, h);
          pixels = new Uint32Array(image.data.buffer);
        }
        // DOOM hands over BGRA; the canvas wants RGBA (and an opaque alpha).
        const src = new Uint32Array(bgra.buffer, bgra.byteOffset, w * h);
        for (let i = 0; i < src.length; i++) {
          const v = src[i];
          pixels[i] = 0xFF000000 | ((v & 0xFF) << 16) | (v & 0xFF00) | ((v >> 16) & 0xFF);
        }
        ctx.putImageData(image, 0, 0);
      }, () => closeDoomWindow());
      if (!doomRun || doomRun.run !== run) return;
      doomRun.doom = doom;
      doomUi.state.textContent = "running";
      doomUi.win.classList.add("running");
      doomRun.timer = setInterval(() => doom.tick(), 28);      // 35 tics a second
    } catch (err) {
      console.error(err);
      if (doomRun && doomRun.run === run) doomUi.state.textContent = "couldn't load DOOM: " + (err.message || err);
    }
  }

  function closeDoomWindow() {
    if (!doomRun) return;
    clearInterval(doomRun.timer);
    doomRun = null;
    doomUi.win.hidden = true;
    doomUi.state.textContent = "closed";
    for (const b of doomUi.pad.querySelectorAll(".held")) b.classList.remove("held");
    if (emulator) ui.fit.focus({ preventScroll: true });
  }

  host.onWindow((what) => { if (what === "doom") openDoomWindow(); });

  // Phones: a second AI model needs a fresh page. Offer a reload that comes
  // back with llm already installed.
  host.onReloadNeeded(() => {
    if ($("reload-bar")) return;
    const bar = document.createElement("button");
    bar.id = "reload-bar";
    bar.className = "taskbar";
    bar.textContent = "Tap to reload the page and load another AI model";
    bar.addEventListener("click", () => {
      try { sessionStorage.setItem("conmon.resume", "llm"); } catch (_) {}
      location.reload();
    });
    ui.monitor.prepend(bar);
  });

  // ------------------------------------------------------ AI file preview
  const pv = { win: $("preview-window"), name: $("preview-name"), tabs: $("preview-tabs"), frame: $("preview-frame"),
    code: $("preview-code"), mode: $("preview-mode"), download: $("preview-download"), close: $("preview-close") };
  let pvFiles = [], pvCurrent = 0, pvShowCode = false, pvUrl = "";

  function pageFor(files) {
    const html = files.find((f) => f.ext === "html" || f.ext === "htm");
    const esc = (t) => t.replace(/<\/(script|style)/gi, "<\\/$1");
    if (html) {
      let page = html.content;
      for (const f of files) {
        if (f.ext === "css") {
          const re = new RegExp(`<link[^>]*href=["']?${f.name.replace(/\./g, "\\.")}["']?[^>]*>`, "i");
          const tag = `<style>${f.content}</style>`;
          page = re.test(page) ? page.replace(re, () => tag) : /<\/head>/i.test(page) ? page.replace(/<\/head>/i, () => tag + "</head>") : tag + page;
        } else if (f.ext === "js") {
          const re = new RegExp(`<script[^>]*src=["']?${f.name.replace(/\./g, "\\.")}["']?[^>]*>\\s*</script>`, "i");
          const tag = `<script>${esc(f.content)}</script>`;
          page = re.test(page) ? page.replace(re, () => tag) : /<\/body>/i.test(page) ? page.replace(/<\/body>/i, () => tag + "</body>") : page + tag;
        }
      }
      return page;
    }
    const css = files.filter((f) => f.ext === "css").map((f) => f.content).join("\n");
    const js = files.filter((f) => f.ext === "js").map((f) => f.content).join("\n");
    const svg = files.find((f) => f.ext === "svg");
    if (svg) return `<!doctype html><body style="margin:0;display:grid;place-items:center;min-height:100vh">${svg.content}</body>`;
    if (!js && !css) return null;
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:15px system-ui,sans-serif;margin:16px}#log{white-space:pre-wrap;font:13px monospace;background:#f4f4f4;padding:8px}${css}</style></head>` +
      `<body><div id="log"></div><script>(function(){var l=document.getElementById('log');var o=console.log;console.log=function(){l.textContent+=Array.prototype.join.call(arguments,' ')+'\\n';o.apply(console,arguments)};window.onerror=function(m){l.textContent+='Error: '+m+'\\n'}})();<\/script><script>${esc(js)}<\/script></body></html>`;
  }

  function showPreviewFile() {
    const f = pvFiles[pvCurrent];
    if (!f) return;
    const page = pageFor(pvFiles);
    const runnable = !!page;
    pvShowCode = pvShowCode || !runnable;
    pv.name.textContent = runnable && !pvShowCode ? "Preview · " + (pvFiles.find((x) => x.ext === "html") || f).name : f.name;
    pv.frame.hidden = pvShowCode;
    pv.code.hidden = !pvShowCode;
    pv.mode.textContent = pvShowCode ? "Preview" : "Code";
    pv.mode.disabled = !runnable;
    pv.code.textContent = f.content;
    if (!pvShowCode && pv.frame.dataset.page !== page) { pv.frame.srcdoc = page; pv.frame.dataset.page = page; }
    for (const [i, b] of [...pv.tabs.children].entries()) b.classList.toggle("on", i === pvCurrent);
    if (pvUrl) URL.revokeObjectURL(pvUrl);
    pvUrl = URL.createObjectURL(new Blob([f.content], { type: "text/plain" }));
    pv.download.href = pvUrl;
    pv.download.download = f.name;
  }

  host.onPreview((files) => {
    pvFiles = files;
    pvCurrent = Math.max(0, files.findIndex((f) => f.ext === "html"));
    pvShowCode = false;
    pv.tabs.innerHTML = "";
    files.forEach((f, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.name;
      b.addEventListener("click", () => { pvCurrent = i; showPreviewFile(); });
      pv.tabs.append(b);
    });
    pv.tabs.hidden = files.length < 2;
    pv.frame.dataset.page = "";
    pv.win.hidden = false;
    pv.win.classList.add("running");
    showPreviewFile();
  });
  pv.mode.addEventListener("click", () => { pvShowCode = !pvShowCode; showPreviewFile(); });
  pv.close.addEventListener("click", () => { pv.win.hidden = true; pv.frame.srcdoc = ""; pv.frame.dataset.page = ""; ui.fit.focus({ preventScroll: true }); });

  // Claude API key for the Haiku advancement, kept only in this browser.
  const haikuPill = $("pkg-haiku"), haikuInput = $("haiku-key");
  async function haikuStatus() {
    if (!haikuPill) return;
    let site = false;
    if (!window.CONMON_PREVIEW) try { const r = await fetch("/api/claude"); site = r.ok && (await r.json()).ready; } catch (_) {}
    let local = "";
    try { local = localStorage.getItem("conmon.anthropicKey") || ""; } catch (_) {}
    const on = site || local;
    haikuPill.textContent = window.CONMON_PREVIEW ? "needs internet" : site ? "on (site key)" : local ? "on (key in this browser)" : "needs a key";
    haikuPill.className = "pill" + (on && !window.CONMON_PREVIEW ? " on" : "");
  }
  $("haiku-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const k = haikuInput.value.trim();
    if (k) try { localStorage.setItem("conmon.anthropicKey", k); } catch (_) {}
    haikuInput.value = "";
    host.haikuKeyChanged();
    haikuStatus();
  });
  $("haiku-clear").addEventListener("click", () => {
    try { localStorage.removeItem("conmon.anthropicKey"); } catch (_) {}
    host.haikuKeyChanged();
    haikuStatus();
  });
  haikuStatus();
  doomUi.close.addEventListener("click", closeDoomWindow);
  doomUi.screen.addEventListener("pointerdown", () => doomUi.screen.focus({ preventScroll: true }));
  for (const [type, down] of [["keydown", true], ["keyup", false]]) {
    doomUi.win.addEventListener(type, (e) => {
      if (e.target.closest("button")) return;
      if (e.key === "F12") { e.preventDefault(); if (down) closeDoomWindow(); return; }
      const name = DOOM_KEYS[e.key] || (e.key.length === 1 && /[a-z0-9\-=]/i.test(e.key) ? e.key : null);
      if (!name) return;
      e.preventDefault();
      if (!(down && e.repeat)) doomKey(name, down);
    });
  }
  doomUi.pad.addEventListener("pointerdown", (e) => {
    const b = e.target.closest("[data-dk]");
    if (!b) return;
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId); } catch (_) {}
    b.classList.add("held");
    doomKey(b.dataset.dk, true);
  });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) {
    doomUi.pad.addEventListener(t, (e) => {
      const b = e.target.closest("[data-dk]");
      if (b && b.classList.contains("held")) { b.classList.remove("held"); doomKey(b.dataset.dk, false); }
    });
  }
  doomUi.pad.addEventListener("contextmenu", (e) => e.preventDefault());

  async function stopEmulator() {
    closeDoomWindow();
    host.detach();
    if (!emulator) return;
    const old = emulator;
    emulator = null;
    try { await old.destroy(); } catch (_) {}
  }

  async function loadSource() {
    // Priority: URL field, then a chosen file, then the active bundled kernel.
    const url = ui.url.value.trim();
    if (url) {
      setStatus("downloading", "warn");
      showOverlay("Downloading " + url, false);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const name = decodeURIComponent(new URL(url, location.href).pathname.split("/").pop() || "download");
      return { name, buffer };
    }
    if (selected) return selected;
    const s = SAMPLES[sample];
    return { name: s.name, buffer: await loadImage(s.url), bundled: sample };
  }

  async function boot() {
    if (booting) return;
    booting = true;
    ui.boot.disabled = ui.bootOverlay.disabled = true;
    try {
      await stopEmulator();
      setRunningControls(false);
      resetScreen();
      showOverlay("Preparing…", false);
      setProgress(0);

      const src = await loadSource();
      ui.chips.classList.toggle("hidden", src.bundled !== "conmon");
      let kind = ui.kind.value;
      const size = src.size || src.buffer.byteLength;
      if (kind === "auto") kind = detectKind(src.name, src.buffer, size);
      ui.pkgPanel.classList.toggle("hidden", src.bundled !== "conmon" && kind !== "multiboot");
      if (kind === "fda" && size > FLOPPY_MAX)
        throw new Error("That image is bigger than a 2.88 MB floppy. Boot it as a hard disk instead.");
      if (kind === "fda" && !src.file && src.buffer.byteLength < 1474560) {   // boot sectors -> a full 1.44 MB floppy
        const padded = new Uint8Array(1474560);
        padded.set(new Uint8Array(src.buffer));
        src.buffer = padded.buffer;
      }
      const sampleInfo = src.bundled ? SAMPLES[src.bundled] : null;
      ui.hint.textContent = sampleInfo && sampleInfo.hint ? sampleInfo.hint : "";
      ui.hint.hidden = !ui.hint.textContent;
      ui.keys.dataset.mode = src.bundled === "conmon" ? "conmon" : "guest";

      ui.name.textContent = `${src.name} · ${KIND_LABEL[kind]} · ${formatSize(size)}`;
      setStatus("starting", "warn");
      showOverlay("Starting the virtual PC…", false);

      const ramMB = parseInt(ui.ram.value, 10);
      const options = {
        ...emuFiles(),
        screen_container: ui.screen,
        memory_size: ramMB * 1024 * 1024,
        vga_memory_size: 8 * 1024 * 1024,
        autostart: true,
      };
      // Big files (a ReactOS CD, say) are read from disk as needed, not all at once.
      options[kind] = src.file ? { buffer: src.file, async: true } : { buffer: src.buffer };
      if (kind === "cdrom") options.boot_order = 0x123;     // CD first
      if (kind === "hda") options.boot_order = 0x132;       // hard disk first
      if (kind === "fda") options.boot_order = 0x321;       // floppy first

      const emu = new V86(options);
      emulator = emu;

      emu.add_listener("download-progress", (e) => {
        if (e.lengthComputable && e.total) setProgress(((e.file_index + e.loaded / e.total) / e.file_count));
      });
      emu.add_listener("download-error", (e) => {
        setStatus("error", "err");
        showOverlay("Failed to download " + (e && e.file_name ? e.file_name : "emulator files"), true);
      });
      host.attach(emu, serialByte);
      window.__conmonLab = { emulator: emu };     // handy for tests and the browser console
      emu.add_listener("serial0-output-byte", (b) => host.onByte(b));
      emu.add_listener("emulator-started", () => {
        if (emulator !== emu) return;
        ui.overlay.classList.add("hidden");
        setProgress(null);
        setStatus("running", "ok");
        setRunningControls(true);
        ui.fit.focus({ preventScroll: true });
        setTimeout(fitScreen, 50);
        // Back from a "reload to load another model": reinstall llm for you.
        let resume = "";
        try { resume = sessionStorage.getItem("conmon.resume") || ""; sessionStorage.removeItem("conmon.resume"); } catch (_) {}
        if (resume === "llm" && src.bundled === "conmon") setTimeout(() => { if (emulator === emu) sendText("install llm\n"); }, 3500);
      });
      emu.add_listener("emulator-stopped", () => {
        if (emulator === emu) { setStatus("paused", "warn"); ui.pause.textContent = "Resume"; }
      });
    } catch (err) {
      console.error(err);
      await stopEmulator();
      setStatus("error", "err");
      setProgress(null);
      showOverlay(err.message || String(err), true);
    } finally {
      booting = false;
      ui.boot.disabled = ui.bootOverlay.disabled = false;
    }
  }

  // --------------------------------------------------------------- controls

  ui.boot.addEventListener("click", () => {
    if (!selected && !ui.url.value.trim()) {
      ui.fileInfo.textContent = "Choose a file or enter a URL first.";
      return;
    }
    boot();
  });
  ui.bootOverlay.addEventListener("click", boot);
  ui.url.addEventListener("input", () => { if (ui.url.value.trim()) markSample(null); });
  function markSample(name) {
    for (const b of ui.samples.querySelectorAll(".sample")) b.classList.toggle("active", b.dataset.sample === name);
  }
  // ReactOS can't be bundled from here, so the page walks you through
  // downloading it once and then boots the CD image from your device.
  const byo = { win: $("byo-window"), close: $("byo-close"), pick: $("byo-pick"), file: $("byo-file"), status: $("byo-status") };
  ui.samples.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sample]");
    if (!b) return;
    if (b.dataset.sample === "reactos") {
      byo.status.textContent = "";
      byo.win.hidden = false;
      return;
    }
    sample = b.dataset.sample;
    selected = null;
    ui.url.value = "";
    ui.file.value = "";
    ui.kind.value = "auto";
    ui.fileInfo.textContent = "No file chosen.";
    markSample(sample);
    boot();
  });

  ui.pause.addEventListener("click", async () => {
    if (!emulator) return;
    if (emulator.is_running()) {
      await emulator.stop();
    } else {
      await emulator.run();
      setStatus("running", "ok");
      ui.pause.textContent = "Pause";
    }
  });
  ui.restart.addEventListener("click", () => { if (emulator) { emulator.restart(); ui.fit.focus({ preventScroll: true }); } });
  ui.cad.addEventListener("click", () => {
    // Ctrl down, Alt down, Del down (E0 53), then releases.
    if (emulator) emulator.keyboard_send_scancodes([0x1D, 0x38, 0xE0, 0x53, 0xE0, 0xD3, 0xB8, 0x9D]);
  });
  ui.full.addEventListener("click", () => {
    if (ui.fit.requestFullscreen) ui.fit.requestFullscreen().catch(() => {});
    else if (emulator) emulator.screen_go_fullscreen();
  });
  document.addEventListener("fullscreenchange", () => setTimeout(fitScreen, 100));

  function pickFile(file, then) {
    if (!file) return;
    ui.fileInfo.textContent = "Reading " + file.name + "…";
    const big = file.size > 24 * 1024 * 1024;
    (big ? file.slice(0, 64 * 1024).arrayBuffer() : file.arrayBuffer()).then((buffer) => {
      selected = big ? { name: file.name, buffer, file, size: file.size } : { name: file.name, buffer };
      ui.url.value = "";
      markSample(null);
      let guess = "";
      try { guess = KIND_LABEL[detectKind(file.name, buffer, file.size)]; } catch (e) { guess = "unsupported: " + e.message; }
      ui.fileInfo.textContent = `${file.name} · ${formatSize(file.size)} · looks like: ${guess}`;
      if (then) then(guess);
    });
  }
  ui.file.addEventListener("change", () => pickFile(ui.file.files[0]));
  byo.close.addEventListener("click", () => { byo.win.hidden = true; });
  byo.pick.addEventListener("click", () => byo.file.click());
  byo.file.addEventListener("change", () => {
    const f = byo.file.files[0];
    if (!f) return;
    if (/\.zip$/i.test(f.name)) { byo.status.textContent = "That's the zip. Unzip it first (tap it in Files), then pick the .iso inside."; return; }
    byo.status.textContent = "Reading " + f.name + "…";
    pickFile(f, (guess) => {
      if (guess !== "CD-ROM") { byo.status.textContent = "That doesn't look like a CD image (.iso). Pick the ReactOS .iso file."; return; }
      if (parseInt(ui.ram.value, 10) < 256) ui.ram.value = "256";
      ui.kind.value = "cdrom";
      byo.win.hidden = true;
      markSample("reactos");
      ui.hint.textContent = "ReactOS: the first boot takes a few minutes. Choose \"Live CD\" to try it without installing. Click the screen to use the mouse.";
      ui.hint.hidden = false;
      boot();
    });
  });
  ["dragenter", "dragover"].forEach((t) => ui.drop.addEventListener(t, (e) => { e.preventDefault(); ui.drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => ui.drop.addEventListener(t, (e) => { e.preventDefault(); ui.drop.classList.remove("over"); }));
  ui.drop.addEventListener("drop", (e) => pickFile(e.dataTransfer.files[0]));

  // Boot ConMon straight away unless the page was opened with ?manual.
  if (typeof V86 === "undefined") {
    setStatus("error", "err");
    showOverlay("The emulator script (/v86/libv86.js) did not load.", false);
  } else if (!new URLSearchParams(location.search).has("manual")) {
    boot();
  }
})();
