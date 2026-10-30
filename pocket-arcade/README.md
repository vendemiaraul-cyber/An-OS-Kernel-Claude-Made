# Pocket Arcade

A phone-friendly game site where every game runs in the browser.

## Games and licences

| Game | Engine / source | Licence |
|---|---|---|
| Quake II demo | [Qwasm2](https://github.com/GMH-Code/Qwasm2) (Yamagi Quake II → WebAssembly), build from [quake2-alfonso-x-1999](https://github.com/EmilioNicolas/quake2-alfonso-x-1999) | Engine GPL-2.0 |
| DOOM shareware | Chocolate Doom → WebAssembly, from [freedoom-web](https://github.com/dzod992-bit/freedoom-web) ([source](https://github.com/dzod992-bit/freedoom-web/tree/main/source)) | Engine GPL-2.0 |
| Freedoom: Phase 2 | [Freedoom](https://freedoom.github.io/) | BSD-3-Clause |
| Blockfall | Original to this site | — |
| HexGL | [BKcore/HexGL](https://github.com/BKcore/HexGL) | MIT |
| Hextris | [hextris/hextris](https://github.com/hextris/hextris) | GPL-3.0 |
| 2048 | [gabrielecirulli/2048](https://github.com/gabrielecirulli/2048) | MIT |
| A Dark Room | [doublespeakgames/adarkroom](https://github.com/doublespeakgames/adarkroom) (audio converted to MP3) | MPL-2.0 |
| Clumsy Bird | [ellisonleao/clumsy-bird](https://github.com/ellisonleao/clumsy-bird) | GPL-3.0 |

Each bundled game keeps its own licence file in its folder.

## The `originals` folder

These are id Software's original, unmodified distribution archives, which their shareware and demo licences allow to be copied as-is:

| File | Size | SHA-1 |
|---|---|---|
| `doom19s.zip` (DOOM v1.9 shareware) | 2,450,688 | 8d0fbbbeba5ecb692a99f97e55dfb5365cfe5b77 |
| `q2-314-demo-x86.exe` (Quake II demo) | 39,015,499 | 5b4dedc59ceee306956a3e48a8bdf6dd33bc91ed |

The game data inside them (DOOM1.WAD, pak0.pak) is never stored separately on this site. The player pages download the original archive and unpack it in the visitor's browser (`kit/unzip.js`).

This site is not affiliated with id Software, Bethesda or any listed developer. Game names belong to their owners.
