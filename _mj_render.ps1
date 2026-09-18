# _mj_render.ps1 — 麻将系统出图（本沙箱里 mshta 的屏幕拷贝不可靠：同一进程 >3 次会挂、
# 牌桌 raf 循环下还会卡在 CopyFromScreen，所以改成「读面板数据 → System.Drawing 画主题图」）。
# 数据源：_mj_panels.json（由浏览器探针从**真实运行中的 DOM** 抓下来），
# 所以图上的每个数字/文案都来自真实渲染结果，不是另写一份文案。
# 用法：powershell -File _mj_render.ps1 -Data <in.json> -Out <out.png>
param([string]$Data, [string]$Out)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# 颜色一律写成 "#RRGGBB"（可选 "#RRGGBBAA"）——避免 PowerShell 多参函数调用的语法坑
function Hex([string]$s) {
  if (-not $s) { return [System.Drawing.Color]::FromArgb(255, 203, 214, 230) }
  $s = $s.Trim()
  if ($s -match '^#([0-9a-fA-F]{8})$') {
    $v = $Matches[1]
    return [System.Drawing.Color]::FromArgb(
      [Convert]::ToInt32($v.Substring(6,2),16), [Convert]::ToInt32($v.Substring(0,2),16),
      [Convert]::ToInt32($v.Substring(2,2),16), [Convert]::ToInt32($v.Substring(4,2),16))
  }
  if ($s -match '^#([0-9a-fA-F]{6})$') {
    $v = $Matches[1]
    return [System.Drawing.Color]::FromArgb(255, [Convert]::ToInt32($v.Substring(0,2),16),
      [Convert]::ToInt32($v.Substring(2,2),16), [Convert]::ToInt32($v.Substring(4,2),16))
  }
  return [System.Drawing.Color]::FromArgb(255, 203, 214, 230)
}
function WithAlpha([string]$s, [int]$a) { $c = Hex $s; return [System.Drawing.Color]::FromArgb($a, $c.R, $c.G, $c.B) }
function RoundRect($g, $brush, $x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $r*2, $r*2, 180, 90)
  $p.AddArc($x+$w-$r*2, $y, $r*2, $r*2, 270, 90)
  $p.AddArc($x+$w-$r*2, $y+$h-$r*2, $r*2, $r*2, 0, 90)
  $p.AddArc($x, $y+$h-$r*2, $r*2, $r*2, 90, 90)
  $p.CloseFigure()
  $g.FillPath($brush, $p)
  $p.Dispose()
}

$J = Get-Content -Raw -Encoding UTF8 $Data | ConvertFrom-Json
$W = [int]$J.w; $H = [int]$J.h
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(0,0)), (New-Object System.Drawing.Point(0,$H)),
  (Hex "#101018"), (Hex "#08080e"))
$g.FillRectangle($bg, 0, 0, $W, $H); $bg.Dispose()

$frame = New-Object System.Drawing.Pen((WithAlpha $J.frame 110), 1.4)
$g.DrawRectangle($frame, 0.7, 0.7, $W - 1.4, $H - 1.4); $frame.Dispose()

$fTitle = New-Object System.Drawing.Font("Microsoft YaHei", 13, [System.Drawing.FontStyle]::Bold)
$fHead  = New-Object System.Drawing.Font("Microsoft YaHei", 10.5, [System.Drawing.FontStyle]::Bold)
$fBody  = New-Object System.Drawing.Font("Microsoft YaHei", 9.5)
$fSmall = New-Object System.Drawing.Font("Microsoft YaHei", 8.5)
$brGold  = New-Object System.Drawing.SolidBrush((Hex "#ffd76e"))
$brText  = New-Object System.Drawing.SolidBrush((Hex $J.color))
$brDim   = New-Object System.Drawing.SolidBrush((Hex "#8a87a3"))
$brWarm  = New-Object System.Drawing.SolidBrush((Hex "#ffb86e"))
$brRed   = New-Object System.Drawing.SolidBrush((Hex "#ff7d9c"))
$linePen = New-Object System.Drawing.Pen((Hex "#2a2a3a"), 1)

$g.DrawString($J.title, $fTitle, $brGold, 16, 12)
if ($J.subtitle) { $g.DrawString($J.subtitle, $fSmall, $brDim, 17, 37) }
$y = 58
$g.DrawLine($linePen, 14, $y, $W - 14, $y)
$y += 12

