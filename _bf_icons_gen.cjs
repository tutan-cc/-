/* ═══════════════════════════════════════════════════════════════════════════
   _bf_icons_gen.cjs — 九宫格素材 → 9 张透明底图标（art/icons/<foodId>.png）

   做四件事（全部纯 Node，只用内置 zlib，不依赖 PIL/numpy/ffmpeg）：
     1) 解析 1254×1254 九宫格，逐格求「真实内容包围盒」（白阈值 235）；
     2) 按行/列的内容间隙算出**不切边的裁剪框**（1254/3=418 是整数，
        但白粥右侧的"耳朵"会越过 418 网格线 13px —— 所以列偏移取
        相邻图标内容之间的空隙中点，而不是死板的 418 等分，避免切到图标）；
     3) 白底 → 透明（alpha 斜坡 + un-premultiply，消除白边/白晕）；
     4) 等比缩放居中到 256×256，逐张输出 PNG 并打印像素统计做非空白验证。

   用法：node _bf_icons_gen.cjs [--preview]
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), zlib = require("zlib"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");

const OUT = __dirname;
const SRC = path.join(OUT, "art", "lovart_63f2f17a1187.png");
const ICON_DIR = path.join(OUT, "art", "icons");

/* ── 行优先顺序的 9 格 → breakfast.js 的 foodId ──
   注意：第 3 行第 1 格（包子）在 breakfast.js 里的 id 是 "bun"（不是 baozi）。 */
const GRID = [
  ["congee", "milk", "soup"],
  ["egg", "bacon", "sandwich"],
  ["bun", "salad", "juice"]
];
const TARGET = 256;        // 输出尺寸
const PAD = 12;            // 输出画布内每边留白（px）

/* ═══ PNG 解码（8bit，颜色类型 0/2/4/6，非隔行）═══ */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let p = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data); else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error("只支持 8bit（实际 " + depth + "）");
  if (interlace) throw new Error("不支持隔行 PNG");
  const ch = color === 0 ? 1 : color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : -1;
  if (ch < 0) throw new Error("不支持颜色类型 " + color);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(w * h * ch);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0, v = line[x];
      let r;
      if (ft === 0) r = v; else if (ft === 1) r = v + a; else if (ft === 2) r = v + b;
      else if (ft === 3) r = v + ((a + b) >> 1);
      else if (ft === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else throw new Error("未知过滤器 " + ft + " @row " + y);
      cur[x] = r & 255;
    }
    cur.copy(out, y * stride); prev = cur;
  }
  return { w, h, ch, data: out };
}

