/* ═══════════════════════════════════════════════════════════════════════════
   tools/bf/shots/panel2.js — 第二批素材的最终验收出图（真跑 breakfast.js / mahjong.js + 软件光栅化）

   产物（测试截图/ 下）：
     bf_game_bg2.png  完整游戏画面：背景 v2（kitchen2） + 6 种新盘面 + 5 人池三态头像
     mj_bg.png        麻将包间背景（art/bg/mahjong.png） + 牌背贴图（真跑 mahjong.js）
    （bf_plates6.png 由 _bf_assets2_shots.cjs 出）
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { createCanvas } = require("../../lib/raster.js");

const OUT = path.join(__dirname, "..", "..", "..");
const SHOT = path.join(OUT, "测试截图");
if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });
const VW = 1180, VH = 790;

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG: " + file);
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
/* breakfast.js 用的 DOM 替身：宿主 canvas 就是光栅化 canvas */
function makeEl(tag, canvas) {
  const e = { tagName: String(tag).toUpperCase(), children: [], parentNode: null, id: "", className: "",
    _html: "", textContent: "", type: "", value: "", style: {}, dataset: {}, width: 0, height: 0,
    set innerHTML(v) { this._html = String(v); this.children = []; }, get innerHTML() { return this._html; },
    setAttribute(k, v) { if (k === "id") this.id = v; if (k === "class") this.className = v; this[k] = v; },
    getAttribute(k) { return this[k] === undefined ? null : this[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { return c; },
    addEventListener() {}, removeEventListener() {}, dispatch() {}, all() { return []; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: VW, height: VH, right: VW, bottom: VH }; },
    getContext() { return this._ctx; },
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } };
  if (e.tagName === "CANVAS") { e._ctx = canvas; canvas.canvas = e; e.width = canvas._w; e.height = canvas._h; }
  return e;
}
/* mahjong.js 用的纯 DOM 替身（不给 canvas）：它自己 createElement("canvas") */
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
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width || 0, height: this.height || 0, right: this.width || 0, bottom: this.height || 0 }; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getContext(kind) { if (String(kind) !== "2d") return null; if (!this._ctx) this._ctx = o.ctx || null; return this._ctx; },
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } };
}
function bootGame(canvas, texts) {
  const SRC = fs.readFileSync(path.join(OUT, "breakfast.js"), "utf8");
  canvas.__textHook = t => texts.push(t);
  const record = { drawImage: [] };
  const origDraw = canvas.drawImage.bind(canvas);
  canvas.drawImage = function (img) {
    record.drawImage.push({ src: (img && img.src) || "", argc: arguments.length - 1, args: Array.prototype.slice.call(arguments, 1) });
    return origDraw.apply(null, arguments);
  };
  const body = makeEl("body", canvas), host = makeEl("div", canvas);
  host.id = "bfGameHost"; body.appendChild(host);
  const frames = []; let clock = 0;
  const win = { devicePixelRatio: 2, performance: { now: () => clock },
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; }, cancelAnimationFrame: id => { frames[id - 1] = null; },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    addEventListener() {}, removeEventListener() {},
    document: null, location: { href: "file:///" + path.join(OUT, "index.html").replace(/\\/g, "/") },
    Image: ImageCtor(), Math: Math };
  win.document = { body, createElement: tag => makeEl(tag, String(tag).toUpperCase() === "CANVAS" ? canvas : null),
    getElementById: id => (id === "bfGameHost" ? host : null), querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {} };
  const ctx = vm.createContext(Object.assign(win, { console, Date, isFinite, Number, String, Object, Array }));
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(SRC + "\n;globalThis.__BF = window.Breakfast;", ctx);
  const B = ctx.__BF;
  function pump(n, ms) { for (let i = 0; i < n; i++) { clock += (ms === undefined ? 16 : ms); const l = frames.slice(); frames.length = 0; l.forEach(cb => cb && cb(clock)); if (!frames.length) break; } }
  return { B, host, canvas, texts, pump, record, cvEl: () => canvas.canvas };
}

