$ErrorActionPreference = "Continue"
$root = "C:\Users\chris\Desktop\重生2-原型"
$src  = "D:\重生2视频提取"
$outDir = "$root\audio\vo_real"
New-Item -ItemType Directory -Force $outDir | Out-Null
$lines = Get-Content "$root\tools/voice/lines.json" -Raw -Encoding UTF8 | ConvertFrom-Json

# 角色 → 源素材分类（素材库按人物分类，因此该分类里的人声＝画面上那个人的真声）
$MAP = @{
  "芳姐丈夫" = @("04_女房东"); "芳姐" = @("04_女房东")
  "苏晚晴"   = @("09-跑步女孩")
  "林溪"     = @("02_女同事")
  "温阮"     = @("05_图书馆")
  "雷姐"     = @("08-拳击女教练")
  "红姐"     = @("06-酒吧老板娘")
  "陈果"     = @("03_妹妹")
  "白露"     = @("01_女护士")
  "顾曼"     = @("07-女老板")
  "大师"     = @("NPC")
  "金老板"   = @("NPC")
}

function Get-SpeechSegments([string]$file, [double]$minLen = 0.9, [double]$maxLen = 7.5) {
  $dur = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 $file 2>$null)
  $raw = & ffmpeg -hide_banner -i $file -af "silencedetect=noise=-31dB:d=0.42" -f null - 2>&1
  $starts = @(); $ends = @()
  foreach ($l in $raw) {
    if ($l -match "silence_start: ([\d\.]+)") { $starts += [double]$Matches[1] }
    elseif ($l -match "silence_end: ([\d\.]+)") { $ends += [double]$Matches[1] }
  }
  $seg = @(); $cursor = 0.0
  for ($i = 0; $i -lt $starts.Count; $i++) {
    $s = $starts[$i]
    if ($s - $cursor -ge $minLen) { $seg += [pscustomobject]@{ s = $cursor; e = $s } }
    if ($i -lt $ends.Count) { $cursor = $ends[$i] }
  }
  if ($dur - $cursor -ge $minLen) { $seg += [pscustomobject]@{ s = $cursor; e = $dur } }
  $out = @()
  foreach ($x in $seg) {
    $len = $x.e - $x.s
    if ($len -lt $minLen) { continue }
    if ($len -gt $maxLen) { $x = [pscustomobject]@{ s = $x.s; e = $x.s + $maxLen }; $len = $maxLen }
    $out += [pscustomobject]@{ s = [math]::Round($x.s + 0.12, 2); len = [math]::Round($len - 0.24, 2); score = [math]::Abs($len - 2.6) }
  }
  return $out | Sort-Object score
}

# 1) 为每个角色收集候选片段
$bank = @{}
foreach ($who in $MAP.Keys) {
  $pool = @()
  foreach ($cat in $MAP[$who]) {
    $dir = Join-Path $src $cat
    if (-not (Test-Path $dir)) { continue }
    $files = Get-ChildItem $dir -Filter *.mp4 | Sort-Object Length | Select-Object -First 12
    foreach ($f in $files) {
      $segs = Get-SpeechSegments $f.FullName
      foreach ($g in $segs) { if ($g.len -ge 0.9) { $pool += [pscustomobject]@{ file = $f.FullName; s = $g.s; len = $g.len; score = $g.score } } }
    }
    if ($pool.Count -lt 8) {
      foreach ($f in $files) {
        $segs2 = Get-SpeechSegments $f.FullName -minLen 0.65 -maxLen 6.0
        foreach ($g in ($segs2 | Select-Object -First 3)) { if ($g.len -ge 0.65) { $pool += [pscustomobject]@{ file = $f.FullName; s = $g.s; len = $g.len; score = $g.score + 0.6 } } }
      }
    }
  }
  $bank[$who] = $pool | Sort-Object score | Select-Object -First 14
  Write-Host ("[{0}] 候选片段 {1} 条" -f $who, $bank[$who].Count)
}

# 2) 按台词出现顺序分配给各角色的台词
$need = @{}
foreach ($l in $lines) { if ($MAP.ContainsKey($l.who)) { $need[$l.who] = ($need[$l.who] + 1) } }
$used = @{}
$ok = 0; $skip = 0
foreach ($l in $lines) {
  if (-not $MAP.ContainsKey($l.who)) { $skip++; continue }     # 旁白留给 TTS
  $who = $l.who
  $idx = if ($used.ContainsKey($who)) { $used[$who] } else { 0 }
  $pool = $bank[$who]
  if (-not $pool -or $idx -ge $pool.Count) { $skip++; continue }
  $g = $pool[$idx]; $used[$who] = $idx + 1
  $mp3 = "$outDir\$($l.key).mp3"
  # 淡入淡出 + 统一响度，避免生硬切断
  $af = "afade=t=in:st=0:d=0.06,afade=t=out:st=$([math]::Max(0,$g.len-0.12)):d=0.12,loudnorm=I=-19:TP=-2:LRA=9"
  & ffmpeg -y -ss $g.s -t $g.len -i $g.file -af $af -ac 1 -ar 22050 -c:a libmp3lame -b:a 72k $mp3 2>$null | Out-Null
  if (Test-Path $mp3) { $ok++ } else { Write-Host ("FAIL: " + $l.key) }
}
Write-Host ("真人原声生成: OK=$ok SKIP=$skip（旁白走 TTS）/ 共 " + $lines.Count)
$tot = (Get-ChildItem $outDir -Filter *.mp3 | Measure-Object Length -Sum).Sum
Write-Host ("总大小: " + [int]($tot/1KB) + " KB")
