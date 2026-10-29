#!/usr/bin/env python3
"""Builds the GitHub Pages copy of ConMon Lab.

GitHub Pages serves a project at /<repo>/, not at /, so every root path the
site uses ("/kernel/", "/v86/v86.wasm", ...) gets that prefix. Everything else
is copied as it is. Usage: build.py <site dir> <out dir> <prefix, e.g. /My-Repo>
"""
import re, shutil, sys
from pathlib import Path

DIRS = "kernel|kernels|v86|guests|doom|doomy|meteo|ps2|youtube|assets"
ROOT_PATH = re.compile(r'(["\'`(=])/(' + DIRS + r')(?=[/"\'`?#)])')
HOME = re.compile(r'href="/"')

def main():
    site, out, prefix = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3].rstrip("/")
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(site, out)
    changed = 0
    for f in out.rglob("*"):
        if f.suffix not in (".html", ".js", ".css") or f.parent.name == "emu":
            continue
        text = f.read_text(encoding="utf-8")
        new = ROOT_PATH.sub(lambda m: m.group(1) + prefix + "/" + m.group(2), text)
        new = HOME.sub(f'href="{prefix}/"', new)
        if new != text:
            f.write_text(new, encoding="utf-8")
            changed += 1
    (out / ".nojekyll").write_text("")      # serve every file as it is
    print(f"GitHub Pages copy in {out}: {changed} files given the {prefix} prefix")

main()
