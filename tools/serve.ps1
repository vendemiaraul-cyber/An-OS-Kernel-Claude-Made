# ConMon Lab - a tiny local web server for Windows (no installs needed).
# Browsers block emulators and downloads on pages opened straight from a
# folder (file://), so this serves the site at http://localhost:8080.
# Start it with "Start ConMon Lab (Windows).bat"; close the window to stop.
param([int]$Port = 8080)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\site")).Path
$types = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"; ".mjs" = "text/javascript; charset=utf-8"
  ".css" = "text/css; charset=utf-8"; ".json" = "application/json"; ".wasm" = "application/wasm"
  ".svg" = "image/svg+xml"; ".png" = "image/png"; ".jpg" = "image/jpeg"; ".ico" = "image/x-icon"
  ".txt" = "text/plain; charset=utf-8"; ".py" = "text/plain; charset=utf-8"; ".mp4" = "video/mp4"
}
$listener = $null
foreach ($p in $Port..($Port + 10)) {
  try {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$p/")
    $listener.Start()
    $Port = $p
    break
  } catch { $listener = $null }
}
if (-not $listener) { Write-Host "Couldn't open a port between $Port and $($Port + 10)."; Read-Host "Press Enter to close"; exit 1 }
$url = "http://localhost:$Port/kernel/"
Write-Host ""
Write-Host "  ConMon Lab is running at $url"
Write-Host "  Keep this window open while you use it. Close it to stop."
Write-Host "  (For Ollama, set OLLAMA_ORIGINS=http://localhost:$Port)"
Write-Host ""
Start-Process $url
while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path.StartsWith("/api/")) {
      $res.StatusCode = 501
      $msg = [Text.Encoding]::UTF8.GetBytes('{"error":"The YouTube API proxy needs Netlify. Paste a key in the YouTube app instead."}')
      $res.ContentType = "application/json"; $res.OutputStream.Write($msg, 0, $msg.Length)
    } else {
      $file = Join-Path $root ($path.TrimStart("/") -replace "/", "\")
      $full = [IO.Path]::GetFullPath($file)
      if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { $res.StatusCode = 403 }
      else {
        if (Test-Path $full -PathType Container) { $full = Join-Path $full "index.html" }
        if (Test-Path $full -PathType Leaf) {
          $ext = [IO.Path]::GetExtension($full).ToLower()
          $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" }
          $res.AddHeader("Cache-Control", "no-cache")
          $bytes = [IO.File]::ReadAllBytes($full)
          $res.ContentLength64 = $bytes.Length
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else { $res.StatusCode = 404 }
      }
    }
  } catch { try { $res.StatusCode = 500 } catch {} }
  try { $res.OutputStream.Close() } catch {}
}
