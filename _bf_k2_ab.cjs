/* 临时：把 kitchen2 的两种候选策略各出一张「真游戏画面」预览，用于目视选型。
   候选 1 = 保整幅宽（scale=VIEW.w/srcW，台面 y≈406，底部木纹平铺补带）
   候选 2 = 台面精确 y=318（scale 由 srcH-counterTop 反解，左右各裁若干）
   用法：node _bf_k2_ab.cjs <早餐店背景v2.png> [counterTopY]
   ⚠ 会临时改写 art/bg/kitchen2.png（每次跑完恢复成候选 1），只用于选型。      */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), { execFileSync } = require("child_process");
const G = require("./_bf_assets2_gen.cjs");
const { createCanvas } = require("./_bf_raster.cjs");
const OUT = __dirname;
const SHOT = path.join(OUT, "测试截图");
const VW = 1180, VH = 790;
const K2 = path.join(OUT, "art", "bg", "kitchen2.png");
const KEEP = path.join(OUT, "_probe_out", "kitchen2_A_fullwidth.png");

function pngSize(file) { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; }
function resolveImgPath(src) { let s = String(src || ""); if (s.startsWith("/")) s = s.slice(1); return path.isAbsolute(s) ? s : path.join(OUT, s); }
function ImageCtor() {
  return function Image() {
    const img = { naturalWidth: 0, naturalHeight: 0, complete: false, onload: null, onerror: null, _src: "",
      get src() { return this._src; },
      set src(v) { this._src = String(v); let sz = null; try { sz = pngSize(resolveImgPath(v)); } catch (e) { sz = null; }
        if (sz) { this.naturalWidth = sz.w; this.naturalHeight = sz.h; this.complete = true; if (this.onload) this.onload({ target: this }); }
        else if (this.onerror) this.onerror({ target: this }); } };
    return img;
  };
}
function makeEl(tag, canvas) {
  const e = { tagName: String(tag).toUpperCase(), children: [], parentNode: null, id: "", className: "", _html: "", textContent: "", type: "", value: "", style: {}, dataset: {}, _handlers: {},
    set innerHTML(v) { this._html = String(v); this.children = []; }, get innerHTML() { return this._html; },
    setAttribute(k, v) { if (k === "id") this.id = v; if (k === "class") this.className = v; this[k] = v; },
    getAttribute(k) { return this[k] === undefined ? null : this[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { return c; },
    addEventListener() {}, removeEventListener() {}, dispatch() {}, all() { return []; }, querySelector() { return null; }, querySelectorAll() { return []; },
    getContext() { return this._ctx; }, classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } };
  if (e.tagName === "CANVAS") { e._ctx = canvas; canvas.canvas = e; e.width = VW; e.height = VH; }
  return e;
}
function bootGame(canvas, texts) {
  const SRC = fs.readFileSync(path.join(OUT, "breakfast.js"), "utf8");
  canvas.__textHook = t => texts.push(t);
  const record = { drawImage: [] };
  const origDraw = canvas.drawImage.bind(canvas);
  canvas.drawImage = function (img) { record.drawImage.push({ src: (img && img.src) || "", args: Array.prototype.slice.call(arguments, 1) }); return origDraw.apply(null, arguments); };
  const body = makeEl("body"), host = makeEl("div");
  host.id = "bfGameHost"; body.appendChild(host);
  const frames = []; let clock = 0;
  const win = { devicePixelRatio: 1, performance: { now: () => clock },
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; }, cancelAnimationFrame: id => { frames[id - 1] = null; },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval() {}, addEventListener() {}, removeEventListener() {},
    document: null, location: { href: "file:///" + path.join(OUT, "index.html").replace(/\\/g, "/") }, Image: ImageCtor(), Math: Math };
  win.document = { body, createElement: tag => makeEl(tag, String(tag).toUpperCase() === "CANVAS" ? canvas : null),
    getElementById: id => (id === "bfGameHost" ? host : null), querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {} };
  const ctx = vm.createContext(Object.assign(win, { console, Date, isFinite, Number, String, Object, Array }));
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(SRC + "\n;globalThis.__BF = window.Breakfast;", ctx);
  const B = ctx.__BF;
  function pump(n, ms) { for (let i = 0; i < n; i++) { clock += (ms === undefined ? 16 : ms); const l = frames.slice(); frames.length = 0; l.forEach(cb => cb && cb(clock)); if (!frames.length) break; } }
  return { B, host, canvas, texts, pump, record, frames, ticks: () => clock };
}
const CAPTION = 46;
function frame(tag, bgInfo) {
  const texts = [];
  const canvas = createCanvas(VW, VH + CAPTION);
  const game = bootGame(canvas, texts);
  const B = game.B, d = B.debug;
  B.start(game.host, { target: { id: "su", name: "苏晚晴", bond: 40 }, duration: 75, goal: 8, onFinish: () => {} });
  const ids = [d.pushCustomer(["congee", "egg"]), d.pushCustomer(["sandwich", "juice"]), d.pushCustomer(["bun", "soup"])];
  ids.forEach(i => d.setPatience(i, 0.9));
  d.drop("egg", null); d.plateNow(3); d.serveCol(3);
  d.drop("bacon", null); d.plateNow(4);
  d.drop("bun", null); d.plateNow(6);
  d.drop("congee", null); d.plateNow(0);
  d.drop("soup", null); d.drop("salad", null); d.drop("juice", null);
  d.tick(0.6); d.setPlateAge(4, 0.5); d.setPlateAge(6, 2.0); d.burnPlate(0);
  [0.82, 0.55, 0.22].forEach((p, i) => d.setPatience(ids[i], p));
  texts.length = 0; game.pump(1);
  const bg = bgInfo || B.art.bg();
  console.log("  [debug] art.bg() = " + JSON.stringify(B.art.bg()));
  console.log("  [debug] record.drawImage = " + JSON.stringify(game.record.drawImage.slice(0, 5)));
  canvas.fillStyle = "rgba(8,6,10,.94)"; canvas.fillRect(0, VH, VW, CAPTION);
  canvas.font = "bold 15px system-ui"; canvas.textAlign = "center"; canvas.textBaseline = "middle"; canvas.fillStyle = "#ffe9b8";
  canvas.fillText(tag, VW / 2, VH + 15);
  canvas.font = "12px system-ui"; canvas.fillStyle = "#cbb894";
  canvas.fillText("木台面上沿实测 = 画布 y" + bg.counterTopCanvasY + "（目标 " + bg.counterTopCanvasYTarget + "，偏差 " + (bg.counterTopCanvasY - bg.counterTopCanvasYTarget).toFixed(1) + "px）" +
    " · 盘带 328..438 / 锅带 450..608 / 桶带 624..776（9 列元素位置一字未动）", VW / 2, VH + 33);
  return { canvas, bg };
}
const src = process.argv[2];
const img = G.decodePNG(fs.readFileSync(src));
/* 候选 1 = 当前 art/bg/kitchen2.png（保整幅宽） */
fs.copyFileSync(K2, KEEP);
const r1 = JSON.parse(fs.readFileSync(path.join(OUT, "art", "_assets2_report.json"), "utf8")).backgrounds.find(b => b.key === "kitchen2");
const g1 = frame("候选 1 · 保整幅宽（左右 0 裁切，完整樱花树冠 + 完整货架）—— scale=" + (r1 ? r1.scale : "?"), r1);
fs.writeFileSync(path.join(SHOT, "bf_game_bg2_cand1.png"), g1.canvas.toPNG());
/* 候选 2 = 台面精确 y=318，左右各裁若干（脚本自己求 scale） */
const r2 = G.kitchen2(src, "kitchen2.png");
r2.counterTopCanvasYTarget = G.COUNTER_TOP_CANVAS_Y;
const g2 = frame("候选 2 · 台面精确 y318（" + r2.strategy + "，左右各裁 " + r2.croppedPerSide + "px = " + r2.croppedPercent + "%）—— scale=" + r2.scale, r2);
fs.writeFileSync(path.join(SHOT, "bf_game_bg2_cand2.png"), g2.canvas.toPNG());
fs.copyFileSync(KEEP, K2);                                   // 恢复候选 1
console.log("候选 1 → 测试截图/bf_game_bg2_cand1.png   台面画布 y=" + g1.bg.counterTopCanvasY + "  " + JSON.stringify({ strategy: r1.strategy, croppedPerSide: r1.croppedPerSide, bottomFillPx: r1.bottomFillPx, scale: r1.scale }));
console.log("候选 2 → 测试截图/bf_game_bg2_cand2.png   台面画布 y=" + g2.bg.counterTopCanvasY + "  " + JSON.stringify({ strategy: r2.strategy, croppedPerSide: r2.croppedPerSide, bottomFillPx: r2.bottomFillPx, scale: r2.scale }));
console.log("（art/bg/kitchen2.png 已恢复为候选 1）");