/* ═══ PNG 编码（RGBA8，filter 0）═══ */
let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) { CRC_T = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ═══ 读源图 ═══ */
const img = decodePNG(fs.readFileSync(SRC));
if (img.w % 3 || img.h % 3) console.log("⚠ 源图 " + img.w + "x" + img.h + " 不是 3 的整数倍");
if (img.ch !== 3) console.log("⚠ 源图通道数 " + img.ch + "（期望 3）");
const PX = (x, y) => { const i = (y * img.w + x) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const MIN3 = (x, y) => { const i = (y * img.w + x) * img.ch; return Math.min(img.data[i], img.data[i + 1], img.data[i + 2]); };

/* ═══ 1) 逐格内容包围盒（阈值 235，忽略贴白底的浅灰残留）═══ */
const CELL = img.w / 3;                       // 418
const TH_BOX = 235;
console.log("源图 " + img.w + "x" + img.h + "  ch=" + img.ch + "  格子=" + CELL + "×" + CELL);
console.log("\n── 1) 逐格内容包围盒（白阈值 min(rgb) < " + TH_BOX + "）──");
const cells = [];
for (let ry = 0; ry < 3; ry++) for (let rx = 0; rx < 3; rx++) {
  const ox = rx * CELL, oy = ry * CELL;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    if (MIN3(ox + x, oy + y) < TH_BOX) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  cells.push({ ry, rx, id: GRID[ry][rx], bx0: ox + x0, by0: oy + y0, bx1: ox + x1, by1: oy + y1, n });
  console.log("  行" + (ry + 1) + "列" + (rx + 1) + " " + GRID[ry][rx].padEnd(9) +
    " 内容=[" + (ox + x0) + "," + (oy + y0) + " → " + (ox + x1) + "," + (oy + y1) + "]" +
    "  宽" + (x1 - x0 + 1) + "×高" + (y1 - y0 + 1) + "  像素=" + n);
}

/* ═══ 2) 裁剪框：用「内容间隙的中点」当格线，保证不切边 ═══
   列：把 x 分成 [min(content), max(content)]，两组相邻内容之间取中点当分界。
   行：同理。若某方向没有间隙（图标紧贴），退化为中位数居中。 */
function gapMid(axis, near) {
  /* 收集所有内容像素在 axis 上的投影，找 near 附近最宽的空白区，返回其中心 */
  const lo = Math.max(0, near - 40), hi = Math.min((axis === "x" ? img.w : img.h) - 1, near + 40);
  let best = null, runStart = -1;
  for (let t = lo; t <= hi; t++) {
    let blank = true;
    if (axis === "x") { for (let y = 0; y < img.h && blank; y++) if (MIN3(t, y) < TH_BOX) blank = false; }
    else { for (let x = 0; x < img.w && blank; x++) if (MIN3(x, t) < TH_BOX) blank = false; }
    if (blank) { if (runStart < 0) runStart = t; }
    else { if (runStart >= 0) { const c = (runStart + t - 1) / 2; if (!best || Math.abs(c - near) < Math.abs(best - near)) best = c; runStart = -1; } }
  }
  if (runStart >= 0) { const c = (runStart + hi) / 2; if (!best || Math.abs(c - near) < Math.abs(best - near)) best = c; }
  return best;
}
const colCut = [], rowCut = [];
for (let k = 1; k <= 2; k++) colCut.push(gapMid("x", k * CELL));
for (let k = 1; k <= 2; k++) rowCut.push(gapMid("y", k * CELL));
console.log("\n── 2) 真实格线（相邻图标内容之间的空隙中点）──");
console.log("  列分界 x = " + colCut.map(v => v === null ? "无间隙" : v).join(" , ") + "   （等分线 418 / 836）");
console.log("  行分界 y = " + rowCut.map(v => v === null ? "无间隙" : v).join(" , "));

/* 裁剪框：以「格心」为中心、边长 CELL 的正方形（保证 418×418 统一尺寸），
   但把格心夹在 [内容中心, 内容中心] 附近、且不越过真实格线 ± 半格。 */
const colEdge = [0, colCut[0], colCut[1], img.w].map(v => v === null ? null : Math.round(v));
const rowEdge = [0, rowCut[0], rowCut[1], img.h].map(v => v === null ? null : Math.round(v));
/** 裁剪框：整数偏移（像素必须整取！小数偏移会让取色越界），
    大小 = 内容 + 两侧各 MG 边距，再夹到本格的可用区间里。 */
const MG_REL = 0.03, MG_MIN = 8;                 // 内容外留 3%（至少 8px）
function makeBox(lo, hi, contentLo, contentHi, limit) {
  const cw = contentHi - contentLo + 1;
  const mg = Math.max(MG_MIN, Math.round(cw * MG_REL));
  const want = cw + 2 * mg;
  let loOk = Math.max(0, lo === null ? 0 : lo), hiOk = Math.min(limit, hi === null ? limit : hi);
  let span = Math.min(want, hiOk - loOk);         // 不能超出本格可用区间
  if (span < cw) span = cw;                       // 兜底：区间比内容还窄也要保住内容
  let start = Math.round((contentLo + contentHi + 1) / 2 - span / 2);
  if (start < loOk) start = loOk;
  if (start + span > hiOk) start = hiOk - span;
  if (start < 0) start = 0;
  if (start + span > limit) start = limit - span;
  return { start: Math.round(start), span: Math.round(span) };
}
console.log("\n── 裁剪参数（保证 418×418 且完整包住图标）──");
const jobs = [];
for (let ry = 0; ry < 3; ry++) for (let rx = 0; rx < 3; rx++) {
  const c = cells[ry * 3 + rx];
  const gx0 = colEdge[rx], gx1 = colEdge[rx + 1];
  const gy0 = rowEdge[ry], gy1 = rowEdge[ry + 1];
  const hb = makeBox(gx0, gx1, c.bx0, c.bx1, img.w);
  const vb = makeBox(gy0, gy1, c.by0, c.by1, img.h);
  /* 越界保护：确保不会切到内容 */
  let warn = "";
  if (hb.start > c.bx0 || hb.start + hb.span <= c.bx1) warn += " ⚠横向切边";
  if (vb.start > c.by0 || vb.start + vb.span <= c.by1) warn += " ⚠纵向切边";
  if (hb.start < 0 || vb.start < 0 || hb.start + hb.span > img.w || vb.start + vb.span > img.h) warn += " ⚠越界";
  jobs.push({ id: c.id, ry, rx, x: hb.start, y: vb.start, w: hb.span, h: vb.span, warn, cell: c });
  console.log("  " + c.id.padEnd(9) + " crop=" + hb.span + ":" + hb.span + ":" + hb.start + ":" + vb.start +
    "   （x " + hb.start + ".." + (hb.start + hb.span - 1) + " ／ y " + vb.start + ".." + (vb.start + vb.span - 1) + "）" +
    "  内容余量 左" + (c.bx0 - hb.start) + " 右" + (hb.start + hb.span - 1 - c.bx1) +
    " 上" + (c.by0 - vb.start) + " 下" + (vb.start + vb.span - 1 - c.by1) + warn);
}

/* ═══ 3) 白底 → 透明 ═══
   三个必须同时成立的判断，缺一个就会翻车（都是实测踩出来的）：

   ① 「背景」= 从图边界沿近白像素 4 邻域洪泛到的连通区域（阈值 NW_BG 取得偏高，如 248）。
      图标有闭合的深色描边，洪泛进不去，所以白粥的粥面、热牛奶的奶面、煎蛋的蛋清
      这些**本身就接近纯白**的食材内部不会被当成背景 → 不会被抠成透明。

   ② 半透明的「白晕带」必须同时满足两个条件：**白（minC ≥ T1）** 且 **紧贴真背景**。
      · 只看白 → 白粥内部的米粒描边（minC≈245）、蛋清上的焦斑会被判成半透明，
        在深色木台上透出黑点（第一版就翻在这）；
      · 只看「紧贴背景」→ 白粥底缘最深的那圈边缘（minC≈235）会保持 α=255，
        外圈却是半透明，交界处出现锯齿状的"虚线边"（第二版翻在这）。
      两个条件一起用，正好只圈住真正的抗锯齿外圈，内部细节一律 α=255 且**颜色原样不动**。

   ③ un-premultiply 消除残留白底贡献时，单通道上涨幅度夹在 UP_MAX 以内 ——
      否则会把本来就很深的像素反算成纯白，木台上出现刺眼白点。 */
const CFG = {
  NW_BG: +(process.argv[2] || 248),   // ① 真背景洪泛阈值
  T1: +(process.argv[3] || 236),      // ② 白晕带的下限（minC ≤ T1 一律不透明）
  UP_MAX: +(process.argv[4] || 20),   // ③ un-premultiply 单通道最大上涨幅度
  TAG: process.argv[5] || ""          // 输出文件名后缀（对比变体用）
};
const NW_BG = CFG.NW_BG, T1 = CFG.T1, UP_MAX = CFG.UP_MAX;
function minC(getRGB, x, y) { const c = getRGB(x, y); return Math.min(c[0], c[1], c[2]); }
function whiteToAlpha(getRGB, w, h) {
  /* ① 真背景洪泛 */
  const bg = new Uint8Array(w * h);
  const stack = [];
  const near = (x, y) => minC(getRGB, x, y) >= NW_BG;
  for (let x = 0; x < w; x++) {
    if (near(x, 0)) { bg[x] = 1; stack.push(x, 0); }
    if (near(x, h - 1)) { bg[(h - 1) * w + x] = 1; stack.push(x, h - 1); }
  }
  for (let y = 0; y < h; y++) {
    if (near(0, y)) { bg[y * w] = 1; stack.push(0, y); }
    if (near(w - 1, y)) { bg[(h - 1) * w + w - 1] = 1; stack.push(w - 1, y); }
  }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (bg[k] || !near(nx, ny)) continue;
      bg[k] = 1; stack.push(nx, ny);
    }
  }
  const touched = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (bg[ny * w + nx]) return true;
    }
    return false;
  };
  /* ② 覆盖率场（coverage field）——先算「必为背景=0 / 必为前景=1 / 边缘待定」，
     再做一次 3×3 加权平滑。这一步是消除边缘锯齿的关键：
     原图抗锯齿外圈的覆盖率本身是连续渐变的，但「背景/前景」两分法会把它切成
      0 和 1 的硬跳变，缩放后就成了锯齿状白边；平滑后覆盖率重新变成连续值。 */
  /* ② 到真背景的距离场（BFS，只关心 ≤BAND 跳）。
     没有这个限制时，只要「够白」就被判半透明：白粥内部的米粒、蛋清上的焦斑
     会整片变半透明 → 深色木台上透出黑点。 */
  const BAND = 3;
  const dist = new Uint8Array(w * h).fill(255);
  {
    const q = [];
    for (let i = 0; i < w * h; i++) if (bg[i]) { dist[i] = 0; q.push(i); }
    for (let head = 0; head < q.length; head++) {
      const k = q[head], d0 = dist[k];
      if (d0 >= BAND) continue;
      const x = k % w, y = (k - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nk = ny * w + nx;
        if (dist[nk] > d0 + 1) { dist[nk] = d0 + 1; q.push(nk); }
      }
    }
  }
  /* ③ 覆盖率场：必背景=0 / 必前景=1 / 只有「离背景 ≤BAND 的白晕」才按白度插值；
     然后对 3×3 加权平滑一次 —— 两分法把连续的抗锯齿外圈切成了 0/1 硬跳变，
     缩放后就是锯齿白边，平滑让覆盖率重新变成连续值。内部（distance > BAND+1）锁死 1。 */
  const K = [1, 2, 1, 2, 4, 2, 1, 2, 1], KS = 16;
  const cov = new Float32Array(w * h);
  let nBg = 0, nAmbig = 0, nSolid = 0, nHalo = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (bg[k]) { cov[k] = 0; nBg++; continue; }
    const m = minC(getRGB, x, y);
    if (m >= NW_BG) { cov[k] = 1; nAmbig++; continue; }          // 被包住的近白（粥面/奶面/蛋清）→ 实心
    if (dist[k] > BAND || m <= T1) { cov[k] = 1; nSolid++; continue; }   // 内部 / 够深 → 实心
    cov[k] = Math.max(0, Math.min(1, (255 - m) / (255 - T1)));   // 真正的外圈白晕
    nHalo++;
  }
  const edgeNear = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (cov[ny * w + nx] < 1) return true;
    }
    return false;
  };
  const sm = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (dist[k] > BAND + 1 || (cov[k] === 1 && !edgeNear(x, y))) { sm[k] = cov[k]; continue; }
    let acc = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      acc += K[(dy + 1) * 3 + (dx + 1)] * cov[ny * w + nx];
    }
    sm[k] = acc / KS;
  }
  /* ④ 中值滤波（5×5，只作用在外圈带）：原图的抗锯齿外圈里有零星孤立像素
     （描边上的高光/噪点），它们会被判成 0 或 1，缩放后在深色木台上就是"白齿"。
     中值滤波专门吃孤立点、保边缘，正好治这个。内部与纯背景都不动。 */
  const med = new Float32Array(sm);
  const buf = new Float32Array(25);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (dist[k] === 0 || dist[k] > BAND) continue;
    let n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      buf[n++] = sm[ny * w + nx];
    }
    const sub = Array.prototype.slice.call(buf, 0, n).sort((a, b) => a - b);
    med[k] = sub[n >> 1];
  }
  const out = Buffer.alloc(w * h * 4);
  let nFull = 0, nSemi = 0, nInnerLight = 0, nClamped = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    let [r, g, b] = getRGB(x, y);
    const m = Math.min(r, g, b);
    let a = med[k];
    if (a <= 0.002) { out[k * 4] = r; out[k * 4 + 1] = g; out[k * 4 + 2] = b; out[k * 4 + 3] = 0; continue; }
    if (a >= 0.998) {
      out[k * 4] = r; out[k * 4 + 1] = g; out[k * 4 + 2] = b; out[k * 4 + 3] = 255; nFull++;
      if (m >= NW_BG) nInnerLight++;              // 被包住的近白像素（粥面/奶面/蛋清/米粒）→ 完整保留
      continue;
    }
    /* ③ 边缘像素：按覆盖率 un-premultiply 消白底贡献，单通道上涨夹在 UP_MAX 内 */
    const A = Math.max(1, Math.min(254, Math.round(a * 255)));
    const f = 255 / A;
    const nr = Math.round(255 - (255 - r) * f), ng = Math.round(255 - (255 - g) * f), nb = Math.round(255 - (255 - b) * f);
    if (nr > r + UP_MAX || ng > g + UP_MAX || nb > b + UP_MAX) nClamped++;
    r = Math.max(0, Math.min(255, Math.min(nr, r + UP_MAX)));
    g = Math.max(0, Math.min(255, Math.min(ng, g + UP_MAX)));
    b = Math.max(0, Math.min(255, Math.min(nb, b + UP_MAX)));
    out[k * 4] = r; out[k * 4 + 1] = g; out[k * 4 + 2] = b; out[k * 4 + 3] = A;
    nSemi++;
  }
  return { rgba: out, nBg, nFull, nSemi, nInnerLight, nClamped, nAmbig, nSolid, nHalo };
}

