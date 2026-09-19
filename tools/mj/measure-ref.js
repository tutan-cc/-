/* ═══════════════════════════════════════════════════════════════════════════
   tools/mj/measure-ref.js — 从参考图**量坐标**（不靠目视估读，不靠描述猜）

   为什么要有它：布局返工三轮都卡在「凭描述猜位置」。参考图是真实麻将 App 的
   透视截图，唯一的可靠做法是**逐像素把每块元素量出来**，再按比例映射到我们的画布。

   输入：参考图的原始 RGB dump（Node 没有内置 JPEG 解码，所以先用 System.Drawing 转一次）：
     powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; \
       $b=New-Object System.Drawing.Bitmap '<参考图路径>'; \
       $r=New-Object System.Drawing.Rectangle 0,0,$b.Width,$b.Height; \
       $d=$b.LockBits($r,[System.Drawing.Imaging.ImageLockMode]::ReadOnly,[System.Drawing.Imaging.PixelFormat]::Format24bppRgb); \
       $y=New-Object byte[] ($d.Stride*$b.Height); \
       [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0,$y,0,$y.Length); $b.UnlockBits($d); \
       [System.IO.File]::WriteAllBytes('ref_raw.bin',$y)"
     （上面的 $b / $d / $y 变量名故意不重名 —— PowerShell 变量名大小写不敏感，踩过坑。）

   运行：node tools/mj/measure-ref.js <ref_raw.bin> [宽 高 行距] [--canvas 1240 860]
   默认 2868 1320 8604（那张 2868×1320 的参考图）。

   输出：① 分类像素统计 ② 绿色牌背的连通块（= 牌墙段）③ 象牙白连通块（= 手牌/副露/牌河/白棱）
        ④ 桌面绒面范围 ⑤ 一张归一化坐标表，并给出映射到我们画布上的坐标。
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path");

const bin = process.argv[2];
if (!bin) { console.error("用法：node tools/mj/measure-ref.js <ref_raw.bin> [宽 高 行距] [--canvas 1240 860]"); process.exit(2); }
const nums = process.argv.slice(3).filter(a => /^\d+$/.test(a)).map(Number);
const W = nums[0] || 2868, H = nums[1] || 1320, STRIDE = nums[2] || W * 3;
const ci = process.argv.indexOf("--canvas");
const CW = ci > 0 ? Number(process.argv[ci + 1]) : 1240;
const CH = ci > 0 ? Number(process.argv[ci + 2]) : 860;

const buf = fs.readFileSync(bin);
if (buf.length < STRIDE * H) { console.error("dump 太小：" + buf.length + " < " + (STRIDE * H)); process.exit(2); }

/* ── 分类（照参考图的真实配色调的阈值）──────────────────────────────────────
   绿牌背：#20~#40 绿系，G 明显压过 R / B
   象牙白：牌面与白棱，R≈G≈B 且都高，R 略高于 B
   绒面：青绿桌面，B ≥ G（与牌背绿正好相反）
   其它：包间背景 / 暗色 UI / 圆盘 */
function cls(r, g, b) {
  if (g >= r + 22 && g >= b + 12 && g > 70 && g < 215) return 1;         // GREEN 牌背
  if (r >= 160 && g >= 155 && b >= 140 && r >= b + 3 && Math.abs(r - g) <= 34) return 2; // IVORY
  if (b >= g + 3 && b > 70) return 3;                                     // FELT
  return 0;
}
const px = (x, y) => { const i = y * STRIDE + x * 3; return [buf[i], buf[i + 1], buf[i + 2]]; };

/* ── 连通块（粗网格 + 4 邻域）：网格 = CELL px 一格 ───────────────────────── */
const CELL = 6;
const gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL);
function components(want) {
  const g = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let hit = 0, tot = 0;
    for (let y = gy * CELL; y < Math.min(H, gy * CELL + CELL); y += 2)
      for (let x = gx * CELL; x < Math.min(W, gx * CELL + CELL); x += 2) { tot++; if (cls(...px(x, y)) === want) hit++; }
    if (tot && hit / tot >= 0.5) g[gy * gw + gx] = 1;
  }
  const seen = new Uint8Array(gw * gh), out = [], st = [];
  for (let i = 0; i < g.length; i++) {
    if (!g[i] || seen[i]) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    st.length = 0; st.push(i); seen[i] = 1;
    while (st.length) {
      const c = st.pop(), cx = c % gw, cy = (c - cx) / gw;
      n++;
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      const nb = [c - 1, c + 1, c - gw, c + gw];
      for (const k of nb) {
        if (k < 0 || k >= g.length || seen[k] || !g[k]) continue;
        const kx = k % gw;
        if (Math.abs(kx - cx) > 1) continue;                 // 别跨行绕回
        seen[k] = 1; st.push(k);
      }
    }
    if (n < 4) continue;                                     // 太小的噪声块不要
    out.push({ x: x0 * CELL, y: y0 * CELL, w: (x1 - x0 + 1) * CELL, h: (y1 - y0 + 1) * CELL, cells: n });
  }
  return out.sort((a, b) => b.cells - a.cells);
}
const f2 = v => (v / W).toFixed(3), f2y = v => (v / H).toFixed(3);
const toCX = v => Math.round(v / W * CW), toCY = v => Math.round(v / H * CH);
function dump(title, list, limit) {
  console.log("\n=== " + title + "（按面积降序，前 " + limit + " 块）===");
  console.log("  #  像素 x..x+w        y..y+h         归一化 x      y       → 画布(1240×860)");
  list.slice(0, limit).forEach((c, i) => {
    console.log("  " + String(i + 1).padStart(2) + "  " +
      (c.x + ".." + (c.x + c.w)).padEnd(8) + " " + (c.y + ".." + (c.y + c.h)).padEnd(15) +
      f2(c.x) + ".." + f2(c.x + c.w) + "  " + f2y(c.y) + ".." + f2y(c.y + c.h) + "   " +
      "x " + String(toCX(c.x)).padStart(4) + ".." + String(toCX(c.x + c.w)).padStart(4) +
      "  y " + String(toCY(c.y)).padStart(4) + ".." + String(toCY(c.y + c.h)).padStart(4) +
      "   (" + c.cells + " 格)");
  });
}

