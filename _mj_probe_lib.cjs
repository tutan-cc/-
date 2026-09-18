/* _mj_probe_lib.cjs — 麻将浏览器实测的公共底座（供 _e2e_mj_system.js / _mj_shots.cjs 复用）
   沙箱事实（本机实测，2026-09 / Windows + DSH workspace-write）：
     · Chrome / Edge 全部起不来（mojo 命名管道被拒）→ 降级 mshta（Trident / IE11 引擎）真实渲染
     · mshta 里 canvas 没有 drawWindow；window.open 一调就卡死；PowerShell 的 PrintWindow 返回 0x0 矩形
     · 唯一能拿到真实像素的路子是 PowerShell(System.Drawing) 的 CopyFromScreen 屏幕拷贝，
       但**同一个 mshta 进程里连续拷贝超过 ~3 次就会挂住**（第 4 次起 Run 永不返回）
   → 结论：出图必须**按 mshta 进程分配预算**（每个进程 ≤3 张），断言与出图分开跑。 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const OUT = __dirname;

/** 中文 → JS \uXXXX 转义（HTA 文件保持纯 ASCII，避免编码问题） */
function U(s) {
  let o = "";
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0);
    o += c < 128 ? ch : "\\u" + c.toString(16).padStart(4, "0");
  }
  return o;
}

/** HTA 公共头部（doctype + charset + 最小 DOM stub 用的骨架由调用方补） */
function htaHead(title) {
  return [
    '<!DOCTYPE html><html><head><meta http-equiv="X-UA-Compatible" content="IE=edge">',
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>' + title + "</title>",
  ];
}

/* ── 截图助手：PowerShell(System.Drawing) 抓屏幕矩形 + 像素统计 ──
   必须写成「UTF-8 with BOM」：Windows PowerShell 5.1 读无 BOM 的 UTF-8 会把中文路径解成乱码，
   Add-Content 直接 DirectoryNotFound（本沙箱实测）。 */
function capPs1Src(dir) {
  const STATS = JSON.stringify(path.join(dir, "_mj_cap_stats.txt"));
  return `param([string]$Out, [int]$X, [int]$Y, [int]$W, [int]$H, [string]$Stamp)
$ErrorActionPreference = "Stop"
try {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Windows.Forms
  try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MjWin {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
}
"@ -ErrorAction SilentlyContinue
    Get-Process mshta -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
      [void][MjWin]::SetWindowPos($_.MainWindowHandle, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040)
    }
  } catch {}
  Start-Sleep -Milliseconds 300
  if ($W -lt 20) { $W = 20 }
  if ($H -lt 20) { $H = 20 }
  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size($W, $H)))
  $g.Dispose()
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $colors = New-Object 'System.Collections.Generic.HashSet[string]'
  $lum = New-Object 'System.Collections.Generic.HashSet[string]'
  $tot = 0
  for ($y = 0; $y -lt $H; $y += 2) {
    for ($x = 0; $x -lt $W; $x += 2) {
      $c = $bmp.GetPixel($x, $y); $tot++
      [void]$colors.Add("$([int]($c.R / 16))-$([int]($c.G / 16))-$([int]($c.B / 16))")
      [void]$lum.Add("$([int]($c.R / 32))-$([int]($c.G / 32))-$([int]($c.B / 32))")
    }
  }
  $bmp.Dispose()
  Add-Content -Path ${STATS} -Value "$Out|$W|$H|$($colors.Count)|$($lum.Count)|$tot" -Encoding UTF8
  if ($Stamp) { Set-Content -Path $Stamp -Value "ok" -Encoding ASCII }
} catch {
  Add-Content -Path ${STATS} -Value "$Out|ERR|0|0|0|0|$($_.Exception.Message)" -Encoding UTF8
  if ($Stamp) { Set-Content -Path $Stamp -Value "err" -Encoding ASCII }
}
`;
}

