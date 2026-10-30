"""doomy - a tiny DOOM-style shooter in pure Python.

Made for ConMon Lab. In the browser it runs inside Pyodide and draws on
ConMon's 80x25 text screen (each text cell shows two "pixels", so the screen
is 80x50). On your own computer it runs in a terminal:

    python doomy.py

Controls
    Arrows or W/A/S/D   move and turn      Q / E   strafe left / right
    Space or F          fire               Shift   run (browser)
    Enter               start / continue   Esc     quit (terminal)

No libraries needed: the renderer, maps, enemies and HUD are all below.
Licence: MIT, (c) ConMon Lab.
"""

import math
import random
import sys

W, H = 80, 50                    # framebuffer in "pixels" (two per text cell)
VIEW_H = 42                      # 3D view height; the HUD uses the rest
FOV = math.radians(66)

# 16-colour palette (r, g, b), sent to ConMon or used for the terminal.
PALETTE = [
    (0, 0, 0),        # 0 black
    (24, 24, 34),     # 1 ceiling far
    (46, 46, 60),     # 2 ceiling near
    (52, 38, 26),     # 3 floor far
    (92, 68, 42),     # 4 floor near
    (110, 28, 26),    # 5 red wall dark
    (186, 52, 40),    # 6 red wall
    (36, 64, 118),    # 7 blue wall dark
    (70, 112, 192),   # 8 blue wall
    (52, 96, 44),     # 9 green wall dark
    (98, 158, 78),    # 10 green wall
    (128, 128, 132),  # 11 stone
    (225, 225, 215),  # 12 white
    (255, 208, 60),   # 13 yellow
    (232, 30, 30),    # 14 bright red
    (255, 140, 20),   # 15 orange
]
BLACK, CEIL_FAR, CEIL, FLOOR_FAR, FLOOR, STONE, WHITE, YELLOW, RED, ORANGE = 0, 1, 2, 3, 4, 11, 12, 13, 14, 15
WALL_COLOURS = {"#": (5, 6), "B": (7, 8), "G": (9, 10), "S": (STONE, STONE), "X": (YELLOW, YELLOW)}

LEVELS = [
    [
        "################",
        "#P....#........#",
        "#.....#..E.....#",
        "#..A..#....H...#",
        "#.....###B##...#",
        "#..............#",
        "###.####...E...#",
        "#......#.......#",
        "#..E...#...BB..#",
        "#......G.......#",
        "#..H...G..A..E.#",
        "#......G.......X",
        "################",
    ],
    [
        "BBBBBBBBBBBBBBBBBB",
        "BP...B.....E.....B",
        "B....B..........AB",
        "B..E.B..SSSSSS...B",
        "B....B..S....S...B",
        "B.......S.HE.S...B",
        "BBB.BBBBS....S..EB",
        "B.......SS.SSS...B",
        "B..A..E..........B",
        "B.....BBBBBB.....B",
        "B..E..B....B..E..B",
        "B.....B.H..B.....X",
        "BBBBBBBBBBBBBBBBBB",
    ],
    [
        "GGGGGGGGGGGGGGGGGGGG",
        "GP.....G.....E.....G",
        "G......G...........G",
        "G..E...G..#####..A.G",
        "G......G..#...#....G",
        "G.A....G..#.E.#..E.G",
        "GGG.GGGG..##.##....G",
        "G..........E.......G",
        "G..H..SSSSSS...E...G",
        "G.....S....S.......G",
        "G..E..S.HE.S..H..E.G",
        "G.....S....S.......X",
        "GGGGGGGGGGGGGGGGGGGG",
    ],
]

# 3x5 pixel font for the HUD and messages.
FONT = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
    "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001001001001",
    "8": "111101111101111", "9": "111101111001111", "A": "010101111101101", "B": "110101110101110",
    "C": "011100100100011", "D": "110101101101110", "E": "111100110100111", "G": "011100101101011",
    "H": "101101111101101", "I": "111010010010111", "K": "101101110101101", "L": "100100100100111",
    "M": "101111111101101", "N": "110101101101101", "O": "010101101101010", "P": "110101110100100",
    "R": "110101110101101", "S": "011100010001110", "T": "111010010010010", "U": "101101101101111",
    "V": "101101101101010", "W": "101101111111101", "Y": "101101010010010", " ": "000000000000000",
    "!": "010010010000010", ":": "000010000010000", "-": "000000111000000", "/": "001001010100100",
}

