/* ═══════════════════════════════════════════════════════════════════════════
   tools/mj/shots-faces.js — 牌面出图（两张，用于和标准参考图逐张比对）

     ① 测试截图/mj_faces_vs_ref.png
        上：标准参考图（麻将零基础教学）的牌区裁切
        下：本项目 mahjong.js 真跑出来的 34 张牌面，按参考图的分组顺序重排
            （万 → 筒 → 条 → 字牌；牌面总览的内部顺序被 e2e 断言钉死为 万→条→筒→字，
              所以这里在合成阶段把「条 / 筒」两行整块对调，不动生产代码）
     ② 测试截图/mj_tiao_zoom.png
        1~9 条 三种尺寸并排：放大 2.1× / 手牌 56×78 / 副露 34×46
        —— 直接回答「碰了的竖条纹我都不知道是几条」

   证据链与 tools/mj/shots-bg2.js 同一条（本沙箱起不了 Chrome/Edge）：
     真跑生产代码 mahjong.js（无头 vm + DOM 替身）→ 它发出的 Canvas2D 指令
     交给 tools/lib/raster.js 真光栅化 → 文字最后交 powershell + System.Drawing 合成真汉字。

   运行（仓库根）：node tools/mj/shots-faces.js [参考图路径]
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), os = require("os");
const { createCanvas } = require("../lib/raster.js");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "..", "..");
const SHOT = path.join(OUT, "测试截图");
if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });
const REFCACHE = path.join(__dirname, "_refcrop");
if (!fs.existsSync(REFCACHE)) fs.mkdirSync(REFCACHE, { recursive: true });
const REFPNG = path.join(REFCACHE, "ref_tiles.png");
const REFSRC = process.argv[2] || path.join(os.homedir(), ".dsh", "attachments", "v1", "objects",
  "e2", "e25eb340fa929c50c4a15a1602eabed0282cc6e3e8ae7814fca531ecab5ddb7b");
const MW = 1240, MH = 860;
/* 为什么这里的画布 DPR 取 1（而生产是 2~3）：
   tools/lib/raster.js 的 strokePath() 先对折线点做了一次 apply(transform)，随后
   fillPath() 又做了一次 —— 描边被双重变换：DPR=1 时 m 是单位阵、两次等于一次（正确），
   DPR>=2 时描边被画到 2~3 倍远处（牌面描边 / 筒的双圈 / 鸟的轮廓统统不见，跑出画布）。
   已实测：DPR=3 的探针里 r=30 的圆环跑到画布外，DPR=1 时位置正确。
   所以本脚本按「生产代码 + 单位变换」渲染：形状与浏览器 devicePixelRatio=1 时逐像素一致，
   描边不丢。此问题不是本轮改动引入的（旧 tools/mj/shots-bg2.js 出的 mj_bg2.png
   同样没有牌面描边），已在报告里如实写明；raster.js 不在本次允许改动的文件清单里。 */
const DPR = 1;