/* ── 分类像素统计 + 绒面范围 ─────────────────────────────────────────────── */
const cnt = [0, 0, 0, 0];
let fx0 = 1e9, fy0 = 1e9, fx1 = -1, fy1 = -1;
for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) {
  const t = cls(...px(x, y)); cnt[t]++;
  if (t === 3) { fx0 = Math.min(fx0, x); fx1 = Math.max(fx1, x); fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y); }
}
console.log("[参考图] " + W + "×" + H + "  像素分类：绿牌背 " + cnt[1] + " · 象牙白 " + cnt[2] +
  " · 绒面 " + cnt[3] + " · 其它 " + cnt[0]);
console.log("[绒面范围] x " + fx0 + ".." + fx1 + "（归一化 " + f2(fx0) + ".." + f2(fx1) + "）  y " +
  fy0 + ".." + fy1 + "（归一化 " + f2y(fy0) + ".." + f2y(fy1) + "）");

const greens = components(1), ivories = components(2);
dump("绿色牌背连通块（= 牌墙段 / 立牌）", greens, 24);
dump("象牙白连通块（= 手牌 / 副露 / 牌河 / 白棱）", ivories, 28);

/* ── 中央圆盘：在画面中心附近找「大片非绒面暗色」的圆形区域 ───────────────── */
let bx = 0, by = 0, bn = 0;
const cx0 = Math.round(W * 0.30), cx1 = Math.round(W * 0.70), cy0 = Math.round(H * 0.15), cy1 = Math.round(H * 0.65);
for (let y = cy0; y < cy1; y += 3) for (let x = cx0; x < cx1; x += 3) {
  const t = cls(...px(x, y));
  if (t !== 3 && t !== 1 && t !== 2) { bx += x; by += y; bn++; }
}
if (bn) {
  const ccx = bx / bn, ccy = by / bn;
  let rr = 0;
  for (let y = cy0; y < cy1; y += 3) for (let x = cx0; x < cx1; x += 3) {
    const t = cls(...px(x, y));
    if (t !== 3 && t !== 1 && t !== 2) rr = Math.max(rr, Math.hypot(x - ccx, y - ccy));
  }
  console.log("\n=== 中央圆盘（粗估：画面中心附近的非绒面暗块质心 + 外接半径）===");
  console.log("  圆心 (" + Math.round(ccx) + ", " + Math.round(ccy) + ")  半径 ≈ " + Math.round(rr) +
    "   归一化 圆心 (" + (ccx / W).toFixed(3) + ", " + (ccy / H).toFixed(3) + ")  半径 " + (rr / W).toFixed(3));
  console.log("  → 画布(1240×860)：圆心 (" + toCX(ccx) + ", " + toCY(ccy) + ")  半径 " + Math.round(rr / W * CW));
}

/* ── 逐行 / 逐列的绿像素投影：看清「四段墙」各占哪一段 ───────────────────── */
function proj(axis, want) {
  const n = axis === "x" ? gw : gh, out = new Array(n).fill(0);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let hit = 0, tot = 0;
    for (let y = gy * CELL; y < Math.min(H, gy * CELL + CELL); y += 2)
      for (let x = gx * CELL; x < Math.min(W, gx * CELL + CELL); x += 2) { tot++; if (cls(...px(x, y)) === want) hit++; }
    if (tot && hit / tot >= 0.5) out[axis === "x" ? gx : gy]++;
  }
  const runs = []; let st = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && out[i] >= 2;
    if (on && st < 0) st = i;
    if (!on && st >= 0) { runs.push([st * CELL, (i - 1) * CELL]); st = -1; }
  }
  return runs;
}
console.log("\n=== 绿像素投影（找「四段墙」各自的跨度）===");
console.log("  按列（x 方向）：" + proj("x", 1).map(r => r[0] + ".." + r[1] +
  "（" + f2(r[0]) + ".." + f2(r[1]) + "）").join("  |  "));
console.log("  按行（y 方向）：" + proj("y", 1).map(r => r[0] + ".." + r[1] +
  "（" + f2y(r[0]) + ".." + f2y(r[1]) + "）").join("  |  "));
console.log("\n=== 象牙白投影（找手牌 / 牌河带）===");
console.log("  按行（y 方向）：" + proj("y", 2).map(r => r[0] + ".." + r[1] +
  "（" + f2y(r[0]) + ".." + f2y(r[1]) + "）").join("  |  "));
