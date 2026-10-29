# ConMon Lab

A Netlify site with two apps:

- **Kernel Lab** (`/kernel/`): boots **ConMon**, a tiny x86 OS written in C and
  C++, inside the [v86](https://github.com/copy/v86) emulator in your browser.
  You can also load your own Multiboot kernel, floppy image, ISO or disk image.
  Inside ConMon, `install llm` adds an AI chat (SmartestChild, Transformers.js,
  WebLLM or Ollama) plus `mp finder` for model facts, and `install solMeteo`
  adds live weather from Open-Meteo for any place (2,582 cities built in, for
  offline use and `cities Italy`-style browsing) with an animated ASCII world map.
  `install doom` plays the real DOOM (shareware Episode 1) on ConMon's text
  screen; `install doomy` plays doomy, a small DOOM-style game written in
  Python, run in the browser by Pyodide. `install native doom` adds
  `native doom`: DOOM compiled for ConMon and run by ConMon's own CPU at
  320×200 in 256 colours, as a ConMon *extension* (see `ext/`). The page does the work and streams
  the results into ConMon over its serial port.
  The **Bundled kernels** list also boots a real **Linux 6.6** kernel with a
  BusyBox shell (one 1.5 MB bzImage), MikeOS, Tetros, bootBASIC, bootOS and
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
  kernel/hostlink.js       host side of ConMon's packages (llm, solMeteo, doom, doomy)
  kernel/smartestchild.js  the built-in SmartestChild chatbot
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
                           linux/ (configs, root files and build.sh for linux.bzimage)
preview/                   builds the offline preview (python3 preview/build.py)
netlify.toml
```

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
few minutes, and writes `site/guests/linux.bzimage`. Inside the Linux shell,
`doom` sends the same serial message as MikeOS's DOOM.BAS and the page opens
DOOM in a window.

## doomy on your PC

`site/doomy/doomy.py` needs only Python 3 (no packages). In a terminal with
colour support (Windows Terminal is fine on a Lenovo or any Windows PC):

```sh
python doomy.py
```

Arrows or WASD move, Q/E strafe, Space fires, Enter starts, Esc quits.

## AI models (install llm)

Models come from WebLLM's catalogue and download from Hugging Face the first
time (0.4 to 3.5 GB), then stay cached in the browser. They need WebGPU:
Chrome or Edge on a computer works best. The list only shows models whose
size and GPU features fit the device.

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
  `site/guests/linux.bzimage`; sources and build recipe in `tools/linux/`.
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
- WebLLM by the MLC team, Apache-2.0, loaded from the esm.run CDN at runtime.
- YouTube is a trademark of Google LLC. This project isn't affiliated with YouTube.
