# Watch Android notification posts (ANS V2 push after PWA booking).
# Prereq: USB debugging ON, phone authorized, same Google account / app logged in as PWA user.
# Usage:  powershell -File .\watch-android-notifications.ps1
# Optional: -PackageFilter "travelvip|bajaj|finserv|firebase|fcm"

param(
  [string]$PackageFilter = "travel|bajaj|finserv|firebase|fcm|gcm|scandid|wishpoint",
  [int]$Seconds = 0
)

$ErrorActionPreference = "Stop"
$adb = (Get-Command adb -ErrorAction SilentlyContinue)?.Source
if (-not $adb) {
  $adb = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe"
}
if (-not (Test-Path $adb)) { throw "adb not found" }

Write-Host "adb: $adb"
& $adb start-server | Out-Null
$devices = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" }
if (-not $devices) {
  Write-Host "NO DEVICE. Plug phone → enable USB debugging → Allow this computer → re-run." -ForegroundColor Red
  & $adb devices -l
  exit 1
}
Write-Host "Device(s):" -ForegroundColor Green
$devices | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "Dumping current notification shade once..." -ForegroundColor Cyan
& $adb shell dumpsys notification --noredact 2>$null | Select-String -Pattern "pkg=|title=|text=|NotificationRecord|android.title|android.text" | Select-Object -First 80

Write-Host ""
Write-Host "Listening for NotificationService / FCM lines (Ctrl+C to stop)..." -ForegroundColor Cyan
Write-Host "Filter: $PackageFilter"
Write-Host "Book on PWA now; watch for push title/body here."
Write-Host ""

# Clear then stream
& $adb logcat -c | Out-Null
if ($Seconds -gt 0) {
  $job = Start-Job -ScriptBlock {
    param($adbPath, $filter)
    & $adbPath logcat -v time *:S NotificationService:V FirebaseMessaging:V FCM:V FCMessaging:V System.out:I | Select-String -Pattern $filter
  } -ArgumentList $adb, $PackageFilter
  Wait-Job $job -Timeout $Seconds | Out-Null
  Receive-Job $job
  Stop-Job $job -ErrorAction SilentlyContinue
  Remove-Job $job -Force -ErrorAction SilentlyContinue
} else {
  & $adb logcat -v time *:S NotificationService:V FirebaseMessaging:V FCM:V FCMessaging:V | Select-String -Pattern $PackageFilter
}
