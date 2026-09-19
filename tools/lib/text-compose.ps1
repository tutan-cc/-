# tools/lib/text-compose.ps1 — 用 System.Drawing + 系统字体（Microsoft YaHei）把真汉字合成回光栅化出来的 PNG
# 背景：本沙箱起不了 Chrome/Edge（mojo platform_channel 被拒），所以出图流程是
#       「breakfast.js 真发出的 Canvas2D 指令 → 软件光栅化形状 → 系统字体合成文字」。
#       这样 PNG 里的中文是清楚的系统字体，而不是 5×7 点阵 / 实心方块。
# 用法：powershell -File tools/lib/text-compose.ps1   （读 tests\bf_shots_text.json，原地覆盖 测试截图\*.png）
param(
  [string]$Manifest = (Join-Path $PSScriptRoot "..\..\dist\test-results\bf_shots_text.json")
)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"

function Parse-Color([string]$c, [double]$alpha) {
  $a = [int][Math]::Round([Math]::Max(0.0, [Math]::Min(1.0, $alpha)) * 255)
  $r = 200; $g = 200; $b = 200
  if ($c -match '^#([0-9a-fA-F]{6})') {
    $h = $matches[1]
    $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($h.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
  } elseif ($c -match 'rgba?\(([^)]+)\)') {
    $p = $matches[1] -split ','
    $r = [int][double]$p[0]; $g = [int][double]$p[1]; $b = [int][double]$p[2]
    if ($p.Count -gt 3) { $a = [int][Math]::Round([double]$p[3] * 255) }
  }
  return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

# 去掉系统字体画不出来的表情符号；秒表符号换成「时」（U+23F1 -> U+65F6）
# 注意：只剔除 emoji / 代理对 / 变体选择符；全角标点（U+FF00 区，如「，：（）」）必须保留
function Clean-Text([string]$t) {
  $t = $t -replace ([char]0x23F1), ([char]0x65F6)
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $t.ToCharArray()) {
    $cp = [int][char]$ch
    if ($cp -ge 0x1F000) { continue }
    if ($cp -ge 0xD800 -and $cp -le 0xDFFF) { continue }
    if ($cp -eq 0xFE0F -or $cp -eq 0x200D) { continue }
    [void]$sb.Append($ch)
  }
  return $sb.ToString()
}

$script:fontCache = @{}
function Get-Font([string]$fontSpec, [double]$scale) {
  $size = 12.0
  if ($fontSpec -match '(\d+(?:\.\d+)?)px') { $size = [double]$matches[1] }
  $px = [float][Math]::Max(6.0, [Math]::Round($size * $scale, 1))
  $bold = ($fontSpec -match 'bold')
  $key = "$bold|$px"
  if (-not $script:fontCache.ContainsKey($key)) {
    $style = [System.Drawing.FontStyle]::Regular
    if ($bold) { $style = [System.Drawing.FontStyle]::Bold }
    $script:fontCache[$key] = New-Object System.Drawing.Font("Microsoft YaHei", $px, $style, [System.Drawing.GraphicsUnit]::Pixel)
  }
  return $script:fontCache[$key]
}

if (-not (Test-Path $Manifest)) { throw "找不到清单：$Manifest（先跑 node tools/bf/shots/panel.js）" }
$json = Get-Content -Raw -Encoding UTF8 $Manifest | ConvertFrom-Json
$total = 0
foreach ($shot in $json.shots) {
  $png = [string]$shot.png
  if (-not (Test-Path $png)) { Write-Host ("  跳过（没有图）：" + $png); continue }
  $bytes = [System.IO.File]::ReadAllBytes($png)
  $ms = New-Object System.IO.MemoryStream
  $ms.Write($bytes, 0, $bytes.Length)
  $ms.Position = 0
  $bmp = New-Object System.Drawing.Bitmap($ms)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $n = 0
  foreach ($t in $shot.texts) {
    $txt = Clean-Text ([string]$t.text)
    if ([string]::IsNullOrEmpty($txt)) { continue }
    $sc = [double]$t.scale
    if ($sc -le 0) { $sc = 1.0 }
    $spec = [string]$t.font
    $f = Get-Font $spec $sc
    $col = Parse-Color ([string]$t.color) ([double]$t.alpha)
    $br = New-Object System.Drawing.SolidBrush($col)
    $sf = New-Object System.Drawing.StringFormat
    $sf.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $size = 12.0
    if ($spec -match '(\d+(?:\.\d+)?)px') { $size = [double]$matches[1] }
    $x = [double]$t.x
    $y = [double]$t.y
    $base = [string]$t.base
    if ($base -eq 'alphabetic' -or $base -eq 'bottom') { $y = $y + $size * $sc * 0.18 }
    $h = [float]([Math]::Max(10.0, $size * $sc * 2.6))
    $align = [string]$t.align
    if ($align -eq 'center') {
      $sf.Alignment = [System.Drawing.StringAlignment]::Center
      $rect = New-Object System.Drawing.RectangleF ([float]($x - 3000)), ([float]($y - $h / 2)), ([float]6000), $h
    } elseif ($align -eq 'right') {
      $sf.Alignment = [System.Drawing.StringAlignment]::Far
      $rect = New-Object System.Drawing.RectangleF ([float]($x - 6000)), ([float]($y - $h / 2)), ([float]6000), $h
    } else {
      $sf.Alignment = [System.Drawing.StringAlignment]::Near
      $rect = New-Object System.Drawing.RectangleF ([float]$x), ([float]($y - $h / 2)), ([float]6000), $h
    }
    $g.DrawString($txt, $f, $br, $rect, $sf)
    $br.Dispose(); $sf.Dispose()
    $n++
  }
  $g.Dispose()
  $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose(); $ms.Dispose()
  Write-Host ("  [文字合成] " + (Split-Path $png -Leaf) + " · " + $n + " 段真字体文字")
  $total += $n
}
Write-Host ("[文字合成完成] " + $total + " 段（系统字体 Microsoft YaHei + GDI+ AntiAlias）")