/* ── Image 替身：src 一赋值就真去磁盘读 PNG 的 IHDR ── */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG：" + file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function resolveImgPath(src) {
  let s = String(src || "");
  if (/^file:\/\//i.test(s)) { s = decodeURIComponent(s.replace(/^file:\/\//i, "")); if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1); }
  if (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\")) return path.normalize(s);
  if (s.startsWith("/")) s = s.slice(1);
  return path.join(OUT, s);
}
function ImageCtor() {
  return function Image() {
    return { naturalWidth: 0, naturalHeight: 0, complete: false, onload: null, onerror: null, _src: "",
      get src() { return this._src; },
      set src(v) {
        this._src = String(v);
        let sz = null; try { sz = pngSize(resolveImgPath(v)); } catch (e) { sz = null; }
        if (sz) { this.naturalWidth = sz.w; this.naturalHeight = sz.h; this.complete = true; if (this.onload) this.onload({ target: this }); }
        else if (this.onerror) this.onerror({ target: this });
      } };
  };
}
function makePlainEl(tag, opts) {
  const o = opts || {};
  return { tagName: String(tag).toUpperCase(), children: [], parentNode: null, id: "", className: "",
    _html: "", textContent: "", type: "", value: "", checked: false, style: {}, dataset: {},
    _ctx: null, width: 0, height: 0,
    get lastChild() { return this.children.length ? this.children[this.children.length - 1] : null; },
    get firstChild() { return this.children.length ? this.children[0] : null; },
    set innerHTML(v) { this._html = String(v); this.children = []; }, get innerHTML() { return this._html; },
    setAttribute(k, v) { if (k === "id") this.id = v; if (k === "class") this.className = v; this[k] = v; },
    getAttribute(k) { return this[k] === undefined ? null : this[k]; },
    removeAttribute(k) { delete this[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { return c; }, insertBefore(c) { return this.appendChild(c); },
    addEventListener() {}, removeEventListener() {}, dispatch() {}, focus() {}, blur() {}, click() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: MW, height: MH, right: MW, bottom: MH }; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getContext(kind) { if (String(kind) !== "2d") return null; if (!this._ctx) this._ctx = o.ctx || null; return this._ctx; },
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } };
}

/* ── 真跑 mahjong.js，开「牌面总览」出图模式，抓一帧 ── */
function runSheet() {
  const canvas = createCanvas(MW, MH, { hostWidth: MW, hostHeight: MH, hostDpr: DPR });
  const texts = [];
  canvas.__textHook = t => texts.push(t);
  /* 把 mahjong.js 的 setTransform(G.dpr,…) 钉成单位阵（见文件头注释） */
  const st0 = canvas.setTransform.bind(canvas);
  canvas.setTransform = function () { return st0(1, 0, 0, 1, 0, 0); };
  const SRC = fs.readFileSync(path.join(OUT, "mahjong.js"), "utf8");
  const host = makePlainEl("div");
  const cvEl = makePlainEl("canvas", { ctx: canvas });
  const rafQ = [];
  const doc = {
    head: makePlainEl("head"), body: makePlainEl("body"),
    createElement: tag => (String(tag).toUpperCase() === "CANVAS" ? cvEl : makePlainEl(tag)),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}
  };
  const win = { devicePixelRatio: DPR, performance: { now: () => 0 },
    requestAnimationFrame: cb => { rafQ.push(cb); return rafQ.length; },
    cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    addEventListener() {}, removeEventListener() {}, document: doc,
    innerWidth: 1280, innerHeight: 900, Image: ImageCtor(), Math: Math,
    location: { href: "file:///" + path.join(OUT, "index.html").replace(/\\/g, "/") },
    AudioSys: { blip() {}, click() {}, ding() {}, good() {}, good2() {}, bad() {} }, localStorage: null };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(Object.assign(win, { console, Date, isFinite, Number, String, Object, Array, JSON }));
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(SRC, ctx, { filename: "mahjong.js" });
  const MJ = ctx.Mahjong || win.Mahjong;
  if (!MJ) throw new Error("mahjong.js 没有导出 window.Mahjong");
  const started = MJ.start(host, { names: ["你", "金老板", "红姐", "顾曼"] });
  const on = MJ.debug.faceSheet(true);
  texts.length = 0;                     // 丢掉 start() 那一帧的牌桌文字（余 N 张 / 第 N 巡…）
  const cb = rafQ[rafQ.length - 1];
  if (cb) cb(0);
  return { canvas, texts, MJ, started, on, tiles: MJ.debug.faceTiles(), rows: MJ.debug.faceSheetRows(),
           stat: MJ.debug.renderStats() };
}

