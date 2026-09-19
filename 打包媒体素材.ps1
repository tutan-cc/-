<#
  打包媒体素材.ps1 —— 从媒体素材库生成「媒体清单.json」并打出可分发 zip

  用途：素材不入 git。这个脚本把素材库做成一个带版本号、可校验的压缩包，
        传到 GitHub Release，协作者下载解压后跑「接媒体素材.ps1」即可完整游玩。

  用法：
    powershell -ExecutionPolicy Bypass -File .\打包媒体素材.ps1
    powershell -ExecutionPolicy Bypass -File .\打包媒体素材.ps1 -Version v1.15 -MediaDir "D:\媒体素材"

  产出：
    <仓库>\媒体清单.json          入库的契约文件（体积小，只记路径/字节/SHA256/来源）
    <仓库>\dist\media-<版本>.zip  分发包（传到 GitHub Release）
#>
param(
  [string]$Version = "v1.15",
  [string]$MediaDir
)

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }

function Test-MediaLib([string]$d) {
  if (-not $d -or -not (Test-Path $d)) { return $false }
  $v = Join-Path $d "video"
  if (-not (Test-Path $v)) { return $false }
  return @(Get-ChildItem $v -Filter *.mp4 -File -ErrorAction SilentlyContinue).Count -gt 0
}

# ── 1. 定位素材库（与 接媒体素材.ps1 同一套逻辑）────────────────────
if (-not (Test-MediaLib $MediaDir)) {
  if ($MediaDir) { throw "不是有效的媒体素材库（需含 video\*.mp4）：$MediaDir" }
  $parent = Split-Path $repo -Parent
  $cands = @()
  $preferred = Join-Path $parent "重生2-媒体素材"
  if (Test-MediaLib $preferred) { $cands = @($preferred) }
  else {
    $cands = Get-ChildItem $parent -Directory -ErrorAction SilentlyContinue |
             Where-Object { $_.FullName -ne $repo -and (Test-MediaLib $_.FullName) } |
             Select-Object -ExpandProperty FullName
  }
  if (@($cands).Count -eq 0) { throw "找不到媒体素材目录，请用 -MediaDir 指定。" }
  $MediaDir = @($cands)[0]
}
$MediaDir = (Resolve-Path $MediaDir).Path
Write-Host "媒体素材库：$MediaDir" -ForegroundColor Cyan

# ── 2. 计算清单（逐文件 SHA256）─────────────────────────────────────
# 来源分类：原创程序化动画属于代码仓库；其余实拍素材授权未核实，标 thirdparty。
$ORIGINAL = @("video/fx_market.mp4","video/fx_flood.mp4",
              "video/poster/fx_market.jpg","video/poster/fx_flood.jpg")

$files = Get-ChildItem $MediaDir -Recurse -File |
         Where-Object { $_.FullName -notlike "*\README.md" } |
         Sort-Object FullName

Write-Host "计算 SHA256（$($files.Count) 个文件，约 $([math]::Round((($files|Measure-Object Length -Sum).Sum/1MB),1)) MB）..." -ForegroundColor Cyan
$entries = @()
$n = 0
foreach ($f in $files) {
  $rel = $f.FullName.Substring($MediaDir.Length).TrimStart('\') -replace '\\','/'
  $h = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower()
  $entries += [ordered]@{
    path   = $rel
    bytes  = $f.Length
    sha256 = $h
    source = if ($ORIGINAL -contains $rel) { "original" } else { "thirdparty" }
    license = if ($ORIGINAL -contains $rel) { "原创-程序化生成" } else { "未核实-仅供本地试验" }
  }
  $n++
  if ($n % 40 -eq 0) { Write-Host "  $n / $($files.Count)" -ForegroundColor DarkGray }
}

$manifest = [ordered]@{
  package  = "重生2-原型-媒体素材"
  version  = $Version
  generated = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  note     = "素材不入 git 仓库；本清单入库作为契约。协作者下载 media-$Version.zip 解压到仓库同级目录后，运行 接媒体素材.ps1 即可接通。"
  root     = @("video","audio")
  counts   = [ordered]@{
    mp4    = @($entries | Where-Object { $_.path -like "video/*.mp4" }).Count
    poster = @($entries | Where-Object { $_.path -like "video/poster/*" }).Count
    vo     = @($entries | Where-Object { $_.path -like "audio/vo/*" }).Count
    voReal = @($entries | Where-Object { $_.path -like "audio/vo_real/*" }).Count
    mj     = @($entries | Where-Object { $_.path -like "audio/mj/*" }).Count
    total  = $entries.Count
  }
  files    = $entries
}

$manifestPath = Join-Path $repo "媒体清单.json"
$json = $manifest | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "已写出清单：$manifestPath" -ForegroundColor Green
Write-Host ("  mp4={0} poster={1} vo={2} vo_real={3} mj={4}  共 {5} 个文件" -f `
  $manifest.counts.mp4,$manifest.counts.poster,$manifest.counts.vo,$manifest.counts.voReal,$manifest.counts.mj,$manifest.counts.total)

# ── 3. 打包 ─────────────────────────────────────────────────────────
$dist = Join-Path $repo "dist"
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$zip = Join-Path $dist "media-$Version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

Write-Host "打包中..." -ForegroundColor Cyan
# 压到临时目录再 Compress-Archive，保证 zip 内是 video\ / audio\ 顶层结构
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("medstage_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach ($d in @("video","audio")) {
  $src = Join-Path $MediaDir $d
  if (Test-Path $src) { Copy-Item $src (Join-Path $stage $d) -Recurse -Force }
}
# 素材库自己的 README 也带上，方便拿到包的人理解结构
Copy-Item (Join-Path $MediaDir "README.md") (Join-Path $stage "README.md") -Force -ErrorAction SilentlyContinue

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force

$zmb = [math]::Round((Get-Item $zip).Length/1MB,1)
Write-Host "已打包：$zip  ($zmb MB)" -ForegroundColor Green
Write-Host ""
Write-Host "下一步（传 GitHub Release）：" -ForegroundColor Cyan
Write-Host "  1. 把 媒体清单.json 提交进 git（体积小，是契约文件）"
Write-Host "  2. 在 GitHub 仓库页 Releases -> Draft a new release，tag 填 $Version"
Write-Host "  3. 把 dist\media-$Version.zip 作为附件上传（Release 附件不受 100MB 单文件限制）"
Write-Host "  4. 把下载链接贴进 README 的「协作者上手」一节"
