# ConMon Lab

A Netlify site with two apps:

- **Kernel Lab** (`/kernel/`): boots **ConMon**, a tiny x86 OS written in C and
  C++, inside the [v86](https://github.com/copy/v86) emulator in your browser.
  You can also load your own Multiboot kernel, floppy image, ISO or disk image.
  Inside ConMon, `install mp4` and `install llm` add a text-mode video player
  and an AI chat: the page decodes video and runs WebLLM models on your GPU,
  and streams the results into ConMon over its serial port.
- **YouTube Test** (`/youtube/`): search, trending, video stats and an embedded
  player through the **YouTube Data API v3**, with a request log for testing.
  The API key stays on the server inside a Netlify Function.

```
site/                      static site Netlify publishes
  index.html               landing page
  kernel/                  Kernel Lab (index.html + kernel.js)
  youtube/                 YouTube Test (index.html + youtube.js)
  kernel/hostlink.js       host side of ConMon's packages (MP4, WebLLM)
  kernels/                 bundled images: conmon.bin, hello-floppy.img
  videos/                  the 4 ConMon explainer videos (used by install mp4)
  v86/                     emulator (libv86.js, v86.wasm) + SeaBIOS/VGA BIOS
netlify/functions/
  youtube.mjs              /api/youtube proxy that adds YOUTUBE_API_KEY
os/                        ConMon source (C, C++, NASM) - see os/README.md
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

## AI models (install llm)

Models come from WebLLM's catalogue and download from Hugging Face the first
time (0.4 to 3.5 GB), then stay cached in the browser. They need WebGPU:
Chrome or Edge on a computer works best. The list only shows models whose
size and GPU features fit the device.

## Credits and licences

- v86 by Fabian Hemmer and contributors, BSD-2-Clause (`site/v86/LICENSE-v86.txt`).
  Built from commit in `site/v86/VERSION.txt`.
- SeaBIOS and VGA BIOS, LGPL-3.0 (`site/v86/LICENSE-seabios-LGPL.txt`).
- WebLLM by the MLC team, Apache-2.0, loaded from the esm.run CDN at runtime.
- YouTube is a trademark of Google LLC. This project isn't affiliated with YouTube.