/* ── 参考图裁切（缓存成 PNG：raster 的 drawImage 只吃 8bit 非隔行 PNG）── */
function ensureRefPng() {
  if (fs.existsSync(REFPNG)) return true;
  if (!fs.existsSync(REFSRC)) return false;
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", REFSRC,
      "-vf", "crop=1080:960:100:400", "-pix_fmt", "rgb24", REFPNG], { stdio: "inherit", cwd: OUT });
    return fs.existsSync(REFPNG);
  } catch (e) { return false; }
}
/* 源 canvas → 目标 canvas 的像素搬运（最近邻，整块缩放） */
function blit(src, sx, sy, sw, sh, dst, dx, dy, dw, dh) {
  const sb = src._buf, sbw = src._w;
  const db = dst._buf, dbw = dst._w, dbh = dst._h;
  for (let y = 0; y < dh; y++) {
    const dy2 = Math.round(dy + y); if (dy2 < 0 || dy2 >= dbh) continue;
    const syy = Math.round(sy + (y + .5) * sh / dh);
    for (let x = 0; x < dw; x++) {
      const dx2 = Math.round(dx + x); if (dx2 < 0 || dx2 >= dbw) continue;
      const sxx = Math.round(sx + (x + .5) * sw / dw);
      const sp = (syy * sbw + sxx) * 3, dp = (dy2 * dbw + dx2) * 3;
      db[dp] = sb[sp]; db[dp + 1] = sb[sp + 1]; db[dp + 2] = sb[sp + 2];
    }
  }
}

const t0 = Date.now();
const r = runSheet();
console.log("[真跑] mahjong.js start=" + r.started + " 牌面总览=" + r.on + " 牌面数=" + (r.stat && r.stat.faces) +
  " 命中 " + r.tiles.length + " 张");
if (!r.tiles || r.tiles.length !== 34) throw new Error("牌面总览没有拿到 34 张：" + (r.tiles || []).length);

const sheetTexts = r.texts.slice();               // 牌面总览里 fillText 记下的文字（单位变换 → 逻辑坐标）
const texts1 = [], texts2 = [];
const D = DPR;
/* 牌面总览的 4 行：行高 / 行距从真实 rect 反推（不猜） */
const rowH = r.tiles[0].h, colW = r.tiles[0].w;
const rowGap = r.tiles[9].y - (r.tiles[0].y + rowH);
const rowStep = rowH + rowGap;
const y0 = r.tiles[0].y, x0 = r.tiles[0].x;

