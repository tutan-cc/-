/* ═══════════════════════════════════════════════════════════════════════════
   _bf_icons_shots.cjs — 出图：九宫格切片成果 + 游戏内使用证据

   产物（都在 测试截图/ 下）：
     bf_icons.png     切好的 9 张图标平铺对照（木台底 + 名称 + 尺寸 + 文件名）
     bf_game_art.png  游戏画面（真跑 breakfast.js → 软件光栅化），底部再贴一条
                      「食材桶特写」证明这 9 张图确实被游戏画出来了

   两条事实都来自真代码：
     · bf_icons 读的是 art/icons/*.png 真文件（不是重新画一遍矢量）
     · bf_game_art 的画面由 tools/bf/shots/panel.js 那套「真跑游戏 + 软件光栅化」产出
   运行：node _bf_icons_shots.cjs       （会顺带用 pwsh 合成中文，失败会提示）
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib"), vm = require("vm");
const { createCanvas, encodePNG } = require("../../lib/raster.js");

const OUT = path.join(__dirname, "..", "..", "..");
const SHOT = path.join(OUT, "测试截图");
const ICONDIR = path.join(OUT, "art", "icons");
if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });

/* 行优先的九宫格顺序 → breakfast.js 的 foodId（第 3 行第 1 格是 bun 不是 baozi） */
const GRID = [["congee", "milk", "soup"], ["egg", "bacon", "sandwich"], ["bun", "salad", "juice"]];
const CN = { congee:"白粥", milk:"热牛奶", soup:"清汤", egg:"煎蛋", bacon:"培根",
             sandwich:"三明治", bun:"包子", salad:"沙拉", juice:"果汁" };

/* ── PNG 解码（RGBA / RGB / 灰度，8bit）── */
function decodePNG(buf) {
  let p = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0; const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; color = d[9]; interlace = d[12]; }
    else if (type === "IDAT") idat.push(d); else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error("只支持 8bit PNG");
  if (interlace) throw new Error("不支持隔行 PNG");
  const ch = color === 0 ? 1 : color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : -1;
  if (ch < 0) throw new Error("不支持颜色类型 " + color);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, px = Buffer.alloc(w * h * ch);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
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
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch;
    if (ch === 1) { data[i*4] = data[i*4+1] = data[i*4+2] = px[s]; data[i*4+3] = 255; }
    else if (ch === 2) { data[i*4] = data[i*4+1] = data[i*4+2] = px[s]; data[i*4+3] = px[s+1]; }
    else if (ch === 3) { data[i*4] = px[s]; data[i*4+1] = px[s+1]; data[i*4+2] = px[s+2]; data[i*4+3] = 255; }
    else { data[i*4] = px[s]; data[i*4+1] = px[s+1]; data[i*4+2] = px[s+2]; data[i*4+3] = px[s+3]; }
  }
  return { w, h, data };
}

/* ── 木台底（和游戏里同色系），返回 [r,g,b] ── */
function wood(x, y) { const n = ((x * 7 + y * 13) % 11) - 4; return [Math.max(0,90+n), Math.max(0,58+n), Math.max(0,34+n)]; }

/* ── 用光栅化器的 5×7 点阵画小标签（ASCII + 数字够用：文件名的尺寸/像素统计）── */
function drawAsciiLabel(cv, text, x, y, size, color) {
  cv.font = "bold " + size + "px sans-serif";
  cv.fillStyle = color; cv.textAlign = "center"; cv.textBaseline = "middle";
  cv.fillText(text, x, y);
  cv.textAlign = "left";
}

