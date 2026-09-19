$ErrorActionPreference = "Continue"
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent   # tools/archive/ → 仓库根（自定位，不写死本机路径）
$voDir = Join-Path $repo "audio\vo"
$lines = Get-Content (Join-Path $repo "tools/voice/lines.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$v = New-Object -ComObject SAPI.SpVoice
$hui = @($v.GetVoices()) | Where-Object { $_.GetDescription() -like "*Huihui*" } | Select-Object -First 1
if ($hui) { $v.Voice = $hui }

function Clean([string]$t){
  $s = [regex]::Replace($t, '（[^）]*）', '')
  $s = [regex]::Replace($s, '[「」『』“”"()]', '')
  $s = $s -replace '——', '，'
  return $s.Trim()
}
function SpeakPcm([string]$text, [int]$rate){
  $ms = New-Object -ComObject SAPI.SpMemoryStream
  $ms.Format.Type = 22
  $v.AudioOutputStream = $ms
  $v.Rate = $rate
  $v.Speak($text)
  return [byte[]]$ms.GetData()
}
function Wav([byte[]]$pcm){
  $sr=22050; $ch=1; $bits=16
  $m = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $m
  $bw.Write([char[]]"RIFF"); $bw.Write([int](36+$pcm.Length)); $bw.Write([char[]]"WAVE")
  $bw.Write([char[]]"fmt "); $bw.Write([int]16); $bw.Write([int16]1); $bw.Write([int16]$ch)
  $bw.Write([int]$sr); $bw.Write([int]($sr*$ch*$bits/8)); $bw.Write([int16]($ch*$bits/8)); $bw.Write([int16]$bits)
  $bw.Write([char[]]"data"); $bw.Write([int]$pcm.Length); $bw.Write($pcm)
  $bw.Flush(); return $m.ToArray()
}

$ok=0; $skip=0
foreach ($l in $lines) {
  if ($l.who -ne "") { continue }                    # 只重做旁白（角色走真人原声）
  $text = Clean $l.text
  if ([string]::IsNullOrWhiteSpace($text)) { $skip++; continue }
  # 按标点切句，逐句合成 → 句间插入停顿，语速轻微起伏，去掉念稿感
  $clauses = [regex]::Split($text, '(?<=[，。！？；、])') | Where-Object { $_.Trim().Length -gt 0 }
  $acc = New-Object System.IO.MemoryStream
  $rates = @(-1, 0, -2, 1)
  $i = 0
  foreach ($cl in $clauses) {
    $piece = $cl.Trim()
    if ($piece.Length -lt 1) { continue }
    $pcm = [byte[]](SpeakPcm $piece $rates[$i % $rates.Count])
    if ($pcm.Length -gt 1000) { $acc.Write($pcm, 0, $pcm.Length) }
    
    $pauseMs = if ($piece -match '[。！？]$') { 210 } elseif ($piece -match '[，；、]$') { 110 } else { 150 }
    $zeros = New-Object byte[] ([int]($pauseMs/1000.0*22050*2))
    $acc.Write($zeros, 0, $zeros.Length)
    $i++
  }
  $wav = "$env:TEMP\narr_$($l.key).wav"
  $pcmAll = $acc.ToArray(); $acc.Dispose(); if ($pcmAll.Length -lt 2000) { Write-Host ("SKIP " + $l.key); $skip++; continue }
  [System.IO.File]::WriteAllBytes($wav, (Wav $pcmAll))
  $mp3 = "$voDir\$($l.key).mp3"
  # 旁白：稍低音色 + 统一响度 + 首尾淡化
  & ffmpeg -y -i $wav -af "asetrate=22050*0.95,aresample=22050,atempo=1.0526,loudnorm=I=-19:TP=-2:LRA=9,afade=t=in:st=0:d=0.05" -ac 1 -ar 22050 -c:a libmp3lame -b:a 72k $mp3 2>$null | Out-Null
  if ((Test-Path $mp3) -and ((Get-Item $mp3).Length -gt 3000)) { $ok++ } else { Write-Host ("FAIL " + $l.key); $skip++ }
  Remove-Item $wav -Force -ErrorAction SilentlyContinue
}
Write-Host "旁白重制: OK=$ok SKIP=$skip"
