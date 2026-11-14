# Installs the EDCH bot from a Windows PC, either on Cloudflare (a free Worker) or on a Linux
# machine reached with SSH (service, HTTPS through DuckDNS and Caddy, admin page, nightly updates).
#   powershell -ExecutionPolicy Bypass -File deploy\install-windows.ps1
# A page opens in the browser for the settings (deploy\setup-page.mjs). The answers without
# secrets are kept in .edch-install for the update and admin scripts; secrets go to Cloudflare or
# to the machine only.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
# Text sent to ssh and wrangler: UTF-8 without BOM (Windows PowerShell 5 would send ASCII).
$OutputEncoding = New-Object System.Text.UTF8Encoding $false

function Say($text) { Write-Host "`n==> $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "`nError: $text" -ForegroundColor Red; exit 1 }
function Need($command, $help) { if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { Fail "$command is needed: $help" } }
# Runs a program and stops when it fails (PowerShell 5 doesn't for programs).
function Run { & $args[0] $args[1..($args.Count - 1)]; if ($LASTEXITCODE -ne 0) { Fail "$($args -join ' ') failed" } }

Need node "install Node.js 20 or newer (https://nodejs.org)"
Need git "install Git for Windows (https://git-scm.com)"
if ([int](node -p "process.versions.node.split('.')[0]") -lt 20) { Fail "Node.js 20 or newer is needed" }

$settings = Join-Path $env:TEMP ("edch-setup-" + [guid]::NewGuid() + ".env")
try {
  Say "Settings (a page opens in your browser)"
  Run node deploy\setup-page.mjs $settings .edch-install
  $values = @{}
  foreach ($line in Get-Content $settings) { if ($line -match '^([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] } }

  # The answers to keep, without any secret.
  function Remember([string[]]$extra) {
    $keys = @("MODE", "DISCORD_APPLICATION_ID", "DISCORD_GUILD_ID") + $extra
    $text = ($keys | ForEach-Object { "$_=$($values[$_])" }) -join "`n"
    [IO.File]::WriteAllText((Join-Path (Get-Location) ".edch-install"), "$text`n")
  }

  if ($values.MODE -eq "cloudflare") {
    Say "Tools (npm install)"
    Run npm install --no-audit --no-fund --loglevel=error
    Say "Cloudflare account"
    $who = (npx wrangler whoami 2>$null) -join "`n"
    if ($who -notmatch "associated with the email") { Run npx wrangler login }
    Remember @()
    # Deployed first: Cloudflare keeps secrets for an existing Worker.
    Say "Deploying"
    Run npm run update
    Say "Secrets, kept by Cloudflare"
    $values.DISCORD_PUBLIC_KEY | npx wrangler secret put DISCORD_PUBLIC_KEY
    $values.DISCORD_BOT_TOKEN | npx wrangler secret put DISCORD_BOT_TOKEN
    # Made once: changing it would cancel every member's key.
    if (((npx wrangler secret list 2>$null) -join "") -notmatch '"LINK_SECRET"') {
      $bytes = New-Object byte[] 32
      [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
      (($bytes | ForEach-Object { $_.ToString("x2") }) -join "") | npx wrangler secret put LINK_SECRET
    }
    Say "Done"
    Write-Host "Developer portal -> General Information -> Interactions Endpoint URL:"
    Write-Host "  the workers.dev address printed above, followed by /interactions"
    Write-Host "(Discord checks it at once; the bot then declares /bgs by itself.)"
  }
  else {
    Need ssh "turn on Windows' OpenSSH client (Settings -> Apps -> Optional features)"
    $target = $values.SSH_TARGET
    $port = $values.SSH_PORT
    Say "The Linux machine ($target)"
    # The settings travel through SSH only, into a file only that user can read; the setup script
    # deletes it once read.
    $send = (Get-Content $settings | Where-Object { $_ -match '^(DISCORD_|DUCKDNS_)' }) -join "`n"
    $send | ssh -p $port $target 'umask 077; tr -d ''\r'' > ~/.edch-setup.env'
    if ($LASTEXITCODE -ne 0) { Fail "SSH to $target failed" }
    Get-Content deploy\server-setup.sh -Raw -Encoding UTF8 | ssh -p $port $target 'tr -d ''\r'' > ~/edch-server-setup.sh'
    ssh -t -p $port $target 'bash ~/edch-server-setup.sh ~/.edch-setup.env; status=$?; rm -f ~/edch-server-setup.sh; exit $status'
    if ($LASTEXITCODE -ne 0) { Fail "the setup on $target stopped (see above)" }
    Remember @("SSH_TARGET", "SSH_PORT", "DUCKDNS_DOMAIN")
    Write-Host "`nAdmin page later: deploy\admin-windows.ps1   Updates: deploy\update-windows.ps1"
  }
}
finally {
  Remove-Item $settings -ErrorAction SilentlyContinue
}
