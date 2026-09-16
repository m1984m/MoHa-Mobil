# Objava funkcije "alarmi za odhod" (MoHa Mobil).
# Skripta je namenoma brez sumnikov: Windows PowerShell 5.1 ne izvede .ps1 datoteke,
# ki je UTF-8 brez BOM in vsebuje sumnike - tiho se konca z exit 0.
#
# Zagon (v mapi web):
#   powershell -ExecutionPolicy Bypass -File .\objava-alarmov.ps1
#
# Skripta se ustavi pri vsakem koraku, ki zahteva prijavo ali odlocitev.

$ErrorActionPreference = 'Stop'
$web = Split-Path -Parent $MyInvocation.MyCommand.Path
$worker = Join-Path $web 'worker'

function Korak($n, $besedilo) {
  Write-Host ""
  Write-Host "=== Korak $n : $besedilo ===" -ForegroundColor Cyan
}

function Ustavi($besedilo) {
  Write-Host ""
  Write-Host $besedilo -ForegroundColor Yellow
  Read-Host "Pritisni Enter za naprej (Ctrl+C za prekinitev)"
}

# --- 6. GitHub -------------------------------------------------------------
Korak 6 "git push origin main"
Set-Location $web
git status -sb | Select-Object -First 1
Ustavi "Sledi potisk na GitHub. Ce se odpre okno za prijavo, jo opravi."
git push origin main
if (-not $?) {
  Write-Host "Potisk ni uspel. Moznosti: (a) prijava v okno upravitelja poverilnic," -ForegroundColor Red
  Write-Host "(b) gh auth login, ce imas GitHub CLI, (c) oseben zeton (PAT)." -ForegroundColor Red
  exit 1
}

# --- 7. KV prostor ---------------------------------------------------------
Korak 7 "npx wrangler kv namespace create ALARMS_KV"
Set-Location $worker
Ustavi "Ce wrangler javi, da nisi prijavljen, pozeni najprej: npx wrangler login"
npx wrangler kv namespace create ALARMS_KV

Write-Host ""
Write-Host "Iz izpisa zgoraj prepisi vrednost id (32 hex znakov)." -ForegroundColor Yellow
$kvId = Read-Host "Prilepi id prostora ALARMS_KV"

if ($kvId -notmatch '^[0-9a-f]{32}$') {
  Write-Host "To ni videti kot veljaven id. Prekinjam, da ne pokvarim wrangler.toml." -ForegroundColor Red
  exit 1
}

$toml = Join-Path $worker 'wrangler.toml'
$vsebina = Get-Content $toml -Raw
if ($vsebina -notmatch '<VPISI_PO_wrangler_kv_namespace_create>') {
  Write-Host "V wrangler.toml ni vec oznake za vpis - id je ocitno ze vpisan. Preskakujem." -ForegroundColor Yellow
} else {
  Copy-Item $toml "$toml.bak" -Force
  ($vsebina -replace '<VPISI_PO_wrangler_kv_namespace_create>', $kvId) |
    Set-Content $toml -Encoding utf8 -NoNewline
  Write-Host "Vpisano v wrangler.toml (varnostna kopija: wrangler.toml.bak)." -ForegroundColor Green
}

# --- 8. Skrivnost VAPID ----------------------------------------------------
Korak 8 "npx wrangler secret put VAPID_PRIVATE"
$vapid = Join-Path $worker 'secrets\vapid.json'
if (-not (Test-Path $vapid)) {
  Write-Host "Ni datoteke worker\secrets\vapid.json - brez nje Worker ne more poslati obvestila." -ForegroundColor Red
  exit 1
}
# Zasebni kljuc gre naravnost iz datoteke v wrangler, brez prikaza na zaslonu.
$kljuc = (Get-Content $vapid -Raw | ConvertFrom-Json).privateKey
$kljuc | npx wrangler secret put VAPID_PRIVATE

# --- 9. Objava Workerja ----------------------------------------------------
Korak 9 "npx wrangler deploy"
Ustavi "Sledi objava Workerja skupaj s cronom, ki tece vsako minuto."
npx wrangler deploy

Write-Host ""
Write-Host "Preveri zivo stanje z: npx wrangler tail" -ForegroundColor Green

# --- 10. Objava aplikacije -------------------------------------------------
Korak 10 "npm run deploy"
Set-Location $web
Ustavi "Sledi gradnja in objava aplikacije na GitHub Pages."
npm run deploy

Write-Host ""
Write-Host "Koncano. Na telefonu odpri aplikacijo Z ZACETNEGA ZASLONA (na iPhonu je to pogoj)," -ForegroundColor Green
Write-Host "dovoli obvestila, nastavi alarm cez nekaj minut in zakleni telefon." -ForegroundColor Green
Write-Host "Opomba: GitHub Pages lahko se kaksno minuto strezes star paket." -ForegroundColor Yellow
