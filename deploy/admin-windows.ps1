# Opens the bot's admin page (settings, updates) from a Windows PC: an SSH tunnel to the Linux
# machine, then the page in the browser. The page is never reachable from the Internet.
#   powershell -ExecutionPolicy Bypass -File deploy\admin-windows.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Test-Path .edch-install)) { Write-Host "Not installed from this PC yet: deploy\install-windows.ps1" -ForegroundColor Red; exit 1 }
$values = @{}
foreach ($line in Get-Content .edch-install) { if ($line -match '^([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] } }
if ($values.MODE -ne "server") { Write-Host "The admin page is for a bot on a Linux machine; on Cloudflare, use deploy\update-windows.ps1." -ForegroundColor Red; exit 1 }
$target = $values.SSH_TARGET
$port = $values.SSH_PORT
$localPort = 18788

$token = (ssh -p $port $target "grep -E '^ADMIN_TOKEN=' ~/edch-discord/bot.env | cut -d= -f2-") -join ""
if (-not $token) { Write-Host "No admin page on ${target}: run the install script again." -ForegroundColor Red; exit 1 }
# In its own window: SSH may ask for the password there. Closing it closes the connection.
Write-Host "A window opens for the SSH connection (type the password there if SSH asks for it)."
$tunnel = Start-Process ssh -ArgumentList @("-N", "-p", $port, "-L", "${localPort}:127.0.0.1:8788", $target) -PassThru
try {
  # Until the tunnel answers (or 60 seconds).
  for ($i = 0; $i -lt 60; $i++) {
    try { $null = Invoke-WebRequest "http://127.0.0.1:$localPort/" -UseBasicParsing -TimeoutSec 2; break }
    catch { if ($_.Exception.Response) { break } else { Start-Sleep -Seconds 1 } }
  }
  Start-Process "http://127.0.0.1:$localPort/?t=$token"
  Read-Host "The admin page is open. Press Enter here to close the connection"
}
finally {
  Stop-Process -Id $tunnel.Id -ErrorAction SilentlyContinue
}
