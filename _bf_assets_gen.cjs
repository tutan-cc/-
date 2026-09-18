/* ═══════════════════════════════════════════════════════════════════════════
   _bf_assets_gen.cjs — 本批 5 张 Lovart 素材 → art/** 切片（零依赖，纯 Node + zlib）

   产出：
     art/bg/kitchen.png                  场景背景（2048×1152 → 原尺寸重编码 + 几何测量）
     art/icons/gear/*.png      ×9        厨具（3×3，1024×1024）
     art/icons/faces/*.png     ×6        顾客头像（3 列 × 2 行，1536×1024）
     art/icons/ui/*.png        ×9        UI 元素（3×3，1254×1254）
     art/icons/game/*.png      ×9        玩法入口图标（3×3，1024×1024）
     art/_assets_report.json             全部切片参数 + 统计（报告/测试读它）

   与上一轮 _bf_icons_gen.cjs 同源的三条纪律：
     ① 裁剪框不许死板等分：先把每格的**真实内容包围盒**求出来，再用「相邻内容
        之间的空隙中点」当格线，保证不切到图标（煎盘手柄 / 锅的把手都会越过网格线）；
     ② 白底 → 透明不能只看「有多白」：图标内部本身近白的区域必须保住，所以用
        「边界洪泛 → 距离场限制 → 覆盖率 → 中值 → 限量 un-premultiply」五步；
     ③ 尺寸统一：同一组共用**一个缩放系数**（由最大内容跨度决定），只缩不拉，
        组内相对大小保持不变；再各自居中到画布。
   背景不抠图（要的就是满幅底图），只重编码 + 量出「干净木台面上沿」的源图 y。

   用法：node _bf_assets_gen.cjs [--keep-bg]
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), zlib = require("zlib"), path = require("path");

const OUT = __dirname;
const ART = path.join(OUT, "art");
const REPORT = path.join(ART, "_assets_report.json");

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

/* ═══ PNG 编码（RGBA8）：逐行自适应选过滤器（0..4）——摄影底图靠它把体积砍下来 ═══
    过滤器的选择用经典启发式：把过滤后的字节按有符号解释，取绝对值之和最小者。 */
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
function encodePNG(w, h, rgba, filterMode) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = Buffer.alloc(stride * 5);
  for (let y = 0; y < h; y++) {
    const cur = rgba.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    let best = 0, bestSum = Infinity;
    const nf = filterMode === "none" ? 1 : 5;
    for (let f = 0; f < nf; f++) {
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
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ═══ 白底 → 透明（与上一轮同一套五步法，参数化）═══════════════════════════════
   ① 从图边界沿 minC ≥ NW_BG 的像素 4 邻域洪泛 → 真背景（α=0）
   ② BFS 距离场把「哑光带」限制在 ≤BAND 跳的外圈白晕内
   ③ 白晕按 minC 在 (T1, NW_BG) 上插值出覆盖率；3×3 加权平滑消锯齿；内部锁 α=255
   ④ 5×5 中值滤波吃掉外圈孤立像素（白齿）
   ⑤ 半透明像素限量 un-premultiply（单通道上涨 ≤ UP_MAX）去残留白底          */
const AL = { NW_BG: 248, T1: 236, UP_MAX: 20, BAND: 3 };
function whiteToAlpha(getRGB, w, h) {
  const NW_BG = AL.NW_BG, T1 = AL.T1, UP_MAX = AL.UP_MAX, BAND = AL.BAND;
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
    if (m >= NW_BG) { cov[k] = 1; continue; }                       // 被包住的近白（盘心/蛋清）→ 实心
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

/* ═══ 通用九宫格/网格切片 ═══════════════════════════════════════════════════
   rows × cols 网格（格子可以是小数尺寸，比如 1024/3）。
   ① 逐格求内容包围盒（白阈值 < 235）
   ② 在名义格线附近 ±40px 找「整行/整列全白」的间隙，取空隙中点当真实格线
   ③ 裁剪框 = 内容居中 + 两侧留边，整数偏移，夹在本格可用区间内
   ④ 白底 → 透明 → 共用缩放 → 居中到 target 方画布                      */
const TH_BOX = 235;
function sliceGrid(cfg) {
  const img = decodePNG(fs.readFileSync(cfg.src));
  const PX = (x, y) => { const i = (y * img.w + x) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  const MIN3 = (x, y) => { const i = (y * img.w + x) * img.ch; return Math.min(img.data[i], img.data[i + 1], img.data[i + 2]); };
  const { rows, cols, ids } = cfg;
  const cw = img.w / cols, chh = img.h / rows;
  console.log("\n══════ " + cfg.key + " ══════");
  console.log("源图 " + path.basename(cfg.src) + " " + img.w + "×" + img.h + " ch=" + img.ch +
    "  网格 " + cols + "×" + rows + "  格=" + cw.toFixed(2) + "×" + chh.toFixed(2) + "  → " + cfg.target + "px");
  /* ① 行格线：整幅宽度上都全白的行（本批素材各行是横向分离的，行线全局可靠）*/
  function blankRun(axis, near, band) {
    /* 在 near±40 内找「band 区间内全白」的列(x)/行(y)，返回空隙中点；找不到返回 null */
    const lim = axis === "x" ? img.w : img.h;
    const lo = Math.max(0, Math.round(near - 40)), hi = Math.min(lim - 1, Math.round(near + 40));
    const b0 = band[0], b1 = band[1];
    let best = null, runStart = -1;
    for (let t = lo; t <= hi; t++) {
      let blank = true;
      if (axis === "x") { for (let y = b0; y < b1 && blank; y++) if (MIN3(t, y) < TH_BOX) blank = false; }
      else { for (let x = b0; x < b1 && blank; x++) if (MIN3(x, t) < TH_BOX) blank = false; }
      if (blank) { if (runStart < 0) runStart = t; }
      else { if (runStart >= 0) { const c = (runStart + t - 1) / 2; if (best === null || Math.abs(c - near) < Math.abs(best - near)) best = c; runStart = -1; } }
    }
    if (runStart >= 0) { const c = (runStart + hi) / 2; if (best === null || Math.abs(c - near) < Math.abs(best - near)) best = c; }
    return best;
  }
  /** 该列/行在 band 里有多少内容像素（分隔线兜底：取内容最少的那一条）*/
  function contentCount(axis, t, band) {
    let n = 0;
    if (axis === "x") { for (let y = band[0]; y < band[1]; y++) if (MIN3(t, y) < TH_BOX) n++; }
    else { for (let x = band[0]; x < band[1]; x++) if (MIN3(x, t) < TH_BOX) n++; }
    return n;
  }
  function sepAt(axis, near, band) {
    const g = blankRun(axis, near, band);
    if (g !== null) return { pos: g, exact: true };
    /* 没有全白间隙（相邻图标像素级粘连）→ 取 band 内内容最少的线兜底 */
    let bestT = Math.round(near), bestN = Infinity;
    for (let t = Math.max(0, Math.round(near - 40)); t <= Math.min((axis === "x" ? img.w : img.h) - 1, Math.round(near + 40)); t++) {
      const n = contentCount(axis, t, band);
      if (n < bestN || (n === bestN && Math.abs(t - near) < Math.abs(bestT - near))) { bestN = n; bestT = t; }
    }
    return { pos: bestT, exact: false, count: bestN };
  }
  /* 行线：全局（整幅宽）*/
  const rowCut = [], rowExact = [];
  for (let k = 1; k < rows; k++) { const s = sepAt("y", k * chh, [0, img.w]); rowCut.push(s.pos); rowExact.push(s.exact); }
  const rowEdge = [0].concat(rowCut.map(v => Math.round(v)), [img.h]);
  /* 列线：**逐行带内**求（同一列线在不同行可以不同 —— 煎盘手柄会越过网格线）*/
  const colCutByRow = [], colEdgeByRow = [];
  for (let ry = 0; ry < rows; ry++) {
    const band = [rowEdge[ry], rowEdge[ry + 1]];
    const cuts = [], exact = [];
    for (let k = 1; k < cols; k++) { const s = sepAt("x", k * cw, band); cuts.push(Math.round(s.pos)); exact.push(s.exact); }
    colCutByRow.push(cuts); colEdgeByRow.push([0].concat(cuts, [img.w]));
  }
  console.log("  真实格线 行 y = " + rowCut.map((v, i) => Math.round(v) + "(名义" + ((i + 1) * chh).toFixed(1) + ")" + (rowExact[i] ? "" : "⚠无全白间隙")).join(" , "));
  for (let ry = 0; ry < rows; ry++)
    console.log("            行" + (ry + 1) + " 列 x = " + colCutByRow[ry].map((v, i) => v + "(名义" + ((i + 1) * cw).toFixed(1) + ")").join(" , "));
  /* ② 内容包围盒：限制在**真实格**内（不许吃邻居）*/
  const cells = [];
  for (let ry = 0; ry < rows; ry++) for (let rx = 0; rx < cols; rx++) {
    const ox = colEdgeByRow[ry][rx], ex = colEdgeByRow[ry][rx + 1];
    const oy = rowEdge[ry], ey = rowEdge[ry + 1];
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    for (let y = oy; y < ey; y++) for (let x = ox; x < ex; x++) {
      if (MIN3(x, y) < TH_BOX) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    cells.push({ ry, rx, id: ids[ry][rx], bx0: x0, by0: y0, bx1: x1, by1: y1, n, ox, oy, ex, ey });
  }
  /* ③ 裁剪框：夹在真实格内（保证不会把邻居画进来）*/
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
  for (let ry = 0; ry < rows; ry++) for (let rx = 0; rx < cols; rx++) {
    const c = cells[ry * cols + rx];
    const hb = makeBox(c.ox, c.ex, c.bx0, c.bx1);
    const vb = makeBox(c.oy, c.ey, c.by0, c.by1);
    let warn = "";
    if (hb.start > c.bx0 || hb.start + hb.span <= c.bx1) warn += " ⚠横向切边";
    if (vb.start > c.by0 || vb.start + vb.span <= c.by1) warn += " ⚠纵向切边";
    jobs.push({ id: c.id, ry, rx, x: hb.start, y: vb.start, w: hb.span, h: vb.span, warn, cell: c });
  }
  /* ④ 共用缩放系数：让「本组最大的内容跨度」放进 target - 2*pad */
  const maxSpan = Math.max(...jobs.map(j => Math.max(j.cell.bx1 - j.cell.bx0 + 1, j.cell.by1 - j.cell.by0 + 1)));
  const SCALE = (cfg.target - 2 * cfg.pad) / maxSpan;
  console.log("  最大内容跨度=" + maxSpan + "px → 共用缩放=" + SCALE.toFixed(4) + "（画布 " + cfg.target + " － 边距 " + cfg.pad + "×2）");
  const outDir = path.join(ART, cfg.out);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const report = [];
  for (const j of jobs) {
    const get = (x, y) => PX(j.x + x, j.y + y);
    const { rgba, nBg, nFull, nSemi, nInnerLight } = whiteToAlpha(get, j.w, j.h);
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
    grid: { rows, cols, cellW: +cw.toFixed(3), cellH: +chh.toFixed(3) },
    colCutByRow: colCutByRow, rowCut: rowCut.map(v => +v.toFixed(1)), rowCutExact: rowExact,
    target: cfg.target, pad: cfg.pad, scale: +SCALE.toFixed(6), maxSpan,
    alphaCfg: { bgFloodThreshold: AL.NW_BG, haloLowerBound: AL.T1, unPremultiplyClamp: AL.UP_MAX, bandPx: AL.BAND, bgThresholdForBox: TH_BOX },
    items: report };
}

/* ═══ 组定义（行优先顺序 = 素材九宫格顺序）═══════════════════════════════════ */
const GROUPS = [
  { key: "gear", src: path.join(ART, "lovart_7f81bea2418a.png"), rows: 3, cols: 3, target: 192, pad: 10, out: "icons/gear",
    ids: [["pot", "griddle", "steamer"], ["plate_empty", "plate_egg_bacon", "plate_bun"], ["juice_jug", "tray", "tools"]] },
  { key: "faces", src: path.join(ART, "lovart_a5fddf40cc93.png"), rows: 2, cols: 3, target: 192, pad: 8, out: "icons/faces",
    ids: [["stud_calm", "office_calm", "uncle_calm"], ["stud_urgent", "office_urgent", "uncle_urgent"]] },
  { key: "ui", src: path.join(ART, "lovart_d72b7b15758c.png"), rows: 3, cols: 3, target: 256, pad: 8, out: "icons/ui",
    ids: [["bar_empty", "bar_full", "stars"], ["btn_wood", "btn_red", "coin"], ["bulb", "check", "cross"]] },
  { key: "game", src: path.join(ART, "lovart_531fa9608451.png"), rows: 3, cols: 3, target: 128, pad: 6, out: "icons/game",
    ids: [["mahjong", "breakfast", "talk"], ["fight", "lottery", "stock"], ["dodge", "circuit", "memory"]] }
];

/* ═══ 背景：几何测量 + 重编码 ═══════════════════════════════════════════════
   要回答的问题是：源图里「前景那条干净木台面」的上沿在 y = ? 我要让它在游戏画布上
   正好落在「专属盘带」的顶部（= LAY.colHeaderY = 318），这样 盘(328..438) /
   锅(450..608) / 桶(624..776) 三段全在木台面上，而顾客卡/顶栏落在街景上。
   测法：木台面上沿是一条几乎横贯整幅的长直边 → 对每一行求「中央带宽内的水平
   梯度能量」，取峰值。（只看中央带，避开左右两侧的建筑与树。）                */
const VIEW = { w: 1180, h: 790 };            // 必须与 breakfast.js 的 VIEW 一致
const COUNTER_TOP_CANVAS_Y = 318;            // = LAY.colHeaderY
function measureBackground(file) {
  const img = decodePNG(fs.readFileSync(file));
  const lum = (x, y) => { const i = (y * img.w + x) * img.ch; return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; };
  const X0 = Math.round(img.w * 0.25), X1 = Math.round(img.w * 0.75);
  const rows = [];
  for (let y = 4; y < img.h - 4; y++) {
    let e = 0;
    for (let x = X0; x <= X1; x += 2) e += Math.abs(lum(x, y + 3) - lum(x, y - 3));
    rows.push({ y, e: +(e / ((X1 - X0) / 2 + 1)).toFixed(2) });
  }
  const top = rows.slice().sort((a, b) => b.e - a.e).slice(0, 12).sort((a, b) => a.y - b.y);
  console.log("\n══════ bg ══════");
  console.log("源图 " + path.basename(file) + " " + img.w + "×" + img.h);
  console.log("  中央带（x " + X0 + ".." + X1 + "）水平梯度能量 Top12（候选「木台面上沿」）：");
  top.forEach(t => console.log("     y=" + t.y + "  能量=" + t.e));
  /* 取 y ∈ [0.42H, 0.78H] 内能量最强的那条：上沿必然在画面中下部 */
  const cand = rows.filter(r => r.y > img.h * 0.42 && r.y < img.h * 0.78).sort((a, b) => b.e - a.e)[0];
  const counterTop = cand.y;
  /* 木台面下方是否真是「暖色木」：取上沿 +40px 的一行，算平均色 */
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let x = X0; x <= X1; x += 2) { const i = ((counterTop + 40) * img.w + x) * img.ch; sr += img.data[i]; sg += img.data[i + 1]; sb += img.data[i + 2]; n++; }
  console.log("  选中 y=" + counterTop + "（能量 " + cand.e + "）→ 其下方 +40px 平均色 rgb(" +
    Math.round(sr / n) + "," + Math.round(sg / n) + "," + Math.round(sb / n) + ")" +
    (((sr / n) > (sb / n) + 18) ? "  暖色木 ✓" : "  ⚠ 不像木头"));
  /* 由「上沿落在画布 y=COUNTER_TOP_CANVAS_Y」反解 crop：
       scale = (VIEW.h - COUNTER_TOP_CANVAS_Y) / (srcH - counterTop)   —— 让上沿到底边的源区间铺满画布下半
       crop.h = VIEW.h / scale ;  crop.w = VIEW.w / scale ; crop.x 水平居中 ; crop.y = counterTop - COUNTER_TOP_CANVAS_Y / scale */
  const scale = (VIEW.h - COUNTER_TOP_CANVAS_Y) / (img.h - counterTop);
  const crop = {
    x: Math.round((img.w - VIEW.w / scale) / 2),
    y: Math.round(counterTop - COUNTER_TOP_CANVAS_Y / scale),
    w: Math.round(VIEW.w / scale), h: Math.round(VIEW.h / scale)
  };
  /* 校验：crop 必须在图内，且与画布同比例（误差 < 0.5%）*/
  const arCrop = crop.w / crop.h, arView = VIEW.w / VIEW.h;
  const ok = crop.x >= 0 && crop.y >= 0 && crop.x + crop.w <= img.w && crop.y + crop.h <= img.h;
  const arErr = Math.abs(arCrop - arView) / arView;
  console.log("  → cover 裁切 crop=" + crop.w + ":" + crop.h + ":" + crop.x + ":" + crop.y +
    "  scale=" + scale.toFixed(4) + "  比例误差=" + (arErr * 100).toFixed(2) + "%  " + (ok ? "图内 ✓" : "⚠ 越界"));
  const mappedTop = (counterTop - crop.y) / crop.h * VIEW.h;
  console.log("  木台面上沿源 y=" + counterTop + " → 画布 y=" + mappedTop.toFixed(1) + "（目标 " + COUNTER_TOP_CANVAS_Y + "）" +
    "  盘带 328..438 / 锅带 450..608 / 桶带 624..776 全在其下方 " + (mappedTop <= 328 ? "✓" : "✗"));
  const outDir = path.join(ART, "bg");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "kitchen.png");
  const t0 = Date.now();
  /* 只存**真正会画到画布上的那一块**（crop 区域，1193×798 ≈0.95MP，1.1MB）；
     2048×1152 全图则是 2.8MB，其中 60% 永远不会被画到。裁切参数与源坐标
     一起写进 art/_assets_report.json，breakfast.js 里也留一份常量给无头断言校验。 */
  const rgbOut = Buffer.alloc(crop.w * crop.h * 4);
  for (let y = 0; y < crop.h; y++) for (let x = 0; x < crop.w; x++) {
    const s = ((crop.y + y) * img.w + (crop.x + x)) * img.ch, d = (y * crop.w + x) * 4;
    rgbOut[d] = img.data[s]; rgbOut[d + 1] = img.data[s + 1]; rgbOut[d + 2] = img.data[s + 2]; rgbOut[d + 3] = 255;
  }
  fs.writeFileSync(outFile, encodePNG(crop.w, crop.h, rgbOut));
  console.log("  → " + path.relative(OUT, outFile) + "  " + crop.w + "×" + crop.h + "  " +
    (fs.statSync(outFile).size / 1024).toFixed(1) + "KB  （源全图 " + (fs.statSync(file).size / 1024).toFixed(1) +
    "KB / " + img.w + "×" + img.h + "，只存会被画到的那块，用时 " + (Date.now() - t0) + "ms）");
  /* 源 crop 区域内的木台面上沿（相对裁剪图的 y）——运行期对齐断言用它 */
  const counterTopInCrop = counterTop - crop.y;
  console.log("  木台面上沿：源 y=" + counterTop + " → 裁剪图内 y=" + counterTopInCrop +
    " → 画布 y=" + (counterTopInCrop * VIEW.h / crop.h).toFixed(1));
  return { file: path.relative(OUT, outFile).replace(/\\/g, "/"), dir: "art/bg/", name: "kitchen.png",
    spec: { w: crop.w, h: crop.h }, srcSpec: { w: img.w, h: img.h }, crop, scale: +scale.toFixed(6),
    counterTopSrcY: counterTop, counterTopInCrop: counterTopInCrop,
    counterTopCanvasY: +(counterTopInCrop * VIEW.h / crop.h).toFixed(1),
    counterTopCanvasYTarget: COUNTER_TOP_CANVAS_Y,
    view: { w: VIEW.w, h: VIEW.h }, aspectErr: +arErr.toFixed(5), measure: { bandX: [X0, X1], topCandidates: top } };
}

/* ═══ stars.png 里三颗星的子框（运行期按这三块源矩形取单颗星）════════════════
   在**源图**上测（源图里三颗星之间的空隙还在，缩到 256 后会被平滑吃掉），
   再换算成「stars.png 画布」的相对坐标：画布 = 内容盒 × scale 居中 + offset。 */
function starSubBoxes(srcFile, item, scale, target) {
  const img = decodePNG(fs.readFileSync(srcFile));
  const MIN3 = (x, y) => { const i = (y * img.w + x) * img.ch; return Math.min(img.data[i], img.data[i + 1], img.data[i + 2]); };
  const y0 = item.cellContent.y0, y1 = item.cellContent.y1;
  const xa = item.cellContent.x0, xb = item.cellContent.x1;
  const hits = [];
  for (let x = xa; x <= xb; x++) {
    let n = 0;
    for (let y = y0; y <= y1; y++) if (MIN3(x, y) < TH_BOX) n++;
    hits.push(n);
  }
  /* 空隙 = 连续 ≥2 列没有内容 */
  const runs = []; let s = -1, blank = 0;
  for (let i = 0; i <= hits.length; i++) {
    const on = i < hits.length && hits[i] > 0;
    if (on) { if (s < 0) s = i; blank = 0; }
    else if (s >= 0) { blank++; if (blank >= 2 || i === hits.length) { runs.push([s, i - blank]); s = -1; blank = 0; } }
  }
  const offX = item.offset[0], offY = item.offset[1];
  const toCanvas = (sx) => (offX + (sx - xa) * scale) / target;
  let boxes, how;
  if (runs.length === 3) {
    boxes = runs.map(r => ({ x: +toCanvas(xa + r[0]).toFixed(4), y: +(offY / target).toFixed(4),
      w: +(((r[1] - r[0] + 1) * scale) / target).toFixed(4), h: +(item.drawSize[1] / target).toFixed(4) }));
    how = "源图列投影的 3 段独立游程";
  } else {
    const fx0 = offX / target, fw = item.drawSize[0] / target;
    boxes = [0, 1, 2].map(i => ({ x: +(fx0 + fw * i / 3).toFixed(4), y: +(offY / target).toFixed(4),
      w: +(fw / 3).toFixed(4), h: +(item.drawSize[1] / target).toFixed(4) }));
    how = "退化：内容盒三等分（源图检测到 " + runs.length + " 段）";
  }
  console.log("  stars.png 子星：" + runs.length + " 段（" + how + "）  " + JSON.stringify(boxes));
  return { count: runs.length, how: how, boxes: boxes,
           note: "坐标为 stars.png 画布的相对比例（x/y/w/h ∈ 0..1），运行期用 9 参 drawImage 取单颗星" };
}

/* ═══ 主流程 ═══ */
const t00 = Date.now();
const bg = measureBackground(path.join(ART, "lovart_41a8d9d144bc.png"));
const groups = GROUPS.map(sliceGrid);
const uiGroup = groups.find(g => g.key === "ui");
const uiSrc = GROUPS.find(g => g.key === "ui").src;
const stars = starSubBoxes(uiSrc, uiGroup.items.find(i => i.id === "stars"), uiGroup.scale, uiGroup.target);

const total = groups.reduce((a, g) => a + g.items.length, 0) + 1;
const blanks = groups.flatMap(g => g.items.filter(i => i.coverage < 4).map(i => g.key + "/" + i.id));
const report = {
  at: new Date().toISOString(),
  note: "本批 Lovart 素材的全部切片参数（脚本 _bf_assets_gen.cjs 自动求出，未写死）",
  view: VIEW,
  background: bg,
  stars: stars,
  groups: groups,
  summary: {
    files: total, byGroup: groups.map(g => ({ key: g.key, n: g.items.length, target: g.target,
      bytes: g.items.reduce((a, i) => a + Math.round(i.kb * 1024), 0) })),
    blankSuspects: blanks
  }
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log("\n══════ 汇总 ══════");
groups.forEach(g => console.log("  " + g.key.padEnd(7) + g.items.length + " 张  " + g.target + "px  " +
  (g.items.reduce((a, i) => a + i.kb, 0) / 1024).toFixed(2) + "MB  @" + g.src));
console.log("  bg     1 张  " + bg.spec.w + "×" + bg.spec.h + "  " + (fs.statSync(path.join(OUT, bg.file)).size / 1024 / 1024).toFixed(2) + "MB");
console.log("汇总 → art/_assets_report.json   （用时 " + ((Date.now() - t00) / 1000).toFixed(1) + "s）");
console.log(blanks.length ? "✗ 疑似空白：" + blanks.join(", ") : "✔ 全部 " + total + " 个文件非空白");