/* ═══ ① bf_game_bg2.png：完整游戏画面（背景 v2 + 6 种盘面 + 5 人池三态头像）═══ */
function gameShot() {
  const texts = [];
  /* breakfast.js 会按 devicePixelRatio 放大位图（cv.width = W*dpr）。
     这里按 dpr=2 开缓冲（2360×1580），变换设成 2× → 逻辑坐标仍是 1180×790。 */
  const DPR = 2;
  const canvas = createCanvas(VW, VH, { hostWidth: VW, hostHeight: VH, hostDpr: DPR });
  const game = bootGame(canvas, texts);
  try { canvas.setTransform(DPR, 0, 0, DPR, 0, 0); } catch (e) {}
  const B = game.B, d = B.debug;
  B.start(game.host, { target: { id: "su", name: "苏晚晴", bond: 40 }, duration: 75, goal: 8, onFinish: () => {} });
  const cvEl = game.cvEl();
  const dprReal = cvEl && cvEl.width ? cvEl.width / VW : 1;
  const ids = [d.pushCustomer(["congee", "egg"]), d.pushCustomer(["sandwich", "juice"]), d.pushCustomer(["bun", "soup"])];
  ids.forEach(i => d.setPatience(i, 0.9));
  /* 6 种盘面一次铺开：空盘列有糊的 / 煎蛋 / 培根 / 三明治 / 包子 / 沙拉 */
  d.drop("egg", null); d.plateNow(3);
  d.drop("bacon", null); d.plateNow(4);
  d.drop("sandwich", null); d.plateNow(5);
  d.drop("bun", null); d.plateNow(6);
  d.drop("salad", null); d.plateNow(7);
  d.drop("congee", null); d.plateNow(0);
  d.drop("soup", null); d.drop("milk", null);
  d.tick(0.6);
  d.setPlateAge(3, 0.4); d.setPlateAge(4, 1.8); d.setPlateAge(5, 3.2);
  d.burnPlate(0);
  /* 三位顾客一次同框：第 1 位「全部拿到 → happy」、第 2 位平静、第 3 位着急。
     注意：满足后顾客 1.3s 就离场，所以 serveAll 必须放在**出图前一瞬**，
     这样「满意」那张脸才抓得到（这也是 happy 态唯一的可见窗口）。 */
  d.setPatience(ids[0], 1); d.setPatience(ids[1], 1); d.setPatience(ids[2], 0.2);
  texts.length = 0;
  d.serveAll(ids[0]);          // 只改状态、不推进时间（satisfiedAt → happy 脸，不离场）
  /* ⚠ 这里必须用**1ms** 的那一帧：loop() 是「先 step 再 render」，而 step() 会在订单完成时
     立刻把顾客置 left（让出座位），render() 又只画 activeCustomers（!left）→ 用默认的
     16ms 泵，满意脸永远抓不到（这是本轮发现的老问题，已在报告里写明）。
     1ms < 1/60s 的步长阈值 → 这一帧只渲染、不推进 → 「满意」那张脸才真的画出来。 */
  game.pump(1, 1);             // 同一次渲染里三张卡同时在，第 1 张就是 happy
  const tex = d.tex(), faces = d.faces(), ready = B.art.ready(), bg = B.art.bg();
  /* 拼一张「画面 + 底部说明条」的成品：光栅化器画不了中文，说明条的文字交给
     tools/lib/text-compose.ps1 用系统字体合成（与上一轮同一条证据链）。 */
  const CAPTION = 52;
  const out = createCanvas(VW, VH + CAPTION, { hostWidth: VW, hostHeight: VH + CAPTION, hostDpr: DPR });
  console.log("   [out] buf=" + out._w + "×" + out._h + "  game=" + canvas._w + "×" + canvas._h);
  /* 把游戏画面按像素搬进成品图（光栅化器之间不做相互 drawImage —— 直接取 _buf 拷） */
  {
    const sb = canvas._buf, sw = canvas._w, sh = canvas._h;
    const db = out._buf, dw = out._w;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const s = (y * sw + x) * 3, d = (y * dw + x) * 3;
      db[d] = sb[s]; db[d + 1] = sb[s + 1]; db[d + 2] = sb[s + 2];
    }
  }
  out.setTransform(DPR, 0, 0, DPR, 0, 0);
  out.fillStyle = "rgba(8,6,10,.94)"; out.fillRect(0, VH, VW, CAPTION);
  out.fillStyle = "#ffe9b8"; out.font = "bold 15px system-ui"; out.textAlign = "center"; out.textBaseline = "middle";
  out.fillText("真跑 breakfast.js + 软件光栅化：背景 v2 art/bg/kitchen2.png（保整幅宽：完整樱花树冠 + 完整货架，" +
    "左右各裁 " + bg.croppedPerSide + "px；木台面上沿落画布 y=" + bg.counterTopCanvasY + "，底部 " + bg.bottomFillPx + "px 木纹补带）" +
    " · 6 种盘面按食物映射（煎蛋/培根各一张）· 5 人池三态头像（满意 / 平静 / 着急）· 糊了红叉", VW / 2, VH + 17);
  out.fillStyle = "#cbb894"; out.font = "12px system-ui";
  out.fillText("贴图可用 food " + ready.food + "/9 · gear " + ready.gear + "/12 · face " + ready.face + "/15 · ui " + ready.ui + "/9 · bg " + ready.bg + "/1" +
    "　｜　本帧 drawImage：背景 " + (tex.bg ? 1 : 0) + " · 锅位 " + tex.panTex + " · 盘位 " + tex.plateTex + " · 头像 " + tex.faces +
    " · 耐心条 " + tex.uiBar + " · 星级 " + tex.uiStars + " · 金币 " + tex.uiCoin + " · 勾 " + tex.uiCheck + " · 叉 " + tex.uiCross +
    "　｜　头像：" + faces.map(f => f.name + "(" + f.mood + ")").join(" / "), VW / 2, VH + 37);
  out.textAlign = "left";
  fs.writeFileSync(path.join(SHOT, "bf_game_bg2.png"), out.toPNG());
  const names = game.record.drawImage.map(x => x.src.split("/").pop());
  return { tex, faces, ready, bg, texts, dpr: dprReal, plates: names.filter(n => /^plate_/.test(n)), names };
}

