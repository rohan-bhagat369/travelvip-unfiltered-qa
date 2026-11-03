# Poll Nothing A015 for TravelVIP / Bajaj push notifications.
# On match: expand shade (optional), screencap, save MD + PNG under notif-evidence/<bookingId>/
# Usage:
#   powershell -File .\watch-travelvip-notifs.ps1
#   powershell -File .\watch-travelvip-notifs.ps1 -Seconds 600 -PollMs 3000

param(
  [int]$Seconds = 900,
  [int]$PollMs = 4000,
  [string]$Serial = "00117648V003247",
  [string]$OutRoot = ""
)

$ErrorActionPreference = "Stop"
if (-not $OutRoot) {
  $OutRoot = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "reports\ans-v2-email-signoff\notif-evidence"
  # Prefer repo-relative known path
  $OutRoot = "d:\Travel VIP API Automation\travel-apis\reports\ans-v2-email-signoff\notif-evidence"
}
New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null

$adbCmd = Get-Command adb -ErrorAction SilentlyContinue
$adb = if ($adbCmd) { $adbCmd.Source } else { $null }
if (-not $adb) {
  $adb = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe"
}

function Get-TvipDump {
  & $adb -s $Serial shell dumpsys notification --noredact 2>$null | Out-String
}

function Get-TvipHits([string]$dump) {
  # Split into NotificationRecord blocks and keep TravelVIP-ish pkgs
  $blocks = [regex]::Split($dump, "NotificationRecord\(")
  $hits = @()
  foreach ($b in $blocks) {
    if ($b -notmatch 'pkg=(ollie\.travelvip\.app|ai\.travelvip\.|in\.shoppingwish\.scandid|com\.customerfacing)') { continue }
    if ($b -match 'pkg=android\b') { continue }
    $pkg = if ($b -match 'pkg=([^\s]+)') { $Matches[1] } else { "?" }
    $title = if ($b -match 'android\.title=String \(([^)]*)\)') { $Matches[1] } else { "" }
    $text = if ($b -match 'android\.text=String \(([^)]*)\)') { $Matches[1] } else { "" }
    $big = if ($b -match 'android\.bigText=String \(([^)]*)\)') { $Matches[1] } else { "" }
    $blob = "$title $text $big $b"
    $bookingId = $null
    foreach ($pat in @('FB\d{10,}', 'BR\d{10,}', 'SR\d{10,}', 'TX\d{10,}', '\b\d{16}\b')) {
      $m = [regex]::Match($blob, $pat)
      if ($m.Success) { $bookingId = $m.Value; break }
    }
    if (-not $title -and -not $text) { continue }
    $key = "$pkg|$title|$text"
    $hits += [pscustomobject]@{
      Package   = $pkg
      Title     = $title
      Text      = $text
      BigText   = $big
      BookingId = $(if ($bookingId) { $bookingId } else { "UNKNOWN-$(Get-Date -Format 'HHmmss')" })
      Key       = $key
    }
  }
  return $hits
}

function Save-Evidence($hit) {
  $id = $hit.BookingId
  $dir = Join-Path $OutRoot $id
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $png = Join-Path $dir "notif-$stamp.png"
  $md  = Join-Path $dir "RESULT-$stamp.md"

  # Expand notification shade for a clearer shot (PNG via pull — PowerShell redirect corrupts binary)
  & $adb -s $Serial shell cmd statusbar expand-notifications 2>$null | Out-Null
  Start-Sleep -Milliseconds 900
  $remote = "/sdcard/Download/tvip-notif-$stamp.png"
  & $adb -s $Serial shell screencap -p $remote | Out-Null
  & $adb -s $Serial pull $remote $png | Out-Null
  & $adb -s $Serial shell rm $remote 2>$null | Out-Null
  & $adb -s $Serial shell cmd statusbar collapse 2>$null | Out-Null

  $size = if (Test-Path $png) { (Get-Item $png).Length } else { 0 }
  @"
# TravelVIP push notification evidence

| Field | Value |
|-------|--------|
| Captured | $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') |
| Device | Nothing A015 · serial $Serial |
| Package | $($hit.Package) |
| Booking ID | **$id** |
| Title | $($hit.Title) |
| Text | $($hit.Text) |
| BigText | $($hit.BigText) |
| Screenshot | ``notif-$stamp.png`` ($size bytes) |
| Status | **PASS** (notification received on device) |

"@ | Set-Content -Path $md -Encoding UTF8

  Write-Host "SAVED $id -> $dir" -ForegroundColor Green
  return $dir
}

# Verify device
$dev = & $adb devices | Select-String $Serial
if (-not ($dev -match 'device')) {
  Write-Host "Device $Serial not in 'device' state. adb devices:" -ForegroundColor Red
  & $adb devices -l
  exit 1
}
Write-Host "Watching TravelVIP notifs on $Serial for ${Seconds}s (poll ${PollMs}ms)" -ForegroundColor Cyan
Write-Host "Out: $OutRoot"
Write-Host "Installed target pkgs: ollie.travelvip.app (and related)"
Write-Host "Book on PWA now..."

$seen = @{}
$deadline = (Get-Date).AddSeconds($Seconds)
$saved = 0
while ((Get-Date) -lt $deadline) {
  try {
    $dump = Get-TvipDump
    $hits = Get-TvipHits $dump
    foreach ($h in $hits) {
      if ($seen.ContainsKey($h.Key)) { continue }
      $seen[$h.Key] = $true
      Write-Host ("HIT [{0}] {1} -- {2}" -f $h.BookingId, $h.Title, $h.Text) -ForegroundColor Yellow
      Save-Evidence $h | Out-Null
      $saved++
    }
  } catch {
    Write-Host "poll error: $_" -ForegroundColor DarkYellow
  }
  Start-Sleep -Milliseconds $PollMs
}

Write-Host "Done. New evidence folders: $saved" -ForegroundColor Cyan
Get-ChildItem $OutRoot -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 10 Name, LastWriteTime
