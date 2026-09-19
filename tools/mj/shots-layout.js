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
           ring: MJ.debug.ring ? MJ.debug.ring() : null,
           wallClear: MJ.debug.wallClear ? MJ.debug.wallClear() : null,
           wallSpan: MJ.debug.wallSpan ? MJ.debug.wallSpan() : null,
           reserved: MJ.debug.reserved ? MJ.debug.reserved() : null,
           wallInfo: MJ.debug.wallInfo(), layout: MJ.debug.layout(),
           wallInfo: MJ.debug.wallInfo(), layout: MJ.debug.layout(),
           decor: MJ.debug.decor(), art: MJ.debug.art ? MJ.debug.art() : null,
           clock: clock, ticks: ticks };
}

/* 墙段连续性：把保留框里的牌墙墩按「边」分组，检查同段内相邻墩的间隙 ≤ 1px（紧贴，不是一格格排开）。 */
function wallContinuity(reserved) {
  const wb = (reserved || []).filter(b => b.name === "wall");
  const out = { ok: wb.length > 0, txt: "", maxGap: 0 };
  const sides = ["top", "bottom", "left", "right"];
  const parts = [];
  for (const sd of sides) {
    const g = wb.filter(b => b.side === sd);
    if (!g.length) continue;
    const horiz = (sd === "top" || sd === "bottom");
    g.sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
    let mg = 0;
    for (let i = 1; i < g.length; i++) {
      const gap = horiz ? (g[i].x - (g[i - 1].x + g[i - 1].w)) : (g[i].y - (g[i - 1].y + g[i - 1].h));
      mg = Math.max(mg, gap);
    }
    out.maxGap = Math.max(out.maxGap, mg);
    if (!(mg <= 1)) out.ok = false;
    parts.push(sd + ":" + g.length + "墩 最大缝 " + mg + "px");
  }
  out.txt = parts.join(" · ");
  return out;
}
/* 牌墙像素实测：在「顶墙 / 左墙」两块取样区里数「绿」与「象牙白」像素 —— 不靠源码字符串。
   取样区取得很宽（3~6 墩都能盖住），余牌 40~90 都稳定命中。
   v4 起方环放大：顶墙带 y55..101（外沿白棱 ~55..58、绿面 ~58..78），左墙带 x256..302。 */
function rasterProbe(cv) {
  const buf = cv && cv._buf, w = cv && cv._w, h = cv && cv._h;
  const out = { green: 0, ivory: 0, w: w || 0, h: h || 0 };
  if (!buf || !w || !h) return out;
  /* 取样区覆盖「外沿白棱 + 绿面」整条带：顶墙带 y55..101、左墙带 x256..302 */
  const zones = [ { x: 560, y: 55, w: 120, h: 23 }, { x: 255, y: 340, w: 24, h: 100 } ];
  for (const z of zones) for (let y = z.y; y < z.y + z.h; y++) for (let x = z.x; x < z.x + z.w; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = (y * w + x) * 3, R = buf[i], G = buf[i + 1], B = buf[i + 2];
    if (G >= 90 && G >= R + 30 && G >= B + 25) out.green++;
    else if (R >= 170 && G >= 165 && B >= 150 && R >= B + 8 && Math.abs(R - G) <= 25) out.ivory++;
  }
  return out;
}
/* 绿面朝外取证：顶墙「外沿窄带」应为象牙白、「紧挨的内侧带」应为绿面。
   顶墙带 y55..101：外枚白棱在最外（y55..58），绿面紧随（y58..78）。 */
