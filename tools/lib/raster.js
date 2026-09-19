/* ═══════════════════════════════════════════════════════════════════════════
   tools/lib/raster.js — 极简软件 Canvas2D 光栅化器 + PNG 编码器（零依赖）
   用途：当前沙箱起不了 Chrome / Edge（mojo platform_channel 0x5）、mshta 又拦落盘，
        所以没法用真浏览器截图。这里自己把 breakfast.js 真正发出的 Canvas2D 指令
        （含变换、渐变、路径填充/描边、文字）光栅化成 PNG，出图是**代码真实绘制结果的回放**，
        不是手画的示意图。
   支持：moveTo/lineTo/quadraticCurveTo/bezierCurveTo/arc/ellipse/rect/closePath、
        fill/stroke/fillRect/strokeRect、线性与径向渐变、globalAlpha、lineWidth、
        save/restore/translate/scale/rotate/setTransform、fillText（5×7 点阵 ASCII + CJK 块）
       非零环绕规则、4× 子像素采样抗锯齿。
   ═══════════════════════════════════════════════════════════════════════════ */
const zlib = require("zlib");

/* ── 5×7 点阵字体（ASCII 32..126）── */
const FONT = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "!": [4, 4, 4, 4, 0, 0, 4], '"': [10, 10, 0, 0, 0, 0, 0], "#": [10, 31, 10, 10, 31, 10, 0],
  "$": [4, 15, 20, 14, 5, 30, 4], "%": [24, 25, 2, 4, 8, 19, 3], "&": [12, 18, 20, 8, 21, 18, 13],
  "'": [4, 4, 0, 0, 0, 0, 0], "(": [2, 4, 8, 8, 8, 4, 2], ")": [8, 4, 2, 2, 2, 4, 8],
  "*": [0, 4, 21, 14, 21, 4, 0], "+": [0, 4, 4, 31, 4, 4, 0], ",": [0, 0, 0, 0, 12, 4, 8],
  "-": [0, 0, 0, 31, 0, 0, 0], ".": [0, 0, 0, 0, 0, 12, 12], "/": [1, 1, 2, 4, 8, 16, 16],
  "0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14], "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [31, 2, 4, 2, 1, 17, 14], "4": [2, 6, 10, 18, 31, 2, 2], "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8], "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12], ":": [0, 12, 12, 0, 12, 12, 0], ";": [0, 12, 12, 0, 12, 4, 8],
  "<": [2, 4, 8, 16, 8, 4, 2], "=": [0, 0, 31, 0, 31, 0, 0], ">": [8, 4, 2, 1, 2, 4, 8],
  "?": [14, 17, 1, 2, 4, 0, 4], "@": [14, 17, 23, 21, 23, 16, 14],
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 27, 17], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31], "[": [14, 8, 8, 8, 8, 8, 14],
  "\\": [16, 16, 8, 4, 2, 1, 1], "]": [14, 2, 2, 2, 2, 2, 14], "^": [4, 10, 17, 0, 0, 0, 0],
  _: [0, 0, 0, 0, 0, 0, 31], "`": [8, 4, 0, 0, 0, 0, 0],
  a: [0, 0, 14, 1, 15, 17, 15], b: [16, 16, 30, 17, 17, 17, 30], c: [0, 0, 14, 16, 16, 17, 14],
  d: [1, 1, 15, 17, 17, 17, 15], e: [0, 0, 14, 17, 31, 16, 14], f: [6, 9, 8, 28, 8, 8, 8],
  g: [0, 15, 17, 17, 15, 1, 14], h: [16, 16, 30, 17, 17, 17, 17], i: [4, 0, 12, 4, 4, 4, 14],
  j: [2, 0, 6, 2, 2, 18, 12], k: [16, 16, 18, 20, 24, 20, 18], l: [12, 4, 4, 4, 4, 4, 14],
  m: [0, 0, 26, 21, 21, 21, 21], n: [0, 0, 30, 17, 17, 17, 17], o: [0, 0, 14, 17, 17, 17, 14],
  p: [0, 30, 17, 17, 30, 16, 16], q: [0, 15, 17, 17, 15, 1, 1], r: [0, 0, 22, 25, 16, 16, 16],
  s: [0, 0, 15, 16, 14, 1, 30], t: [8, 8, 28, 8, 8, 9, 6], u: [0, 0, 17, 17, 17, 19, 13],
  v: [0, 0, 17, 17, 17, 10, 4], w: [0, 0, 17, 21, 21, 21, 10], x: [0, 0, 17, 10, 4, 10, 17],
  y: [0, 17, 17, 17, 15, 1, 14], z: [0, 0, 31, 2, 4, 8, 31], "{": [2, 4, 4, 8, 4, 4, 2],
  "|": [4, 4, 4, 4, 4, 4, 4], "}": [8, 4, 4, 2, 4, 4, 8], "~": [0, 0, 8, 21, 2, 0, 0],
};

