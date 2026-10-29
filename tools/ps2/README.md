# PS2 games for ConMon Lab

`install ps2` / `run game <letter>` in ConMon open these on `/ps2/`, where
**Play!** (the open-source PS2 emulator, github.com/jpd002/Play-) runs them,
compiled to WebAssembly.

## The emulator (`site/ps2/emu/`)

Built by `.github/workflows/ps2-emulator.yml` from the Play! commit in
`PLAY_COMMIT` (Emscripten 4.0.1, Play!'s own `wasm-ninja-release` preset).
Change `PLAY_COMMIT` and push to rebuild; the workflow commits the new
`Play.js` and `Play.wasm`. Its threads need SharedArrayBuffer, so `/ps2/*` is
served with COOP/COEP headers (`netlify.toml`).

## A: Quake II (`site/ps2/games/quake2/`)

glampert's PS2 port, github.com/glampert/quake2-for-ps2 (GPL-2.0), commit
d49ead4, built with the prebuilt ps2dev toolchain
(github.com/ps2dev/ps2dev/releases, `ps2dev-ubuntu-latest.tar.gz`) and
`quake2-play.patch`, which lets it load its IOP sound modules through Play!'s
own module loader (Play! has no ROM for the sbv patches):

```
git clone --recursive https://github.com/glampert/quake2-for-ps2 && cd quake2-for-ps2
git apply /path/to/quake2-play.patch
export PS2DEV=~/ps2dev PS2SDK=~/ps2dev/ps2sdk
export PATH=$PS2DEV/bin:$PS2DEV/ee/bin:$PS2DEV/iop/bin:$PS2DEV/dvp/bin:$PS2SDK/bin:$PATH
make release CONFIG_DEFS='-DPS2_QUAKE_DEBUG=0 -DPS2_QUAKE_ASSERTS=0 -DPS2_QUAKE_PROFILE=0 -DNDEBUG -DPS2_QUAKE_PLAY_EMU=1'
cp build/release/quake2.elf ../site/ps2/games/quake2/
```

The game data (`baseq2/pak0.pak`) is the player's own: the page asks for it
once and keeps it in the browser's private storage (OPFS).

## Adding a game

Add an entry to `site/ps2/games.json` (letter, id, name, by, source,
licence, `elf`, optional `files` copied next to it and `needs` for data the
player brings). The ELF is booted from Play!'s `host:` folder.
