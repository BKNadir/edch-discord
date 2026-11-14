# Updates the EDCH bot from a Windows PC, where deploy\install-windows.ps1 installed it: Cloudflare
# (deploy again, with the game's faction list rebuilt) or the Linux machine (over SSH).
#   powershell -ExecutionPolicy Bypass -File deploy\update-windows.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Test-Path .edch-install)) { Write-Host "Not installed from this PC yet: deploy\install-windows.ps1" -ForegroundColor Red; exit 1 }
$values = @{}
foreach ($line in Get-Content .edch-install) { if ($line -match '^([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] } }

Write-Host "`n==> These scripts, up to date" -ForegroundColor Yellow
git pull --ff-only -q
if ($LASTEXITCODE -ne 0) { exit 1 }

if ($values.MODE -eq "cloudflare") {
  npm install --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -eq 0) { npm run update }
}
else {
  ssh -t -p $values.SSH_PORT $values.SSH_TARGET 'bash ~/edch-discord/deploy/server-update.sh'
}
exit $LASTEXITCODE
