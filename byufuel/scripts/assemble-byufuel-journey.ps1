# Assemble Byufuel journey video with clear title cards (vertical 1080x1920)
# Forces constant 30fps + reset PTS so concat does not explode with frame duplicates.
$ErrorActionPreference = "Continue"
$ff = "D:\Travel VIP API Automation\node_modules\ffmpeg-static\ffmpeg.exe"
$raw = "D:\Travel VIP API Automation\reports\byufuel-drive\video-raw"
$work = Join-Path $raw "assemble"
$out = Join-Path $raw "BYUFUEL-FULL-JOURNEY-24Sep2026.mp4"
$log = Join-Path $work "ffmpeg.log"
New-Item -ItemType Directory -Force -Path $work | Out-Null
if (Test-Path $log) { Remove-Item $log -Force }

$W = 1080
$H = 1920
$FPS = 30
$font = "C\:/Windows/Fonts/segoeui.ttf"
$fontBold = "C\:/Windows/Fonts/segoeuib.ttf"
if (-not (Test-Path "C:\Windows\Fonts\segoeuib.ttf")) { $fontBold = $font }

function Esc-Draw([string]$s) {
  # drawtext: escape \ : ' and replace | (filter separator risk)
  return (($s -replace '\\', '/' -replace '\|', '-' -replace ':', '\:' -replace "'", "") )
}

function Invoke-Ffmpeg {
  param([Parameter(Mandatory)][string[]]$FFmpegArgs)
  # Call ffmpeg directly; stderr to log (native exit code preserved)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  & $ff @FFmpegArgs 2> $log | Out-Null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  return $code
}

function New-TitleCard([string]$file, [double]$sec, [string]$step, [string]$title, [string]$sub) {
  $stepE = Esc-Draw $step
  $titleE = Esc-Draw $title
  $subE = Esc-Draw $sub
  $vf = "fps=${FPS},scale=${W}:${H},format=yuv420p,setsar=1,setpts=PTS-STARTPTS,drawtext=fontfile=${fontBold}:text='${stepE}':fontcolor=0xD4A84B:fontsize=36:x=(w-text_w)/2:y=h*0.28,drawtext=fontfile=${fontBold}:text='${titleE}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h*0.40,drawtext=fontfile=${font}:text='${subE}':fontcolor=0xE8E8E8:fontsize=26:x=(w-text_w)/2:y=h*0.54"
  $code = Invoke-Ffmpeg @(
    "-y",
    "-f","lavfi","-i","color=c=0x0B3D2E:s=${W}x${H}:d=${sec}:r=${FPS}",
    "-f","lavfi","-i","anullsrc=r=44100:cl=mono",
    "-vf",$vf,
    "-r","$FPS",
    "-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p",
    "-c:a","aac","-ar","44100","-ac","1",
    "-shortest","-t","$sec",
    "-movflags","+faststart",
    $file
  )
  if ($code -ne 0 -or -not (Test-Path $file) -or (Get-Item $file).Length -lt 1000) {
    throw "Failed title $file exit=$code (see $log)"
  }
  Write-Host "  ok title $(Split-Path $file -Leaf)"
}

function Normalize-Clip([string]$inPath, [string]$outPath, [string]$badge) {
  Write-Host "  normalize $(Split-Path $inPath -Leaf) ..."
  $badgeE = Esc-Draw $badge
  $vf = "fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p,setsar=1,setpts=PTS-STARTPTS,drawtext=fontfile=${fontBold}:text='${badgeE}':fontcolor=white:fontsize=28:box=1:boxcolor=0x0B3D2E@0.85:boxborderw=12:x=36:y=36"
  $code = Invoke-Ffmpeg @(
    "-y","-i",$inPath,
    "-f","lavfi","-i","anullsrc=r=44100:cl=mono",
    "-vf",$vf,
    "-r","$FPS","-vsync","cfr",
    "-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p",
    "-c:a","aac","-ar","44100","-ac","1",
    "-shortest",
    "-movflags","+faststart",
    $outPath
  )
  if ($code -ne 0 -or -not (Test-Path $outPath) -or (Get-Item $outPath).Length -lt 1000) {
    throw "Failed normalize $inPath exit=$code (see $log)"
  }
  Write-Host "  ok $(Split-Path $outPath -Leaf) MB=$([math]::Round((Get-Item $outPath).Length/1MB,1))"
}

