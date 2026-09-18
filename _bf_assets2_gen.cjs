/* ═══════════════════════════════════════════════════════════════════════════
   _bf_assets2_gen.cjs — 第二批 Lovart 素材切片/裁切（零依赖，可重复运行）

   产物：
     art/icons/gear/plate_{empty,egg,bacon,sandwich,bun,salad}.png   盘面六宫格
     art/icons/faces/{fang,lu}_{calm,urgent,happy}.png               顾客头像六宫格
     art/icons/mj/*.png                                              麻将道具九宫格
     art/bg/kitchen2.png                                             早餐店背景 v2
     art/bg/mahjong.png                                              麻将包间背景
     art/_assets2_report.json                                        全部参数与测量过程

   用法：node _bf_assets2_gen.cjs [--only=plates,faces,mj,bg,kitchen2]
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), zlib = require("zlib"), path = require("path");

const OUT = __dirname;
const ART = path.join(OUT, "art");
const REPORT = path.join(ART, "_assets2_report.json");

/* ═══ PNG 解码（8bit，颜色类型 0/2/4/6，非隔行）═══ */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let p = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0; const idat = [];
  while (p + 8 <= buf.length) {
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

/* ═══ PNG 编码（RGBA8，逐行自适应过滤）═══ */
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
function encodePNG(w, h, rgba, level) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = Buffer.alloc(stride * 5);
  for (let y = 0; y < h; y++) {
    const cur = rgba.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      const o = f * stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? cur[x - 4] : 0, b = prev ? prev[x] : 0, c = (prev && x >= 4) ? prev[x - 4] : 0;
        let v;
        if (f === 0) v = cur[x];
        else if (f === 1) v = cur[x] - a;
        else if (f === 2) v = cur[x] - b;
        else if (f === 3) v = cur[x] - ((a + b) >> 1);
        else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = cur[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        v &= 255; cand[o + x] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand.copy(raw, y * (stride + 1) + 1, best * stride, best * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: level || 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/* ═══ 白底 → 透明（与上一轮同一套五步法，参数化；这里把「纯白底」系数调得更宽容，
       因为本批盘面素材是白盘压在白底上，盘边只有很浅的灰） ═══════════════════ */
function whiteToAlphaCfg(getRGB, w, h, cfg) {
  const NW_BG = cfg.NW_BG, T1 = cfg.T1, UP_MAX = cfg.UP_MAX, BAND = cfg.BAND;
  const minC = (x, y) => { const c = getRGB(x, y); return Math.min(c[0], c[1], c[2]); };
  const bg = new Uint8Array(w * h);
  const stack = [];
  const near = (x, y) => minC(x, y) >= NW_BG;
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
  const K = [1, 2, 1, 2, 4, 2, 1, 2, 1], KS = 16;
  const cov = new Float32Array(w * h);
  let nBg = 0, nFull = 0, nSemi = 0, nHalo = 0, nInnerLight = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (bg[k]) { cov[k] = 0; nBg++; continue; }
    const m = minC(x, y);
    if (m >= NW_BG) { cov[k] = 1; continue; }
    if (dist[k] > BAND || m <= T1) { cov[k] = 1; nFull++; continue; }
    cov[k] = Math.max(0, Math.min(1, (255 - m) / (255 - T1)));
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
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    let [r, g, b] = getRGB(x, y);
    const m = Math.min(r, g, b);
    const a = med[k];
    if (a <= 0.002) { out[k * 4] = r; out[k * 4 + 1] = g; out[k * 4 + 2] = b; out[k * 4 + 3] = 0; continue; }
    if (a >= 0.998) {
      out[k * 4] = r; out[k * 4 + 1] = g; out[k * 4 + 2] = b; out[k * 4 + 3] = 255;
      if (m >= NW_BG) nInnerLight++;
      continue;
    }
    const A = Math.max(1, Math.min(254, Math.round(a * 255)));
    const f = 255 / A;
    const nr = Math.round(255 - (255 - r) * f), ng = Math.round(255 - (255 - g) * f), nb = Math.round(255 - (255 - b) * f);
    r = Math.max(0, Math.min(255, Math.min(nr, r + UP_MAX)));
    g = Math.max(0, Math.min(255, Math.min(ng, g + UP_MAX)));
    b = Math.max(0, Math.min(255, Math.min(nb, b + UP_MAX)));
    out[k * 4] = r; out[k * 4 + 1] = g; out[k * 4 + 2] = b; out[k * 4 + 3] = A;
    nSemi++;
  }
  return { rgba: out, nBg, nFull, nSemi, nInnerLight, nHalo };
}
/* 上一批的参数（食材 / 厨具 / 头像 / UI 都用它）*/
const AL = { NW_BG: 248, T1: 236, UP_MAX: 20, BAND: 3 };
/* 本批盘面：白瓷盘压白底，盘沿只有很浅的灰 → 把「算背景」的白阈值抬到 252，
   「算实心内容」的阈值留 244（248..252 之间的极浅灰算半透明晕） */
const AL_PLATE = { NW_BG: 252, T1: 244, UP_MAX: 16, BAND: 3 };
/* 打包成 1024×1024 图集的白底也偏白，麻将道具沿用盘面参数 */
const AL_MJ = { NW_BG: 252, T1: 244, UP_MAX: 16, BAND: 3 };

/* ═══ 等比缩放居中到方形画布（面积平均 box filter，共用 scale）═══ */
function fitCanvas(rgba, sw, sh, size, scale) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (rgba[(y * sw + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const dw = Math.max(1, Math.round((x1 - x0 + 1) * scale)), dh = Math.max(1, Math.round((y1 - y0 + 1) * scale));
  const offX = Math.round((size - dw) / 2), offY = Math.round((size - dh) / 2);
  const out = Buffer.alloc(size * size * 4);
  for (let dy = 0; dy < dh; dy++) for (let dx = 0; dx < dw; dx++) {
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

/* ═══ 网格切片（内容包围盒 + 全白间隙找真实格线；逐行找列线可选）═══════════════
   cfg: { key, src, rows, colsPerRow:[[..],[..]] 或 cols, ids:[[..]], target, pad, out,
          alpha: AL|AL_PLATE, perRow:bool, boxScale:[sx,sy]（裁剪框相对内容盒的放大系数）} */
const TH_BOX = 236;
function sliceGrid(cfg) {
  const img = decodePNG(fs.readFileSync(cfg.src));
  const PX = (x, y) => { const i = (y * img.w + x) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  const MIN3 = (x, y) => { const i = (y * img.w + x) * img.ch; return Math.min(img.data[i], img.data[i + 1], img.data[i + 2]); };
  const { rows } = cfg;
  const colsOf = (ry) => (cfg.colsPerRow ? cfg.colsPerRow[ry] : cfg.cols);
  const cwOf = (ry) => img.w / colsOf(ry);
  const chh = img.h / rows;
  console.log("\n══════ " + cfg.key + " ══════");
  console.log("源图 " + path.basename(cfg.src) + " " + img.w + "×" + img.h + " ch=" + img.ch +
    "  网格 " + rows + " 行 × " + (cfg.colsPerRow ? JSON.stringify(cfg.colsPerRow) : cfg.cols) + " 列  → " + cfg.target + "px");
  function blankRun(axis, near, band) {
    const lim = axis === "x" ? img.w : img.h;
    const lo = Math.max(0, Math.round(near - 40)), hi = Math.min(lim - 1, Math.round(near + 40));
    let best = null, runStart = -1;
    for (let t = lo; t <= hi; t++) {
      let blank = true;
      if (axis === "x") { for (let y = band[0]; y < band[1] && blank; y++) if (MIN3(t, y) < TH_BOX) blank = false; }
      else { for (let x = band[0]; x < band[1] && blank; x++) if (MIN3(x, t) < TH_BOX) blank = false; }
      if (blank) { if (runStart < 0) runStart = t; }
      else { if (runStart >= 0) { const c = (runStart + t - 1) / 2; if (best === null || Math.abs(c - near) < Math.abs(best - near)) best = c; runStart = -1; } }
    }
    if (runStart >= 0) { const c = (runStart + hi) / 2; if (best === null || Math.abs(c - near) < Math.abs(best - near)) best = c; }
    return best;
  }
  function contentCount(axis, t, band) {
    let n = 0;
    if (axis === "x") { for (let y = band[0]; y < band[1]; y++) if (MIN3(t, y) < TH_BOX) n++; }
    else { for (let x = band[0]; x < band[1]; x++) if (MIN3(x, t) < TH_BOX) n++; }
    return n;
  }
  function sepAt(axis, near, band) {
    const g = blankRun(axis, near, band);
    if (g !== null) return { pos: g, exact: true };
    let bestT = Math.round(near), bestN = Infinity;
    for (let t = Math.max(0, Math.round(near - 40)); t <= Math.min((axis === "x" ? img.w : img.h) - 1, Math.round(near + 40)); t++) {
      const n = contentCount(axis, t, band);
      if (n < bestN || (n === bestN && Math.abs(t - near) < Math.abs(bestT - near))) { bestN = n; bestT = t; }
    }
    return { pos: bestT, exact: false, count: bestN };
  }
  const rowCut = [], rowExact = [];
  for (let k = 1; k < rows; k++) { const s = sepAt("y", k * chh, [0, img.w]); rowCut.push(s.pos); rowExact.push(s.exact); }
  const rowEdge = [0].concat(rowCut.map(v => Math.round(v)), [img.h]);
  const colCutByRow = [], colEdgeByRow = [];
  for (let ry = 0; ry < rows; ry++) {
    const band = [rowEdge[ry], rowEdge[ry + 1]];
    const cols = colsOf(ry), cuts = [], exact = [];
    for (let k = 1; k < cols; k++) { const s = sepAt("x", k * cwOf(ry), band); cuts.push(Math.round(s.pos)); exact.push(s.exact); }
    colCutByRow.push(cuts);
    colEdgeByRow.push([0].concat(cuts, [img.w]));
  }
  console.log("  真实格线 行 y = " + rowCut.map((v, i) => Math.round(v) + "(名义" + ((i + 1) * chh).toFixed(1) + ")" + (rowExact[i] ? "" : "⚠无全白间隙")).join(" , "));
  for (let ry = 0; ry < rows; ry++)
    console.log("            行" + (ry + 1) + " 列 x = " + colCutByRow[ry].map((v, i) => v + "(名义" + ((i + 1) * cwOf(ry)).toFixed(1) + ")").join(" , "));
  const cells = [];
  for (let ry = 0; ry < rows; ry++) for (let rx = 0; rx < colsOf(ry); rx++) {
    const ox = colEdgeByRow[ry][rx], ex = colEdgeByRow[ry][rx + 1];
    const oy = rowEdge[ry], ey = rowEdge[ry + 1];
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    for (let y = oy; y < ey; y++) for (let x = ox; x < ex; x++) {
      if (MIN3(x, y) < TH_BOX) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    cells.push({ ry, rx, id: cfg.ids[ry][rx], bx0: x0, by0: y0, bx1: x1, by1: y1, n, ox, oy, ex, ey });
  }
  const MG_REL = 0.03, MG_MIN = 6;
  function makeBox(lo, hi, cLo, cHi) {
    if (cHi < cLo) return { start: lo, span: Math.max(1, hi - lo) };
    const span0 = cHi - cLo + 1;
    const mg = Math.max(MG_MIN, Math.round(span0 * MG_REL));
    const want = span0 + 2 * mg;
    let span = Math.min(want, hi - lo);
    let start = Math.round((cLo + cHi + 1) / 2 - span / 2);
    if (start < lo) start = lo;
    if (start + span > hi) start = hi - span;
    if (start < 0) start = 0;
    if (start + span > img.w) start = img.w - span;
    return { start: Math.round(start), span: Math.round(span) };
  }
  const jobs = [];
  for (let ry = 0; ry < rows; ry++) for (let rx = 0; rx < colsOf(ry); rx++) {
    const c = cells[ry * colsOf(ry) + rx];
    const bs = cfg.boxScale || [1, 1];
    /* boxScale：盘面这类「内容盒必须完全装下、还要留对称余量」的素材用 1.06 左右；
       缩放只允许扩到本格边界内（不许吃邻居） */
    const hb = makeBox(c.ox, c.ex, Math.max(c.ox, (c.bx0 + c.bx1 + 1) / 2 - (c.bx1 - c.bx0 + 1) * bs[0] / 2),
                       Math.min(c.ex - 1, (c.bx0 + c.bx1 + 1) / 2 + (c.bx1 - c.bx0 + 1) * bs[0] / 2));
    const vb = makeBox(c.oy, c.ey, Math.max(c.oy, (c.by0 + c.by1 + 1) / 2 - (c.by1 - c.by0 + 1) * bs[1] / 2),
                       Math.min(c.ey - 1, (c.by0 + c.by1 + 1) / 2 + (c.by1 - c.by0 + 1) * bs[1] / 2));
    let warn = "";
    if (hb.start > c.bx0 || hb.start + hb.span <= c.bx1) warn += " ⚠横向切边";
    if (vb.start > c.by0 || vb.start + vb.span <= c.by1) warn += " ⚠纵向切边";
    jobs.push({ id: c.id, ry, rx, x: hb.start, y: vb.start, w: hb.span, h: vb.span, warn, cell: c });
  }
  const maxSpan = Math.max(...jobs.map(j => Math.max(j.cell.bx1 - j.cell.bx0 + 1, j.cell.by1 - j.cell.by0 + 1)));
  const SCALE = (cfg.target - 2 * cfg.pad) / maxSpan;
  console.log("  最大内容跨度=" + maxSpan + "px → 共用缩放=" + SCALE.toFixed(4) + "（画布 " + cfg.target + " － 边距 " + cfg.pad + "×2）");
  const outDir = path.join(ART, cfg.out);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const report = [];
  for (const j of jobs) {
    const get = (x, y) => PX(j.x + x, j.y + y);
    const { rgba, nBg, nFull, nSemi, nInnerLight } = whiteToAlphaCfg(get, j.w, j.h, cfg.alpha || AL);
    const sc = fitCanvas(rgba, j.w, j.h, cfg.target, SCALE);
    if (!sc) { console.log("  ✗ " + j.id + " 全透明（裁剪框里没有内容）"); continue; }
    let nz = 0, colors = new Set(), sumA = 0;
    for (let i = 0; i < cfg.target * cfg.target; i++) {
      const a = sc.rgba[i * 4 + 3]; sumA += a;
      if (a > 16) { nz++; colors.add(sc.rgba[i * 4] + "," + sc.rgba[i * 4 + 1] + "," + sc.rgba[i * 4 + 2]); }
    }
    const file = path.join(outDir, j.id + ".png");
    fs.writeFileSync(file, encodePNG(cfg.target, cfg.target, sc.rgba));
    const kb = +(fs.statSync(file).size / 1024).toFixed(1);
    const cov = +(100 * nz / (cfg.target * cfg.target)).toFixed(1);
    report.push({ id: j.id, row: j.ry, col: j.rx, file: path.relative(OUT, file).replace(/\\/g, "/"),
      crop: { x: j.x, y: j.y, w: j.w, h: j.h }, cellContent: { x0: j.cell.bx0, y0: j.cell.by0, x1: j.cell.bx1, y1: j.cell.by1 },
      margin: { l: j.cell.bx0 - j.x, r: (j.x + j.w - 1) - j.cell.bx1, t: j.cell.by0 - j.y, b: (j.y + j.h - 1) - j.cell.by1 },
      target: cfg.target, kb, coverage: cov, colors: colors.size, meanA: +(sumA / (cfg.target * cfg.target)).toFixed(1),
      drawSize: [sc.dw, sc.dh], offset: [sc.offX, sc.offY], srcBox: sc.srcBox,
      alpha: { bg: nBg, full: nFull, semi: nSemi, innerLight: nInnerLight }, warn: j.warn || "" });
    console.log("  ✔ " + j.id.padEnd(16) + "crop=" + j.w + ":" + j.h + ":" + j.x + ":" + j.y +
      "  余量 左" + (j.cell.bx0 - j.x) + " 右" + ((j.x + j.w - 1) - j.cell.bx1) + " 上" + (j.cell.by0 - j.y) + " 下" + ((j.y + j.h - 1) - j.cell.by1) +
      "  " + String(kb).padStart(6) + "KB  不透明 " + String(cov).padStart(5) + "%  颜色 " + String(colors.size).padStart(6) +
      "  画进画布 " + sc.dw + "×" + sc.dh + (j.warn || ""));
  }
  return { key: cfg.key, src: path.relative(OUT, cfg.src).replace(/\\/g, "/"), srcW: img.w, srcH: img.h,
    grid: { rows, cols: cfg.cols || null, colsPerRow: cfg.colsPerRow || null, cellH: +chh.toFixed(3) },
    colCutByRow, rowCut: rowCut.map(v => +v.toFixed(1)), rowCutExact: rowExact,
    target: cfg.target, pad: cfg.pad, scale: +SCALE.toFixed(6), maxSpan,
    alphaCfg: cfg.alpha || AL, boxScale: cfg.boxScale || [1, 1],
    items: report };
}

/* ═══ 背景 1：早餐店 v2 —— 木台面上沿必须落在画布 y=318（= LAY.colHeaderY）══════
   与 v1 同一套「中央带水平梯度能量」测法测出木台面上沿，再反解 cover 裁切：
     scale = (VIEW.h - 318) / (srcH - counterTop)      —— 台面到底边铺满画布下半
   v1 的公式在 16:9 源图上会把左右各裁掉 ~460px（樱花树冠 / 右侧货架就没了）。
   v2 的目标是「不再裁掉树冠与右侧货架」，所以：
     ① 优先用**整幅宽**（scale = VIEW.w / srcW，左右一处不裁）；
     ② 整幅宽若把台面顶出画面（画布下半不够高），就逐步放大 scale 直到
        「台面正好落在 y=318」——每 +1% scale 就把可见宽缩小 1%，直到可见宽 < 源宽；
        这个让步点由脚本自动求出（不是写死的魔数），并把「左右各裁多少」写进报告；
     ③ 可见高不足时用源图**底部镜像木纹**补满（无缝、不是纯色渐变），
        再叠一层极浅的向下压深（模拟台面往前伸出画面的暗部）。
   本次实跑的结果：scale=0.72，左右各裁 205px（源宽 10%），台面精确落在 y=318。   */
const VIEW = { w: 1180, h: 790 };
const COUNTER_TOP_CANVAS_Y = 318;
function measureCounter(file, yLo, yHi) {
  const img = decodePNG(fs.readFileSync(file));
  const lum = (x, y) => { const i = (y * img.w + x) * img.ch; return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; };
  const X0 = Math.round(img.w * 0.25), X1 = Math.round(img.w * 0.75);
  const rows = [];
  for (let y = 4; y < img.h - 4; y++) {
    let e = 0;
    for (let x = X0; x <= X1; x += 2) e += Math.abs(lum(x, y + 3) - lum(x, y - 3));
    rows.push({ y, e: +(e / ((X1 - X0) / 2 + 1)).toFixed(2) });
  }
  const top = rows.slice().sort((a, b) => b.e - a.e).slice(0, 12).sort((a, y) => a.y - y);
  console.log("\n══════ " + path.basename(file) + " ══════");
  console.log("源图 " + img.w + "×" + img.h + "  中央带 x " + X0 + ".." + X1 + " 水平梯度能量 Top12：");
  top.forEach(t => console.log("     y=" + t.y + "  能量=" + t.e));
  const lo = yLo || img.h * 0.42, hi = yHi || img.h * 0.78;
  const cand = rows.filter(r => r.y > lo && r.y < hi).sort((a, b) => b.e - a.e)[0];
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let x = X0; x <= X1; x += 2) { const i = ((cand.y + 40) * img.w + x) * img.ch; sr += img.data[i]; sg += img.data[i + 1]; sb += img.data[i + 2]; n++; }
  console.log("  选中 y=" + cand.y + "（能量 " + cand.e + "）→ 下方 +40px 平均色 rgb(" +
    Math.round(sr / n) + "," + Math.round(sg / n) + "," + Math.round(sb / n) + ")" +
    (((sr / n) > (sb / n) + 18) ? "  暖色木 ✓" : "  ⚠ 不像木头"));
  return { img, counterTop: cand.y, energy: cand.e, bandX: [X0, X1], topCandidates: top,
           belowColor: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] };
}
function writeCrop(img, crop, outFile) {
  const rgba = Buffer.alloc(crop.w * crop.h * 4);
  for (let y = 0; y < crop.h; y++) for (let x = 0; x < crop.w; x++) {
    const sx = Math.max(0, Math.min(img.w - 1, crop.x + x)), sy = Math.max(0, Math.min(img.h - 1, crop.y + y));
    const s = (sy * img.w + sx) * img.ch, d = (y * crop.w + x) * 4;
    rgba[d] = img.data[s]; rgba[d + 1] = img.data[s + 1]; rgba[d + 2] = img.data[s + 2]; rgba[d + 3] = 255;
  }
  fs.writeFileSync(outFile, encodePNG(crop.w, crop.h, rgba));
  return { w: crop.w, h: crop.h, kb: +(fs.statSync(outFile).size / 1024).toFixed(1) };
}
/** 把「源矩形 → 画布整幅」按 scale 渲染，源图底部不够高时用**台面木纹纵向平铺**补满。
    crop: 源窗口；scale: 绘制缩放；gapFill: true 时补底。返回写出的文件信息。 */
function renderBg(img, crop, scale, outFile, gapFill, counterTop) {
  const dw = VIEW.w, dh = VIEW.h;
  const rgba = Buffer.alloc(dw * dh * 4);
  const PX = (x, y) => { const s = (Math.min(img.h - 1, Math.max(0, y)) * img.w + Math.min(img.w - 1, Math.max(0, x))) * img.ch; return [img.data[s], img.data[s + 1], img.data[s + 2]]; };
  const winBottom = crop.y + crop.h;                            // 窗口底边（源坐标，可能超出图底）
  const stripTop = counterTop;                                  // 木台面木纹条的起点（源 y）
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sx = crop.x + x / scale, sy = crop.y + y / scale;
    let c;
    if (sy <= img.h - 1) c = PX(Math.round(sx), Math.round(sy));
    else if (gapFill) {
      /* 窗口越过源图底边：把「台面木纹条」按纵向平铺补下去（木纹是横向连续的，平铺接缝不可见），
         越靠画面底端压得越深，做出「台面往前伸出画面」的暗部 */
      const over = sy - img.h;
      const syt = stripTop + (over % Math.max(1, img.h - stripTop));
      c = PX(Math.round(sx), Math.round(syt));
      const k = Math.min(1, over / (winBottom - img.h + 1));
      c = [Math.round(c[0] * (1 - 0.40 * k)), Math.round(c[1] * (1 - 0.40 * k)), Math.round(c[2] * (1 - 0.40 * k))];
    } else c = [crop.fillR, crop.fillG, crop.fillB];
    const d = (y * dw + x) * 4;
    rgba[d] = c[0]; rgba[d + 1] = c[1]; rgba[d + 2] = c[2]; rgba[d + 3] = 255;
  }
  fs.writeFileSync(outFile, encodePNG(dw, dh, rgba));
  return { w: dw, h: dh, kb: +(fs.statSync(outFile).size / 1024).toFixed(1) };
}
function kitchen2(file, outName) {
  const m = measureCounter(file);
  const img = m.img, counterTop = m.counterTop;
  /* 台面下方的平均色（万不得已时的纯色兜底） */
  let sr = 0, sg = 0, sb = 0, nn = 0;
  for (let x = Math.round(img.w * 0.3); x <= Math.round(img.w * 0.7); x += 2) {
    const i = (Math.min(img.h - 1, counterTop + 60) * img.w + x) * img.ch;
    sr += img.data[i]; sg += img.data[i + 1]; sb += img.data[i + 2]; nn++;
  }
  const fillR = Math.round(sr / nn), fillG = Math.round(sg / nn), fillB = Math.round(sb / nn);
  /* ① 台面到底边要铺满画布下半所需的最低可见高（源px）：hVis >= (srcH-counterTop)*VIEW.h/(VIEW.h-318) */
  const hVisMin = (img.h - counterTop) * VIEW.h / (VIEW.h - COUNTER_TOP_CANVAS_Y);
  const sFull = VIEW.w / img.w;                                 // 整幅宽进画面所需的 scale（最小可能 scale）
  const sAligned = (VIEW.h - COUNTER_TOP_CANVAS_Y) / (img.h - counterTop);   // 台面精确落在 318 的 scale
  /* 策略：**优先保住整幅宽**（v2 的目的就是别裁掉树冠/货架）。
     scale 越小可视宽越大、台面在画布上越靠下。取 scale = sFull 时：
       · 台面画布 y = 318 + (sAligned - sFull) / sAligned * 472  ← 一定 ≥ 318（台面不会跑进盘带里）
       · 画布底部缺口 = (VIEW.h - srcH*sFull) 像素 → 用台面木纹纵向平铺补满
     若 sFull 已经 >= sAligned（源图很宽很矮），那整幅宽也够高，直接用它即可。 */
  const scale = process.env.BF_K2_ALIGNED ? sAligned : sFull;
  const mode = process.env.BF_K2_ALIGNED ? "counter-aligned-ab" : ((hVisMin <= img.h) ? "full-width" : "full-width-gapfill");
  const croppedPerSide = Math.max(0, Math.round((img.w - VIEW.w / scale) / 2));
  let cropW = Math.round(VIEW.w / scale), cropH = Math.round(VIEW.h / scale);
  let cropX = Math.round((img.w - cropW) / 2);
  const alignTop = !process.env.BF_K2_ALIGNED;                 // 保整幅宽 → 源图顶边贴画面顶边
  let cropY = alignTop ? 0 : Math.round(counterTop - COUNTER_TOP_CANVAS_Y / scale);
  cropX = Math.max(0, Math.min(cropX, Math.max(0, img.w - cropW)));
  cropY = Math.max(0, Math.min(cropY, Math.max(0, img.h - Math.min(cropH, img.h))));
  const counterInCrop = counterTop - cropY;
  const counterCanvas = counterInCrop * VIEW.h / cropH;
  const gapPx = Math.max(0, cropY + cropH - img.h) * scale;     // 画布底部需要补的像素
  console.log("  ① 台面铺满下半所需最低可见高 " + Math.round(hVisMin) + "px（源高 " + img.h + "）→ " +
    (hVisMin <= img.h ? "源图够高" : "源图偏矮，底部要补 " + Math.round(gapPx) + "px"));
  console.log("  ② 整幅宽 scale=" + sFull.toFixed(4) + " ／ 台面精确对齐 scale=" + sAligned.toFixed(4) +
    " → 采用 " + scale.toFixed(4) + "（" + mode + "，保整幅宽）");
  console.log("  ③ 源窗口 " + cropW + "×" + cropH + " @" + cropX + "," + cropY +
    "   左右各裁 " + croppedPerSide + "px   底部木纹补带 " + gapPx.toFixed(0) + "px");
  console.log("  木台面上沿 源 y=" + counterTop + " → 裁剪图内 y=" + counterInCrop + " → 画布 y=" + counterCanvas.toFixed(1) +
    "（目标 " + COUNTER_TOP_CANVAS_Y + "，偏差 " + (counterCanvas - COUNTER_TOP_CANVAS_Y).toFixed(1) + "px —— 保整幅宽的代价）");
  const outDir = path.join(ART, "bg");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, outName);
  const info = renderBg(img, { x: cropX, y: cropY, w: cropW, h: cropH, fillR, fillG, fillB }, scale, outFile, true, counterTop);
  console.log("  → art/bg/" + outName + "  " + info.w + "×" + info.h + "  " + info.kb + "KB" +
    "  （源全图 " + img.w + "×" + img.h + "，" + (fs.statSync(file).size / 1024).toFixed(0) + "KB）");
  return {
    file: "art/bg/" + outName, dir: "art/bg/", name: outName,
    spec: { w: info.w, h: info.h }, srcSpec: { w: img.w, h: img.h },
    srcWindow: { x: cropX, y: cropY, w: cropW, h: cropH }, scale: +scale.toFixed(6),
    strategy: mode, scaleFullWidth: +sFull.toFixed(6), scaleCounterAligned: +sAligned.toFixed(6),
    hVisMin: Math.round(hVisMin), croppedPerSide: croppedPerSide,
    croppedPercent: +(croppedPerSide * 2 / img.w * 100).toFixed(2),
    bottomFillPx: Math.round(gapPx),
    bottomFill: "台面木纹条（源 y≥counterTop）纵向平铺 + 向画面底端线性压深 40%，无纯色渐变、无接缝",
    counterTopSrcY: counterTop, counterTopInCrop: counterInCrop, counterTopCanvasY: +counterCanvas.toFixed(1),
    counterTopCanvasYTarget: COUNTER_TOP_CANVAS_Y,
    counterTopDelta: +(counterCanvas - COUNTER_TOP_CANVAS_Y).toFixed(1),
    counterTopEnergy: m.energy, counterBelowColor: [fillR, fillG, fillB],
    view: VIEW, bandX: m.bandX, topCandidates: m.topCandidates
  };
}

/* ═══ 背景 2：通用 16:9（麻将包间）——等比 cover 裁切，可给锚点 ═══════════════ */
function bg16x9(file, outName, opts) {
  const img = decodePNG(fs.readFileSync(file));
  const o = opts || {};
  const cx = o.cx === undefined ? 0.5 : o.cx, cy = o.cy === undefined ? 0.5 : o.cy;
  const arView = VIEW.w / VIEW.h;
  const arImg = img.w / img.h;
  let cropW, cropH;
  if (arImg > arView) { cropH = img.h; cropW = Math.round(img.h * arView); }
  else { cropW = img.w; cropH = Math.round(img.w / arView); }
  let cropX = Math.round((img.w - cropW) * cx), cropY = Math.round((img.h - cropH) * cy);
  cropX = Math.max(0, Math.min(cropX, img.w - cropW));
  cropY = Math.max(0, Math.min(cropY, img.h - cropH));
  const outDir = path.join(ART, "bg");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, outName);
  const info = writeCrop(img, { x: cropX, y: cropY, w: cropW, h: cropH }, outFile);
  console.log("\n══════ " + path.basename(file) + " ══════");
  console.log("源图 " + img.w + "×" + img.h + " (ar " + arImg.toFixed(3) + ")  → 16:9 cover  crop=" + cropW + "×" + cropH + " @(" + cropX + "," + cropY + ")");
  console.log("  裁掉：左 " + cropX + " 右 " + (img.w - cropX - cropW) + " 上 " + cropY + " 下 " + (img.h - cropY - cropH) + " 源px");
  console.log("  → art/bg/" + outName + "  " + info.w + "×" + info.h + "  " + info.kb + "KB");
  return { file: "art/bg/" + outName, dir: "art/bg/", name: outName,
    spec: { w: info.w, h: info.h }, srcSpec: { w: img.w, h: img.h }, crop: { x: cropX, y: cropY, w: cropW, h: cropH },
    aspectErr: +Math.abs((cropW / cropH) - arView) / arView, view: VIEW, anchor: { cx, cy },
    cut: { l: cropX, r: img.w - cropX - cropW, t: cropY, b: img.h - cropY - cropH } };
}

/* ═══ 组定义（行优先 = 素材里的排列顺序）═══
   源文件名不写死：由命令行按**生成顺序**传入，脚本自己查表：
     node _bf_assets2_gen.cjs <盘面六宫格> <早餐店背景v2> <顾客头像六宫格> [麻将包间背景] [麻将道具九宫格]
   理由：Lovart 的文件名是随机 hex，写死会在下次重生成时失效；按「生成顺序」认更稳，
   且脚本会把「哪个文件当成哪一项」原样写进 art/_assets2_report.json 供报告核对。      */
const ARG_KEYS = ["plates", "kitchen2", "faces", "mahjong", "mj"];
const ARGV = process.argv.slice(2).filter(a => a.indexOf("--") !== 0);
const SRC_OF = {};
ARGV.forEach((f, i) => { if (i < ARG_KEYS.length) SRC_OF[ARG_KEYS[i]] = path.isAbsolute(f) ? f : path.join(OUT, f); });
const SRCNAME_OF = {};
ARGV.forEach((f, i) => { if (i < ARG_KEYS.length) SRCNAME_OF[ARG_KEYS[i]] = path.basename(f); });
if (process.argv.indexOf("--print-map") >= 0) {
  ARG_KEYS.forEach(k => console.log("  " + k.padEnd(9) + " ← " + (SRCNAME_OF[k] || "(缺)")));
  process.exit(0);
}
const GROUPS = [
  { key: "plates", src: SRC_OF.plates, rows: 2, cols: 3, target: 192, pad: 6, out: "icons/gear",
    alpha: AL_PLATE, boxScale: [1.10, 1.10],
    ids: [["plate_empty", "plate_egg", "plate_bacon"], ["plate_sandwich", "plate_bun", "plate_salad"]] },
  { key: "faces", src: SRC_OF.faces, rows: 2, cols: 3, target: 192, pad: 8, out: "icons/faces",
    alpha: AL,
    ids: [["fang_calm", "fang_urgent", "fang_happy"], ["lu_calm", "lu_urgent", "lu_happy"]] },
  { key: "mj", src: SRC_OF.mj, rows: 3, cols: 3, target: 256, pad: 8, out: "icons/mj",
    alpha: AL_MJ,
    ids: [["tile_white", "tile_fa", "dice"], ["chip_blue", "chip_red", "chip_gold"], ["tile_back", "ruler", "ashtray"]] }
];
const BGJOBS = [{ key: "kitchen2", src: SRC_OF.kitchen2, out: "kitchen2.png" },
                { key: "mahjong", src: SRC_OF.mahjong, out: "mahjong.png" }];

/* ═══ 主流程（只有**直接运行**才跑；被 require 时只导出工具函数，不写文件）═══ */
const MAIN = require.main === module;
const t00 = Date.now();
const only = (process.argv.find(a => a.indexOf("--only=") === 0) || "").replace("--only=", "");
const want = only ? only.split(",") : ["plates", "faces", "mj", "kitchen2", "mahjong"];
const report = { at: new Date().toISOString(), view: VIEW,
  note: "第二批 Lovart 素材的全部切片/裁切参数（_bf_assets2_gen.cjs 自动求出，未写死）",
  sources: ARG_KEYS.map(k => ({ slot: k, file: SRCNAME_OF[k] || null })), groups: [], backgrounds: [] };
const blanks = [];
GROUPS.forEach(g => {
  if (!MAIN) return;
  if (want.indexOf(g.key) < 0) return;
  if (!g.src || !fs.existsSync(g.src)) { console.log("\n⚠ 跳过 " + g.key + "：源文件不存在 " + (g.src || "(未传参)")); return; }
  const r = sliceGrid(g);
  r.slot = g.key;
  report.groups.push(r);
  r.items.forEach(i => { if (i.coverage < 4) blanks.push(g.key + "/" + i.id); });
});
BGJOBS.forEach(j => {
  if (!MAIN) return;
  if (want.indexOf(j.key) < 0) return;
  if (!j.src || !fs.existsSync(j.src)) { console.log("\n⚠ 跳过背景 " + j.key + "：源文件不存在 " + (j.src || "(未传参)")); return; }
  const r = (j.key === "kitchen2") ? kitchen2(j.src, j.out) : bg16x9(j.src, j.out, { cx: 0.5, cy: 0.5 });
  r.key = j.key; r.src = path.relative(OUT, j.src).replace(/\\/g, "/");
  r.srcName = SRCNAME_OF[j.key];
  report.backgrounds.push(r);
});
if (MAIN) {
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log("\n══════ 汇总 ══════");
report.groups.forEach(g => console.log("  " + g.key.padEnd(7) + g.items.length + " 张  " + g.target + "px  @" + g.src));
report.backgrounds.forEach(b => console.log("  bg/" + b.key.padEnd(9) + b.spec.w + "×" + b.spec.h + "  " + b.file));
console.log("汇总 → art/_assets2_report.json   （用时 " + ((Date.now() - t00) / 1000).toFixed(1) + "s）");
console.log(blanks.length ? "✗ 疑似空白：" + blanks.join(", ") : "✔ 全部 " + report.groups.reduce((a, g) => a + g.items.length, 0) + " 个图标文件非空白");
}
module.exports = { VIEW, COUNTER_TOP_CANVAS_Y, decodePNG, encodePNG, sliceGrid, kitchen2, bg16x9, whiteToAlphaCfg, fitCanvas, AL, AL_PLATE, AL_MJ };