/* ═══ ① bf_icons.png：9 张切片平铺 ═══ */
function buildIconSheet() {
  const CELLW = 232, CELLH = 232, GAPX = 34, GAPY = 56, PADX = 40, PADY = 92, COLS = 3, ROWS = 3;
  const W = PADX * 2 + COLS * CELLW + (COLS - 1) * GAPX;
  const H = PADY + ROWS * CELLH + (ROWS - 1) * GAPY + 74;
  const cv = createCanvas(W, H);
  /* 木台底 */
  const buf = cv._buf;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = wood(x, y), i = (y * W + x) * 3;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
  const meta = [];
  let nz = 0;
  GRID.forEach((row, ry) => row.forEach((id, rx) => {
    const file = path.join(ICONDIR, id + ".png");
    const img = decodePNG(fs.readFileSync(file));
    const step = img.w / CELLW;                                  // 最近邻就够了：这里是原尺寸展示
    const cx = PADX + rx * (CELLW + GAPX), cy = PADY + ry * (CELLH + GAPY);
    for (let y = 0; y < CELLH; y++) for (let x = 0; x < CELLW; x++) {
      const s = (Math.min(img.h - 1, Math.floor(y * step)) * img.w + Math.min(img.w - 1, Math.floor(x * step))) * 4;
      const a = img.data[s + 3] / 255;
      if (a <= 0.003) continue;
      const i = ((cy + y) * W + cx + x) * 3;
      buf[i] = buf[i] * (1 - a) + img.data[s] * a;
      buf[i + 1] = buf[i + 1] * (1 - a) + img.data[s + 1] * a;
      buf[i + 2] = buf[i + 2] * (1 - a) + img.data[s + 2] * a;
    }
    /* 文件名 + 尺寸/占比统计（ASCII，用点阵字直接画）*/
    const bytes = fs.statSync(file).size;
    let n = 0;
    for (let i = 0; i < img.w * img.h; i++) if (img.data[i * 4 + 3] > 16) n++;
    const cov = (100 * n / (img.w * img.h)).toFixed(1);
    nz += n;
    drawAsciiLabel(cv, id + ".png", cx + CELLW / 2, cy + CELLH + 22, 17, "#fff3dc");
    drawAsciiLabel(cv, img.w + "x" + img.h + "  " + (bytes / 1024).toFixed(0) + "KB  " + cov + "%", cx + CELLW / 2, cy + CELLH + 44, 14, "#d8c7a8");
    meta.push({ id: id, w: img.w, h: img.h, bytes: bytes, coverage: +cov });
  }));
  /* 顶部标题（ASCII；中文交给 pwsh 合成）*/
  drawAsciiLabel(cv, "art/icons/*.png  —  9 icons sliced from lovart_63f2f17a1187.png (crop offsets from content gaps)", W / 2, 44, 18, "#ffe9b8");
  drawAsciiLabel(cv, "checkerboard = transparent   |   wood = in-game backdrop", W / 2, 70, 15, "#cbb894");
  fs.writeFileSync(path.join(SHOT, "bf_icons.png"), cv.toPNG());
  return { W, H, meta };
}

