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
  };

  const SAMPLES = {
    conmon: { name: "conmon.bin", url: "/kernels/conmon.bin", label: "ConMon" },
    hello: { name: "hello-floppy.img", url: "/kernels/hello-floppy.img", label: "Hello boot sector" },
  };
  let sample = "conmon";                 // bundled kernel used when no file/URL is chosen
  const FLOPPY_MAX = 2949120;            // 2.88 MB
  const KIND_LABEL = { multiboot: "Multiboot kernel", fda: "floppy", cdrom: "CD-ROM", hda: "hard disk" };

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
    const scale = Math.min(avail / w, 2);
    ui.screen.style.transform = `scale(${scale})`;
    ui.fit.scrollTop = 0;
    ui.fit.scrollLeft = 0;
    ui.fit.style.height = Math.ceil(h * scale) + "px";
  }
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
    const res = await fetch(s.url);
    if (!res.ok) throw new Error(`Could not load the bundled ${s.label} image.`);
    return { name: s.name, buffer: await res.arrayBuffer(), bundled: sample };
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
        wasm_path: "/v86/v86.wasm",
        bios: { url: "/v86/seabios.bin" },
        vga_bios: { url: "/v86/vgabios.bin" },
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
