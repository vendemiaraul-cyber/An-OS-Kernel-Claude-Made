# ConMon Lab

A Netlify site with two apps:

- **Kernel Lab** (`/kernel/`): boots **ConMon**, a tiny x86 OS written in C and
  C++, inside the [v86](https://github.com/copy/v86) emulator in your browser.
  You can also load your own Multiboot kernel, floppy image, ISO or disk image.
  Inside ConMon, `install ps2` lists PS2 games and `run game A` plays one
  (Quake II's PS2 port) in the Play! PS2 emulator, and `install solMeteo`
  adds live weather from Open-Meteo for any place (2,582 cities built in, for
  offline use and `cities Italy`-style browsing) with an animated ASCII world map.
  `install doom` plays the real DOOM (shareware Episode 1) on ConMon's text
  screen; `install doomy` plays doomy, a small DOOM-style game written in
  Python, run in the browser by Pyodide. `install native doom` adds
  `native doom`: DOOM compiled for ConMon and run by ConMon's own CPU at
  320×200 in 256 colours, as a ConMon *extension* (see `ext/`). The page does the work and streams
  the results into ConMon over its serial port.
  The **Bundled kernels** list also boots **Linux Desktop**: Linux 6.6 with
  the Nano-X (Microwindows) windowing desktop, its window manager and apps
  (terminal, calculator, clock, Tetris, landmine, chess, world map, DOOM),
  with a mouse that follows your pointer or finger (2.5 MB). There is also
  a text-only **Linux 6.6 (shell)** with BusyBox (1.5 MB),
  **ReactOS (Windows-like)** (real Windows is Microsoft's paid software and
  can't be bundled, so this entry walks you through downloading the free,
  open-source ReactOS CD from reactos.org and boots it from your device), MikeOS, Tetros, bootBASIC, bootOS and
  SectorLISP on the main screen. You can drop in your own bzImage too. MikeOS has a `DOOM.BAS` program at the top
  of its menu: it can't run DOOM itself (it's 16-bit), so it asks the page,
  over the serial port, to open DOOM in a window.
- **YouTube Test** (`/youtube/`): search, trending, video stats and an embedded
  player through the **YouTube Data API v3**, with a request log for testing.
  The API key stays on the server inside a Netlify Function.

```
site/                      static site Netlify publishes
  index.html               landing page
  kernel/                  Kernel Lab (index.html + kernel.js)
  youtube/                 YouTube Test (index.html + youtube.js)
  kernel/hostlink.js       host side of ConMon's packages (ps2, solMeteo, doom, doomy)
  ps2/                     PS2 page: Play! emulator (emu/) and games (games/)
  kernels/                 bundled images: conmon.bin, hello-floppy.img
  meteo/                   countries GeoJSON + cities.json for solMeteo (public domain)
  doom/                    doom.wasm (DOOM engine + shareware WAD, GPL-2.0)
  doomy/                   doomy.py, the Python game (also runs in a terminal)
  guests/                  bundled OS images, with their licences (SOURCES.txt)
  v86/                     emulator (libv86.js, v86.wasm) + SeaBIOS/VGA BIOS
netlify/functions/
  youtube.mjs              /api/youtube proxy that adds YOUTUBE_API_KEY
os/                        ConMon source (C, C++, NASM) - see os/README.md
ext/                       ConMon extensions: a small libc and DOOM (make -> site/doom/ndoom.cmx)
tools/                     doom.bas (MikeOS DOOM launcher), fat12_add.py,
                           linux/ (configs, root files and build.sh for linux.bzimage),
                           linux/desktop/ (the same for linux-desktop.bzimage)
preview/                   builds the offline preview (python3 preview/build.py)
netlify.toml
```

## Run it on your PC (from the zip)

Don't open the HTML files straight from the folder: browsers block the
emulator and downloads on `file://` pages (the page now says
so instead of breaking). Use the launcher instead:

- **Windows:** double-click `Start ConMon Lab (Windows).bat`. It starts a
  small local web server (PowerShell, nothing to install) and opens
  `http://localhost:8080/kernel/`. Keep its window open; close it to stop.
- **Mac / Linux:** `sh start-mac-linux.sh` (needs python3).

Everything except the YouTube app's server-side key and the PS2 emulator
(it needs the cross-origin isolation headers Netlify adds) works this way.

## Deploy on Netlify (from GitHub)

1. Push this folder to a GitHub repository.
2. In Netlify: **Add new site → Import an existing project → GitHub**, pick the repo.
   The settings come from `netlify.toml` (publish `site`, functions in
   `netlify/functions`); there is no build command.
3. Add your key: **Site configuration → Environment variables →**
   `YOUTUBE_API_KEY` = your key. Then **Deploys → Trigger deploy**.

Kernel Lab needs no configuration. Netlify Drop (drag-and-drop) publishes only
the static files, so the YouTube function isn't deployed that way; the YouTube
app then lets you paste a key that is stored in your browser instead.

### Getting a YouTube API key

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable **YouTube Data API v3**.
2. **APIs & Services → Credentials → Create credentials → API key.**
3. Restrict the key to the YouTube Data API v3. Since the Netlify Function calls
   Google from the server, don't add an HTTP-referrer restriction for that use.

Quota: by default `search.list` gets its own small daily allowance (100
calls), while trending and video-detail calls cost 1 unit each from the
10,000-unit pool. **Trending now** is the cheapest way to test.

## Run locally

```sh
npm install -g netlify-cli
YOUTUBE_API_KEY=your_key netlify dev      # site + function on http://localhost:8888
```

Any static server works for Kernel Lab alone (`python3 -m http.server -d site`).

## Rebuild ConMon

```sh
cd os
make               # needs nasm + gcc/g++ with 32-bit support (gcc-multilib)
make test          # host-side tests
make samples       # rebuilds samples/hello-floppy.img
cp conmon.bin ../site/kernels/conmon.bin
```

## Rebuild native DOOM

```sh
cd ext && make     # -> site/doom/ndoom.cmx (needs gcc with -m32)
```

An extension (`.cmx`) is a flat 32-bit program linked at 20 MiB with a
small header and CRC-32 (`os/include/conmon_ext.h`). For `native doom` the
page writes it and the shareware WAD straight into the emulated PC's memory,
then ConMon checks it, switches to VBE graphics and calls it with an API
table (timer, raw keyboard, graphics, memory). The WAD comes out of
doom.wasm, checked by its SHA-1. It needs 48 MB of RAM or more.

## Rebuild the bundled Linux

```sh
sh tools/linux/build.sh     # clones Linux 6.6, BusyBox 1.36.1 and musl 1.2.5 from GitHub
```

It needs gcc with `-m32`, make, flex, bison, bc, perl, xz and git, takes a
few minutes, and writes `site/guests/linux.bzimage`. Then
`sh tools/linux/desktop/build.sh` builds `linux-desktop.bzimage`: it adds
Nano-X from github.com/ghaerr/microwindows with a small patch
(`nanox-conmon.patch`: evdev mouse and keyboard input, the desktop menu) and
a kernel with the bochs DRM framebuffer and the VMware absolute mouse. Inside the Linux shell,
`doom` sends the same serial message as MikeOS's DOOM.BAS and the page opens
DOOM in a window.

## doomy on your PC

`site/doomy/doomy.py` needs only Python 3 (no packages). In a terminal with
colour support (Windows Terminal is fine on a Lenovo or any Windows PC):

```sh
python doomy.py
```

Arrows or WASD move, Q/E strafe, Space fires, Enter starts, Esc quits.

## PS2 games (install ps2)

`install ps2` lists the games, each with a letter; `run game A` opens it. A
PS2 can't run on ConMon's emulated 486, so ConMon Lab opens **Play!**, the
open-source PS2 emulator by Jean-Philip Desjardins, compiled to WebAssembly
(`site/ps2/emu/`, built by `.github/workflows/ps2-emulator.yml`), in a new
tab next to it.

- **A: Quake II** — glampert's fan-made PS2 port of id Software's Quake II
  ([glampert/quake2-for-ps2](https://github.com/glampert/quake2-for-ps2),
  GPL-2.0), built with the free ps2dev SDK (`site/ps2/games/quake2.elf`).
  It plays the free **Quake II demo** (3 levels, `site/ps2/games/quake2/baseq2/pak0.pak`,
  50 MB, id Software's freely distributable demo data, taken from
  [drags/docker-quake2](https://github.com/drags/docker-quake2)). For the
  whole game, pick `baseq2/pak0.pak` (about 175 MB) from your own copy of
  Quake II (Steam or GOG) on the game's page; it is kept in this browser's
  private storage and used instead of the demo.

PS2 emulation is heavy: a recent PC runs it best; phones are slow. Controls:
arrows (D-pad), T F G H (left stick), I J K L (look), Z (X / fire), X
(circle), A (square), S (triangle), Enter (Start), Backspace (Select), 1 2 / 8 9
(L1 L2 / R1 R2).

## iPhone kernel info (apple) and Android (android)

- **apple**: the ConMon XNU iPhone app ([apple/](apple/)) reads the phone's own
  XNU kernel (version, Darwin release, chip, cores, memory, boot time) with
  `uname()` and `sysctl`. Its **Show in ConMon Lab** button opens Kernel Lab
  with the info, and the `apple` command prints it. GitHub Actions builds the
  app (Actions → *iOS app (ConMon XNU)*); install it with Sideloadly. Steps in
  [apple/README.md](apple/README.md).
- **android**: real Android 12 (Redroid) on your own ARM server, streamed to
  the browser with ws-scrcpy behind HTTPS and a password. One-paste setup in
  [android-server/README.md](android-server/README.md); then **Android (your
  server)** in the bundled list, or the `android` command in ConMon.

## Credits and licences

- v86 by Fabian Hemmer and contributors, BSD-2-Clause (`site/v86/LICENSE-v86.txt`).
  Built from commit in `site/v86/VERSION.txt`.
- SeaBIOS and VGA BIOS, LGPL-3.0 (`site/v86/LICENSE-seabios-LGPL.txt`).
- World map: countries GeoJSON from johan/world.geo.json, public domain
  (`site/meteo/LICENSE-countries-geojson.txt`), derived from Natural Earth.
- Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0, free
  for non-commercial use); place search based on GeoNames.
- Cities: Natural Earth populated places, public domain (`site/meteo/LICENSE-natural-earth.txt`).
- Linux kernel (GPL-2.0), BusyBox (GPL-2.0) and musl (MIT) in
  `site/guests/linux.bzimage` and `linux-desktop.bzimage`; sources and build
  recipes in `tools/linux/`.
- Nano-X / Microwindows by Greg Haerr and contributors (MPL-1.1, or GPL-2.0),
  in `linux-desktop.bzimage` (`site/guests/LICENSE-nanox.txt`).
- Bundled systems: MikeOS (BSD-3-Clause), Tetros (MIT), bootBASIC and bootOS
  by Oscar Toledo G. (BSD-2-Clause), SectorLISP (ISC). See `site/guests/`.
  The MikeOS floppy adds DOOM.BAS (`tools/doom.bas`).
- DOOM: doom.wasm from jacobenget/doom.wasm, a WebAssembly port of id
  Software's DOOM source, GPL-2.0, with the freely distributable shareware
  DOOM1.WAD inside (`site/doom/`). DOOM is a trademark of id Software.
- Native DOOM: doomgeneric by ozkl (GPL-2.0, `ext/doom/doomgeneric/`),
  built into `site/doom/ndoom.cmx` with ConMon Lab's platform layer and libc.
- Pyodide (MPL-2.0), loaded from the jsDelivr CDN when you `install doomy`.
  doomy itself is ConMon Lab's own code (MIT).
- Play! PS2 emulator by Jean-Philip Desjardins and contributors, BSD-2-Clause
  (`site/ps2/emu/LICENSE-Play.txt`), commit in `tools/ps2/PLAY_COMMIT`.
- Quake II for the PS2 by Guilherme R. Lampert, on id Software's Quake II
  source, GPL-2.0 (`site/ps2/games/`). Quake II is a trademark of id Software.
  The bundled data is the freely distributable Quake II demo (© id Software);
  the full game's data is not included.
- YouTube is a trademark of Google LLC. This project isn't affiliated with YouTube.