/* ═══ 4) 缩放居中到 256×256（面积平均 box filter）═══
   9 张**共用同一个缩放系数**（由最大那张决定），这样各图标之间的相对大小保持不变，
   只是统一缩到画布内；再各自居中。 */
function scaleToCanvas(rgba, sw, sh, size, scale) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (rgba[(y * sw + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const dw = Math.max(1, Math.round((x1 - x0 + 1) * scale)), dh = Math.max(1, Math.round((y1 - y0 + 1) * scale));
  const offX = Math.round((size - dw) / 2), offY = Math.round((size - dh) / 2);
  const out = Buffer.alloc(size * size * 4);
  for (let dy = 0; dy < dh; dy++) for (let dx = 0; dx < dw; dx++) {
    /* 目标像素覆盖的源矩形 */
    const sx0f = x0 + (dx / scale), sx1f = x0 + ((dx + 1) / scale);
    const sy0f = y0 + (dy / scale), sy1f = y0 + ((dy + 1) / scale);
    const ix0 = Math.max(0, Math.floor(sx0f)), ix1 = Math.min(sw - 1, Math.ceil(sx1f) - 1);
    const iy0 = Math.max(0, Math.floor(sy0f)), iy1 = Math.min(sh - 1, Math.ceil(sy1f) - 1);
    let sr = 0, sg = 0, sb = 0, sa = 0, wsum = 0;
    for (let sy = iy0; sy <= iy1; sy++) for (let sx = ix0; sx <= ix1; sx++) {
      const wx = Math.min(sx + 1, sx1f) - Math.max(sx, sx0f);
      const wy = Math.min(sy + 1, sy1f) - Math.max(sy, sy0f);
      const w = Math.max(0, wx) * Math.max(0, wy);
      if (w <= 0) continue;
      const k = (sy * sw + sx) * 4, a = rgba[k + 3] / 255;
      sr += rgba[k] * w * a; sg += rgba[k + 1] * w * a; sb += rgba[k + 2] * w * a; sa += a * w; wsum += w;
    }
    const k = ((dy + offY) * size + (dx + offX)) * 4;
    if (sa > 1e-6) { out[k] = Math.round(sr / sa); out[k + 1] = Math.round(sg / sa); out[k + 2] = Math.round(sb / sa); out[k + 3] = Math.round(255 * sa / wsum); }
  }
  return { rgba: out, offX, offY, dw, dh, srcBox: [x0, y0, x1, y1] };
}

/* ═══ 主流程 ═══ */
if (!fs.existsSync(ICON_DIR)) fs.mkdirSync(ICON_DIR, { recursive: true });
console.log("\n── 3/4) 去白底 + 缩放居中 → " + TARGET + "×" + TARGET + " ──");
/* 先算 9 张共用缩放：让「最大的那张内容」放进 (TARGET - 2*PAD) */
const maxSpan = Math.max(...jobs.map(j => Math.max(j.cell.bx1 - j.cell.bx0 + 1, j.cell.by1 - j.cell.by0 + 1)));
const SCALE = (TARGET - 2 * PAD) / maxSpan;
console.log("  最大内容跨度=" + maxSpan + "px → 共用缩放=" + SCALE.toFixed(4) +
  "（" + TARGET + "px 画布 － " + PAD + "px×2 边距）");
const report = [];
for (const j of jobs) {
  const get = (x, y) => PX(j.x + x, j.y + y);
  const t0 = Date.now();
  const { rgba, nBg, nFull, nSemi, nInnerLight } = whiteToAlpha(get, j.w, j.h);
  const sc = scaleToCanvas(rgba, j.w, j.h, TARGET, SCALE);
  if (!sc) { console.log("  ✗ " + j.id + " 全透明（裁剪框里没有内容）"); continue; }
  /* 非空白校验：统计最终图里不透明像素占比与颜色多样性 */
  let nz = 0, colors = new Set(), sumA = 0;
  for (let i = 0; i < TARGET * TARGET; i++) {
    const a = sc.rgba[i * 4 + 3]; sumA += a;
    if (a > 16) { nz++; colors.add(sc.rgba[i * 4] + "," + sc.rgba[i * 4 + 1] + "," + sc.rgba[i * 4 + 2]); }
  }
  const file = path.join(ICON_DIR, j.id + ".png");
  fs.writeFileSync(file, encodePNG(TARGET, TARGET, sc.rgba));
  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  report.push({ id: j.id, file, kb: +kb, coverage: +(100 * nz / (TARGET * TARGET)).toFixed(1), colors: colors.size, meanA: +(sumA / (TARGET * TARGET)).toFixed(1), drawSize: [sc.dw, sc.dh], nBg, nFull, nSemi, nInnerLight });
  console.log("  ✔ " + j.id.padEnd(9) + " " + path.basename(file).padEnd(14) + kb.padStart(6) + " KB" +
    "  不透明占比=" + (100 * nz / (TARGET * TARGET)).toFixed(1) + "%" +
    "  颜色数=" + colors.size + "  平均α=" + (sumA / (TARGET * TARGET)).toFixed(1) +
    "  画进画布=" + sc.dw + "×" + sc.dh + "  源内容盒=" + JSON.stringify(sc.srcBox) +
    "\n            抠图: 背景透明=" + nBg + "  实心=" + nFull + "  半透明=" + nSemi +
    "  内部近白(保留!)=" + nInnerLight + "  用时" + (Date.now() - t0) + "ms" +
    (nz < TARGET * TARGET * 0.05 ? "  ✗ 疑似空白" : ""));
}

/* ═══ 对照图：默认深色木台底（一眼看出白边），空格子画棋盘格 ═══ */
const SHEET = TARGET * 3 + 4 * 12;
function buildPreview(bgFn, bgName, file) {
  const px = Buffer.alloc(SHEET * SHEET * 4);
  for (let y = 0; y < SHEET; y++) for (let x = 0; x < SHEET; x++) {
    const k = (y * SHEET + x) * 4; const c = bgFn(x, y);
    px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; px[k + 3] = 255;
  }
  GRID.forEach((row, ry) => row.forEach((id, rx) => {
    const rec = report.find(r => r.id === id); if (!rec) return;
    const src = decodePNG(fs.readFileSync(rec.file));
    const ox = 12 + rx * (TARGET + 12), oy = 12 + ry * (TARGET + 12);
    for (let y = 0; y < TARGET; y++) for (let x = 0; x < TARGET; x++) {
      const s = (y * TARGET + x) * 4, a = src.data[s + 3] / 255;
      const d = ((oy + y) * SHEET + ox + x) * 4;
      px[d] = Math.round(src.data[s] * a + px[d] * (1 - a));
      px[d + 1] = Math.round(src.data[s + 1] * a + px[d + 1] * (1 - a));
      px[d + 2] = Math.round(src.data[s + 2] * a + px[d + 2] * (1 - a));
      px[d + 3] = 255;
    }
  }));
  fs.writeFileSync(file, encodePNG(SHEET, SHEET, px));
  return file;
}
const wood = buildPreview((x, y) => {
  const n = ((x * 7 + y * 13) % 11) - 5;
  return [Math.max(0, Math.min(255, 90 + n)), Math.max(0, Math.min(255, 58 + n)), Math.max(0, Math.min(255, 34 + n))];
}, "木台", path.join(ICON_DIR, "_sheet_preview" + CFG.TAG + ".png"));
const dark = buildPreview((x, y) => {
  const c = (Math.floor(x / 32) + Math.floor(y / 32)) % 2 ? 26 : 58;
  return [c, c, c + 4];
}, "深灰棋盘", path.join(ICON_DIR, "_sheet_preview" + CFG.TAG + "_checker.png"));
const white = buildPreview(() => [255, 255, 255], "白", path.join(ICON_DIR, "_sheet_preview" + CFG.TAG + "_white.png"));
/* 逐张放大 2× 的细节图：木台底 + 纯黑底（黑底最能暴露白边/白晕） */
function buildZoom(rec, bg, bgName, file) {
  const S = TARGET * 2, M = 16, W2 = S + 2 * M;
  const src = decodePNG(fs.readFileSync(rec.file));
  const px = Buffer.alloc(W2 * W2 * 4);
  for (let y = 0; y < W2; y++) for (let x = 0; x < W2; x++) {
    const k = (y * W2 + x) * 4, c = bg(x, y); px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; px[k + 3] = 255;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const s = (Math.floor(y / 2) * TARGET + Math.floor(x / 2)) * 4, a = src.data[s + 3] / 255;
    const d = ((y + M) * W2 + x + M) * 4;
    px[d] = Math.round(src.data[s] * a + px[d] * (1 - a));
    px[d + 1] = Math.round(src.data[s + 1] * a + px[d + 1] * (1 - a));
    px[d + 2] = Math.round(src.data[s + 2] * a + px[d + 2] * (1 - a));
  }
  fs.writeFileSync(file, encodePNG(W2, W2, px));
  return file;
}
const zoomWood = (x, y) => { const n = ((x * 7 + y * 13) % 11) - 5; return [90 + n, 58 + n, 34 + n]; };
console.log("\n── 逐张 2× 细节图（黑底最能看出白边）──");
for (const id of ["congee", "egg", "milk", "bun"]) {
  const rec = report.find(r => r.id === id);
  const f1 = buildZoom(rec, zoomWood, "木", path.join(OUT, "art", "icons", "_zoom_" + CFG.TAG + id + "_wood.png"));
  const f2 = buildZoom(rec, () => [0, 0, 0], "黑", path.join(OUT, "art", "icons", "_zoom_" + CFG.TAG + id + "_black.png"));
  console.log("  " + id + " → " + path.basename(f1) + " , " + path.basename(f2));
}
console.log("\n── 对照图 ──");
for (const f of [wood, dark, white]) console.log("  " + f + "  " + (fs.statSync(f).size / 1024).toFixed(1) + " KB  " + SHEET + "×" + SHEET);

/* ═══ 汇总 JSON（给报告/测试用）═══ */
const summary = {
  src: path.relative(OUT, SRC).replace(/\\/g, "/"), srcW: img.w, srcH: img.h, cell: CELL,
  cropOffsetRule: "列/行分界取「相邻图标内容之间的空隙中点」；裁剪框 418×418，内容居中",
  colCut, rowCut, jobs: jobs.map(j => ({ id: j.id, crop: "crop=" + j.w + ":" + j.h + ":" + j.x + ":" + j.y, x: j.x, y: j.y, w: j.w, h: j.h })),
  target: TARGET, pad: PAD, scale: +SCALE.toFixed(6), maxSpan,
  method: {
    name: "border-flood + distance-constrained coverage field + median",
    bgFloodThreshold: NW_BG,
    bandPx: 3,
    amberLowerBound: T1,
    unPremultiplyClamp: UP_MAX,
    steps: [
      "① 从图边界沿 minC ≥ " + NW_BG + " 的像素 4 邻域洪泛 → 真背景（α=0）；图标闭合描边挡住洪泛，内部近白食材（粥面/奶面/蛋清）不受影响",
      "② BFS 求到真背景的距离场，把哑光限制在 ≤3px 的外圈白晕内",
      "③ 外圈白晕按 minC 插值出覆盖率，3×3 加权平滑消除锯齿，内部锁死 α=255 且颜色原样不动",
      "④ 5×5 中值滤波消除外圈的孤立像素（白齿）",
      "⑤ 半透明像素做限量 un-premultiply（单通道上涨 ≤" + UP_MAX + "）消除残留白底贡献"
    ]
  },
  report
};
fs.writeFileSync(path.join(ICON_DIR, "_icons_report.json"), JSON.stringify(summary, null, 2));
console.log("\n汇总 → art/icons/_icons_report.json");
console.log(report.some(r => r.coverage < 5) ? "✗ 有图标疑似空白" : "✔ 9 张全部非空白");
