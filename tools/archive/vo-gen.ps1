$ErrorActionPreference = "Continue"
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent   # tools/archive/ → 仓库根（自定位，不写死本机路径）
$voDir = Join-Path $repo "audio\vo"
New-Item -ItemType Directory -Force $voDir | Out-Null
$lines = Get-Content (Join-Path $repo "tools/voice/lines.json") -Raw -Encoding UTF8 | ConvertFrom-Json

# 角色 → @{ rate = SAPI语速(-10..10); pitch = 变调系数 }
$VOICE = @{
  ""        = @{ rate = -1; pitch = 0.93 }   # 旁白
  "芳姐丈夫" = @{ rate = 0;  pitch = 0.86 }
  "芳姐"    = @{ rate = 0;  pitch = 0.99 }
  "苏晚晴"  = @{ rate = 1;  pitch = 1.07 }
  "林溪"    = @{ rate = 0;  pitch = 1.04 }
  "温阮"    = @{ rate = 1;  pitch = 1.09 }
  "雷姐"    = @{ rate = 0;  pitch = 0.95 }
  "红姐"    = @{ rate = -1; pitch = 0.97 }
  "陈果"    = @{ rate = 1;  pitch = 1.11 }
  "白露"    = @{ rate = 0;  pitch = 1.05 }
  "顾曼"    = @{ rate = -1; pitch = 0.96 }
  "大师"    = @{ rate = -2; pitch = 0.84 }
  "金老板"  = @{ rate = 0;  pitch = 0.88 }
}

$v = New-Object -ComObject SAPI.SpVoice
$voices = @($v.GetVoices())
$huihui = $voices | Where-Object { $_.GetDescription() -like "*Huihui*" } | Select-Object -First 1
if ($huihui) { $v.Voice = $huihui }
Write-Host ("音色: " + ($(if($huihui){$huihui.GetDescription()}else{"默认"})))

function Get-CleanText([string]$t) {
  $s = $t
  $s = [regex]::Replace($s, '（[^）]*）', '')      # 去掉括号内的动作描述
  $s = [regex]::Replace($s, '[「」『』“”"()]', '')
  $s = $s -replace '——', '，'
  $s = $s.Trim()
  return $s
}

$ok = 0; $skip = 0
foreach ($l in $lines) {
  $text = Get-CleanText $l.text
  if ([string]::IsNullOrWhiteSpace($text) -or $text.Length -lt 2) { $skip++; continue }
  $p = $VOICE[$l.who]
  if (-not $p) { $p = $VOICE[""] }
  $wav = "$env:TEMP\vo_$($l.key).wav"
  $mp3 = "$voDir\$($l.key).mp3"
  # 1) SAPI 合成
  $ms = New-Object -ComObject SAPI.SpMemoryStream
  $ms.Format.Type = 22
  $v.AudioOutputStream = $ms
  $v.Rate = [int]$p.rate
  $v.Speak($text)
  $pcm = [byte[]]$ms.GetData()
  if ($pcm.Length -lt 1000) { Write-Host ("SKIP(no audio): " + $l.key); $skip++; continue }
  # 2) 补 WAV 头
  $sr = 22050; $ch = 1; $bits = 16
  $ms2 = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ms2
  $bw.Write([char[]]"RIFF"); $bw.Write([int](36 + $pcm.Length)); $bw.Write([char[]]"WAVE")
  $bw.Write([char[]]"fmt "); $bw.Write([int]16); $bw.Write([int16]1); $bw.Write([int16]$ch)
  $bw.Write([int]$sr); $bw.Write([int]($sr*$ch*$bits/8)); $bw.Write([int16]($ch*$bits/8)); $bw.Write([int16]$bits)
  $bw.Write([char[]]"data"); $bw.Write([int]$pcm.Length); $bw.Write($pcm)
  $bw.Flush(); [System.IO.File]::WriteAllBytes($wav, $ms2.ToArray()); $bw.Dispose(); $ms2.Dispose()
  # 3) 变调 → mp3
  $f = [double]$p.pitch
  $af = "asetrate=22050*$f,aresample=22050,atempo=$(1/$f)"
  & ffmpeg -y -i $wav -af $af -ac 1 -ar 22050 -c:a libmp3lame -b:a 64k $mp3 2>$null | Out-Null
  if (Test-Path $mp3) { $ok++ } else { Write-Host ("FFMPEG FAIL: " + $l.key) }
  Remove-Item $wav -Force -ErrorAction SilentlyContinue
}
Write-Host ("生成完成: OK=$ok SKIP=$skip / 共 " + $lines.Count)
$total = (Get-ChildItem $voDir -Filter *.mp3 | Measure-Object Length -Sum).Sum
Write-Host ("音频总大小: " + [int]($total/1KB) + " KB")
