# The EDCH bot's setup from a Windows PC: installs what the setup needs, then opens the setup page
# in the browser (deploy\setup.mjs), where everything else happens: install or update on
# Cloudflare or on a Linux machine over SSH, and that machine's admin page.
#   powershell -ExecutionPolicy Bypass -File deploy\setup-windows.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Fail($text) { Write-Host "`nError: $text" -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js 20 or newer is needed (https://nodejs.org)." }
if ([int](node -p "process.versions.node.split('.')[0]") -lt 20) { Fail "Node.js 20 or newer is needed." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "Git is needed (https://git-scm.com)." }

Write-Host "`n==> The setup's tools (npm install, a minute the first time)" -ForegroundColor Yellow
npm install --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
node deploy\setup.mjs
