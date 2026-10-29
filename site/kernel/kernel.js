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
    keys: $("keys"), zoom: $("btn-zoom"), monitor: $("monitor"), taskbar: $("taskbar"),
  };

  const SAMPLES = {
    conmon: { name: "conmon.bin", url: "/kernels/conmon.bin", label: "ConMon" },
    hello: { name: "hello-floppy.img", url: "/kernels/hello-floppy.img", label: "Hello boot sector" },
  };
  let sample = "conmon";                 // bundled kernel used when no file/URL is chosen
  const FLOPPY_MAX = 2949120;            // 2.88 MB
  const KIND_LABEL = { multiboot: "Multiboot kernel", fda: "floppy", cdrom: "CD-ROM", hda: "hard disk" };

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

  function detectKind(name, buf) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (isIso(buf) || ext === "iso") return "cdrom";
    const mb = hasMultibootHeader(buf);
    if (mb === 1) return "multiboot";
    if (mb === 2) throw new Error("This is a Multiboot2 kernel. v86 only boots Multiboot v1 kernels directly; wrap it in a GRUB ISO instead.");
    if (buf.byteLength <= FLOPPY_MAX) return "fda";
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
    ui.pkgBusy.textContent = st.busy ? "host: " + st.busy + "…" : "";
  });
  host.checkGpu();

  // ----------------------------------------------------------- run v86
  //
  // `run v86` in ConMon opens a second emulator in a window over the screen.
  // Desktop: a draggable window. Phones: a full-screen sheet that can be
  // minimised back to ConMon, which keeps running underneath.

  const FLOPPY = 1474560;
  const guest = { emu: null, el: null, info: null, minimized: false };

  function guestKeyboard(on) {
    if (guest.emu) try { guest.emu.keyboard_set_enabled(on); } catch (_) {}
    if (guest.el) guest.el.classList.toggle("focused", on);
  }

  function fitGuest() {
    if (!guest.el || guest.minimized) return;
    const box = guest.el.querySelector(".vm-screen"), inner = guest.el.querySelector(".vm-inner");
    const visible = [...inner.children].find((el) => el.style.display !== "none" && el.offsetWidth > 0);
    if (!visible) return;
    const w = visible.offsetWidth, h = visible.offsetHeight;
    if (!w || !h) return;
    // Fit by width and by height, so tall screens (Tetros) stay on screen.
    const phone = matchMedia("(max-width: 720px)").matches;
    const maxH = Math.max(160, Math.min(window.innerHeight * (phone ? 0.6 : 0.48), 520));
    const scale = Math.min(box.clientWidth / w, maxH / h, 2);
    inner.style.transform = `scale(${scale})`;
    inner.style.marginLeft = Math.max(0, (box.clientWidth - w * scale) / 2) + "px";
    box.style.height = Math.ceil(h * scale) + "px";
  }
  setInterval(fitGuest, 400);
  window.addEventListener("resize", fitGuest);

  async function closeGuest(silent) {
    const old = guest.emu;
    guest.emu = null;
    if (guest.el) guest.el.remove();
    guest.el = null;
    ui.taskbar.hidden = true;
    ui.taskbar.textContent = "";
    if (old) try { await old.destroy(); } catch (_) {}
    if (!silent) host.guestClosed();
  }

  function setMinimized(min) {
    guest.minimized = min;
    if (!guest.el) return;
    guest.el.hidden = min;
    ui.taskbar.hidden = !min;
    if (min) {
      ui.taskbar.textContent = `${guest.info.label} is running · tap to open`;
      ui.fit.focus({ preventScroll: true });
    } else {
      guest.el.querySelector(".vm-screen").focus({ preventScroll: true });
      setTimeout(fitGuest, 30);
    }
  }
  ui.taskbar.addEventListener("click", () => setMinimized(false));

  function makeDraggable(win, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || !matchMedia("(min-width: 721px)").matches) return;
      dragging = true; sx = e.clientX; sy = e.clientY; ox = win.offsetLeft; oy = win.offsetTop;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const parent = win.offsetParent || document.body;
      const x = Math.max(0, Math.min(parent.clientWidth - win.offsetWidth, ox + e.clientX - sx));
      const y = Math.max(0, Math.min(parent.clientHeight - 60, oy + e.clientY - sy));
      win.style.left = x + "px"; win.style.top = y + "px"; win.style.right = "auto";
    });
    handle.addEventListener("pointerup", () => { dragging = false; });
  }

  function guestWindow(info) {
    const win = document.createElement("section");
    win.className = "vm-window";
    win.setAttribute("aria-label", info.label + " window");
    win.innerHTML = `
      <header class="vm-title">
        <span class="vm-led"></span>
        <b class="vm-name"></b>
        <span class="vm-state">starting</span>
        <span class="vm-spacer"></span>
        <button class="vm-btn" data-act="restart" title="Restart">Restart</button>
        <button class="vm-btn" data-act="min" title="Back to ConMon">Minimise</button>
        <button class="vm-btn vm-close" data-act="close" title="Close" aria-label="Close">×</button>
      </header>
      <div class="vm-screen" tabindex="0"><div class="vm-inner"><div></div><canvas style="display:none"></canvas></div></div>
      <p class="vm-hint"></p>
      <div class="vm-keys">
        <button data-key="esc">Esc</button><button data-key="tab">Tab</button>
        <button data-key="left" aria-label="Left">←</button><button data-key="up" aria-label="Up">↑</button>
        <button data-key="down" aria-label="Down">↓</button><button data-key="right" aria-label="Right">→</button>
        <button data-key="space">Space</button><button data-key="bksp" aria-label="Backspace">⌫</button>
        <button data-key="enter">Enter</button>
      </div>
      <form class="vm-type" autocomplete="off">
        <input class="field" placeholder="Type to ${info.label.replace(/"/g, "")}" autocapitalize="off" spellcheck="false" enterkeyhint="send">
        <button class="btn" type="submit">Send</button>
      </form>`;
    win.querySelector(".vm-name").textContent = info.label;
    win.querySelector(".vm-hint").textContent = info.hint;
    const screen = win.querySelector(".vm-screen");
    screen.addEventListener("pointerdown", () => screen.focus({ preventScroll: true }));
    screen.addEventListener("focus", () => guestKeyboard(true));
    screen.addEventListener("blur", () => guestKeyboard(false));
    win.querySelector(".vm-title").addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "close") closeGuest(false);
      else if (act.dataset.act === "min") setMinimized(true);
      else if (act.dataset.act === "restart" && guest.emu) guest.emu.restart();
    });
    win.querySelector(".vm-keys").addEventListener("click", (e) => {
      const k = e.target.closest("[data-key]");
      if (k) sendKey(guest.emu, k.dataset.key);
    });
    win.querySelector(".vm-type").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = win.querySelector(".vm-type input");
      // Paced typing: boot-sector programs read keys through the BIOS, whose
      // buffer holds only ~15 keys, so typing at full speed loses letters.
      // Lines queue up, so sending twice quickly never interleaves letters.
      const emu = guest.emu, text = input.value + "\n";
      input.value = "";
      if (!emu) return;
      guest.typing = (guest.typing || Promise.resolve()).then(async () => {
        if (guest.emu !== emu) return;
        emu.keyboard_set_enabled(true);
        try { await emu.keyboard_send_text(text, 35); } catch (_) {}
        if (guest.emu === emu) emu.keyboard_set_enabled(document.activeElement === screen);
      });
    });
    makeDraggable(win, win.querySelector(".vm-title"));
    return win;
  }

  // Called by the host link when ConMon runs `run v86 <letter>`.
  host.onGuestOpen(async (info) => {
    await closeGuest(true);
    let buffer = await loadImage(info.file);
    const kind = info.kind === "kernel" ? "multiboot" : "fda";
    if (kind === "fda" && buffer.byteLength < FLOPPY) {      // boot sectors -> a full 1.44 MB floppy
      const padded = new Uint8Array(FLOPPY);
      padded.set(new Uint8Array(buffer));
      buffer = padded.buffer;
    }
    const win = guestWindow(info);
    ui.monitor.append(win);
    guest.el = win;
    guest.info = info;
    guest.minimized = false;
    guest.typing = null;
    ui.taskbar.hidden = true;
    const options = {
      ...emuFiles(),
      screen_container: win.querySelector(".vm-inner"),
      memory_size: 32 * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024,
      autostart: true,
      disable_mouse: true,
    };
    options[kind] = { buffer };
    if (kind === "fda") options.boot_order = 0x321;
    const emu = new V86(options);
    guest.emu = emu;
    emu.add_listener("emulator-started", () => {
      if (guest.emu !== emu) return;
      win.querySelector(".vm-state").textContent = "running";
      win.classList.add("running");
      win.querySelector(".vm-screen").focus({ preventScroll: true });
      setTimeout(fitGuest, 50);
    });
  });

  async function stopEmulator() {
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
      if (kind === "auto") kind = detectKind(src.name, src.buffer);
      ui.pkgPanel.classList.toggle("hidden", src.bundled !== "conmon" && kind !== "multiboot");
      if (kind === "fda" && src.buffer.byteLength > FLOPPY_MAX)
        throw new Error("That image is bigger than a 2.88 MB floppy. Boot it as a hard disk instead.");

      ui.name.textContent = `${src.name} · ${KIND_LABEL[kind]} · ${formatSize(src.buffer.byteLength)}`;
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
      options[kind] = { buffer: src.buffer };
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
      emu.add_listener("serial0-output-byte", (b) => host.onByte(b));
      emu.add_listener("emulator-started", () => {
        if (emulator !== emu) return;
        ui.overlay.classList.add("hidden");
        setProgress(null);
        setStatus("running", "ok");
        setRunningControls(true);
        ui.fit.focus({ preventScroll: true });
        setTimeout(fitScreen, 50);
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
  ui.samples.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sample]");
    if (!b) return;
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

  function pickFile(file) {
    if (!file) return;
    ui.fileInfo.textContent = "Reading " + file.name + "…";
    file.arrayBuffer().then((buffer) => {
      selected = { name: file.name, buffer };
      ui.url.value = "";
      markSample(null);
      let guess = "";
      try { guess = KIND_LABEL[detectKind(file.name, buffer)]; } catch (e) { guess = "unsupported: " + e.message; }
      ui.fileInfo.textContent = `${file.name} · ${formatSize(file.size)} · looks like: ${guess}`;
    });
  }
  ui.file.addEventListener("change", () => pickFile(ui.file.files[0]));
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
