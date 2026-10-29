// ConMon PS2 - runs a PS2 game in Play! (github.com/jpd002/Play-), the
// open-source PS2 emulator compiled to WebAssembly (emu/Play.js + Play.wasm,
// built by .github/workflows/ps2-emulator.yml).
//
// The game's ELF goes into Play!'s "host:" folder, the PS2's development
// file system, next to any data the game needs (for Quake II, the player's
// own baseq2/pak0.pak). The game finds its data on host: and boots from it.
// Game data the player picks is kept in this browser's private storage (OPFS)
// so it only has to be picked once. Nothing is uploaded anywhere.

const $ = (id) => document.getElementById(id);
const ui = {
  over: $("over"), title: $("title"), about: $("about"), need: $("need"), needText: $("need-text"),
  pick: $("pick"), file: $("file"), have: $("have"), start: $("start"), bar: $("bar"), status: $("status"),
  fps: $("fps"), full: $("full"), forget: $("forget"), log: $("log"), canvas: $("outputCanvas"),
  name: $("game-name"), credit: $("credit"), pad: $("pad"),
};

let game = null;          // entry from games.json
let data = null;          // File or Blob with the game data, if the game needs some
let Module = null;

function status(text, isError) {
  ui.status.textContent = text;
  ui.status.className = "small " + (isError ? "err" : "muted");
}
function bar(f) { ui.bar.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + "%"; }
function log(line) {
  ui.log.textContent += line + "\n";
  if (ui.log.textContent.length > 60000) ui.log.textContent = ui.log.textContent.slice(-40000);
  ui.log.scrollTop = ui.log.scrollHeight;
}

// ------------------------------------------------------------ game data

async function opfsDir(create) {
  if (!navigator.storage || !navigator.storage.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const ps2 = await root.getDirectoryHandle("ps2", { create });
    return await ps2.getDirectoryHandle(game.id, { create });
  } catch (_) { return null; }
}
const storedName = () => game.needs.path.split("/").pop();

async function loadStored() {
  const dir = await opfsDir(false);
  if (!dir) return null;
  try { return await (await dir.getFileHandle(storedName())).getFile(); } catch (_) { return null; }
}

async function checkData(file) {
  const n = game.needs;
  if (file.size < (n.minBytes || 1)) return `That file is too small to be ${storedName()}.`;
  if (n.magic) {
    const head = new TextDecoder().decode(await file.slice(0, n.magic.length).arrayBuffer());
    if (head !== n.magic) return `That isn't ${storedName()} (it doesn't start with "${n.magic}").`;
  }
  return "";
}

// Copies the picked file into OPFS (where the browser supports writing it).
async function keep(file) {
  const dir = await opfsDir(true);
  if (!dir) return false;
  try {
    const h = await dir.getFileHandle(storedName(), { create: true });
    if (!h.createWritable) return false;
    const w = await h.createWritable();
    await file.stream().pipeTo(w);
    return true;
  } catch (e) {
    console.warn("Couldn't keep the game data:", e);
    try { await dir.removeEntry(storedName()); } catch (_) {}
    return false;
  }
}

function showHave(text) {
  ui.have.hidden = false;
  ui.have.textContent = text;
  ui.start.disabled = false;
}

ui.pick.addEventListener("click", () => ui.file.click());
ui.file.addEventListener("change", async () => {
  const f = ui.file.files[0];
  if (!f) return;
  const bad = await checkData(f);
  if (bad) { status(bad, true); return; }
  data = f;
  showHave(`Using ${f.name} (${(f.size / 1048576).toFixed(0)} MB).`);
  status("Saving a copy in this browser so you won't need to pick it again…");
  const kept = await keep(f);
  if (kept) { data = (await loadStored()) || f; ui.forget.hidden = false; }
  status(kept ? "Ready. Tap Start." : "Ready. Tap Start. (This browser can't keep the file, so you'll pick it again next time.)");
});
ui.forget.addEventListener("click", async () => {
  const dir = await opfsDir(false);
  if (dir) try { await dir.removeEntry(storedName()); } catch (_) {}
  ui.forget.hidden = true;
  status("Removed the saved game data from this browser.");
});

// ------------------------------------------------------------ emulator

