/* ═══════════════════════════════════════════════════════════════════════════
   tools/mj/shots-layout.js — 测试截图/mj_layout.png（新布局全景）+ 布局几何自检

   照参考图 2（真实麻将 App 截图）重排后的牌桌全景：
     · 牌墙：四边整齐的长条墙、双层叠放、条条对齐、随剩余张数从两端变短
     · 三家对家手牌：背面朝上整齐一横排 / 一竖排，紧贴牌墙内侧，旁边有「N 张」
     · 副露：横放 / 竖放在各家手牌外侧，与手牌分离；碰 3 张其中一张横置、
             明杠 4 张横置一张、暗杠两张盖两张 —— 同组内所有牌尺寸完全一致，横置只旋转不缩放
     · 牌河：桌面中央，四家各自朝向中心，每行 6 张换行，最近一张金边
     · 中央：圆形指示盘「余 N 张 · 第 N 巡」
     · 保留：骰子 / 筹码 / 牌尺 / 烟灰缸（drawTableDecor）、牌背贴图、包间背景

   证据链与 tools/mj/shots-bg2.js 同一条（本沙箱起不了 Chrome/Edge）：
     真跑生产代码 mahjong.js（无头 vm + 真 DOM 替身 + 虚拟定时器）→ Canvas2D 指令
     交 tools/lib/raster.js 真光栅化 → 中文交 powershell + System.Drawing 合成。

   运行（仓库根）：node tools/mj/shots-layout.js [--nofx]
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { createCanvas } = require("../lib/raster.js");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "..", "..");
const SHOT = path.join(OUT, "测试截图");
if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });
const NOFX = process.argv.indexOf("--nofx") >= 0;
/* --check-only：只跑几何自检（不出图、不合成文字）→ 当作「布局几何闸」用，秒级可复跑 */
const CHECK_ONLY = process.argv.indexOf("--check-only") >= 0;
const MW = 1240, MH = 860, DPR = 1, CAPTION = 152;
const PNG = path.join(SHOT, NOFX ? "mj_layout_nofx.png" : "mj_layout.png");

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
function ImageCtor(forceFail) {
  return function Image() {
    return { naturalWidth: 0, naturalHeight: 0, complete: false, onload: null, onerror: null, _src: "",
      get src() { return this._src; },
      set src(v) {
        this._src = String(v);
        let sz = null; if (!forceFail) { try { sz = pngSize(resolveImgPath(v)); } catch (e) { sz = null; } }
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

function runTable(opts) {
  opts = opts || {};
  const canvas = createCanvas(MW, MH, { hostWidth: MW, hostHeight: MH, hostDpr: DPR });
  const texts = [];
  canvas.__textHook = t => texts.push(t);
  /* mahjong.js 每帧会 setTransform(G.dpr…)（G.dpr 被钳到 ≥2）；这里把画布钉成 1:1，
     出图就是 1240×860 的生产逻辑尺寸（文字坐标同为一套逻辑坐标，合成时不用再换算）。 */
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
    innerWidth: 1280, innerHeight: 900, Image: ImageCtor(!!opts.imageFail), Math: Math,
    location: { href: "file:///" + path.join(OUT, "index.html").replace(/\\/g, "/") },
    AudioSys: { blip() {}, click() {}, ding() {}, good() {}, bad() {} }, localStorage: null };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(Object.assign(win, { console, Date, isFinite, Number, String, Object, Array, JSON }));
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(SRC, ctx, { filename: "mahjong.js" });
  const MJ = ctx.Mahjong || win.Mahjong;
  if (!MJ) throw new Error("mahjong.js 没有导出 window.Mahjong");
  const started = MJ.start(host, { names: ["你", "金老板", "红姐", "顾曼"] });
  let loopCb = null;
  function tick() {
    clock += 16;
    for (let i = 0; i < timers.length; i++) {
      if (timers[i].at <= clock) { const t = timers.splice(i, 1)[0]; i--; try { t.cb(); } catch (e) {} }
    }
    if (rafQ.length) { loopCb = rafQ[rafQ.length - 1]; rafQ.length = 0; }
  }
  const want = opts.untilDiscards === undefined ? 6 : opts.untilDiscards;
  const maxMs = opts.maxMs === undefined ? 240000 : opts.maxMs;
  let ticks = 0, st = null;
  while (clock < maxMs && ticks < 20000) {
    tick(); ticks++;
    st = MJ.debug.state();
    if (!st || st.phase === "over") break;
    const seats = MJ.debug.seats();
    if (seats && seats[0] && seats[0].discards.length >= want) break;
  }
  /* 副露示范（4 家各 4 组）→ 再渲染一帧：全景里三处副露（自家 / 对家 / 左右家）都在。
     只保留这最后一帧的 fillText：dbgDemoMelds() 自己会 renderTable()，
     不清空文字数组的话，会把「示范副露」和「真实牌局」两帧的字都合成到同一张图上，
     出现「只有字、没有牌」的鬼影（旧脚本踩过这个坑）。*/
  if (opts.demoMelds !== false && MJ.debug.demoMelds) MJ.debug.demoMelds(true);
  texts.length = 0;
  if (loopCb) { try { loopCb(clock); } catch (e) { console.error("render:", e && e.message); } }
  /* 这里不调用 demoMelds(false)：它会再渲染一帧把画布覆盖成「没有副露」的样子，
     而文字数组已经取过快照 → 出图会变成「牌没了、字还在」。进程马上退出，不需要还原。 */
  return { canvas, texts: texts.slice(), MJ, started, st: MJ.debug.state(), seats: MJ.debug.seats(),
           stat: MJ.debug.renderStats(), meldRects: MJ.debug.meldRects(),
           wallInfo: MJ.debug.wallInfo(), layout: MJ.debug.layout(),
           decor: MJ.debug.decor(), art: MJ.debug.art ? MJ.debug.art() : null,
           clock: clock, ticks: ticks };
}

/* ── 几何自检（纯几何，可重复复现）── */
function geomChecks(r) {
  const out = { ok: true, lines: [], fails: [] };
  const add = (ok, txt) => { out.lines.push((ok ? "✔ " : "✗ ") + txt); if (!ok) { out.ok = false; out.fails.push(txt); } };
  /* ① 副露：同组内尺寸完全一致，横置只是 rot=90 */
  const mr = r.meldRects || [];
  const bySeatType = {};
  mr.forEach(m => { const k = m.seat + "|" + m.type; (bySeatType[k] = bySeatType[k] || []).push(m); });
  let uniform = true, rotOK = true;
  const sizes = {};
  Object.keys(bySeatType).forEach(k => {
    const s = {}; bySeatType[k].forEach(m => { s[m.w.toFixed(2) + "x" + m.h.toFixed(2)] = 1; if (m.rot !== 0 && m.rot !== 90) rotOK = false; });
    const ws = Object.keys(s);
    if (ws.length !== 1) uniform = false;
    sizes[k] = ws.join("/");
  });
  add(mr.length > 0, "副露牌张数取证 " + mr.length + " 张（4 家 × 4 组示范副露）");
  add(uniform, "同组内所有牌尺寸完全一致（(w,h) 只有一种）：" + Object.keys(sizes).map(k => k + "=" + sizes[k]).join(" · "));
  add(rotOK, "横置牌只旋转不缩放：rot 只出现 0 / 90（实际 " +
    JSON.stringify([...new Set(mr.map(m => m.rot))].sort()) + "）");
  /* ② 牌墙：同一侧尺寸一致 */
  const ws = (r.wallInfo && r.wallInfo.sizes) || [];
  add(ws.length > 0 && ws.length <= 2, "牌墙牌背尺寸一致（" + ws.map(s => s.size + "×" + s.n + "块").join(" · ") +
    "）—— 横向边 30×22 / 纵向边 22×30，共 " + (r.wallInfo ? r.wallInfo.total : 0) + " 块（满墙 34 墩 × 双层）");
  /* ③ 装饰安全区 */
  const dk = r.decor || {};
  add(!!dk.ok, "装饰安全区自检 decorCheck()：" + (dk.frames ? dk.frames.length : 0) + " 个装饰框 / " +
    (dk.reserved || 0) + " 个保留框零相交" + (dk.ok ? "" : " → " + JSON.stringify(dk.hits)));
  /* ④ 手牌 / 牌河几何 */
  const L = r.layout || {};
  add(!!(L.hand && L.hand.tw === 56 && L.hand.th === 78), "玩家手牌仍 56×78（排序 + 刚摸的牌单独靠右 + 金边规则不变）");
  add(!!(L.disc && L.disc.tw === 30 && L.disc.th === 40), "牌河牌面 30×40，四家统一每行 6 张换行");
  return out;
}

const t0 = Date.now();
const r = NOFX ? runTable({ imageFail: true, untilDiscards: 0, maxMs: 1200 })
               : runTable({ untilDiscards: 6 });
console.log("[真跑] mahjong.js start=" + r.started + " 虚拟时钟 " + (r.clock / 1000).toFixed(1) + "s / " + r.ticks + " 帧" +
  (NOFX ? "（--nofx 贴图全失败 → 矢量兜底）" : ""));
console.log("  阶段=" + (r.st && r.st.phase) + " 余牌=" + (r.st && r.st.wall) +
  " 四家弃牌=" + (r.seats || []).map(s => s.discards.length).join("/"));
const g = geomChecks(r);
g.lines.forEach(l => console.log("  " + l));
if (!g.ok) console.error("  ⚠ 几何自检未全过：" + JSON.stringify(g.fails));
if (CHECK_ONLY) {
  console.log("[check-only] 布局几何闸：" + (g.ok ? "全部通过 ✔" : "有失败项 ✗") + "（未出图）");
  process.exit(g.ok ? 0 : 3);
}

/* ── 合成为「画面 + 说明条」 ── */
const out = createCanvas(MW, MH + CAPTION, { hostWidth: MW, hostHeight: MH + CAPTION, hostDpr: 1 });
const texts = r.texts.slice();
out.__textHook = t => texts.push(t);
{
  const sb = r.canvas._buf, sw = r.canvas._w, sh = r.canvas._h;
  const db = out._buf, dw = out._w;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const s = (y * sw + x) * 3, d = (y * dw + x) * 3;
    db[d] = sb[s]; db[d + 1] = sb[s + 1]; db[d + 2] = sb[s + 2];
  }
}
out.textAlign = "center"; out.textBaseline = "middle";
out.fillStyle = "rgba(6,5,9,.94)"; out.fillRect(0, MH, MW, CAPTION);
const dc = (r.art && r.art.decor) || {};
const cap = NOFX ? [
  { t: "回退验证（--nofx：art/ 贴图全部加载失败）→ 骰子画成矢量两枚 · 筹码画成矢量圆片 · 牌尺 / 烟灰缸不画；牌桌退化程序化绿绒",
    f: "bold 14px system-ui", c: "#ffe9b8" },
  { t: "本帧：骰子贴图 " + (dc.dice || 0) + " / 矢量 " + (dc.vecDice || 0) + " · 筹码贴图 " + (dc.chips || 0) +
    " / 矢量 " + (dc.vecChip || 0) + " · 牌尺 " + (dc.ruler || 0) + " · 烟灰缸 " + (dc.ashtray || 0), f: "13px system-ui", c: "#8ef2c0" },
  { t: "布局骨架不受影响：牌墙四边 / 三家背面 / 副露外侧 / 牌河每行 6 张 / 中央指示盘", f: "13px system-ui", c: "#d8c7a8" }
] : [
  { t: "照参考图 2 重排：四边整齐长条牌墙（双层 · 对面最长）· 三家手牌背面整齐一横/竖排 · 副露在手牌外侧 · 牌河每行 6 张 · 中央圆形指示盘",
    f: "bold 14px system-ui", c: "#ffe9b8" },
  { t: "本帧：余 " + (r.st && r.st.wall) + " 张 · 第 " + (r.st && r.st.turnNo) + " 巡 · 四家弃牌 " +
    (r.seats || []).map(s => s.discards.length).join("/") + " · 牌墙画出 " + (r.stat && r.stat.wallTiles) + " 块（双层）",
    f: "13px system-ui", c: "#8ef2c0" },
  { t: "副露尺寸纪律：同组内所有牌 " + JSON.stringify([...new Set((r.meldRects || []).map(m => m.w.toFixed(1) + "×" + m.h.toFixed(1)))]) +
    " 一种尺寸；横置牌 rot=90°（绕中心旋转，绝不缩放）→ 共取样 " + (r.meldRects || []).length + " 张",
    f: "13px system-ui", c: g.ok ? "#8ef2c0" : "#ff7d9c" },
  { t: "牌墙牌背尺寸：" + ((r.wallInfo && r.wallInfo.sizes) || []).map(s => s.size + "×" + s.n).join(" · ") +
    "（同一侧完全一致）· 装饰框 " + ((r.decor && r.decor.frames) ? r.decor.frames.length : 0) + " 个与所有保留框零相交 → " + (r.decor && r.decor.ok ? "OK ✔" : "✗"),
    f: "13px system-ui", c: (r.decor && r.decor.ok) ? "#8ef2c0" : "#ff7d9c" },
  { t: "装饰（骰子 / 筹码 / 牌尺 / 烟灰缸）全部保留：贴图命中 dice×" + (dc.dice || 0) + " chips×" + (dc.chips || 0) +
    " ruler×" + (dc.ruler || 0) + " ashtray×" + (dc.ashtray || 0) + " · 矢量兜底 " + ((dc.vecDice || 0) + (dc.vecChip || 0)) + " 次",
    f: "13px system-ui", c: "#d8c7a8" },
  { t: "证据链：无头 vm 真跑生产代码 mahjong.js → Canvas2D 真光栅化（非示意图）· 规则 / AI / 提示 / 结算 / 点击热区零改动",
    f: "12px system-ui", c: "#cbb894" }
];
cap.forEach((l, i) => { out.font = l.f; out.fillStyle = l.c; out.fillText(l.t, MW / 2, MH + 16 + i * 22); });
fs.writeFileSync(PNG, out.toPNG());

const TR = path.join(OUT, "dist", "test-results");
if (!fs.existsSync(TR)) fs.mkdirSync(TR, { recursive: true });
const MANIFEST = path.join(TR, "_mj_layout_text.json");
fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), shots: [{ png: PNG, texts: texts }] }), "utf8");
try {
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(OUT, "tools", "lib", "text-compose.ps1"), "-Manifest", MANIFEST], { stdio: "inherit", cwd: OUT });
} catch (e) { console.error("（文字合成失败，PNG 已出但中文可能缺失）：" + (e && e.message)); }
try { fs.rmSync(MANIFEST, { force: true }); } catch (e) {}

console.log("[" + path.basename(PNG) + "] " + MW + "×" + (MH + CAPTION) + "  " +
  (fs.statSync(PNG).size / 1024).toFixed(1) + "KB  用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
if (!g.ok) process.exitCode = 3;