/* ═══ ① mj_faces_vs_ref.png ═══ */
const hasRef = ensureRefPng();
let refH = 0;
if (hasRef) { const s = pngSize(REFPNG); refH = Math.round(s.h * MW / s.w); }
const SHEET_H = 118;
/* 高度先算好（raster 画布要一次分配）：参考图块 + 我方牌面总览块 + 两行脚注 */
const SHEET_BLOCK = 48 + (4 * rowStep - rowGap) + 14 + 12 + 56 + 12 + 24;
const H1 = (hasRef ? SHEET_H + refH : 0) + SHEET_BLOCK;
const out1 = createCanvas(MW, H1, { hostWidth: MW, hostHeight: H1, hostDpr: 1 });
out1.__textHook = t => texts1.push(t);
out1.textAlign = "center"; out1.textBaseline = "middle";
out1.fillStyle = "#0b0a10"; out1.fillRect(0, 0, MW, H1);
let cy = 0;
if (hasRef) {
  const img = { src: REFPNG, naturalWidth: MW, naturalHeight: refH };
  out1.drawImage(img, 0, cy + SHEET_H, MW, refH);
  out1.fillStyle = "rgba(6,5,9,.86)"; out1.fillRect(0, cy, MW, SHEET_H);
  out1.fillStyle = "#ffe9b8"; out1.font = "bold 17px system-ui";
  out1.fillText("① 标准参考图（唯一权威）· 麻将零基础教学 · 万 / 筒 / 条 / 字牌 全部 34 种", MW / 2, cy + 34);
  out1.fillStyle = "#8ef2c0"; out1.font = "13px system-ui";
  out1.fillText("下方是本项目 mahjong.js 在同一分组顺序下的真实绘制结果，可逐张对照", MW / 2, cy + 64);
  out1.fillStyle = "#d8c7a8"; out1.font = "12px system-ui";
  out1.fillText("参考图裁切区域 = 原图 x100..1180 / y400..1360（四行牌面）· 等比缩放到 1240 宽", MW / 2, cy + 88);
  cy += SHEET_H + refH;
}
/* 我方牌面总览：把源画布按行分块搬到输出（万→筒→条→字，条/筒对调） */
out1.fillStyle = "rgba(6,5,9,.86)"; out1.fillRect(0, cy, MW, 48);
out1.fillStyle = "#8ef2c0"; out1.font = "bold 16px system-ui";
out1.fillText("② 本项目 mahjong.js 真跑绘制 · 34 张 · 分组顺序与参考图一致（万 → 筒 → 条 → 字牌）", MW / 2, cy + 24);
cy += 48;
const srcRow = [0, 2, 1, 3];                       /* 源行序（万/条/筒/字）→ 输出行序（万/筒/条/字） */
const destOf = {};                                 /* 源行 → 输出行 */
const rowTop = cy;
for (let i = 0; i < 4; i++) {
  const s = srcRow[i];
  destOf[s] = i;
  const sy = (y0 + s * rowStep) * D, sh = rowH * D;
  const dy = cy + i * rowStep, dh = rowH;
  for (let c = 0; c < 9; c++) {
    const t = r.tiles[s * 9 + c]; if (!t) break;
    blit(r.canvas, t.x * D, sy, colW * D, sh, out1, t.x, dy, colW, dh);
  }
}
/* 牌面里的汉字（万 / 萬 / 东南西北中發…）raster 画不出来，靠 text-compose 事后合成。
   __textHook 记的是当时变换下的坐标；本脚本变换是单位阵 → 记的就是逻辑坐标，
   这里只需按「换过位置的行」重新落点（列不动），字体缩放原样带过去。 */
let mapped = 0, dropped = 0;
for (const t of sheetTexts) {
  const lx = t.x / D, ly = t.y / D, sc = t.scale || 1;
  const sr = Math.floor((ly - y0) / rowStep);
  if (sr < 0 || sr > 3 || destOf[sr] === undefined) { dropped++; continue; }
  const off = ly - (y0 + sr * rowStep);
  texts1.push(Object.assign({}, t, { x: lx, y: rowTop + destOf[sr] * rowStep + off, scale: sc }));
  mapped++;
}
cy += 4 * rowStep - rowGap + 14;
out1.fillStyle = "#d8c7a8"; out1.font = "12px system-ui";
out1.fillText("判据：条 1~9 的单根宽 / 行列数 / 配色在本图内可直接点数；每张牌面 = 112×146（与生产出图同尺寸）", MW / 2, cy + 12);
cy += 56;
out1.fillStyle = "#cbb894"; out1.font = "12px system-ui";
out1.fillText("证据链：无头 vm 真跑生产代码 mahjong.js → Canvas2D 指令交 tools/lib/raster.js 真光栅化（非示意图）", MW / 2, cy + 12);
const P1 = path.join(SHOT, "mj_faces_vs_ref.png");
fs.writeFileSync(P1, out1.toPNG());