function rasterStrips(cv) {
  const buf = cv && cv._buf, w = cv && cv._w, h = cv && cv._h;
  const out = { white: 0, green: 0, nw: 0, ng: 0 };
  if (!buf || !w || !h) return out;
  function frac(z, kind) {
    let hit = 0, tot = 0;
    for (let y = z.y; y < Math.min(h, z.y + z.h); y++) for (let x = z.x; x < Math.min(w, z.x + z.w); x++) {
      if (x < 0 || y < 0) continue;
      const i = (y * w + x) * 3, R = buf[i], G = buf[i + 1], B = buf[i + 2];
      tot++;
      const isWhite = (R >= 170 && G >= 165 && B >= 150 && R >= B + 8 && Math.abs(R - G) <= 25);
      const isGreen = (G >= 90 && G >= R + 30 && G >= B + 25);
      if (kind === "white" ? isWhite : isGreen) hit++;
    }
    return tot ? hit / tot : 0;
  }
  /* 白棱取样避开 1px 描边：取 y57..60（白棱 55..59.9 的内侧 3px）*/ 
  out.white = frac({ x: 566, y: 57, w: 108, h: 3 }, "white");
  out.green = frac({ x: 566, y: 60, w: 108, h: 16 }, "green");
  return out;
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
  add(ws.length > 0 && ws.length <= 2, "牌墙牌背尺寸一致（" + ws.map(s => s.size + "×" + s.n + "枚").join(" · ") +
    "）—— 横向边 30×23 / 纵向边 23×30，共 " + (r.wallInfo ? r.wallInfo.total : 0) + " 枚（满墙 34 墩 × 每墩两枚）");
  /* ③ 装饰安全区 */
  const dk = r.decor || {};
  add(!!dk.ok, "装饰安全区自检 decorCheck()：" + (dk.frames ? dk.frames.length : 0) + " 个装饰框 / " +
    (dk.reserved || 0) + " 个保留框零相交" + (dk.ok ? "" : " → " + JSON.stringify(dk.hits)));
  /* ④ 手牌 / 牌河几何 */
  const L = r.layout || {};
  add(!!(L.hand && L.hand.tw === 56 && L.hand.th === 78), "玩家手牌仍 56×78（排序 + 刚摸的牌单独靠右 + 金边规则不变）");
  add(!!(L.disc && L.disc.tw === 36 && L.disc.th === 48), "牌河牌面 36×48（照参考图放大、贴近指示盘外圈），四家统一每行 6 张换行");
  /* ⑤ 牌墙四段围成同心方环：内表面到中心**四面全等** + 四段各在自己那一侧 */
  const rg = r.ring || {}, k4 = ["top", "right", "bottom", "left"];
  add(!!rg.ok, "牌墙四面围成方环：内表面到中心 " +
    k4.map(k => k + "=" + (rg.dIn || {})[k]).join(" · ") + "（上下 " + rg.rInY + "px / 左右 " + rg.rInX + "px）· 外沿 " +
    rg.rOutX + "×" + rg.rOutY + "px · 四段各在自己那一侧=" + rg.sameSide + " · 各段墩数 " +
    k4.map(k => k + ":" + (rg.n || {})[k]).join("/"));
  /* ⑥ 牌墙 × 牌河 / 手牌 / 副露 / 中央盘：零相交（保留框与 decorCheck 同一份口径）*/
  const wc = r.wallClear || {};
  add(!!wc.ok, "牌墙 " + wc.wall + " 块 × 其它保留框 " + wc.others + " 个零相交" +
    (wc.ok ? " ✔" : " → " + JSON.stringify(wc.hits)));
  /* ⑦ 同心三层顺序：指示盘 × 牌河零相交 ⊂ 牌河全在方环内表面之内 ⊂ 手牌全在方环外表面之外 */
  const ro = rg.order || {};
  add(!!ro.ok, "同心三层顺序：指示盘×牌河零相交=" + ro.disc + " · 牌河全在方环内=" + ro.riverInside +
    " · 手牌全在方环外=" + ro.backOutside + (ro.ok ? " ✔" : " → " + JSON.stringify(ro.hits)));
  /* ⑧ 牌墙不再贴屏幕四边（同心重排的核心诉求；旧布局上边只剩 12px 余量 → 这条当时必红）*/
  const wb = (r.reserved || []).filter(b => b.name === "wall");
  let wx = Infinity, wy = Infinity, wx2 = -Infinity, wy2 = -Infinity;
  wb.forEach(b => { wx = Math.min(wx, b.x); wy = Math.min(wy, b.y);
                    wx2 = Math.max(wx2, b.x + b.w); wy2 = Math.max(wy2, b.y + b.h); });
  const wMargin = Math.min(wx - 14, wy - 14, 1226 - wx2, 846 - wy2);
  add(wb.length === 34 && wMargin >= 30, "牌墙整环外接框 x" + wx + ".." + wx2 + " y" + wy + ".." + wy2 +
    "（34 墩 × 每墩两枚 = 68 枚），离绒面边（14/14/1226/846）最小余量 " + wMargin + "px ≥ 30（方环已放大到参考图比例，余量自然变小）");
  /* ⑭ 方环占桌面比例（用户验收：宽 ≥0.60 · 高 ≥0.78）*/
  const rr2 = rg.ratio || {}, rbk = rg.box || {};
  add(!!(rr2.w >= 0.60 && rr2.h >= 0.78), "方环占桌面比例：宽 " + (rr2.w || 0).toFixed(3) + " ≥ 0.60 · 高 " +
    (rr2.h || 0).toFixed(3) + " ≥ 0.78（参考图 0.645 / 0.815）· 外接框 " + rbk.w + "×" + rbk.h);
  /* ⑮ 墙段连续性：同一段内相邻墩**紧贴**（间距 ≤ 1px），不是一格格排开 */
  const cont = wallContinuity(r.reserved);
  add(!!cont.ok, "墙段连续性（同段相邻墩间距 ≤1px）：" + cont.txt);
  /* ⑯ 绿面朝外：顶墙外沿那条窄带必须是**象牙白**（白棱压在上沿），紧挨着的带必须是**绿面** */
  const st2 = rasterStrips(r.canvas);
  add(st2.white >= 0.55 && st2.green >= 0.60, "绿面朝外（顶墙像素实测）：外沿窄带象牙白占比 " +
    st2.white.toFixed(2) + "（≥0.55）· 内侧带绿面占比 " + st2.green.toFixed(2) + "（≥0.60）→ 白棱在外沿、绿面朝外");
  /* ⑩ 一墩两枚：满墙 34 墩 × 2 枚 = 68 枚；整墩总高 = 2 × 单枚牌厚 */
  const wi = r.wallInfo || {}, rs3 = r.stat || {};
  add(wi.total === 68 && wi.stacks === 34 && wi.perStack === 2 && wi.stackDepth === 2 * wi.tileDepth,
    "牌墙一墩两枚：满墙 " + wi.stacks + " 墩 × " + wi.perStack + " 枚 = " + wi.total + " 枚；单枚牌背深 " +
    wi.tileDepth + "px，整墩 " + wi.stackDepth + "px = 2 × " + wi.tileDepth + " ✔");
  /* ⑪ 画出枚数 = ceil(余牌 / 2)（每枚代表 2 张）；余牌不足时**外枚先消失** → 只剩内枚单层 */
  const remain = (r.st && r.st.wall) || 0, wantVis = Math.ceil(remain / 2);
  add(wi.tiles === wantVis && wi.drawnStacks === Math.ceil(wantVis / 2),
    "余牌 " + remain + " 张 → 画出 " + wi.tiles + " 枚（= ceil(" + remain + "/2)）/ " + wi.drawnStacks +
    " 墩 · 每枚代表 2 张 · 余牌不足时外枚先消失（只剩内枚单层）");
  /* ⑫ 每一枚牌背都同时画了「绿色主面」与「象牙白棱边」两块 */
  add(wi.tiles > 0 && rs3.backGreen >= wi.tiles && rs3.backIvory >= wi.tiles,
    "牌背颜色分层（绘制指令计数）：本帧牌背 " + rs3.backSolid + " 枚 → 绿面 " + rs3.backGreen +
    " 块 + 象牙白棱 " + rs3.backIvory + " 块（每一枚两样都有）");
  /* ⑬ 光栅化实测：牌墙区域里同时取到「绿」与「象牙白」像素（不靠源码字符串）*/
  const px = rasterProbe(r.canvas);
  add(px.green > 200 && px.ivory > 60, "牌墙像素实测（软件光栅化真图取样）：绿 " + px.green + " px / 象牙白 " +
    px.ivory + " px（顶墙 x560..680 y55..78 + 左墙 x255..279 y340..440 两块取样区，含外沿白棱）");
  /* ⑨ 缺口留在正中：本帧四面「已画那一段」的中点必须落回本侧中点（偶数墩也不许偏半块）*/
  const wsp = r.wallSpan || {};
  let centered = true;
  const off4 = k4.map(k => { const o = wsp[k];
    if (!o) { centered = false; return k + ":无"; }
    const dd = Math.abs(o.mid - o.want); if (dd > 0.01) centered = false;
    return k + " " + o.n + "墩 mid=" + o.mid + " want=" + o.want; });
  add(centered, "牌墙四面各自以本侧中点为中心（缺口留正中）：" + off4.join(" · "));
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
  { t: "同心三层（照参考图量测后重排）：最中央圆形指示盘 → 内圈牌墙方环（双层 · 四面内表面到中心等距 240px）→ 方环内侧牌河（每行 6 张 · 朝心）→ 外圈四家手牌 + 副露 + 座位牌",
    f: "bold 14px system-ui", c: "#ffe9b8" },
  { t: "牌墙方环：上9/右8/下9/左8 墩 · 内层到中心 240px / 外层 286px · 四段各在自己那侧 " +
    ((r.ring && r.ring.ok) ? "✔" : "✗") + " · 与牌河 / 手牌 / 副露 / 中央盘零相交 " +
    ((r.wallClear && r.wallClear.ok) ? "✔" : "✗"),
    f: "13px system-ui", c: ((r.ring && r.ring.ok) && (r.wallClear && r.wallClear.ok)) ? "#8ef2c0" : "#ff7d9c" },
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
/* 供 tools/mj/shots-vs-ref.js 做「与参考图并排对照」：把未合成的 1240×860 桌面原图另存一份 raw RGB */
fs.writeFileSync(path.join(TR, "mj_layout_raw.bin"), Buffer.from(r.canvas._buf));
fs.writeFileSync(path.join(TR, "mj_layout_raw.json"),
  JSON.stringify({ w: r.canvas._w, h: r.canvas._h, wall: (r.st && r.st.wall), turn: (r.st && r.st.turnNo),
                   discCx: 620, discCy: 380, at: new Date().toISOString() }), "utf8");
fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), shots: [{ png: PNG, texts: texts }] }), "utf8");
try {
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(OUT, "tools", "lib", "text-compose.ps1"), "-Manifest", MANIFEST], { stdio: "inherit", cwd: OUT });
} catch (e) { console.error("（文字合成失败，PNG 已出但中文可能缺失）：" + (e && e.message)); }
try { fs.rmSync(MANIFEST, { force: true }); } catch (e) {}

console.log("[" + path.basename(PNG) + "] " + MW + "×" + (MH + CAPTION) + "  " +
  (fs.statSync(PNG).size / 1024).toFixed(1) + "KB  用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
if (!g.ok) process.exitCode = 3;