/** JScript 侧的 wf/fsize/cap 片段（由调用方 J() 进 HTA） */
function jsHelpers(outTxt) {
  return [
    'function wf(name, text) { var fso = new ActiveXObject("Scripting.FileSystemObject"); var ts = fso.CreateTextFile(DIR + name, true, false); ts.Write(text); ts.Close(); }',
    'function fsize(p) { try { var fso = new ActiveXObject("Scripting.FileSystemObject"); return fso.GetFile(p).Size; } catch (e) { return -1; } }',
    'function byId(id) { return document.getElementById(id); }',
    'var CAPLOG = [];',
    /* 同步屏幕拷贝；每个 mshta 进程最多用 3 次（第 4 次起沙箱会挂住） */
    'function cap(name, elId) {',
    '  try {',
    '    trace("cap-enter:" + name);',
    '    var el = byId(elId); if (!el) { CAPLOG.push(name + ":no-el"); return false; }',
    '    document.body.scrollTop = 0; document.body.scrollLeft = 0;',
    '    var r = el.getBoundingClientRect();',
    '    var x = Math.round(window.screenLeft + r.left) - 6, y = Math.round(window.screenTop + r.top) - 6;',
    '    var w = Math.round(r.width) + 12, h = Math.round(r.height) + 12;',
    '    if (w < 20 || h < 20) { CAPLOG.push(name + ":badgeom"); return false; }',
    '    var full = DIR + SHOTDIR + name;',
    '    var stamp = full + ".done";',
    '    try { var fo0 = new ActiveXObject("Scripting.FileSystemObject"); if (fo0.FileExists(stamp)) { fo0.DeleteFile(stamp); } } catch (e0) {}',
    '    var sh = new ActiveXObject("WScript.Shell");',
    '    var cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File \\"" + DIR + "_mj_cap.ps1\\" -Out \\"" + full + "\\" -X " + x + " -Y " + y + " -W " + w + " -H " + h + " -Stamp \\"" + stamp + "\\"";',
    '    trace("cap-run:" + name + " " + w + "x" + h + "@" + x + "," + y);',
    /* 异步 + 等完成哨兵：牌桌还在跑 raf 时同步 Run 会偶发卡死（本沙箱实测 outcome_note 场景） */
    '    sh.Run(cmd, 0, false);',
    '    var t0 = new Date().getTime(), seen = false;',
    '    while (new Date().getTime() - t0 < 30000) {',
    '      try { var fo1 = new ActiveXObject("Scripting.FileSystemObject"); if (fo1.FileExists(stamp)) { seen = true; break; } } catch (e1) {}',
    '      for (var sp = 0; sp < 40000; sp++) { var zz = sp * 1; }',
    '    }',
    '    trace("cap-done:" + name + ":stamp=" + seen + ":" + (new Date().getTime() - t0) + "ms");',    '    var sz = fsize(full);',
    '    CAPLOG.push(name + ":" + w + "x" + h + "@" + x + "," + y + ":" + sz);',
    '    return sz > 2000;',
    '  } catch (e) { CAPLOG.push(name + ":throw:" + String(e.message || e)); trace("cap-err:" + e.message); return false; }',
    '}',
    'function trace(s) { try { var fso = new ActiveXObject("Scripting.FileSystemObject"); var f = fso.OpenTextFile(DIR + "_mj_trace.txt", 8, true); f.WriteLine(String(s)); f.Close(); } catch (e) {} }',
  ];
}

/** 写 HTA + 抓图脚本，跑一次 mshta，等 sidecar 输出，返回 { ok, out, raw } */
async function runHta({ htaPath, outTxt, capPs1, htaBody, waitMs = 60000, keep = false }) {
  fs.writeFileSync(htaPath, htaBody, "utf8");
  if (capPs1) { fs.writeFileSync(capPs1, "\ufeff" + capPs1Src(OUT), { encoding: "utf8" }); }
  try { fs.rmSync(outTxt, { force: true }); } catch (e) {}
  if (!fs.existsSync("C:\\Windows\\System32\\mshta.exe")) return { ok: false, why: "mshta.exe 不存在" };
  const p = spawn("C:\\Windows\\System32\\mshta.exe", [htaPath], { stdio: "ignore", cwd: OUT });
  let raw = null;
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    await sleep(300);
    if (fs.existsSync(outTxt)) {
      const txt = fs.readFileSync(outTxt, "utf8");
      if (txt && txt.trim().length > 20) { raw = txt; break; }
    }
  }
  try { p.kill(); } catch (e) {}
  await sleep(250);
  let out = null;
  if (raw) { try { out = JSON.parse(raw.trim()); } catch (e) { out = null; } }
  if (!keep) { try { fs.rmSync(htaPath, { force: true }); } catch (e) {} }
  return { ok: !!out, why: out ? "" : "mshta 探针未产出结果（HTA 可能被拦截或超时）", out, raw };
}

/** 读 sidecar 像素统计 */
function readCapStats() {
  const f = path.join(OUT, "_mj_cap_stats.txt");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => {
    const [file, w, h, colors, lum, tot] = l.split("|");
    return { file, w: +w, h: +h, colors: +colors, lum: +lum, tot: +tot };
  });
}
function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

const SCENARIOS_PLACEHOLDER = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { OUT, U, htaHead, capPs1Src, jsHelpers, runHta, readCapStats, pngSize, sleep };