foreach ($row in $J.rows) {
  $kind = if ($row.kind) { $row.kind } else { "body" }
  switch ($kind) {
    "kv" {
      $g.DrawString($row.k, $fSmall, $brDim, 20, $y + 2)
      $g.DrawString($row.v, $fHead, (New-Object System.Drawing.SolidBrush((Hex $row.c))), 146, $y)
      $y += 23
    }
    "note" {
      $bb = New-Object System.Drawing.SolidBrush((Hex "#1a1424"))
      RoundRect $g $bb 14 $y ($W - 28) 27 6; $bb.Dispose()
      $bar = New-Object System.Drawing.SolidBrush((Hex $row.c))
      $g.FillRectangle($bar, 14, $y, 3, 27); $bar.Dispose()
      $g.DrawString($row.t, $fHead, (New-Object System.Drawing.SolidBrush((Hex $row.c))), 25, $y + 6)
      $y += 33
    }
    "li" { $g.DrawString($row.t, $fBody, $brText, 26, $y); $y += 20 }
    "sep" { $g.DrawLine($linePen, 14, $y + 3, $W - 14, $y + 3); $y += 13 }
    "inv" {
      $bx = 16; $by = $y; $bw = $W - 32; $bh = [int]$row.h
      $grd = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point($bx,$by)), (New-Object System.Drawing.Point($bx, ($by + $bh))),
        (Hex "#14101e"), (Hex "#0a0910"))
      RoundRect $g $grd $bx $by $bw $bh 12; $grd.Dispose()
      $bd = New-Object System.Drawing.Pen((WithAlpha "#ffd76e" 150), 1)
      $g.DrawRectangle($bd, $bx, $by, $bw, $bh); $bd.Dispose()
      $av = New-Object System.Drawing.SolidBrush((Hex "#3a2a12"))
      $g.FillEllipse($av, $bx + 12, $by + 14, 38, 38); $av.Dispose()
      $avp = New-Object System.Drawing.Pen((WithAlpha "#ffd76e" 160), 1)
      $g.DrawEllipse($avp, $bx + 12, $by + 14, 38, 38); $avp.Dispose()
      $g.DrawString($row.avatar, $fHead, $brGold, $bx + 25, $by + 24)
      $tx = $bx + 64
      $g.DrawString($row.name, $fSmall, $brGold, $tx, $by + 14)
      $g.DrawString("刚刚", $fSmall, $brDim, $tx + 54, $by + 14)
      $g.DrawString($row.msg, $fHead, $brText, $tx, $by + 34)
      $g.DrawString($row.meta, $fSmall, $brDim, $tx, $by + 58)
      if ($row.gain) {
        $gp = New-Object System.Drawing.Pen((WithAlpha "#ffb86e" 170), 2)
        $g.DrawLine($gp, $tx, $by + 78, $tx, $by + 92); $gp.Dispose()
        $g.DrawString($row.gain, $fSmall, $brWarm, $tx + 7, $by + 78)
      }
      $byy = if ($row.btnY) { $by + [int]$row.btnY } else { $by + $bh - 34 }
      $acc = New-Object System.Drawing.SolidBrush((Hex "#281f10"))
      RoundRect $g $acc $tx $byy 100 26 6; $acc.Dispose()
      $accp = New-Object System.Drawing.Pen((WithAlpha "#ffd76e" 170), 1)
      $g.DrawRectangle($accp, $tx, $byy, 100, 26); $accp.Dispose()
      $g.DrawString("接 受", $fBody, $brGold, $tx + 32, $byy + 5)
      $btnNo = New-Object System.Drawing.SolidBrush((Hex "#0c0c14"))
      RoundRect $g $btnNo ($tx + 112) $byy 100 26 6; $btnNo.Dispose()
      $nop = New-Object System.Drawing.Pen((Hex "#555566"), 1)
      $g.DrawRectangle($nop, $tx + 112, $byy, 100, 26); $nop.Dispose()
      $g.DrawString("改 天", $fBody, $brDim, $tx + 144, $byy + 5)
      $y = $by + $bh + 10
    }
    "card" {
      $bx = 14; $by = $y; $bw = $W - 28; $bh = [int]$row.h
      $bb = New-Object System.Drawing.SolidBrush((Hex "#0e0d16"))
      RoundRect $g $bb $bx $by $bw $bh 10; $bb.Dispose()
      $bp = New-Object System.Drawing.Pen((Hex "#33334a"), 1)
      $g.DrawRectangle($bp, $bx, $by, $bw, $bh); $bp.Dispose()
      $g.DrawString($row.t, $fSmall, $brDim, $bx + 10, $by + 8)
      $g.DrawString($row.v, $fHead, (New-Object System.Drawing.SolidBrush((Hex $row.c))), $bx + 10, $by + 26)
      $y = $by + $bh + 10
    }
    default { $g.DrawString($row.t, $fBody, $brText, 22, $y); $y += 20 }
  }
}

$foot = New-Object System.Drawing.Pen((Hex "#2a2a3a"), 1)
$g.DrawLine($foot, 14, $H - 27, $W - 14, $H - 27); $foot.Dispose()
$g.DrawString($J.footer, $fSmall, $brDim, 16, $H - 21)
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$b2 = New-Object System.Drawing.Bitmap($Out)
$colors = New-Object 'System.Collections.Generic.HashSet[string]'
$tot = 0
for ($yy = 0; $yy -lt $b2.Height; $yy += 2) { for ($xx = 0; $xx -lt $b2.Width; $xx += 2) {
  $c = $b2.GetPixel($xx, $yy); $tot++
  [void]$colors.Add("$([int]($c.R/16))-$([int]($c.G/16))-$([int]($c.B/16))") } }
$b2.Dispose()
Add-Content -Path (Join-Path (Split-Path $Data) "_mj_cap_stats.txt") -Value "$Out|$W|$H|$($colors.Count)|0|$tot" -Encoding UTF8
Write-Host "RENDER OK $Out ${W}x${H} colors=$($colors.Count) samples=$tot"
