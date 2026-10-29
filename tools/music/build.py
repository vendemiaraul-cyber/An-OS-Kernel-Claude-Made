"""Builds Sigeon OS Music: site/music/ for ConMon Lab and a single-file preview."""
import base64, os, sys, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "app.html")).read()
logo = "data:image/png;base64," + base64.b64encode(open(os.path.join(HERE, "pigeon.png"), "rb").read()).decode()
src = src.replace("__LOGO__", logo)
head, body = src.split("<!--HEAD-END-->", 1)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "site", "music")
os.makedirs(out, exist_ok=True)
open(os.path.join(HERE, "preview.html"), "w").write(head + body)  # single-file preview (no head wrapper)
page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Sigeon OS Music: a music player for ConMon Lab that keeps your songs in the browser and streams YouTube.">
<meta name="theme-color" content="#120a0f">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Sigeon Music">
{head.strip()}
</head>
<body>
{body.strip()}
</body>
</html>
"""
open(os.path.join(out, "index.html"), "w").write(page)
for f in ("icon-192.png", "icon-512.png", "manifest.webmanifest", "sw.js"):
    shutil.copy(os.path.join(HERE, f), os.path.join(out, f))
print("built", out, len(page) // 1024, "KB")