async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download ${url} (${res.status}).`);
  const total = +res.headers.get("content-length") || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const out = new Uint8Array(total);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, got);
    got += value.length;
    onProgress(got / total);
  }
  return out;
}

// Play! keeps its folders under its base path in Emscripten's file system;
// "host:" is <base>/vfs/host. Found by walking it, as the base path depends
// on the environment Play! sees.
function findHostDir(FS) {
  const seen = new Set();
  const walk = (dir, depth) => {
    if (depth > 7 || seen.has(dir)) return null;
    seen.add(dir);
    let names = [];
    try { names = FS.readdir(dir); } catch (_) { return null; }
    for (const n of names) {
      if (n === "." || n === "..") continue;
      const p = (dir === "/" ? "" : dir) + "/" + n;
      let isDir = false;
      try { isDir = FS.isDir(FS.stat(p).mode); } catch (_) {}
      if (!isDir || p.startsWith("/proc") || p.startsWith("/dev")) continue;
      if (/\/vfs\/host$/.test(p)) return p;
      const r = walk(p, depth + 1);
      if (r) return r;
    }
    return null;
  };
  return walk("/", 0);
}

function writeFile(FS, path, bytes) {
  const dir = path.slice(0, path.lastIndexOf("/"));
  try { FS.mkdirTree(dir); } catch (_) {}
  FS.writeFile(path, bytes, { canOwn: true });
}

async function start() {
  ui.start.disabled = true;
  ui.pick.disabled = true;
  try {
    status("Downloading the Play! PS2 emulator…");
    bar(0.02);
    let Play;
    try { Play = (await import("./emu/Play.js")).default; }
    catch (e) { throw new Error("The PS2 emulator isn't on this site yet (emu/Play.js). It is built by GitHub Actions; try again in a few minutes."); }
    const emuUrl = new URL("emu/Play.js", location.href).href;
    Module = await Play({
      locateFile: (p) => new URL("emu/" + p, location.href).href,
      mainScriptUrlOrBlob: emuUrl,
      print: (t) => log(t),
      printErr: (t) => log(t),
    });
    bar(0.3);
    Module.FS.mkdir("/work");
    Module.discImageDevice = { read() {}, getFileSize() { return 0; }, isDone() { return true; }, setFile() {} };
    Module.ccall("initVm", "", [], []);

    status("Loading " + game.name + "…");
    const elf = await fetchBytes(game.elf, (f) => bar(0.3 + f * 0.2));
    const extra = {};
    for (const [to, from] of Object.entries(game.files || {})) extra[to] = await fetchBytes(from, () => {});
    let host = null;
    for (let i = 0; i < 100 && !(host = findHostDir(Module.FS)); i++) await new Promise((r) => setTimeout(r, 50));
    if (!host) throw new Error("Play! didn't create its host: folder.");
    log(`[ConMon] host: is ${host}`);
    const elfName = game.elf.split("/").pop();
    writeFile(Module.FS, `${host}/${elfName}`, elf);
    for (const [to, bytes] of Object.entries(extra)) writeFile(Module.FS, `${host}/${to}`, bytes);
    if (game.needs) {
      status(`Reading ${storedName()} (${(data.size / 1048576).toFixed(0)} MB)…`);
      bar(0.55);
      writeFile(Module.FS, `${host}/${game.needs.path}`, new Uint8Array(await data.arrayBuffer()));
      data = null;              // the emulator's copy is the one that counts now
    }
    bar(1);
    status("Booting…");
    Module.bootElf(`${host}/${elfName}`);
    ui.over.hidden = true;
    ui.canvas.focus();
    setInterval(() => {
      try {
        const frames = Module.getFrames();
        Module.clearStats();
        ui.fps.textContent = frames + " frames a second";
      } catch (_) {}
    }, 1000);
  } catch (e) {
    console.error(e);
    status(e && e.message ? e.message : String(e), true);
    log("[ConMon] " + (e && e.stack ? e.stack : e));
    ui.start.disabled = false;
    ui.pick.disabled = false;
  }
}
ui.start.addEventListener("click", start);

// ------------------------------------------------------------ controls

ui.canvas.addEventListener("pointerdown", () => ui.canvas.focus());
ui.full.addEventListener("click", () => {
  const el = ui.canvas.parentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
});
// Touch pad: sends the same key events Play!'s keyboard bindings listen for.
function key(code, down) {
  ui.canvas.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, key: code, bubbles: true }));
}
for (const b of ui.pad.querySelectorAll("button")) {
  const down = (e) => { e.preventDefault(); b.classList.add("on"); key(b.dataset.code, true); };
  const up = (e) => { e.preventDefault(); if (!b.classList.contains("on")) return; b.classList.remove("on"); key(b.dataset.code, false); };
  b.addEventListener("pointerdown", down);
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
  b.addEventListener("pointerleave", up);
}

// ------------------------------------------------------------ setup

(async () => {
  const id = new URLSearchParams(location.search).get("game") || "quake2";
  try {
    const list = await (await fetch("games.json")).json();
    game = list.games.find((g) => g.id === id || g.letter.toLowerCase() === id.toLowerCase());
  } catch (_) {}
  if (!game) { status(`No PS2 game called "${id}".`, true); return; }
  document.title = game.name + " · ConMon PS2";
  ui.title.textContent = game.name;
  ui.name.textContent = game.name;
  ui.about.innerHTML = "";
  ui.about.append(game.by + " · ", Object.assign(document.createElement("a"), { href: game.source, target: "_blank", rel: "noopener", textContent: "source" }), " · " + game.licence);
  ui.credit.textContent = `${game.name}: ${game.by} (${game.licence}).`;

  const problems = [];
  if (!window.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") problems.push("this page isn't cross-origin isolated (SharedArrayBuffer is off), so the emulator's threads can't start. Open it from your Netlify site, not a file or a plain local server");
  if (!document.createElement("canvas").getContext("webgl2")) problems.push("this browser has no WebGL 2");
  if (problems.length) { status("Can't run here: " + problems.join("; ") + ".", true); return; }

  if (game.needs) {
    ui.need.hidden = false;
    ui.needText.textContent = "This game needs " + game.needs.what + ". It stays in this browser; nothing is uploaded.";
    ui.pick.textContent = "Choose " + storedName();
    const stored = await loadStored();
    if (stored && !(await checkData(stored))) {
      data = stored;
      ui.forget.hidden = false;
      showHave(`Found ${storedName()} saved in this browser (${(stored.size / 1048576).toFixed(0)} MB).`);
      status("Ready. Tap Start.");
    } else {
      status(`Choose ${storedName()} to continue.`);
    }
  } else {
    ui.start.disabled = false;
    status("Ready. Tap Start.");
  }
})();
