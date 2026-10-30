// ConMon Lab - host link.
//
// ConMon talks to this page over its serial port (COM1). This file is the
// "host" side: it installs packages, runs games (DOOM, doomy, PS2 games),
// fetches weather from Open-Meteo with an animated ASCII map, then streams it
// all back into the OS.
//
//   ConMon -> host:  ESC ] "CM;" <type> ";" <payload> BEL
//   host -> ConMon:  STX <type> <len lo> <len hi> <payload bytes>
(() => {
  "use strict";

  // Offline preview (preview/preview-data.js): no internet, so a built-in
  // city list with SAMPLE weather.
  const PREVIEW = window.CONMON_PREVIEW || null;
  let emu = null;
  let onState = () => {};
  let onWindow = null;
  const state = { meteo: false, doom: false, doomy: false, nativedoom: false, ps2: false, game: "", busy: "" };

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

  // Progress reports are throttled: downloads can fire thousands of callbacks
  // a second, and every packet has to squeeze through the emulated serial port.
  let lastProgress = { at: 0, pct: -1, text: "" };
  function progress(pct, text) {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    text = String(text).slice(0, 40);
    const now = performance.now();
    if (pct < 100 && text === lastProgress.text && (pct === lastProgress.pct || now - lastProgress.at < 250)) return;
    lastProgress = { at: now, pct, text };
    sendText("P", `${pct}|${text}`);
  }
  function setBusy(text) { state.busy = text; onState(state); }

  // -------------------------------------------------------- dispatcher

  // A keep-alive packet ('K') goes out every few seconds while a job runs, so
  // ConMon can tell a slow job from a dead page.
  let jobDepth = 0, keepAlive = 0;
  function jobStarted() { if (jobDepth++ === 0) keepAlive = setInterval(() => send("K", ""), 4000); }
  function jobEnded() { if (jobDepth > 0 && --jobDepth === 0) clearInterval(keepAlive); }
  function releaseQueue() { jobDepth = 0; clearInterval(keepAlive); }
  const handle = (msg) => run(msg);

  async function run(msg) {
    const i = msg.indexOf(";");
    const type = i < 0 ? msg : msg.slice(0, i);
    const arg = i < 0 ? "" : msg.slice(i + 1);
    const long = type !== "hello" && type !== "cancel" && !type.endsWith(".k") && type !== "game.ack";
    if (long) jobStarted();
    try {
      switch (type) {
        case "hello": sendText("H", "ConMon Lab 1"); break;
        case "pkg.install":
          if (arg === "solmeteo") await installMeteo();
          else if (arg === "doom") await installDoom();
          else if (arg === "doomy") await installDoomy();
          else if (arg === "nativedoom") await installNativeDoom();
          else if (arg === "ps2") await installPs2();
          else sendText("E", `Unknown package ${arg}`);
          break;
        case "cancel":
          cancelled = true;
          setTimeout(() => releaseQueue(), 3000);
          break;
        case "meteo.show": await showMeteo(arg); break;
        case "meteo.cities": await listCities(arg); break;
        case "doom.start": await startDoom(); break;
        case "doomy.start": await startDoomy(); break;
        case "ext.load": await loadExtension(arg); break;
        case "ext.done": if (state.game === "native doom") { state.game = ""; onState(state); } break;
        case "doom.k": case "doomy.k": gameKeys(arg); break;
        case "doom.stop": case "doomy.stop": stopGame(null); break;
        case "game.ack": game.acked = true; break;
        // A guest OS (MikeOS's DOOM.BAS) asks the page to open a window.
        case "window.doom": if (onWindow) onWindow("doom"); break;
        case "window.android": if (onWindow) onWindow("android"); send("D", ""); break;
        case "apple.info": appleInfo(); break;
        case "ps2.run": await runPs2(arg); break;
        case "ps2.list": await listPs2(); break;
        case "meteo.stop": meteoRun++; setBusy(""); break;
        default: break;
      }
    } catch (err) {
      console.error(err);
      sendText("E", explain(err).slice(0, 160));
      setBusy("");
    } finally {
      if (long) jobEnded();
    }
  }

  // Turns errors into something a person can act on.
  function explain(err) {
    const m = (err && err.message ? err.message : String(err)) || "Unknown error";
    if (/\bquota\b|QuotaExceeded|no space left/i.test(m)) return "The browser ran out of storage. Free some space and try again.";
    if (/Failed to fetch|NetworkError|Load failed|net::ERR_/i.test(m)) return "A download failed. Check your internet connection and try again.";
    if (/Cancelled/i.test(m)) return "Cancelled.";
    return m;
  }

  // Errors nobody awaited (e.g. a GPU that gave up mid-load) still reach ConMon.
  window.addEventListener("unhandledrejection", (e) => {
    if (!emu || !state.busy) return;
    e.preventDefault();                 // reported to ConMon below
    console.error(e.reason);
    sendText("E", explain(e.reason).slice(0, 160));
    setBusy("");
    releaseQueue();
  });

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
      onProgress(Math.min(1, got / total));
    }
    return new Blob(parts, { type: res.headers.get("content-type") || "application/octet-stream" });
  }

  // ---------------------------------------------------------------- ps2
  //
  // PS2 games run in Play!, the open-source PS2 emulator, on /ps2/ (a page
  // of its own: it needs cross-origin isolation for its threads). ConMon
  // lists them and picks one; this page opens a window that starts it.

  let ps2Games = null;
  async function ps2List() {
    if (!ps2Games) {
      const res = await fetch("/ps2/games.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("Couldn't load the PS2 game list.");
      ps2Games = (await res.json()).games;
    }
    return ps2Games;
  }
  function ps2Lines(games) {
    const lines = ["PS2 games (run in Play!, the open-source PS2 emulator):"];
    for (const g of games) {
      lines.push(`  ${g.letter}  ${g.name.padEnd(12)} ${g.by}`);
      if (g.demo) lines.push("     free demo included (3 levels); your own pak0.pak gives the full game");
      else if (g.needs) lines.push(`     needs ${g.needs.what}`);
    }
    lines.push("Type run game <letter> to play, e.g. run game A");
    return lines;
  }
  async function installPs2() {
    if (PREVIEW) throw new Error("The PS2 emulator needs the online site; this offline preview can't run it.");
    setBusy("installing ps2");
    const games = await ps2List();
    progress(40, "Checking the Play! PS2 emulator");
    const built = await fetch("/ps2/emu/Play.wasm", { method: "HEAD" }).catch(() => null);
    progress(100, built && built.ok ? "Play! PS2 emulator ready" : "Play! not built yet");
    for (const l of ps2Lines(games)) sendText("M", l);
    if (!(built && built.ok)) sendText("M", "(The emulator files are still being built on GitHub; games open once they are.)");
    state.ps2 = true;
    setBusy("");
    send("D", "ps2");
  }
  async function listPs2() {
    for (const l of ps2Lines(await ps2List())) sendText("M", l);
    send("D", "");
  }
  async function runPs2(letter) {
    if (!state.ps2) throw new Error("Type install ps2 first.");
    const games = await ps2List();
    const g = games.find((x) => x.letter.toLowerCase() === String(letter).trim().toLowerCase());
    if (!g) throw new Error(`No PS2 game with letter ${letter}. Type run game to see the list.`);
    if (onWindow) onWindow("ps2", g);
    sendText("M", `Opened ${g.name} in ConMon Lab: tap Play in its window. It runs in a new tab.`);
    send("D", "");
  }

  // Facts the ConMon XNU iPhone app read from the phone's own kernel.
  function appleInfo() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem("conmon.xnu") || "null"); } catch {}
    if (!data || !data.facts) {
      for (const l of [
        "No iPhone kernel info yet. On the iPhone:",
        "  1. Install the ConMon XNU app (apple/ in the GitHub repo; Sideloadly).",
        "  2. Open it and tap Show in ConMon Lab. This page opens with the info.",
        "  3. Boot ConMon and type apple again.",
      ]) sendText("M", l);
      send("D", "");
      return;
    }
    const keys = Array.isArray(data.order) ? data.order.filter((k) => k in data.facts) : Object.keys(data.facts);
    const w = Math.min(18, Math.max(...keys.map((k) => k.length)));
    sendText("M", "Apple XNU kernel, read on the iPhone by the ConMon XNU app:");
    for (const k of keys) {
      const v = String(data.facts[k]).replace(/[\x00-\x1f]/g, " ");
      const lines = (k.padEnd(w) + "  " + v).match(/.{1,76}/g) || [];
      lines.forEach((l, i) => sendText("M", (i ? " ".repeat(w + 4) : "  ") + l.trimStart()));
    }
    if (data.received) sendText("M", "  (received " + data.received.slice(0, 16).replace("T", " ") + " UTC)");
    send("D", "");
  }

  // ----------------------------------------------------------- solMeteo
  //
  // `meteo <place>` in ConMon: geocode the place with Open-Meteo, fetch the
  // forecast, and stream a full-screen animation: an ASCII world map (from
  // GeoJSON country outlines) zooming in on the place, then the weather.
  // Frames go to ConMon as 'A' packets: <rows> byte, rows*80 chars, rows*80 attrs.

  const GEOJSON_URL = "/meteo/countries.geo.json";
  const CITIES_URL = "/meteo/cities.json";        // Natural Earth populated places
  let cityList = null;                            // [[name, country, region, lat, lon, population]]
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

  async function loadCities() {
    if (!cityList) {
      const res = await fetch(CITIES_URL);
      if (!res.ok) throw new Error("Couldn't load the city list.");
      cityList = (await res.json()).cities;
    }
    return cityList;
  }

  const fold = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  // Offline place search over the built-in list: "Name" or "Name, Country".
  async function offlineGeocode(text) {
    const list = await loadCities();
    const [rawName, rawCountry] = String(text).split(",");
    const name = fold(rawName), country = fold(rawCountry);
    const inCountry = (c) => !country || fold(c[1]).startsWith(country);
    const hit = list.find((c) => fold(c[0]) === name && inCountry(c))
      || list.find((c) => fold(c[0]).startsWith(name) && inCountry(c))
      || (name.length >= 4 && list.find((c) => fold(c[0]).includes(name) && inCountry(c)));
    if (!hit) {
      throw new Error(`"${text}" isn't in the ${list.length} built-in cities. Type cities to browse them` + (PREVIEW ? "; your site can look up any place." : "."));
    }
    const offset = Math.round(hit[4] / 15);
    return { name: hit[0], admin1: hit[2], country: hit[1], lat: hit[3], lon: hit[4], tzOffset: offset };
  }

  // `cities` and `cities <country>` at solMeteo's location prompt.
  async function listCities(arg) {
    const list = await loadCities();
    const want = fold(arg);
    if (!want) {
      const counts = new Map();
      for (const c of list) counts.set(c[1], (counts.get(c[1]) || 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
      sendText("M", `${list.length} built-in cities in ${counts.size} countries. Most covered:`);
      for (let i = 0; i < top.length; i += 3) {
        sendText("M", top.slice(i, i + 3).map(([n, k]) => `  ${(n.slice(0, 18) + " " + k).padEnd(24)}`).join(""));
      }
      sendText("M", "Type cities <country>, e.g. cities Italy. Any place works when online.");
      send("D", "");
      return;
    }
    const country = [...new Set(list.map((c) => c[1]))].find((n) => fold(n) === want) || [...new Set(list.map((c) => c[1]))].find((n) => fold(n).startsWith(want));
    if (!country) throw new Error(`No country called "${arg}" in the list. Type cities to see them.`);
    const rows = list.filter((c) => c[1] === country);
    sendText("M", `${country}: ${rows.length} cities, biggest first`);
    const names = rows.slice(0, 80).map((c) => c[0].slice(0, 18).padEnd(19));
    for (let i = 0; i < names.length; i += 4) sendText("M", "  " + names.slice(i, i + 4).join(""));
    if (rows.length > 80) sendText("M", `  ...and ${rows.length - 80} more.`);
    send("D", "");
  }

  async function geocode(name) {
    if (PREVIEW) return offlineGeocode(name);
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

  // -------------------------------------------------------------- games
  //
  // `doom` and `doomy` run here in the page; ConMon is the screen and the
  // keyboard. ConMon sends raw scancodes ("doom.k;1de048"), and gets back
  // 80x50 "pixel" frames drawn with the upper-half-block character: each text
  // cell shows two pixels (foreground = top, background = bottom). A 'Q'
  // packet first loads a 16-colour palette tuned to the game.

  const DOOM_URL = "/doom/doom.wasm";
  // 12 colours found by k-means over real DOOM frames, plus black, blood
  // red, HUD yellow, menu white and armour green.
  const DOOM_PALETTE = [
    [0, 0, 0], [15, 15, 27], [28, 28, 26], [38, 38, 35], [121, 1, 1], [53, 53, 42], [67, 69, 64], [93, 66, 41],
    [200, 20, 20], [97, 84, 71], [98, 100, 95], [133, 109, 87], [211, 191, 126], [255, 215, 70], [205, 205, 195], [40, 110, 40],
  ];
  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.5) * 22);
  // Set-1 scancode -> character, for cheats, Y/N prompts and weapon numbers.
  const SC_CHARS = { 0x02: "1", 0x03: "2", 0x04: "3", 0x05: "4", 0x06: "5", 0x07: "6", 0x08: "7", 0x09: "8", 0x0A: "9", 0x0B: "0",
    0x0C: "-", 0x0D: "=", 0x10: "q", 0x11: "w", 0x12: "e", 0x13: "r", 0x14: "t", 0x15: "y", 0x16: "u", 0x17: "i", 0x18: "o",
    0x19: "p", 0x1E: "a", 0x1F: "s", 0x20: "d", 0x21: "f", 0x22: "g", 0x23: "h", 0x24: "j", 0x25: "k", 0x26: "l",
    0x2C: "z", 0x2D: "x", 0x2E: "c", 0x2F: "v", 0x30: "b", 0x31: "n", 0x32: "m", 0x33: ",", 0x34: ".", 0x35: "/" };

  const game = { name: "", timer: 0, acked: true, ackWait: 0, lastSend: 0, frame: null, key: null, stop: null, e0: false };
  let doomModule = null;

  function paletteLUT(pal) {
    const lut = new Uint8Array(32768);
    for (let i = 0; i < 32768; i++) {
      const r = ((i >> 10) & 31) * 8.2, g = ((i >> 5) & 31) * 8.2, b = (i & 31) * 8.2;
      let best = 0, bd = Infinity;
      for (let c = 0; c < pal.length; c++) {
        const p = pal[c], d = (r - p[0]) ** 2 * 0.3 + (g - p[1]) ** 2 * 0.59 + (b - p[2]) ** 2 * 0.11;
        if (d < bd) { bd = d; best = c; }
      }
      lut[i] = best;
    }
    return lut;
  }

  function sendPalette(pal) {
    const q = new Uint8Array(48);
    pal.forEach((c, i) => { q[i * 3] = c[0] >> 2; q[i * 3 + 1] = c[1] >> 2; q[i * 3 + 2] = c[2] >> 2; });
    send("Q", q);
  }

  // 80x50 palette indices -> one 25-row text frame of half blocks.
  function sendIndexed(px) {
    const out = new Uint8Array(1 + 25 * 160);
    out[0] = 25;
    for (let row = 0; row < 25; row++) {
      for (let x = 0; x < 80; x++) {
        const i = row * 80 + x, top = px[row * 160 + x], bottom = px[row * 160 + 80 + x];
        out[1 + i] = 0xDF;                               // upper half block
        out[1 + 2000 + i] = (bottom << 4) | top;
      }
    }
    send("A", out);
  }

  function pumpGame() {
    if (!game.frame) return;
    const now = performance.now();
    if (!game.acked && now - game.ackWait > 1500) game.acked = true;    // never stall for good
    if (!game.acked || now - game.lastSend < 66) return;               // ~15 frames a second
    const px = game.frame();
    if (!px) return;
    sendIndexed(px);
    game.acked = false;
    game.ackWait = game.lastSend = now;
  }

  function stopGame(message) {
    clearInterval(game.timer);
    const wasRunning = !!game.name;
    if (game.stop) try { game.stop(); } catch (_) {}
    Object.assign(game, { name: "", timer: 0, frame: null, key: null, stop: null, acked: true, e0: false });
    state.game = "";
    setBusy("");
    if (wasRunning && message !== null) {
      if (message) sendText("M", message);
      send("X", "");
    }
  }

  // "1de048e0c89d" -> key events for the running game.
  function gameKeys(hex) {
    if (!game.key) return;
    for (let i = 0; i + 1 < hex.length; i += 2) {
      const b = parseInt(hex.slice(i, i + 2), 16);
      if (b === 0xE0) { game.e0 = true; continue; }
      game.key(b & 0x7F, !(b & 0x80), game.e0);
      game.e0 = false;
    }
  }

  async function loadDoomModule(onProgress) {
    if (doomModule) return doomModule;
    const blob = await fetchWithProgress(DOOM_URL, onProgress || (() => {}));
    doomModule = await WebAssembly.compile(await blob.arrayBuffer());
    return doomModule;
  }

  async function installDoom() {
    cancelled = false;
    setBusy("installing doom");
    progress(0, "Downloading DOOM (4.6 MB)");
    await loadDoomModule((f) => progress(f * 95, "Downloading DOOM (4.6 MB)"));
    progress(100, "DOOM engine ready");
    state.doom = true;
    setBusy("");
    send("D", "doom");
  }

  // Starts a DOOM instance. `draw(rgbaBGRA, width, height)` gets every frame.
  async function startDoomInstance(draw, onQuit) {
    const module = await loadDoomModule();
    let mem = null, W = 0, H = 0, quit = false;
    const imports = {
      loading: { onGameInit: (w, h) => { W = w; H = h; }, wadSizes: () => {}, readWads: () => {} },
      ui: { drawFrame: (ptr) => draw(new Uint8Array(mem.buffer, ptr, W * H * 4), W, H) },
      runtimeControl: { timeInMilliseconds: () => BigInt(Math.trunc(performance.now())) },
      console: { onInfoMessage: () => {}, onErrorMessage: (p, l) => console.warn("[DOOM]", new TextDecoder().decode(new Uint8Array(mem.buffer, p, l))) },
      gameSaving: { sizeOfSaveGame: () => 0, readSaveGame: () => 0, writeSaveGame: () => 0 },
    };
    const instance = await WebAssembly.instantiate(module, imports);
    const e = instance.exports;
    mem = e.memory;
    e.initGame();
    const keyFor = (code, ext) => {
      switch (code) {
        case 0x48: return e.KEY_UPARROW.value;
        case 0x50: return e.KEY_DOWNARROW.value;
        case 0x4B: return e.KEY_LEFTARROW.value;
        case 0x4D: return e.KEY_RIGHTARROW.value;
        case 0x1D: return e.KEY_FIRE.value;
        case 0x39: return e.KEY_USE.value;
        case 0x2A: case 0x36: return e.KEY_SHIFT.value;
        case 0x38: return e.KEY_ALT.value;
        case 0x0F: return e.KEY_TAB.value;
        case 0x01: return e.KEY_ESCAPE.value;
        case 0x1C: return e.KEY_ENTER.value;
        case 0x0E: return e.KEY_BACKSPACE.value;
        case 0x33: return e.KEY_STRAFE_L.value;
        case 0x34: return e.KEY_STRAFE_R.value;
        default: return SC_CHARS[code] ? SC_CHARS[code].charCodeAt(0) : null;
      }
    };
    return {
      tick() {
        if (quit) return false;
        try { e.tickGame(); return true; } catch (err) { quit = true; if (onQuit) onQuit(err); return false; }
      },
      key(code, down, ext) {
        const k = keyFor(code, ext);
        if (k == null) return;
        try { if (down) e.reportKeyDown(k); else e.reportKeyUp(k); } catch (_) {}
      },
      keyCode: (name) => e["KEY_" + name].value,
      press(k, down) { try { if (down) e.reportKeyDown(k); else e.reportKeyUp(k); } catch (_) {} },
    };
  }

  async function startDoom() {
    stopGame(null);
    setBusy("loading DOOM");
    const lut = paletteLUT(DOOM_PALETTE);
    let latest = null, W = 0, H = 0;
    const doom = await startDoomInstance((rgba, w, h) => { latest = rgba; W = w; H = h; },
      () => stopGame("DOOM has quit."));
    sendPalette(DOOM_PALETTE);
    const px = new Uint8Array(80 * 50);
    Object.assign(game, {
      name: "doom", acked: true, lastSend: 0,
      key: (code, down, ext) => doom.key(code, down, ext),
      frame() {
        if (!latest || !W) return null;
        const bw = W / 80, bh = H / 50;
        for (let y = 0; y < 50; y++) {
          for (let x = 0; x < 80; x++) {
            // Average four samples per block. Pixels are BGRA in memory.
            let r = 0, g = 0, b = 0;
            for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
              const i = ((Math.floor(y * bh + (sy + 0.5) * bh / 2)) * W + Math.floor(x * bw + (sx + 0.5) * bw / 2)) * 4;
              b += latest[i]; g += latest[i + 1]; r += latest[i + 2];
            }
            // A little brighter than the original: chunky pixels read darker.
            const d = BAYER4[(y & 3) * 4 + (x & 3)], k = 1.25 / 4;
            const R = Math.max(0, Math.min(255, r * k + d)) >> 3, G = Math.max(0, Math.min(255, g * k + d)) >> 3, B = Math.max(0, Math.min(255, b * k + d)) >> 3;
            px[y * 80 + x] = lut[(R << 10) | (G << 5) | B];
          }
        }
        return px;
      },
    });
    state.game = "doom";
    setBusy("playing DOOM");
    game.timer = setInterval(() => {
      if (!doom.tick()) return;
      pumpGame();
    }, 28);                                                 // DOOM runs at 35 tics a second
  }

  // --------------------------------------------------------- native doom
  //
  // DOOM compiled for ConMon itself (ext/ in the repo): a .cmx extension.
  // The host writes it and the shareware WAD straight into the PC's memory
  // where ConMon asks; ConMon checks the CRC and runs it on its own CPU.
  // The WAD is the one already inside doom.wasm, checked by its SHA-1.

  const NDOOM_URL = "/doom/ndoom.cmx";
  const WAD_SHA1 = "5b2e249b9c5133ec987b3ea77596381dc0d6bc1d";   // DOOM 1.9 shareware
  let ndoom = null;                                                // { cmx, wad }

  async function sha1hex(bytes) {
    if (!(crypto && crypto.subtle)) return WAD_SHA1;                 // no WebCrypto: trust the size check
    const h = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
    return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Finds the IWAD inside doom.wasm's data and checks it.
  async function findWad(wasmBytes) {
    const u8 = new Uint8Array(wasmBytes), dv = new DataView(wasmBytes);
    for (let i = 0; i + 12 < u8.length; i++) {
      if (u8[i] !== 0x49 || u8[i + 1] !== 0x57 || u8[i + 2] !== 0x41 || u8[i + 3] !== 0x44) continue;   // "IWAD"
      const lumps = dv.getInt32(i + 4, true), dir = dv.getInt32(i + 8, true);
      if (lumps <= 0 || lumps > 4000 || dir <= 0 || i + dir + lumps * 16 > u8.length) continue;
      const wad = u8.slice(i, i + dir + lumps * 16);
      if (await sha1hex(wad) === WAD_SHA1) return wad;
    }
    throw new Error("Couldn't find the DOOM shareware WAD.");
  }

  async function fetchBytes(url, onProgress) {
    if (window.CONMON_IMAGES && window.CONMON_IMAGES.has(url.split("/").pop())) return new Uint8Array(window.CONMON_IMAGES.get(url.split("/").pop()));
    const blob = await fetchWithProgress(url, onProgress || (() => {}));
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function installNativeDoom() {
    setBusy("installing native doom");
    progress(0, "Downloading DOOM for ConMon");
    const cmx = await fetchBytes(NDOOM_URL, (f) => progress(f * 20, "Downloading DOOM for ConMon"));
    progress(20, "Downloading the shareware WAD (4.6 MB)");
    const wasm = await fetchBytes(DOOM_URL, (f) => progress(20 + f * 70, "Downloading the shareware WAD (4.6 MB)"));
    progress(92, "Checking the WAD");
    const wad = await findWad(wasm.buffer);
    progress(100, "native doom ready");
    ndoom = { cmx, wad };
    state.nativedoom = true;
    setBusy("");
    send("D", "nativedoom");
  }

  async function loadExtension(arg) {
    const [name, load, max, dataAt, dataMax] = arg.split("|");
    if (name !== "doom" || !ndoom) throw new Error("Type install native doom first.");
    const n = (h) => parseInt(h, 16);
    if (ndoom.cmx.length > n(max) || ndoom.wad.length > n(dataMax)) throw new Error("This DOOM doesn't fit ConMon's memory layout.");
    emu.write_memory(ndoom.cmx, n(load));
    emu.write_memory(ndoom.wad, n(dataAt));
    send("D", `${ndoom.cmx.length}|${ndoom.wad.length}`);
    state.game = "native doom";                 // shows the game pad on phones
    onState(state);
  }

  // -------------------------------------------------------------- doomy
  //
  // doomy is a small DOOM-style game written in Python (/doomy/doomy.py).
  // Pyodide, Python compiled to WebAssembly, runs it right in this page.

  const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.6/full/";
  const DOOMY_URL = "/doomy/doomy.py";
  let pyodide = null;
  const DOOMY_KEYS = { 0x48: "up", 0x50: "down", 0x4B: "left", 0x4D: "right", 0x11: "up", 0x1F: "down", 0x1E: "left",
    0x20: "right", 0x10: "strafe_l", 0x12: "strafe_r", 0x33: "strafe_l", 0x34: "strafe_r", 0x1D: "fire", 0x39: "fire",
    0x21: "fire", 0x2A: "run", 0x36: "run", 0x1C: "enter", 0x15: "enter" };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Couldn't download Python (Pyodide). Check your internet connection."));
      document.head.append(s);
    });
  }

  async function installDoomy() {
    if (PREVIEW) {
      throw new Error("doomy needs internet to download Python (Pyodide, about 10 MB), so it only runs on your site. You can also run doomy.py on your PC: python doomy.py");
    }
    setBusy("installing doomy");
    if (!pyodide) {
      progress(5, "Downloading Python (Pyodide, ~10 MB)");
      if (!window.loadPyodide) await loadScript(PYODIDE_URL + "pyodide.js");
      progress(35, "Starting Python");
      pyodide = await window.loadPyodide({ indexURL: PYODIDE_URL });
    }
    progress(85, "Loading doomy.py");
    const res = await fetch(DOOMY_URL);
    if (!res.ok) throw new Error("Couldn't load doomy.py.");
    pyodide.runPython(await res.text());
    progress(100, "doomy ready (Python " + pyodide.runPython("import sys; sys.version.split()[0]") + ")");
    state.doomy = true;
    setBusy("");
    send("D", "doomy");
  }

  async function startDoomy() {
    if (!pyodide || !state.doomy) throw new Error("Type install doomy first.");
    stopGame(null);
    const g = pyodide.runPython("Doomy()");
    const palProxy = pyodide.globals.get("PALETTE");
    const pal = palProxy.toJs();
    if (palProxy.destroy) palProxy.destroy();
    sendPalette(pal);
    let last = performance.now();
    Object.assign(game, {
      name: "doomy", acked: true, lastSend: 0,
      key(code, down) { const k = DOOMY_KEYS[code]; if (k) g.key(k, down); },
      frame() {
        const now = performance.now();
        const out = g.step((now - last) / 1000);
        last = now;
        const px = out && out.toJs ? out.toJs() : out;
        if (out && out.destroy) out.destroy();
        return px;
      },
      stop() { if (g.destroy) g.destroy(); },
    });
    state.game = "doomy";
    setBusy("playing doomy");
    game.timer = setInterval(pumpGame, 33);
  }

  // ------------------------------------------------------------ public

  window.ConMonHost = {
    attach(emulator, textSink) {
      emu = emulator;
      emitText = textSink;
      mode = 0; frame = "";
      meteoRun++;
      stopGame(null);
      state.meteo = false;                      // a fresh ConMon has nothing installed
      state.doom = false; state.doomy = false; state.ps2 = false;
      onState(state);
    },
    detach() { meteoRun++; stopGame(null); emu = null; },
    startDoomInstance,
    loadDoomModule,
    onByte,
    onStateChange(fn) { onState = fn; fn(state); },
    onWindow(fn) { onWindow = fn; },
    get state() { return state; },
  };
})();
