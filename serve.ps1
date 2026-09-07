# Static HTTP server for local development.
# Usage:   powershell -ExecutionPolicy Bypass -File .\serve.ps1
# Custom port: ...\serve.ps1 -Port 9000
# Then open http://localhost:8080  (Ctrl+C to stop)
#
# NOTE: Port 8000 is reserved by Windows (netsh excluded range) on many machines
# and Start() will throw. Default here is 8080.

param(
  [int]$Port = 8080,
  [string]$Root = $PSScriptRoot
)

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "-> Serving $Root"
Write-Host "-> Open http://localhost:$Port/"

# Print LAN IP for testing PWA / offline from phone.
# localhost is treated as dev by app.js and will NOT register the Service Worker.
if (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue) {
  $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { ($_.PrefixOrigin -eq 'Dhcp' -or $_.PrefixOrigin -eq 'Manual') -and $_.IPAddress -notlike '127.*' })
  foreach ($ip in $ips) { Write-Host "-> LAN:  http://$($ip.IPAddress):$Port/  (phone / PWA / offline)" }
}

Write-Host "-> Press Ctrl+C to stop"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".htm"  = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".mjs"  = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".woff2"= "font/woff2"
  ".ico"  = "image/x-icon"
  ".txt"  = "text/plain; charset=utf-8"
  ".md"   = "text/markdown; charset=utf-8"
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($rel -eq "/") { $rel = "/index.html" }
      $path = Join-Path $Root ($rel.TrimStart("/"))
      if (Test-Path $path -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($path).ToLower()
        $ct = $mime[$ext]; if (-not $ct) { $ct = "application/octet-stream" }
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $res.ContentType = $ct
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
        $msg = [System.Text.Encoding]::UTF8.GetBytes("404 not found: $rel")
        $res.ContentType = "text/plain; charset=utf-8"
        $res.ContentLength64 = $msg.Length
        $res.OutputStream.Write($msg, 0, $msg.Length)
      }
    } catch {
      try {
        $res.StatusCode = 500
        $msg = [System.Text.Encoding]::UTF8.GetBytes("500 $($_.Exception.Message)")
        $res.ContentType = "text/plain; charset=utf-8"
        $res.ContentLength64 = $msg.Length
        $res.OutputStream.Write($msg, 0, $msg.Length)
      } catch {
        # give up
      }
    } finally {
      $res.OutputStream.Close()
    }
    Write-Host "$($req.HttpMethod) $($req.Url.AbsolutePath) -> $($res.StatusCode)"
  }
} finally {
  $listener.Stop()
}