/* ═══ ② bf_game_art.png：真跑游戏 + 底部「食材桶特写」条 ═══ */
function buildGameArt() {
  /* 用 tools/bf/shots/panel.js 的同一套机器跑游戏（复用它的 boot 有副作用，所以这里内联最小版本） */
  const SRC = fs.readFileSync(path.join(OUT, "breakfast.js"), "utf8");
  const scale = 1;                                        // 1:1，够看清贴图；文件也更小
  const VW = 1180, VH = 790;
  const canvas = createCanvas(VW, VH);
  const texts = [];
  canvas.__textHook = t => texts.push(t);
  function makeEl(tag) {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], parentNode: null,
      id: "", className: "", _html: "", textContent: "", type: "", value: "",
      style: {}, dataset: {}, _handlers: {},
      set innerHTML(v) { this._html = String(v); this.children = []; }, get innerHTML() { return this._html; },
      setAttribute(k, v) { if (k === "id") this.id = v; if (k === "class") this.className = v; this[k] = v; },
      getAttribute(k) { return this[k] === undefined ? null : this[k]; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { return c; },
      addEventListener() {}, removeEventListener() {}, dispatch() {},
      all() { return []; }, querySelector() { return null; }, querySelectorAll() { return []; },
      getContext() { return this._ctx; },
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    };
    return e;
  }
  const body = makeEl("body"), host = makeEl("div"); host.id = "bfGameHost"; body.appendChild(host);
  const frames = []; let clock = 0;
  function pngSize(file) { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; }
  const win = {
    devicePixelRatio: scale,
    performance: { now: () => clock },
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: id => { frames[id - 1] = null; },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    addEventListener() {}, removeEventListener() {},
    document: null,
    location: { href: "file:///" + path.join(OUT, "index.html").replace(/\\/g, "/") },
    /* 真去磁盘读 art/icons/<id>.png 的宽高 → breakfast.js 走真贴图分支 */
    Image: function () {
      const img = { naturalWidth: 0, naturalHeight: 0, complete: false, onload: null, onerror: null, _src: "",
        get src() { return this._src; },
        set src(v) {
          this._src = String(v);
          let s = this._src;
          if (/^file:\/\//i.test(s)) { s = decodeURIComponent(s.replace(/^file:\/\//i, "")); if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1); }
          const f = path.isAbsolute(s) ? s : path.join(OUT, s);
          let sz = null; try { sz = pngSize(f); } catch (e) { sz = null; }
          if (sz) { this.naturalWidth = sz.w; this.naturalHeight = sz.h; this.complete = true; if (this.onload) this.onload({ target: this }); }
          else if (this.onerror) this.onerror({ target: this });
        } };
      return img;
    },
  };
  win.document = {
    body, createElement: tag => { const e = makeEl(tag); if (e.tagName === "CANVAS") { e._ctx = canvas; canvas.canvas = e; e.width = VW; e.height = VH; } return e; },
    getElementById: id => (id === "bfGameHost" ? host : null),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  const ctx = vm.createContext(Object.assign(win, { console, Math, Date, isFinite, Number, String, Object, Array }));
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(SRC + "\n;globalThis.__BF = window.Breakfast;", ctx);
  const B = ctx.__BF;
  function pump(n, ms) { for (let i = 0; i < n; i++) { clock += (ms === undefined ? 16 : ms); const l = frames.slice(); frames.length = 0; l.forEach(cb => cb && cb(clock)); if (!frames.length) break; } }
  B.start(host, { target: { id:"su", name:"苏晚晴", bond:40 }, duration:75, goal:8, onFinish: () => {} });
  const d = B.debug;
  /* 摆一个有内容的局面：9 列全下料 → 不断补料，同时「只在完美窗口出锅」，
     于是盘上会留住几份（热乎/温），锅里也还有在做的生的。这样一张图里
     桶 / 锅 / 盘 / 顾客卡四处都能看到新贴图。 */
  const step = 1 / 60;
  for (let i = 0; i < 9; i++) d.tap("bucket", i);         // 9 列全部下料
  for (let f = 0; f < 30 * 60; f++) {                    // 30 秒游戏时间
    d.stations().forEach((p, i) => {
      if (!p.food) { d.tap("bucket", i); return; }        // 空了就补料
      if (p.state === "perfect") { d.tap("station", i); return; }   // 只在完美窗口落盘
      if (p.state === "burnt" || p.plateState === "burnt") d.trash(i);   // 糊了就丢，保持画面干净
    });
    d.tick(step);
    if (d.state().over) break;
  }
  pump(2);
  const ios = B.debug.icons();
  const di = B.debug.view().icons;
  /* 把整屏 PNG 落到内存，再拼上「食材桶特写」条 */
  const base = decodePNG(canvas.toPNG());
  /* 桶里图标画在 (b.x + b.w/2, b.y + 46)（见 breakfast.js 画桶那一行），
     b.y = LAY.buckets.y = 624，贴图跨度 36*1.95 ≈ 70px → 图标占 y≈635..705。
     取 y 628..718 横切一条，3× 放大。 */
  const SRCY = 628, SRCH = 90, ZOOM = 3;
  const stripH = SRCH * ZOOM + 64;
  const W = base.w, H = base.h + stripH;
  const cv2 = createCanvas(W, H);
  const out = cv2._buf;
  for (let y = 0; y < base.h; y++) for (let x = 0; x < W; x++) {
    const s = (y * base.w + x) * 4, i = (y * W + x) * 3;
    out[i] = base.data[s]; out[i + 1] = base.data[s + 1]; out[i + 2] = base.data[s + 2];
  }
  for (let y = 0; y < stripH; y++) for (let x = 0; x < W; x++) {
    const i = ((base.h + y) * W + x) * 3;
    out[i] = 10; out[i + 1] = 7; out[i + 2] = 12;                       // 特写条底色
  }
  for (let y = 0; y < SRCH * ZOOM; y++) for (let x = 0; x < W; x++) {
    const sy = SRCY + Math.floor(y / ZOOM), sx = x;
    const s = (sy * base.w + Math.min(base.w - 1, sx)) * 4, i = ((base.h + 20 + y) * W + x) * 3;
    out[i] = base.data[s]; out[i + 1] = base.data[s + 1]; out[i + 2] = base.data[s + 2];
  }
  drawAsciiLabel(cv2, "in-game: bottom bucket row, 3x zoom - every icon here came from art/icons/*.png", W / 2, base.h + 9, 15, "#ffe9b8");
  drawAsciiLabel(cv2, "images ready " + di.ready + "/9  |  vector fallback " + di.vector + "  |  icon span " + di.span + "px  |  food id order: " + di.ids.join(" / "),
    W / 2, base.h + stripH - 14, 14, "#cbb894");
  fs.writeFileSync(path.join(SHOT, "bf_game_art.png"), cv2.toPNG());
  return { W: W, H: H, ions: ios, view: di };
}

/* ═══ 主流程 ═══ */
const sheet = buildIconSheet();
console.log("[bf_icons.png] " + sheet.W + "×" + sheet.H + "  " +
  (fs.statSync(path.join(SHOT, "bf_icons.png")).size / 1024).toFixed(1) + " KB");
sheet.meta.forEach(m => console.log("   " + m.id.padEnd(9) + m.w + "×" + m.h + "  " + (m.bytes / 1024).toFixed(1) + "KB  不透明 " + m.coverage + "%"));

const art = buildGameArt();
console.log("[bf_game_art.png] " + art.W + "×" + art.H + "  " +
  (fs.statSync(path.join(SHOT, "bf_game_art.png")).size / 1024).toFixed(1) + " KB");
console.log("   贴图可用 " + art.view.ready + "/9 · 走矢量 " + art.view.vector + " · 基准 " + art.view.base);
art.ions.forEach(x => console.log("   " + x.id.padEnd(9) + x.drawAs.padEnd(7) + x.naturalWidth + "×" + x.naturalHeight + "  " + x.src));