# Sprite art: one character per pixel, "." is transparent.
IMP = [
    "..rrr..",
    ".rwrwr.",
    ".rrrrr.",
    "rr.r.rr",
    "r.rrr.r",
    "..r.r..",
    ".rr.rr.",
]
IMP_HURT = [row.replace("r", "o") for row in IMP]
MEDKIT = ["wwwww", "ww.ww", "w...w", "ww.ww", "wwwww"]
AMMO = [".yyy.", "yyyyy", "yoooy", "yyyyy"]
ART_COLOURS = {"r": RED, "w": WHITE, "o": ORANGE, "y": YELLOW}


class Thing:
    def __init__(self, kind, x, y):
        self.kind, self.x, self.y = kind, x, y
        self.hp = 3 if kind == "E" else 0
        self.alive = True
        self.hurt = 0.0
        self.cooldown = 0.0


class Doomy:
    """The whole game. Call key(name, down) and step(dt) -> bytes(W*H)."""

    KEYS = ("up", "down", "left", "right", "strafe_l", "strafe_r", "fire", "run", "enter", "use")

    def __init__(self, seed=None):
        self.rng = random.Random(seed)
        self.held = {k: False for k in self.KEYS}
        self.fb = bytearray(W * H)
        self.level = 0
        self.mode = "title"          # title, play, dead, next, won
        self.message_time = 0.0
        self.total_kills = 0
        self.time = 0.0
        self.start_level(0, fresh=True)

    # -------------------------------------------------------------- setup
    def start_level(self, n, fresh=False):
        self.level = n
        self.map = [list(row) for row in LEVELS[n]]
        self.things = []
        for y, row in enumerate(self.map):
            for x, c in enumerate(row):
                if c == "P":
                    self.px, self.py = x + 0.5, y + 0.5
                    self.map[y][x] = "."
                elif c in "EHA":
                    self.things.append(Thing(c, x + 0.5, y + 0.5))
                    self.map[y][x] = "."
        self.angle = 0.0
        if fresh:
            self.hp, self.ammo, self.kills = 100, 24, 0
        self.flash = 0.0
        self.gun_cool = 0.0
        self.damage_flash = 0.0

    # --------------------------------------------------------------- input
    def key(self, name, down):
        if name in self.held:
            if down and not self.held[name]:
                self.pressed(name)
            self.held[name] = bool(down)

    def pressed(self, name):
        if name in ("enter", "fire", "use") and self.mode in ("title", "dead", "won", "next"):
            if self.mode == "dead":
                self.start_level(self.level, fresh=True)
            elif self.mode == "won":
                self.total_kills = 0
                self.start_level(0, fresh=True)
            self.mode = "play"
            self.held["fire"] = False

    # ---------------------------------------------------------------- world
    def wall(self, x, y):
        if y < 0 or y >= len(self.map) or x < 0 or x >= len(self.map[0]):
            return "#"
        c = self.map[int(y)][int(x)]
        return None if c == "." else c

    def try_move(self, dx, dy):
        r = 0.22
        nx = self.px + dx
        if not self.wall(nx + (r if dx > 0 else -r), self.py):
            self.px = nx
        ny = self.py + dy
        if not self.wall(self.px, ny + (r if dy > 0 else -r)):
            self.py = ny

    def line_of_sight(self, x0, y0, x1, y1):
        steps = int(math.hypot(x1 - x0, y1 - y0) * 4) + 1
        for i in range(1, steps):
            t = i / steps
            if self.wall(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t):
                return False
        return True

    # ---------------------------------------------------------------- update
    def step(self, dt):
        dt = max(0.0, min(dt, 0.1))
        self.time += dt
        if self.mode == "play":
            self.update(dt)
        self.render()
        return bytes(self.fb)

    def update(self, dt):
        held = self.held
        speed = (3.0 if held["run"] else 1.9) * dt
        turn = 2.4 * dt
        if held["left"]:
            self.angle -= turn
        if held["right"]:
            self.angle += turn
        ca, sa = math.cos(self.angle), math.sin(self.angle)
        if held["up"]:
            self.try_move(ca * speed, sa * speed)
        if held["down"]:
            self.try_move(-ca * speed, -sa * speed)
        if held["strafe_l"]:
            self.try_move(sa * speed, -ca * speed)
        if held["strafe_r"]:
            self.try_move(-sa * speed, ca * speed)

        self.gun_cool = max(0.0, self.gun_cool - dt)
        self.flash = max(0.0, self.flash - dt)
        self.damage_flash = max(0.0, self.damage_flash - dt)
        if held["fire"] and self.gun_cool == 0 and self.ammo > 0:
            self.shoot()

        for t in self.things:
            if not t.alive:
                continue
            d = math.hypot(t.x - self.px, t.y - self.py)
            if t.kind == "E":
                t.hurt = max(0.0, t.hurt - dt)
                t.cooldown = max(0.0, t.cooldown - dt)
                if d < 8 and self.line_of_sight(t.x, t.y, self.px, self.py):
                    if d > 0.9:
                        mx, my = (self.px - t.x) / d * 1.1 * dt, (self.py - t.y) / d * 1.1 * dt
                        if not self.wall(t.x + mx, t.y):
                            t.x += mx
                        if not self.wall(t.x, t.y + my):
                            t.y += my
                    elif t.cooldown == 0:
                        self.hp -= self.rng.randint(6, 12)
                        self.damage_flash = 0.25
                        t.cooldown = 0.8
            elif d < 0.6:
                if t.kind == "H" and self.hp < 100:
                    self.hp = min(100, self.hp + 25)
                    t.alive = False
                elif t.kind == "A":
                    self.ammo += 12
                    t.alive = False

        if self.hp <= 0:
            self.hp = 0
            self.mode = "dead"
        if self.wall(self.px + math.cos(self.angle) * 0.6, self.py + math.sin(self.angle) * 0.6) == "X":
            if self.level + 1 < len(LEVELS):
                self.start_level(self.level + 1)
                self.mode = "next"
            else:
                self.mode = "won"

    def shoot(self):
        self.ammo -= 1
        self.gun_cool = 0.35
        self.flash = 0.12
        best, best_d = None, 99.0
        for t in self.things:
            if t.kind != "E" or not t.alive:
                continue
            dx, dy = t.x - self.px, t.y - self.py
            d = math.hypot(dx, dy)
            ang = math.atan2(dy, dx) - self.angle
            ang = (ang + math.pi) % (2 * math.pi) - math.pi
            if abs(ang) < math.atan2(0.35, d) + 0.03 and d < best_d and self.line_of_sight(self.px, self.py, t.x, t.y):
                best, best_d = t, d
        if best:
            best.hp -= 1
            best.hurt = 0.2
            if best.hp <= 0:
                best.alive = False
                self.kills += 1
                self.total_kills += 1

    # ---------------------------------------------------------------- render
    def render(self):
        fb = self.fb
        horizon = VIEW_H // 2
        for y in range(VIEW_H):
            if y < horizon:
                c = CEIL_FAR if y > horizon - 6 else CEIL
            else:
                c = FLOOR_FAR if y < horizon + 6 else FLOOR
            fb[y * W:(y + 1) * W] = bytes([c]) * W

        zbuf = [0.0] * W
        ca, sa = math.cos(self.angle), math.sin(self.angle)
        plane = math.tan(FOV / 2)
        for x in range(W):
            cam = 2 * x / W - 1
            rx, ry = ca - sa * plane * cam, sa + ca * plane * cam
            mx, my = int(self.px), int(self.py)
            ddx = abs(1 / rx) if rx else 1e30
            ddy = abs(1 / ry) if ry else 1e30
            if rx < 0:
                stx, sdx = -1, (self.px - mx) * ddx
            else:
                stx, sdx = 1, (mx + 1 - self.px) * ddx
            if ry < 0:
                sty, sdy = -1, (self.py - my) * ddy
            else:
                sty, sdy = 1, (my + 1 - self.py) * ddy
            side, cell = 0, "#"
            for _ in range(64):
                if sdx < sdy:
                    sdx += ddx; mx += stx; side = 0
                else:
                    sdy += ddy; my += sty; side = 1
                cell = self.wall(mx, my)
                if cell:
                    break
            dist = (sdx - ddx) if side == 0 else (sdy - ddy)
            dist = max(dist, 0.05)
            zbuf[x] = dist
            h = int(VIEW_H / dist)
            top = max(0, horizon - h // 2)
            bot = min(VIEW_H, horizon + h // 2)
            dark, bright = WALL_COLOURS.get(cell, (STONE, STONE))
            col = dark if side == 1 else bright
            for y in range(top, bot):
                # far walls: checker in the dark shade, then fully dark
                c = col
                if dist > 6 or (dist > 4 and (x + y) & 1):
                    c = dark
                if dist > 9 and (x + y) & 1:
                    c = BLACK
                fb[y * W + x] = c

        # sprites, far to near
        order = []
        for t in self.things:
            if t.alive:
                d = math.hypot(t.x - self.px, t.y - self.py)
                order.append((d, t))
        order.sort(key=lambda p: -p[0])
        inv = 1.0 / (plane * plane + 1)
        for d, t in order:
            dx, dy = t.x - self.px, t.y - self.py
            # transform into camera space
            tx = (sa * dx - ca * dy) * -1
            tz = ca * dx + sa * dy
            if tz <= 0.2:
                continue
            sx = int(W / 2 * (1 + tx / (tz * plane)))
            art = IMP_HURT if (t.kind == "E" and t.hurt > 0) else IMP if t.kind == "E" else MEDKIT if t.kind == "H" else AMMO
            size = int(VIEW_H / tz * (0.8 if t.kind == "E" else 0.4))
            if size < 2:
                continue
            ah, aw = len(art), len(art[0])
            sw = max(2, int(size * aw / ah * 1.4))
            y0 = horizon + int(VIEW_H / tz / 2) - size
            x0 = sx - sw // 2
            for px in range(max(0, x0), min(W, x0 + sw)):
                if zbuf[px] < tz:
                    continue
                ax = (px - x0) * aw // sw
                for py in range(max(0, y0), min(VIEW_H, y0 + size)):
                    ch = art[(py - y0) * ah // size][ax]
                    if ch != ".":
                        fb[py * W + px] = ART_COLOURS[ch]

        self.draw_gun()
        self.draw_hud()
        if self.damage_flash > 0:
            for i in range(0, VIEW_H * W, 3):
                fb[i] = RED
        self.draw_overlay()

    def draw_gun(self):
        fb, cx = self.fb, W // 2
        bob = int(math.sin(self.time * 8) * 1) if any(self.held[k] for k in ("up", "down")) else 0
        for y in range(VIEW_H - 7 + bob, VIEW_H):
            half = 2 if y < VIEW_H - 4 + bob else 4
            for x in range(cx - half, cx + half):
                fb[y * W + x] = STONE
        if self.flash > 0:
            for y in range(VIEW_H - 11, VIEW_H - 7):
                for x in range(cx - 2, cx + 2):
                    fb[y * W + x] = YELLOW if (x + y) & 1 else ORANGE

    def text(self, s, x, y, colour, scale=1):
        for ch in s.upper():
            glyph = FONT.get(ch, FONT[" "])
            for i, bit in enumerate(glyph):
                if bit == "1":
                    gx, gy = i % 3, i // 3
                    for yy in range(scale):
                        for xx in range(scale):
                            px, py = x + gx * scale + xx, y + gy * scale + yy
                            if 0 <= px < W and 0 <= py < H:
                                self.fb[py * W + px] = colour
            x += 4 * scale

    def draw_hud(self):
        fb = self.fb
        fb[VIEW_H * W:] = bytes([BLACK]) * (W * (H - VIEW_H))
        fb[VIEW_H * W:(VIEW_H + 1) * W] = bytes([STONE]) * W
        y = VIEW_H + 2
        self.text("HP", 2, y, WHITE)
        self.text(str(self.hp), 11, y, RED if self.hp < 30 else YELLOW)
        self.text("AM", 26, y, WHITE)
        self.text(str(self.ammo), 35, y, YELLOW)
        self.text("K", 50, y, WHITE)
        self.text(str(self.kills), 55, y, YELLOW)
        self.text("L" + str(self.level + 1), 70, y, WHITE)

    def draw_overlay(self):
        msgs = {
            "title": ("DOOMY", "PRESS ENTER"),
            "dead": ("YOU DIED", "ENTER: TRY AGAIN"),
            "next": ("LEVEL " + str(self.level + 1), "PRESS ENTER"),
            "won": ("YOU WIN!", "KILLS: " + str(self.total_kills)),
        }
        if self.mode not in msgs:
            return
        big, small = msgs[self.mode]
        for y in range(10, 32):
            for x in range(4, W - 4):
                if (x + y) & 1:
                    self.fb[y * W + x] = BLACK
        self.text(big, (W - len(big) * 8) // 2, 13, YELLOW if self.mode != "dead" else RED, scale=2)
        self.text(small, (W - len(small) * 4) // 2, 26, WHITE)


# ------------------------------------------------------------------ terminal

def run_terminal():
    """Plays doomy in a terminal with 24-bit colour half blocks."""
    import os
    import sys
    import time

    windows = os.name == "nt"
    if windows:
        import msvcrt
        os.system("")                              # enable ANSI colours in the Windows console
    else:
        import select
        import termios
        import tty
        fd = sys.stdin.fileno()
        saved = termios.tcgetattr(fd)
        tty.setcbreak(fd)

    # Terminals don't report key releases, so a press "holds" the key briefly.
    HOLD = 0.18
    names = {"w": "up", "s": "down", "a": "left", "d": "right", "q": "strafe_l", "e": "strafe_r",
             " ": "fire", "f": "fire", "\r": "enter", "\n": "enter"}
    arrows = {"H": "up", "P": "down", "K": "left", "M": "right", "A": "up", "B": "down", "D": "left", "C": "right"}

    def read_keys():
        keys = []
        if windows:
            while msvcrt.kbhit():
                c = msvcrt.getwch()
                if c in ("\x00", "\xe0"):
                    keys.append(arrows.get(msvcrt.getwch()))
                elif c == "\x1b":
                    keys.append("quit")
                else:
                    keys.append(names.get(c.lower()))
        else:
            while select.select([sys.stdin], [], [], 0)[0]:
                c = sys.stdin.read(1)
                if c == "\x1b":
                    if select.select([sys.stdin], [], [], 0.01)[0] and sys.stdin.read(1) == "[":
                        keys.append(arrows.get(sys.stdin.read(1)))
                    else:
                        keys.append("quit")
                else:
                    keys.append(names.get(c.lower()))
        return [k for k in keys if k]

    game = Doomy()
    until = {}
    out = sys.stdout
    out.write("\x1b[?25l\x1b[2J")
    last = time.time()
    try:
        while True:
            now = time.time()
            for k in read_keys():
                if k == "quit":
                    return
                until[k] = now + HOLD
            for k in Doomy.KEYS:
                game.key(k, until.get(k, 0) > now)
            fb = game.step(now - last)
            last = now
            lines = ["\x1b[H"]
            for row in range(H // 2):
                parts = []
                for x in range(W):
                    t = PALETTE[fb[row * 2 * W + x]]
                    b = PALETTE[fb[(row * 2 + 1) * W + x]]
                    parts.append(f"\x1b[38;2;{t[0]};{t[1]};{t[2]}m\x1b[48;2;{b[0]};{b[1]};{b[2]}m▀")
                lines.append("".join(parts) + "\x1b[0m\n")
            lines.append("Arrows/WASD move  Q/E strafe  Space fire  Enter start  Esc quit ")
            out.write("".join(lines))
            out.flush()
            time.sleep(max(0, 1 / 20 - (time.time() - now)))
    except KeyboardInterrupt:
        pass
    finally:
        out.write("\x1b[0m\x1b[?25h\n")
        if not windows:
            termios.tcsetattr(fd, termios.TCSADRAIN, saved)


# In the browser (Pyodide) ConMon drives the game instead.
if __name__ == "__main__" and sys.platform != "emscripten":
    run_terminal()