Write-Host "Creating title cards..."
New-TitleCard (Join-Path $work "t00_intro.mp4") 4 `
  "BYUFUEL  -  Live demo" `
  "UCO Pickup Journey" `
  "24 Sep 2026 - SCH-000006640 - IT-000001193"

New-TitleCard (Join-Path $work "t01.mp4") 3 `
  "Step 1 of 6" `
  "Supplier requests pickup" `
  "30 kg Grade A - Today 8 AM-11 PM - Andheri"

New-TitleCard (Join-Path $work "t02.mp4") 3 `
  "Step 2 of 6" `
  "Admin approves request" `
  "Supplier app shows Approved - Rs 3540"

New-TitleCard (Join-Path $work "t03.mp4") 3 `
  "Step 3 of 6" `
  "Driver runs the pickup" `
  "Accept - Scan container - Documents - Warehouse"

New-TitleCard (Join-Path $work "t04.mp4") 3 `
  "Step 4 of 6" `
  "Supplier sees progress" `
  "Status: Pickup Started"

New-TitleCard (Join-Path $work "t05.mp4") 5 `
  "Step 5 of 6" `
  "Warehouse check-in" `
  "WH web Check in Oil - B-2609-3-00003 - 30 kg verified"

New-TitleCard (Join-Path $work "t06.mp4") 5 `
  "Step 6 of 6" `
  "Supplier paid" `
  "Cash payment - Ref QA-CASH-IT1193-0924 - CREDITED Rs 3540"

New-TitleCard (Join-Path $work "t99_end.mp4") 5 `
  "Journey complete" `
  "Request - Approve - Pickup - WH - Paid" `
  "SCH-6640 / IT-1193 / Atul / WareOne"

Write-Host "Normalizing clips (CFR 30fps)..."
Normalize-Clip (Join-Path $raw "screen-20260924-163925.mp4") (Join-Path $work "c01_supplier_request.mp4") "SUPPLIER APP - Create request"
Normalize-Clip (Join-Path $raw "screen-20260924-171227.mp4") (Join-Path $work "c02_supplier_approved.mp4") "SUPPLIER APP - Approved"
Normalize-Clip (Join-Path $raw "driver-screen-20260924-173333.mp4") (Join-Path $work "c03_driver.mp4") "DRIVER APP - IT-000001193"
Normalize-Clip (Join-Path $raw "screen-20260924-172733.mp4") (Join-Path $work "c04_supplier_started.mp4") "SUPPLIER APP - Pickup started"

Write-Host "Building concat list..."
$list = Join-Path $work "concat.txt"
@(
  "file 't00_intro.mp4'"
  "file 't01.mp4'"
  "file 'c01_supplier_request.mp4'"
  "file 't02.mp4'"
  "file 'c02_supplier_approved.mp4'"
  "file 't03.mp4'"
  "file 'c03_driver.mp4'"
  "file 't04.mp4'"
  "file 'c04_supplier_started.mp4'"
  "file 't05.mp4'"
  "file 't06.mp4'"
  "file 't99_end.mp4'"
) | Set-Content -Path $list -Encoding ASCII

if (Test-Path $out) { Remove-Item $out -Force }

Write-Host "Concatenating final film (stream copy)..."
Push-Location $work
try {
  $code = Invoke-Ffmpeg @("-y","-f","concat","-safe","0","-i","concat.txt","-c","copy","-movflags","+faststart",$out)
  if ($code -ne 0 -or -not (Test-Path $out)) {
    Write-Host "Copy-concat failed; re-encoding once..."
    $code = Invoke-Ffmpeg @(
      "-y","-f","concat","-safe","0","-i","concat.txt",
      "-r","$FPS","-vsync","cfr",
      "-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p",
      "-c:a","aac","-ar","44100","-ac","1",
      "-movflags","+faststart",$out
    )
  }
  if ($code -ne 0 -or -not (Test-Path $out)) { throw "concat failed exit=$code" }
} finally {
  Pop-Location
}

$fi = Get-Item $out
Write-Host "DONE: $($fi.FullName)"
Write-Host ("SIZE_MB=" + [math]::Round($fi.Length / 1MB, 1))
$probe = & $ff -hide_banner -i $out 2>&1 | Out-String
if ($probe -match "Duration:\s*([0-9:.]+)") { Write-Host "DURATION=$($Matches[1])" }