function parseColor(c) {
  if (typeof c !== "string") c = String(c);
  c = c.trim();
  if (c[0] === "#") {
    let h = c.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length === 8) h = h.slice(0, 6);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  let m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(",").map(s => parseFloat(s));
    return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? (p[3] === undefined ? 1 : p[3]) : 1];
  }
  return [200, 200, 200, 1];
}
function lerpColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

/* ── Canvas2D 记录 + 光栅化 ──
   第三个参数可选：{ hostWidth, hostHeight, hostDpr } —— 用来喂「宿主 canvas 的 CSS 逻辑尺寸」。
   有些模块（mahjong.js）会自己算 dpr 把位图放大：cv.width = W*dpr。这时光栅化器的像素缓冲
   必须按位图尺寸分配，而不是逻辑尺寸，否则用户坐标会被放大到画面之外（整屏空白）。
   缺省不传 = 老行为（缓冲 = 逻辑尺寸）。                                        */
function createCanvas(w, h, o) {
  o = o || {};
  const hostW = o.hostWidth || w, hostH = o.hostHeight || h;
  const hostDpr = o.hostDpr || 1;
  const bufW = Math.round(hostW * hostDpr), bufH = Math.round(hostH * hostDpr);
  const buf = new Float32Array(bufW * bufH * 3);    // RGB, 深色底
  for (let i = 0; i < bufW * bufH; i++) { buf[i * 3] = 6; buf[i * 3 + 1] = 4; buf[i * 3 + 2] = 8; }
  w = bufW; h = bufH;

  let m = [1, 0, 0, 1, 0, 0], stack = [];
  const apply = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  let sub = [];                                     // 当前子路径（含闭合标记）
  let path = [];                                    // 所有子路径
  let cur = { fill: "#000", stroke: "#000", alpha: 1, lw: 1, font: "10px sans-serif", align: "left", base: "alphabetic" };
  let stateStack = [];
  let gradId = 0, gradDef = {};                     // 渐变定义（返回的“对象”是 {__g:id}）
  let clipStack = [];

  function beginSub() { sub = []; path.push(sub); }
  function push(x, y) { if (!sub.length) beginSub(); sub.push([x, y, false]); }

  /* 4× 子像素采样填充（大面积铺底/渐变改用 1× 采样：肉眼无差，速度快 4 倍）*/
  const SS = 2, SN = SS * SS;
  const BIG_AREA = 220000;
  function fillPath(paths, style, alpha, rule) {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const sp of paths) for (const pt of sp) {
      const p = apply(pt[0], pt[1]);
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    if (!(minX <= maxX)) return;
    const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(w - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
    const flat = [];
    for (const sp of paths) {
      const pts = sp.map(pt => apply(pt[0], pt[1]));
      if (pts.length > 2) flat.push(pts);
    }
    if (!flat.length) return;
    const isGrad = style && style.__g !== undefined;
    const gd = isGrad ? gradDef[style.__g] : null;
    const col = isGrad ? null : parseColor(style);
    const big = (x1 - x0 + 1) * (y1 - y0 + 1) > BIG_AREA;
    const ss = big ? 1 : SS, sn = ss * ss;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let cov = 0;
        if (ss === 1) { if (inside(flat, x + 0.5, y + 0.5, rule)) cov = 1; }
        else for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss, py = y + (sy + 0.5) / ss;
          if (inside(flat, px, py, rule)) cov++;
        }
        if (!cov) continue;
        const a = (cov / sn) * alpha;
        if (a <= 0.003) continue;
        let c;
        if (isGrad) {
          const g = apply(x + 0.5, y + 0.5);
          c = gd.at(g[0], g[1]);
        } else c = col;
        const ca = a * (c[3] === undefined ? 1 : c[3]);
        const i = (y * w + x) * 3;
        buf[i] = buf[i] * (1 - ca) + c[0] * ca;
        buf[i + 1] = buf[i + 1] * (1 - ca) + c[1] * ca;
        buf[i + 2] = buf[i + 2] * (1 - ca) + c[2] * ca;
      }
    }
  }
  function inside(polys, x, y, rule) {
    let wind = 0;
    for (const pts of polys) {
      for (let i = 0, n = pts.length; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        if (a[1] <= y) { if (b[1] > y && ((b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) > 0)) wind++; }
        else if (b[1] <= y && ((b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) < 0)) wind--;
      }
    }
    return wind !== 0;
  }
  /* 描边：把折线按 lineWidth 加宽成四边形再填充 */
  function strokePath(paths, style, alpha, lw) {
    const hw = Math.max(0.4, lw / 2);
    for (const sp of paths) {
      for (let i = 0; i + 1 < sp.length; i++) {
        const a = apply(sp[i][0], sp[i][1]), b = apply(sp[i + 1][0], sp[i + 1][1]);
        let dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy); if (len < 1e-6) continue;
        dx /= len; dy /= len;
        const nx = -dy * hw, ny = dx * hw;
        fillPath([[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny], [a[0] - nx, a[1] - ny]]], style, alpha, "nonzero");
      }
      // 简单圆角接缝
      for (const pt of sp) {
        const p = apply(pt[0], pt[1]);
        const q = [];
        for (let k = 0; k < 8; k++) q.push([p[0] + Math.cos(k / 8 * Math.PI * 2) * hw, p[1] + Math.sin(k / 8 * Math.PI * 2) * hw]);
        fillPath([q], style, alpha, "nonzero");
      }
    }
  }

  function drawText(str, x, y, style, alpha, font, align, base) {
    const fm = /(\d+(?:\.\d+)?)px/.exec(font || "");
    const size = fm ? parseFloat(fm[1]) : 10;
    const px = Math.max(4, size);
    const cw = px * 0.62, ch = px * 0.95, gap = px * 0.06;
    const chars = Array.from(String(str));
    let total = 0;
    for (const ch2 of chars) total += (/[\x20-\x7e]/.test(ch2) ? cw : px) + gap;
    let cx = x;
    if (align === "center") cx = x - total / 2;
    else if (align === "right") cx = x - total;
    let cy = y;
    if (base === "middle") cy = y + ch / 2;
    else if (base === "alphabetic" || base === "bottom") cy = y - ch * 0.15;
    else if (base === "top") cy = y + ch;
    const col = parseColor(style);
    const cells = [];
    for (const ch2 of chars) {
      if (/[\x20-\x7e]/.test(ch2)) {
        const gl = FONT[ch2] || FONT["?"];
        const sc = Math.max(1, px / 7);
        for (let r = 0; r < 7; r++) for (let c2 = 0; c2 < 5; c2++)
          if (gl[r] & (1 << (4 - c2))) cells.push([cx + c2 * sc, cy - (7 - r) * sc, sc + 0.6, sc + 0.6]);
        cx += cw + gap;
      } else {                                       // CJK：实心块（点阵无中文字形）
        cells.push([cx + px * 0.08, cy - ch * 0.92, px * 0.84, ch * 0.84]);
        cx += px + gap;
      }
    }
    for (const [bx, by, bw, bh] of cells) {
      const quad = [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh], [bx, by]];
      fillPath([quad], col, alpha, "nonzero");
    }
  }

  function mkGrad(kind, args) {
    const id = ++gradId;
    const pts = args.map(a => apply(a[0], a[1]));
    const stops = [];
    const at = (x, y) => {
      let t = 0;
      if (kind === "linear") {
        const [x0, y0] = pts[0], [x1, y1] = pts[1];
        const dx = x1 - x0, dy = y1 - y0; const d2 = dx * dx + dy * dy;
        t = d2 ? ((x - x0) * dx + (y - y0) * dy) / d2 : 0;
      } else {
        const [x0, y0] = pts[0];
        const r0 = args[2] === undefined ? 0 : args[2], r1 = args[3] === undefined ? 1 : args[3];
        const d = Math.hypot(x - x0, y - y0);
        t = (d - r0) / Math.max(1e-6, r1 - r0);
      }
      t = Math.max(0, Math.min(1, t));
      if (!stops.length) return [0, 0, 0, 1];
      let a = stops[0], b = stops[stops.length - 1];
      for (let i = 0; i < stops.length - 1; i++) if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
      const k = (b[0] - a[0]) > 1e-6 ? (t - a[0]) / (b[0] - a[0]) : 0;
      return lerpColor(a[1], b[1], k);
    };
    const handle = {
      __g: id,
      addColorStop(p, c) { stops.push([p, parseColor(c)]); stops.sort((u, v) => u[0] - v[0]); },
    };
    gradDef[id] = { at };
    return handle;
  }

  function flattenQuad(x0, y0, cx, cy, x1, y1, n) {
    for (let i = 1; i <= n; i++) { const t = i / n, it = 1 - t; push(it * it * x0 + 2 * it * t * cx + t * t * x1, it * it * y0 + 2 * it * t * cy + t * t * y1); }
  }

  const ctx = {
    canvas: null,
    /* 文字钩子：设了它就不再画 5×7 点阵，而是把每一次 fillText 的参数（含设备坐标与缩放）
       交给调用方 —— 调用方随后用系统字体（如 PowerShell System.Drawing）把真字合成回 PNG，
       这样出图里的中文是清楚的系统字体，而不是方块/点阵。 */
    __textHook: null,
    get fillStyle() { return cur.fill; }, set fillStyle(v) { cur.fill = v; },
    get strokeStyle() { return cur.stroke; }, set strokeStyle(v) { cur.stroke = v; },
    get globalAlpha() { return cur.alpha; }, set globalAlpha(v) { cur.alpha = v; },
    get lineWidth() { return cur.lw; }, set lineWidth(v) { cur.lw = v; },
    get font() { return cur.font; }, set font(v) { cur.font = v; },
    get textAlign() { return cur.align; }, set textAlign(v) { cur.align = v; },
    get textBaseline() { return cur.base; }, set textBaseline(v) { cur.base = v; },
    get lineJoin() { return "miter"; }, set lineJoin(v) {}, get lineCap() { return "butt"; }, set lineCap(v) {},
    save() { stack.push(m.slice()); stateStack.push(Object.assign({}, cur)); },
    restore() { if (stack.length) m = stack.pop(); if (stateStack.length) cur = stateStack.pop(); },
    setTransform(a, b, c, d, e, f) { m = [a, b, c, d, e, f]; },
    resetTransform() { m = [1, 0, 0, 1, 0, 0]; },
    translate(x, y) { m = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; },
    scale(sx, sy) { m = [m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]]; },
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, m[0] * -s + m[2] * c, m[1] * -s + m[3] * c, m[4], m[5]]; },
    beginPath() { path = []; sub = []; },
    closePath() { if (sub.length) sub.push([sub[0][0], sub[0][1], true]); },
    moveTo(x, y) { beginSub(); push(x, y); },
    lineTo(x, y) { push(x, y); },
    quadraticCurveTo(cx, cy, x, y) {
      if (!sub.length) push(0, 0);
      const s = apply(sub[sub.length - 1][0], sub[sub.length - 1][1]);
      const inv = invert(m);
      const p0 = inv ? invPt(inv, s) : [0, 0];
      flattenQuad(p0[0], p0[1], cx, cy, x, y, 10);
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      if (!sub.length) push(0, 0);
      const s = apply(sub[sub.length - 1][0], sub[sub.length - 1][1]);
      const inv = invert(m); const p0 = inv ? invPt(inv, s) : [0, 0];
      for (let i = 1; i <= 12; i++) {
        const t = i / 12, it = 1 - t;
        push(it * it * it * p0[0] + 3 * it * it * t * c1x + 3 * it * t * t * c2x + t * t * t * x,
             it * it * it * p0[1] + 3 * it * it * t * c1y + 3 * it * t * t * c2y + t * t * t * y);
      }
    },
    arc(x, y, r, a0, a1, ccw) {
      beginSub();
      const n = Math.max(10, Math.ceil(Math.abs(a1 - a0) * Math.max(2, r) / 5));
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; push(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    },
    ellipse(x, y, rx, ry, rot, a0, a1) {
      beginSub();
      const n = Math.max(12, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) / 4));
      for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * i / n;
        const px = Math.cos(a) * rx, py = Math.sin(a) * ry;
        push(x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot));
      }
    },
    rect(x, y, w2, h2) { beginSub(); push(x, y); push(x + w2, y); push(x + w2, y + h2); push(x, y + h2); push(x, y); },
    fill() { fillPath(path, typeof cur.fill === "object" ? cur.fill : cur.fill, cur.alpha, "nonzero"); },
    stroke() { strokePath(path, cur.stroke, cur.alpha, cur.lw); },
    fillRect(x, y, w2, h2) { beginSub(); path.push([[x, y], [x + w2, y], [x + w2, y + h2], [x, y + h2], [x, y]]); sub = path[path.length - 1]; fillPath([path[path.length - 1]], cur.fill, cur.alpha, "nonzero"); sub = []; },
    strokeRect(x, y, w2, h2) { beginSub(); path.push([[x, y], [x + w2, y], [x + w2, y + h2], [x, y + h2], [x, y]]); strokePath([path[path.length - 1]], cur.stroke, cur.alpha, cur.lw); sub = []; },
    clip() { /* 不实现裁剪（本游戏只用于矩形边界） */ },
    /* clearRect：把这个区域清回「全透明」——用整幅底的深色代替（本光栅化器没有 alpha 通道） */
    clearRect(x, y, w2, h2) {
      const p0 = apply(x, y), p1 = apply(x + w2, y + h2);
      const X0 = Math.max(0, Math.floor(Math.min(p0[0], p1[0]))), X1 = Math.min(w - 1, Math.ceil(Math.max(p0[0], p1[0])));
      const Y0 = Math.max(0, Math.floor(Math.min(p0[1], p1[1]))), Y1 = Math.min(h - 1, Math.ceil(Math.max(p0[1], p1[1])));
      for (let py = Y0; py <= Y1; py++) for (let pxx = X0; pxx <= X1; pxx++) {
        const i = (py * w + pxx) * 3;
        buf[i] = 6; buf[i + 1] = 4; buf[i + 2] = 8;
      }
    },
    fillText(t, x, y) {
      if (ctx.__textHook) {
        const p = apply(x, y);
        const sc = Math.hypot(m[0], m[1]) || 1;
        ctx.__textHook({ text: String(t), x: p[0], y: p[1], scale: sc,
                         font: cur.font, align: cur.align, base: cur.base, color: cur.fill, alpha: cur.alpha });
        return;
      }
      drawText(t, x, y, cur.fill, cur.alpha, cur.font, cur.align, cur.base);
    },
    strokeText(t, x, y) {
      if (ctx.__textHook) { ctx.fillText(t, x, y); return; }
      drawText(t, x, y, cur.stroke, cur.alpha, cur.font, cur.align, cur.base);
    },
    measureText(t) { const px = parseFloat((/(\d+(?:\.\d+)?)px/.exec(cur.font) || [0, 10])[1]); return { width: String(t).length * px * 0.62 }; },
    createLinearGradient(x0, y0, x1, y1) { return mkGrad("linear", [[x0, y0], [x1, y1]]); },
    createRadialGradient(x0, y0, r0, x1, y1, r1) { return mkGrad("radial", [[x0, y0], [x1, y1], r0, r1]); },
    createPattern() { return null; },
    /* 贴图：把 <img>.src 指向的 PNG 解成 RGBA 再按当前变换 + globalAlpha 合成。
       3 参 / 5 参 / 9 参三种形式都支持（breakfast.js 现在用 5 参）。 */
    drawImage(img, dx, dy, dw, dh) {
      if (!img) return;
      const dec = decodeImage(img);
      if (!dec) throw new Error("drawImage: 图片没解码成功 → " + ((img && img.src) || img));
      let sw = dec.w, sh = dec.h, sx = 0, sy = 0;
      /* 9 参：drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
         —— 形参名只接住了 arguments[1..4]，所以 dest 四元组必须从 arguments[5..8] 取
         （原来写成 [4..7]，dest 的 dw 会被当成 0 → 整条 9 参路径静默不画；
           本轮 UI 星的源矩形裁剪 / 背景铺满才第一次用到 9 参，翻出来了）*/
      if (arguments.length >= 9) { sx = dx; sy = dy; sw = dw; sh = dh; dx = arguments[5]; dy = arguments[6]; dw = arguments[7]; dh = arguments[8]; }
      else if (arguments.length <= 3) { dw = sw; dh = sh; dx = dx || 0; dy = dy || 0; }
      if (!(dw > 0) || !(dh > 0)) return;
      blitImage(dec, sx, sy, sw, sh, dx, dy, dw, dh);
    },
    getImageData(x, y, w2, h2) { return { data: new Uint8ClampedArray(w2 * h2 * 4), width: w2, height: h2 }; },
    putImageData() {},
    setLineDash() {}, getLineDash() { return []; },
    toPNG() { return encodePNG(w, h, buf); },
    _buf: buf, _w: w, _h: h,
  };
  /* ── 贴图（drawImage）────────────────────────────────────────────────────
     解码：读 <img>.src 指向的 PNG（8bit，颜色类型 0/2/4/6，非隔行），
     按 src 缓存；带 __rgba 的替身对象直接用它自己的像素（无头测试用）。
     合成：按当前变换把目标矩形拆成一个像素一个像素地反查源图（最近邻），
     再按 globalAlpha 与源 alpha 做 source-over —— 图标是 256×256 缩到 ~70px，
     最近邻在这个倍率下足够；边缘因已做过中值+平滑，不会出现锯齿。 */
  function decodeImage(img) {
    if (!img) return null;
    if (img.__rgba && img.__w && img.__h) return { w: img.__w, h: img.__h, data: img.__rgba };
    const src = img.src;
    /* 缓存按 **src** 命中，不能只看 img 上有没有 __decoded：同一个 Image 对象换 src
       （出图脚本平铺素材时就这么干）在浏览器里会重新解码，按对象缓存会把第一张图的
       像素发给后面所有 src → 整张平铺图全是同一张。 */
    if (img.__decoded && img.__decodedSrc === src) return img.__decoded;
    if (typeof src !== "string" || !src) return null;
    let file = src;
    if (/^file:\/\//i.test(file)) { file = decodeURIComponent(file.replace(/^file:\/\//i, "")); if (/^\/[A-Za-z]:/.test(file)) file = file.slice(1); }
    let buf;
    try { buf = require("fs").readFileSync(file); } catch (e) { return null; }
    let p = 8, W = 0, H = 0, depth = 0, color = 0, interlace = 0; const idat = [];
    while (p + 8 <= buf.length) {
      const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
      const d = buf.subarray(p + 8, p + 8 + len);
      if (type === "IHDR") { W = d.readUInt32BE(0); H = d.readUInt32BE(4); depth = d[8]; color = d[9]; interlace = d[12]; }
      else if (type === "IDAT") idat.push(d);
      else if (type === "IEND") break;
      p += 12 + len;
    }
    if (depth !== 8 || interlace) return null;
    const ch = color === 0 ? 1 : color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : -1;
    if (ch < 0) return null;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = W * ch, px = Buffer.alloc(W * H * ch);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < H; y++) {
      const ft = raw[y * (stride + 1)];
      const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
      const c2 = Buffer.alloc(stride);
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? c2[x - ch] : 0, b = prev[x], cc = x >= ch ? prev[x - ch] : 0, v = line[x];
        let r;
        if (ft === 0) r = v; else if (ft === 1) r = v + a; else if (ft === 2) r = v + b;
        else if (ft === 3) r = v + ((a + b) >> 1);
        else { const pp = a + b - cc, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - cc); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc); }
        c2[x] = r & 255;
      }
      c2.copy(px, y * stride); prev = c2;
    }
    const data = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const s = i * ch;
      if (ch === 1) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = px[s]; data[i * 4 + 3] = 255; }
      else if (ch === 2) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = px[s]; data[i * 4 + 3] = px[s + 1]; }
      else if (ch === 3) { data[i * 4] = px[s]; data[i * 4 + 1] = px[s + 1]; data[i * 4 + 2] = px[s + 2]; data[i * 4 + 3] = 255; }
      else { data[i * 4] = px[s]; data[i * 4 + 1] = px[s + 1]; data[i * 4 + 2] = px[s + 2]; data[i * 4 + 3] = px[s + 3]; }
    }
    const dec = { w: W, h: H, data: data };
    try { img.__decoded = dec; img.__decodedSrc = src; } catch (e) { /* 冻结对象就算了 */ }
    return dec;
  }
  function blitImage(dec, sx, sy, sw, sh, dx, dy, dw, dh) {
    const alpha = cur.alpha;
    if (alpha <= 0.003) return;
    /* 目标矩形 → 设备坐标（本游戏只有平移+等比缩放，仿射即矩形） */
    const p0 = apply(dx, dy), p1 = apply(dx + dw, dy), p3 = apply(dx, dy + dh);
    const ex = [p1[0] - p0[0], p1[1] - p0[1]], ey = [p3[0] - p0[0], p3[1] - p0[1]];
    let minX = p0[0], maxX = p0[0], minY = p0[1], maxY = p0[1];
    for (const q of [p1, p3, [p0[0] + ex[0] + ey[0], p0[1] + ex[1] + ey[1]]]) {
      if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
      if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
    }
    const X0 = Math.max(0, Math.floor(minX)), X1 = Math.min(w - 1, Math.ceil(maxX));
    const Y0 = Math.max(0, Math.floor(minY)), Y1 = Math.min(h - 1, Math.ceil(maxY));
    /* 用目标矩形的逆变换把设备像素映射回「目标矩形局部坐标」 */
    const det = ex[0] * ey[1] - ex[1] * ey[0];
    if (Math.abs(det) < 1e-9) return;
    for (let py = Y0; py <= Y1; py++) for (let pxx = X0; pxx <= X1; pxx++) {
      const rx = pxx + 0.5 - p0[0], ry = py + 0.5 - p0[1];
      const u = (rx * ey[1] - ry * ey[0]) / det;          // 0..1
      const v = (ry * ex[0] - rx * ex[1]) / det;          // 0..1
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const su = Math.min(dec.w - 1, Math.max(0, Math.floor(sx + u * sw)));
      const sv = Math.min(dec.h - 1, Math.max(0, Math.floor(sy + v * sh)));
      const k = (sv * dec.w + su) * 4;
      const sa = (dec.data[k + 3] / 255) * alpha;
      if (sa <= 0.003) continue;
      const i = (py * w + pxx) * 3;
      buf[i] = buf[i] * (1 - sa) + dec.data[k] * sa;
      buf[i + 1] = buf[i + 1] * (1 - sa) + dec.data[k + 1] * sa;
      buf[i + 2] = buf[i + 2] * (1 - sa) + dec.data[k + 2] * sa;
    }
  }
  function invert(m2) {
    const det = m2[0] * m2[3] - m2[1] * m2[2];
    if (Math.abs(det) < 1e-12) return null;
    return [m2[3] / det, -m2[1] / det, -m2[2] / det, m2[0] / det,
      (m2[2] * m2[5] - m2[3] * m2[4]) / det, (m2[1] * m2[4] - m2[0] * m2[5]) / det];
  }
  function invPt(inv, p) { return [inv[0] * p[0] + inv[2] * p[1] + inv[4], inv[1] * p[0] + inv[3] * p[1] + inv[5]]; }
  return ctx;
}

/* ── PNG 编码（零依赖，用 zlib.deflateSync） ── */
function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3, o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = Math.max(0, Math.min(255, rgb[i] | 0));
      raw[o + 1] = Math.max(0, Math.min(255, rgb[i + 1] | 0));
      raw[o + 2] = Math.max(0, Math.min(255, rgb[i + 2] | 0));
    }
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    const crcBuf = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcBuf) >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRC_TABLE[n] = c; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

module.exports = { createCanvas, encodePNG, parseColor };