/* ═══ ② mj_tiao_zoom.png ═══ */
const ZW = 2360, ZPAD = 40;
const rowsZ = [
  { k: 2.10, t: "放大 2.1×（看清画法：圆头 + 中段节纹 + 白色内芯）" },
  { k: 1.00, t: "手牌 56×78（1:1 生产尺寸 —— 数条数就靠这一行）" },
  { k: 0.607, t: "副露 34×46（碰 / 杠 的尺寸 —— 用户原话「碰了的竖条纹我都不知道是几条」指的就是这一行）" }
];
const ZH = Math.round(130 + rowsZ.reduce((a, r) => a + 146 * r.k + 104, 0) + 66);
const out2 = createCanvas(ZW, ZH, { hostWidth: ZW, hostHeight: ZH, hostDpr: 1 });
out2.__textHook = t => texts2.push(t);
out2.textAlign = "center"; out2.textBaseline = "middle";
out2.fillStyle = "#0b0a10"; out2.fillRect(0, 0, ZW, ZH);
out2.fillStyle = "#ffe9b8"; out2.font = "bold 26px system-ui";
out2.fillText("1 ~ 9 条 · 三种真实尺寸放大对照（照参考图画法：细长分离、行列对齐、绿 8 根 / 红 1 根规律）", ZW / 2, 44);
out2.fillStyle = "#8ef2c0"; out2.font = "15px system-ui";
out2.fillText("每根竹节宽 ≤ 牌面宽 1/5；相邻净缝 ≥ 3px（手牌尺寸）——「一眼数得清」是这一版的硬指标", ZW / 2, 78);
out2.fillStyle = "#cbb894"; out2.font = "13px system-ui";
out2.fillText("证据链同 mj_faces_vs_ref.png：真跑生产代码 + 软件光栅化；下面每一格都是 drawTileFace() 的真实像素", ZW / 2, 104);
let zy = 130;
for (const row of rowsZ) {
  const tw = 112 * row.k, th = 146 * row.k;
  out2.fillStyle = "rgba(255,255,255,.06)"; out2.fillRect(ZPAD, zy - 10, ZW - ZPAD * 2, th + 76);
  out2.fillStyle = "#ffd76e"; out2.font = "bold 16px system-ui"; out2.textAlign = "left";
  out2.fillText(row.t, ZPAD + 14, zy + 16);
  out2.textAlign = "center";
  const total = 9 * (tw + 20) - 20, x1 = (ZW - total) / 2;
  for (let n = 1; n <= 9; n++) {
    const t = r.tiles[9 + (n - 1)];                       /* 源行 1 = 条 */
    const dx = x1 + (n - 1) * (tw + 20), dy = zy + 44;
    blit(r.canvas, t.x * D, t.y * D, colW * D, rowH * D, out2, dx, dy, tw, th);
    out2.fillStyle = "#8ef2c0"; out2.font = "bold " + Math.max(11, Math.round(15 * row.k)) + "px system-ui";
    out2.fillText(n + " 条", dx + tw / 2, dy + th + 16 + 14 * Math.min(row.k, 1.2));
  }
  zy += th + 104;
}
out2.fillStyle = "#cbb894"; out2.font = "12px system-ui";
out2.fillText("条子几何（牌面 0~1 比例）：单根宽 sw≤.175、单根高 sh、列心 / 行心见 mahjong.js 的 TIAO_POS 表", ZW / 2, ZH - 30);
const P2 = path.join(SHOT, "mj_tiao_zoom.png");
fs.writeFileSync(P2, out2.toPNG());

/* ── 中文用 powershell + System.Drawing 合成 ── */
const TR = path.join(OUT, "dist", "test-results");
if (!fs.existsSync(TR)) fs.mkdirSync(TR, { recursive: true });
const MANIFEST = path.join(TR, "_mj_faces_text.json");
fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(),
  shots: [{ png: P1, texts: texts1 }, { png: P2, texts: texts2 }] }), "utf8");
try {
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(OUT, "tools", "lib", "text-compose.ps1"), "-Manifest", MANIFEST], { stdio: "inherit", cwd: OUT });
} catch (e) { console.error("（文字合成失败，PNG 已出但中文可能缺失）：" + (e && e.message)); }
try { fs.rmSync(MANIFEST, { force: true }); } catch (e) {}

console.log("[mj_faces_vs_ref.png] " + MW + "×" + H1 + "  参考图=" + (hasRef ? "已嵌入" : "缺失（只出我方牌面）") +
  "  牌面汉字重定位 " + mapped + " 段 / 丢弃 " + dropped + " 段");
console.log("[mj_tiao_zoom.png]    " + ZW + "×" + Math.round(ZH));
console.log("[done] 用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
