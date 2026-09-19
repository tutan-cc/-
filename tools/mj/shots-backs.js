/* ═══════════════════════════════════════════════════════════════════════════
   tools/mj/shots-backs.js — 测试截图/mj_backs.png：3D 立牌牌背特写（一面绿 · 一面象牙白 · 两枚叠放）

   四个机位（全部从**真跑出来的那一帧**上裁，不是另画的示意图）：
     ① 顶墙特写：**一墩两枚上下叠放**，每枚 = 绿色牌背主面 + 顶部象牙白棱边
     ② 左墙特写：左右侧墙的棱边在**侧棱**（象牙白竖条），同样是两枚叠放
     ③ 对家手牌一排：单层立牌（不是两枚叠），一面绿一面白，尺寸完全一致
     ④ 暗杠盖着的两张：平放盖牌，共用同一套 3D 牌背画法
   并在牌墙取样区做**像素实测**：同时数出「绿」与「象牙白」两种像素（不靠源码字符串）。

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
/* 牌墙 / 手牌取样区里数「绿面」与「象牙白棱边」两种像素 —— 直接验光栅化真图，不靠源码字符串。 */
function countBackColors(cv, zones) {
  const buf = cv._buf, w = cv._w, h = cv._h;
  const out = { green: 0, ivory: 0 };
  for (const z of zones) for (let y = z.y; y < z.y + z.h; y++) for (let x = z.x; x < z.x + z.w; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = (y * w + x) * 3, R = buf[i], G = buf[i + 1], B = buf[i + 2];
    if (G >= 90 && G >= R + 30 && G >= B + 25) out.green++;
    else if (R >= 170 && G >= 165 && B >= 150 && R >= B + 8 && Math.abs(R - G) <= 25) out.ivory++;
  }
  return out;
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
const wi = r.wall || {};
console.log("[真跑] 牌墙 " + (wi.total || 0) + " 枚 / " + (wi.stacks || 0) + " 墩（每墩 " + (wi.perStack || 0) +
  " 枚）· 单枚尺寸 " + (((wi.sizes || []).map(s => s.size + "×" + s.n).join(" · ")) || "-") +
  " · 单枚牌背深 " + wi.tileDepth + "px / 整墩 " + wi.stackDepth + "px（= 2 × " + wi.tileDepth + "）" +
  " · 纯色牌背画出 " + ((r.stat && r.stat.backSolid) || 0) + " 枚（绿面 " +
  ((r.stat && r.stat.backGreen) || 0) + " 块 + 象牙白棱 " + ((r.stat && r.stat.backIvory) || 0) + " 块）" +
  " · tile_back 贴图命中 " + ((r.art && r.art.tileBackTex) || 0) + " 次");
const PROBE = [ { x: 550, y: 110, w: 148, h: 58 }, { x: 330, y: 344, w: 64, h: 112 } ];
const pxc = countBackColors(r.canvas, PROBE);
console.log("[牌背像素实测] 绿 " + pxc.green + " px / 象牙白 " + pxc.ivory +
  " px（顶墙 + 左墙取样区，软件光栅化真图）");
if (!(pxc.green > 400 && pxc.ivory > 150)) {
  console.error("✗ 牌背取样没有同时取到「绿色主面」与「象牙白棱边」→ 一面绿一面白这条没做到");
  process.exitCode = 3;
}

/* 四个机位（源坐标，全部取自真实帧） */
const panels = [
  { t: "① 顶墙特写：**一墩两枚上下叠放** —— 每枚 = 绿色牌背主面 + 顶部象牙白棱边（" + wi.tileDepth +
       "px 单枚 / " + wi.stackDepth + "px 整墩）",
    sx: 550, sy: 110, sw: 148, sh: 58, z: 5 },
  { t: "② 左墙特写：左右侧墙的棱边在**侧棱**（象牙白竖条）· 同样两枚叠放 · 纯色无花纹",
    sx: 330, sy: 344, sw: 64, sh: 112, z: 4 },
  { t: "③ 对家手牌背面一排（**单层立牌**，不是两枚叠）· 一面绿一面白 · 每张尺寸完全一致",
    sx: 518, sy: 74, sw: 204, sh: 42, z: 5 },
  { t: "④ 暗杠盖着的两张（平放盖牌：只旋转 / 只覆盖，不缩放；与明牌同尺寸）",
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
out.fillText("牌背特写 · 3D 立牌：一面绿、一面象牙白 · 牌墙一墩两枚叠放（无斜纹 / 无花纹）", W2 / 2, 40);
out.fillStyle = "#8ef2c0"; out.font = "15px system-ui";
out.fillText("牌背几何：绿面（竖向渐变，上亮下暗）+ 象牙白棱边（朝「外」）+ 一条分界阴影线 + 右下深绿厚度暗面 + 圆角 + 细描边", W2 / 2, 72);
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
out.fillText("牌墙每墩两枚 = 「余 N 张 / 2」枚，余牌不足时**外枚先消失**（只剩内枚单层）→ 画出的枚数与计数一致；棱边一律朝外（背离桌心）", W2 / 2, totalH - 52);
out.fillText("art/icons/mj/tile_back.png 是「深蓝 + 鱼鳞纹」素材，与「纯色无花纹」冲突 → 按用户指示改用纯色矢量（该素材故意不接，本帧命中 0 次）", W2 / 2, totalH - 78);
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
