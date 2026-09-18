$ErrorActionPreference = "Continue"
$root = "C:\Users\chris\Desktop\重生2-原型"
$dir  = "$root\audio\mj"
New-Item -ItemType Directory -Force $dir | Out-Null

# 词条：文件名 → 朗读文本
$lines = [ordered]@{}
$nums = @("一","二","三","四","五","六","七","八","九")
foreach ($s in @(@("万","万"), @("条","条"), @("筒","筒"))) {
  for ($i = 0; $i -lt 9; $i++) { $lines["$($i+1)$($s[0])"] = "$($nums[$i])$($s[1])" }
}
$lines["东"] = "东"; $lines["南"] = "南"; $lines["西"] = "西"; $lines["北"] = "北"
$lines["中"] = "红中"; $lines["发"] = "发财"; $lines["白"] = "白板"
# 动作喊话
$lines["碰"]   = "碰！"
$lines["杠"]   = "杠！"
$lines["暗杠"] = "暗杠！"
$lines["补杠"] = "补杠！"
$lines["胡"]   = "胡了！"
$lines["自摸"] = "自摸！"
$lines["抢杠"] = "抢杠胡！"
$lines["杠开"] = "杠上开花！"
$lines["听"]   = "听牌。"
$lines["过"]   = "过。"
$lines["流局"] = "流局。"

$v = New-Object -ComObject SAPI.SpVoice
$hui = @($v.GetVoices()) | Where-Object { $_.GetDescription() -like "*Huihui*" } | Select-Object -First 1
if ($hui) { $v.Voice = $hui }
$v.Rate = 1

function SavePcm([string]$text, [int]$rate) {
  $ms = New-Object -ComObject SAPI.SpMemoryStream
  $ms.Format.Type = 22
  $v.AudioOutputStream = $ms
  $v.Rate = $rate
  $v.Speak($text)
  return [byte[]]$ms.GetData()
}
function WavBytes([byte[]]$pcm) {
  $sr=22050; $ch=1; $bits=16
  $m = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $m
  $bw.Write([char[]]"RIFF"); $bw.Write([int](36+$pcm.Length)); $bw.Write([char[]]"WAVE")
  $bw.Write([char[]]"fmt "); $bw.Write([int]16); $bw.Write([int16]1); $bw.Write([int16]$ch)
  $bw.Write([int]$sr); $bw.Write([int]($sr*$ch*$bits/8)); $bw.Write([int16]($ch*$bits/8)); $bw.Write([int16]$bits)
  $bw.Write([char[]]"data"); $bw.Write([int]$pcm.Length); $bw.Write($pcm)
  $bw.Flush(); return $m.ToArray()
}

$ok = 0; $fail = 0
foreach ($name in $lines.Keys) {
  $text = $lines[$name]
  $rate = if ($name -in @("碰","杠","胡","自摸","抢杠","杠开")) { 2 } else { 1 }
  $pcm = [byte[]](SavePcm $text $rate)
  if ($pcm.Length -lt 1200) { Write-Host "SKIP $name"; $fail++; continue }
  $wav = "$env:TEMP\mj_$name.wav"
  [System.IO.File]::WriteAllBytes($wav, (WavBytes $pcm))
  $mp3 = "$dir\$name.mp3"
  & ffmpeg -y -i $wav -af "loudnorm=I=-17:TP=-2:LRA=8,afade=t=in:st=0:d=0.02" -ac 1 -ar 22050 -c:a libmp3lame -b:a 64k $mp3 2>$null | Out-Null
  if ((Test-Path $mp3) -and ((Get-Item $mp3).Length -gt 1500)) { $ok++ } else { Write-Host "FFMPEG FAIL $name"; $fail++ }
  Remove-Item $wav -Force -ErrorAction SilentlyContinue
}
Write-Host "语音包生成: OK=$ok FAIL=$fail"
$tot = (Get-ChildItem $dir -Filter *.mp3 | Measure-Object Length -Sum).Sum
Write-Host ("总大小: " + [int]($tot/1KB) + " KB · 文件数 " + (Get-ChildItem $dir -Filter *.mp3).Count)
