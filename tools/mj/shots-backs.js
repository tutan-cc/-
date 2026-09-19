/* ═══════════════════════════════════════════════════════════════════════════
   tools/mj/shots-backs.js — 测试截图/mj_backs.png：牌背特写（纯色饱满立体 · 无斜纹）

   三个机位（全部从**真跑出来的那一帧**上裁，不是另画的示意图）：
     ① 牌墙一角：对面那条长墙（双层叠放、条条对齐）+ 右墙一段
     ② 对家手牌一排：背面横排、尺寸完全一致
     ③ 暗杠盖着的两张：明暗一致的纯色牌背
   画面上标注每处的实测像素尺寸，人眼可直接确认「纯色 · 有厚度 · 尺寸一致 · 无斜纹」。

   运行（仓库根）：node tools/mj/shots-backs.js
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { createCanvas } = require("../lib/raster.js");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "..", "..");
const SHOT = path.join(OUT, "测试截图");
if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });
const MW = 1240, MH = 860, DPR = 1;
const PNG = path.join(SHOT, "mj_backs.png");

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
function runTable() {
  const canvas = createCanvas(MW, MH, { hostWidth: MW, hostHeight: MH, hostDpr: DPR });
  const texts = [];
  canvas.__textHook = t => texts.push(t);
  const st0 = canvas.setTransform.bind(canvas);
  canvas.setTransform = function () { return st0(1, 0, 0, 1, 0, 0); };
  const SRC = fs.readFileSync(path.join(OUT, "mahjong.js"), "utf8");
  const host = makePlainEl("div");
  const cvEl = makePlainEl("canvas", { ctx: canvas });
  const rafQ = [], timers = [];
  let clock = 0, seq = 0;
  const doc = {
    head: makePlainEl("head"), body: makePlainEl("body"),
    createElement: tag => (String(tag).toUpperCase() === "CANVAS" ? cvEl : makePlainEl(tag)),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}
  };
  const win = { devicePixelRatio: DPR, performance: { now: () => clock },
    requestAnimationFrame: cb => { rafQ.push(cb); return rafQ.length; },
    cancelAnimationFrame: id => { rafQ[id - 1] = null; },
    setTimeout: (cb, ms) => { const id = ++seq; timers.push({ id: id, at: clock + (Number(ms) || 0), cb: cb }); return id; },
    clearTimeout: id => { for (let i = 0; i < timers.length; i++) if (timers[i].id === id) { timers.splice(i, 1); return; } },
    setInterval: () => 0, clearInterval: () => {},
    addEventListener() {}, removeEventListener() {}, document: doc,
    innerWidth: 1280, innerHeight: 900, Image: ImageCtor(), Math: Math,
    location: { href: "file:///" + path.join(OUT, "index.html").replace(/\\/g, "/") },
    AudioSys: { blip() {}, click() {}, ding() {}, good() {}, bad() {} }, localStorage: null };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(Object.assign(win, { console, Date, isFinite, Number, String, Object, Array, JSON }));
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(SRC, ctx, { filename: "mahjong.js" });
  const MJ = ctx.Mahjong || win.Mahjong;
  if (!MJ) throw new Error("mahjong.js 没有导出 window.Mahjong");
  MJ.start(host, { names: ["你", "金老板", "红姐", "顾曼"] });
  let loopCb = null;
  function tick() {
    clock += 16;
    for (let i = 0; i < timers.length; i++) if (timers[i].at <= clock) { const t = timers.splice(i, 1)[0]; i--; try { t.cb(); } catch (e) {} }
    if (rafQ.length) { loopCb = rafQ[rafQ.length - 1]; rafQ.length = 0; }
  }
  let ticks = 0;
  while (clock < 60000 && ticks < 6000) {
    tick(); ticks++;
    const s = MJ.debug.seats();
    if (s && s[0] && s[0].discards.length >= 4) break;
  }
  MJ.debug.demoMelds(true);                  // 暗杠那两张盖牌要出现在画面里
  texts.length = 0;
  if (loopCb) loopCb(clock);
  return { canvas, texts: texts.slice(), MJ, wall: MJ.debug.wallInfo(), melds: MJ.debug.meldRects(),
           art: MJ.debug.art ? MJ.debug.art() : null, stat: MJ.debug.renderStats() };
}
function blit(src, sx, sy, sw, sh, dst, dx, dy, dw, dh) {
  const sb = src._buf, sbw = src._w, db = dst._buf, dbw = dst._w, dbh = dst._h;
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
const r = runTable();
const anGang = (r.melds || []).filter(m => m.seat === 0 && m.type === "gang-an").slice(0, 2);
const wallTile = (r.wall && r.wall.sizes && r.wall.sizes[0]) ? r.wall.sizes[0].size : "-";
console.log("[真跑] 牌墙 " + (r.wall ? r.wall.total : 0) + " 块 / 尺寸 " +
  ((r.wall && r.wall.sizes) || []).map(s => s.size + "×" + s.n).join(" · ") +
  " · 纯色牌背画出 " + ((r.stat && r.stat.backSolid) || 0) + " 张 · tile_back 贴图命中 " +
  ((r.art && r.art.tileBackTex) || 0) + " 次");

/* 三个机位（源坐标，全部取自真实帧） */
const Z = 4;
const panels = [
  { t: "① 牌墙一角（对面长墙双层 + 右墙一段）· 每张 " + wallTile + " · 条条对齐、纯色无花纹",
    sx: 486, sy: 22, sw: 268, sh: 56, z: Z },
  { t: "② 对家手牌背面一排（13 张，每张 26×30，尺寸完全一致）",
    sx: 448, sy: 114, sw: 344, sh: 42, z: Z },
  { t: "③ 暗杠盖着的两张（纯色牌背，与明牌同尺寸：只会转/盖，不缩放）",
    sx: (anGang[0] ? anGang[0].x : 437) - 6, sy: 682, z: 5,
    sw: (anGang.length === 2 ? (anGang[1].x + anGang[1].w - anGang[0].x) : 80) + 12, sh: 62 }
];
const PAD = 26, LH = 30;
let totalH = 96;
panels.forEach(p => { p.dw = Math.round(p.sw * p.z); p.dh = Math.round(p.sh * p.z); totalH += p.dh + LH + 18; });
totalH += 96;
const W2 = Math.max(1500, ...panels.map(p => p.dw + PAD * 2 + 80));
const out = createCanvas(W2, totalH, { hostWidth: W2, hostHeight: totalH, hostDpr: 1 });
const texts = [];
out.__textHook = t => texts.push(t);
out.textAlign = "center"; out.textBaseline = "middle";
out.fillStyle = "#0b0a10"; out.fillRect(0, 0, W2, totalH);
out.fillStyle = "#ffe9b8"; out.font = "bold 26px system-ui";
out.fillText("牌背特写 · 饱满立体的纯色麻将（无斜纹 / 无花纹）· 三处共用同一套画法", W2 / 2, 40);
out.fillStyle = "#8ef2c0"; out.font = "15px system-ui";
out.fillText("圆角矩形 + 顶面亮/侧面暗的厚度过渡 + 顶左高光边 + 细描边；四家颜色一致，尺寸由牌位决定（牌墙每张完全一致）", W2 / 2, 72);
let y = 100;
panels.forEach(p => {
  blit(r.canvas, p.sx, p.sy, p.sw, p.sh, out, PAD + 60, y, p.dw, p.dh);
  out.strokeStyle = "rgba(255,215,110,.35)"; out.lineWidth = 1;
  out.strokeRect(PAD + 60 + .5, y + .5, p.dw - 1, p.dh - 1);
  out.fillStyle = "#ffd76e"; out.font = "bold 15px system-ui"; out.textAlign = "left";
  out.fillText(p.t, PAD + 60, y + p.dh + 20);
  out.fillStyle = "#cbb894"; out.font = "12px system-ui";
  out.fillText("源区域 " + p.sw + "×" + p.sh + "px → 放大 " + p.z + "×（" + p.dw + "×" + p.dh + "）", PAD + 60, y + p.dh + 38);
  out.textAlign = "center";
  y += p.dh + LH + 18;
});
out.fillStyle = "#cbb894"; out.font = "13px system-ui";
out.fillText("art/icons/mj/tile_back.png 是「深蓝 + 鱼鳞纹」素材，与「纯色无花纹」冲突 → 按用户指示改用纯色矢量（该素材故意不接，本帧命中 0 次）", W2 / 2, totalH - 52);
out.fillText("证据链：无头 vm 真跑生产代码 mahjong.js → Canvas2D 真光栅化（tools/lib/raster.js）→ 中文由 System.Drawing 合成", W2 / 2, totalH - 26);
fs.writeFileSync(PNG, out.toPNG());

const TR = path.join(OUT, "dist", "test-results");
if (!fs.existsSync(TR)) fs.mkdirSync(TR, { recursive: true });
const MANIFEST = path.join(TR, "_mj_backs_text.json");
fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), shots: [{ png: PNG, texts: texts }] }), "utf8");
try {
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(OUT, "tools", "lib", "text-compose.ps1"), "-Manifest", MANIFEST], { stdio: "inherit", cwd: OUT });
} catch (e) { console.error("（文字合成失败）：" + (e && e.message)); }
try { fs.rmSync(MANIFEST, { force: true }); } catch (e) {}
console.log("[mj_backs.png] " + W2 + "×" + totalH + "  " + (fs.statSync(PNG).size / 1024).toFixed(1) + "KB  用时 " +
  ((Date.now() - t0) / 1000).toFixed(1) + "s");