/* ═══ ② mj_bg.png：麻将包间背景 + 牌背贴图（真跑 mahjong.js）═══ */
function mjShot() {
  const MW = 1240, MH = 860;
  const canvas = createCanvas(MW, MH, { hostWidth: MW, hostHeight: MH, hostDpr: 2 });
  const texts = [];
  canvas.__textHook = t => texts.push(t);
  const record = { drawImage: [] };
  const origDraw = canvas.drawImage.bind(canvas);
  canvas.drawImage = function (img) {
    record.drawImage.push({ src: (img && img.src) || "", args: Array.prototype.slice.call(arguments, 1) });
    return origDraw.apply(null, arguments);
  };
  const SRC = fs.readFileSync(path.join(OUT, "mahjong.js"), "utf8");
  const host = makePlainEl("div");
  const cvEl = makePlainEl("canvas", { ctx: canvas });
  const frames = []; let clock = 0;
  const doc = {
    head: makePlainEl("head"), body: makePlainEl("body"),
    createElement: tag => (String(tag).toUpperCase() === "CANVAS" ? cvEl : makePlainEl(tag)),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}
  };
  const win = { devicePixelRatio: 2, performance: { now: () => clock },
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; }, cancelAnimationFrame: id => { frames[id - 1] = null; },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    addEventListener() {}, removeEventListener() {}, document: doc,
    innerWidth: 1280, innerHeight: 900, Image: ImageCtor(), Math: Math,
    location: { href: "file:///" + path.join(OUT, "index.html").replace(/\\/g, "/") },
    AudioSys: { blip() {}, click() {}, ding() {}, good() {}, bad() {} }, localStorage: null };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(Object.assign(win, { console, Date, isFinite, Number, String, Object, Array, JSON }));
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(SRC, ctx, { filename: "mahjong.js" });
  const MJ = ctx.Mahjong || win.Mahjong;
  if (!MJ) throw new Error("mahjong.js did not export window.Mahjong");
  const started = MJ.start(host, {});
  for (let i = 0; i < 10; i++) { clock += 16; const l = frames.slice(); frames.length = 0; l.forEach(cb => cb && cb(clock)); }
  const st = MJ.debug.state();
  const art = MJ.debug.art ? MJ.debug.art() : null;
  fs.writeFileSync(path.join(SHOT, "mj_bg.png"), canvas.toPNG());
  return { started, st, art, texts, drawn: record.drawImage.map(x => x.src.split("/").pop()), MW, MH };
}

const t0 = Date.now();
const g = gameShot();
console.log("[bf_game_bg2.png] " + VW + "×" + VH + "  " + (fs.statSync(path.join(SHOT, "bf_game_bg2.png")).size / 1024).toFixed(1) + "KB  dpr=" + g.dpr);
console.log("   bg: " + g.bg.file + " active=" + g.bg.active + " counter y=" + g.bg.counterTopCanvasY + " croppedPerSide=" + g.bg.croppedPerSide + " bottomFill=" + g.bg.bottomFillPx);
console.log("   plates: " + [...new Set(g.plates)].join(" / "));
console.log("   faces: " + g.faces.map(f => f.name + "(" + f.mood + ")").join(" / "));
console.log("   ready: food " + g.ready.food + "/9 gear " + g.ready.gear + "/12 face " + g.ready.face + "/15 ui " + g.ready.ui + "/9 bg " + g.ready.bg + "/1");
const m = mjShot();
console.log("[mj_bg.png] " + m.MW + "×" + m.MH + "  " + (fs.statSync(path.join(SHOT, "mj_bg.png")).size / 1024).toFixed(1) + "KB"
  + "  start=" + m.started + " phase=" + (m.st && m.st.phase));
console.log("   room bg: " + (m.art ? m.art.bg.file + " ready=" + m.art.bg.ready + " roomBg=" + m.art.roomBg : "(no art api)"));
console.log("   tiles: " + (m.art ? m.art.ready + "/9" : "-") + " tileBackTex=" + (m.art ? m.art.tileBackTex : "-"));
const manifest = { at: new Date().toISOString(), shots: [
  { png: path.join(SHOT, "bf_game_bg2.png"), texts: g.texts },
  { png: path.join(SHOT, "mj_bg.png"), texts: m.texts }] };
fs.writeFileSync(path.join(OUT, "dist", "test-results", "bf_shots2_text.json"), JSON.stringify(manifest), "utf8");
console.log("[done] 测试截图/bf_game_bg2.png · mj_bg.png   (" + ((Date.now() - t0) / 1000).toFixed(1) + "s)");
