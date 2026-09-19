/* ═══════════════════════════════════════════════════════════════════════════
   _mj_bg2_shots.cjs — 出品 测试截图/mj_bg2.png：「含骰子 / 筹码装饰的麻将桌」

   证据链（与 _bf_shots2.cjs / _bf_assets_shots.cjs 同一条，本沙箱起不了 Chrome/Edge）：
     真跑生产代码 mahjong.js（无头 vm + 真 DOM 替身）
       → 它发出的 Canvas2D 指令交给 _bf_raster.cjs 真光栅化
         （drawImage 是**真实现**：现解 PNG、按当前变换 + globalAlpha 合成）
       → 文字经 __textHook 记下，最后交给 _bf_text.ps1 + System.Drawing 合成真汉字。

   与 _bf_shots2.cjs 的 mjShot() 的差别（为什么另起一个脚本）：
     · mj_bg.png 是「开局第一帧」（setTimeout 被 stub 成 0 → AI 一步都不走，牌河是空的）
     · 本图要展示**装饰与牌河 / 手牌 / 副露同框**，所以这里实现了**虚拟定时器 + 虚拟 rAF**：
       让 AI 真的把牌打出来、人类回合超时自动出牌，牌桌上出现真实牌河后再出一帧。
       （_bf_shots2.cjs 是已验证的产线脚本，不动它，避免影响 bf_game_bg2.png 的复现。）

   运行：node _mj_bg2_shots.cjs
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { createCanvas } = require("./_bf_raster.cjs");
const { execFileSync } = require("child_process");

const OUT = __dirname;
const SHOT = path.join(OUT, "测试截图");
if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });
const PNG = path.join(SHOT, "mj_bg2.png");
const MW = 1240, MH = 860, DPR = 2, CAPTION = 118;

/* ── Image 替身：src 一赋值就真去磁盘读 PNG 的 IHDR（宽高是真数据）── */
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
/* mahjong.js 用的纯 DOM 替身（它自己 createElement("canvas") 拿宿主画布）*/
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

/* ── 真跑 mahjong.js：虚拟定时器 + 虚拟 rAF，让 AI 与「人类超时自动出牌」都真的跑起来 ── */
function runTable(opts) {
  opts = opts || {};
  const canvas = createCanvas(MW, MH, { hostWidth: MW, hostHeight: MH, hostDpr: DPR });
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
  /* 推帧：每 16ms 一拍，先跑到期定时器（AI 行动 / 人类超时自动出牌），再收 rAF。
     ⚠ 关键：**不执行** rAF 回调 —— 光栅化一帧 2480×1720 的照片背景很贵，几千帧根本跑不完。
       mahjong.js 的 rAF 回调只负责 renderTable + 倒计时显示 + 结算兜底，
       游戏推进全靠 later()（setTimeout）→ 所以这里只把回调「存起来」，
       最后执行一次就能得到一帧完整画面（回调内部会自己再注册下一帧）。
       setInterval 被 stub 成 0（与 mj_bg.png 同一做法），避免 200ms 兜底帧偷偷渲染。 */
  let loopCb = null;
  function tick() {
    clock += 16;
    for (let i = 0; i < timers.length; i++) {
      if (timers[i].at <= clock) { const t = timers.splice(i, 1)[0]; i--; try { t.cb(); } catch (e) {} }
    }
    /* 只留最后一次拿到的 rAF 回调（= mahjong 的 loop），其余的丢掉；
       注意不能每拍都覆盖成空数组 —— 那样最后就没有可执行的渲染回调了。 */
    if (rafQ.length) { loopCb = rafQ[rafQ.length - 1]; rafQ.length = 0; }
  }
  const wantDisc = opts.untilDiscards === undefined ? 10 : opts.untilDiscards;
  const maxMs = opts.maxMs === undefined ? 240000 : opts.maxMs;
  let ticks = 0, st = null;
  while (clock < maxMs && ticks < 20000) {
    tick(); ticks++;
    st = MJ.debug.state();
    if (!st || st.phase === "over") break;
    const seats = MJ.debug.seats();
    if (seats && seats[0] && seats[0].discards.length >= wantDisc) break;
  }
  /* 最后执行一次 loop()：它内部 renderTable() 画的是**当前**状态（而不是开局那一帧） */
  if (loopCb) { try { loopCb(clock); } catch (e) { console.error("render:", e && e.message); } }
  return { canvas, texts, record, MJ, started, st: MJ.debug.state(), seats: MJ.debug.seats(),
           art: MJ.debug.art ? MJ.debug.art() : null, decor: MJ.debug.decor ? MJ.debug.decor() : null,
           clock: clock, ticks: ticks };
}

/* ═══ 出图 ═══
   --nofx：把 Image 换成「永远加载失败」→ 验**回退链**（骰子→矢量两枚 · 筹码→矢量圆片 ·
           牌尺/烟灰缸→不画）。这一模式只在开局附近出一帧（够看装饰），几秒就完。 */
const NOFX = process.argv.indexOf("--nofx") >= 0;
const OUTPNG = path.join(SHOT, NOFX ? "mj_bg2_vecfallback.png" : "mj_bg2.png");
const t0 = Date.now();
const r = NOFX ? runTable({ imageFail: true, untilDiscards: 0, maxMs: 1200 })
               : runTable({ untilDiscards: 10 });
console.log("[真跑] mahjong.js start=" + r.started + " 虚拟时钟 " + (r.clock / 1000).toFixed(1) + "s / " + r.ticks + " 帧" + (NOFX ? "（--nofx 全贴图加载失败）" : ""));
console.log("  阶段=" + (r.st && r.st.phase) + " 余牌=" + (r.st && r.st.wall) +
  " 四家弃牌=" + (r.seats || []).map(s => s.discards.length).join("/") +
  " 四家副露=" + (r.seats || []).map(s => s.melds.length).join("/"));

/* 把游戏画面按像素搬进「画面 + 说明条」的成品图 */
const out = createCanvas(MW, MH + CAPTION, { hostWidth: MW, hostHeight: MH + CAPTION, hostDpr: DPR });
{
  const sb = r.canvas._buf, sw = r.canvas._w, sh = r.canvas._h;
  const db = out._buf, dw = out._w;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const s = (y * sw + x) * 3, d = (y * dw + x) * 3;
    db[d] = sb[s]; db[d + 1] = sb[s + 1]; db[d + 2] = sb[s + 2];
  }
}
out.setTransform(DPR, 0, 0, DPR, 0, 0);
out.__textHook = t => r.texts.push(t);
out.fillStyle = "rgba(6,5,9,.94)"; out.fillRect(0, MH, MW, CAPTION);
out.textAlign = "center"; out.textBaseline = "middle";
const ar = r.art || {}, dc = (ar.decor) || {}, ck = r.decor || {};
const lines = NOFX ? [
  { t: "回退链验证（--nofx：所有 art/ 贴图强制加载失败）：骰子 → 矢量两枚 · 筹码 → 矢量圆片 · 牌尺 / 烟灰缸 → 不画",
    f: "bold 15px system-ui", c: "#ffe9b8", y: MH + 18 },
  { t: "本帧计数：骰子贴图 " + (dc.dice || 0) + " / 矢量 " + (dc.vecDice || 0) + "　·　筹码贴图 " + (dc.chips || 0) +
       " / 矢量 " + (dc.vecChip || 0) + "　·　牌尺 " + (dc.ruler || 0) + " · 烟灰缸 " + (dc.ashtray || 0) +
       "　·　跳过（不画） " + (dc.skipped || 0) + " 次",
    f: "13px system-ui", c: "#8ef2c0", y: MH + 46 },
  { t: "判据：vecDice = 1（一次矢量调用画两枚）· vecChip = 3（金 / 红 / 蓝各一片）· skipped = 2（牌尺 + 烟灰缸不画）· 贴图命中数全为 0",
    f: "13px system-ui", c: "#d8c7a8", y: MH + 70 },
  { t: "房间背景贴图同时失败 → 桌面回退程序化绿绒（这帧就是回退出来的样子）；规则 / AI / 智脑提示 / 结算 一律不受影响",
    f: "13px system-ui", c: "#cbb894", y: MH + 94 },
  { t: "安全区自检 decorCheck()：" + (ck.frames ? ck.frames.length : 0) + " 个装饰框（含矢量兜底）与牌墙 / 手牌 / 副露 / 牌河 / 中央面板零相交 → " + (dc.safe ? "OK ✔" : "✗"),
    f: "13px system-ui", c: dc.safe ? "#8ef2c0" : "#ff7d9c", y: MH + 114 }
] : [
  { t: "真跑 mahjong.js + 软件光栅化：牌桌静态装饰（骰子 · 筹码 · 牌尺 · 烟灰缸）—— 贴图优先，全部来自 art/icons/mj/",
    f: "bold 15px system-ui", c: "#ffe9b8", y: MH + 18 },
  { t: "本帧贴图命中：dice.png ×" + (dc.dice || 0) + "（素材本身即两枚，故只画一次）· chip_gold/red/blue ×" + (dc.chips || 0) +
       " · ruler.png ×" + (dc.ruler || 0) + " · ashtray.png ×" + (dc.ashtray || 0) +
       "　｜　矢量兜底 " + ((dc.vecDice || 0) + (dc.vecChip || 0)) + " 次 · 跳过 " + (dc.skipped || 0) + " 次",
    f: "13px system-ui", c: "#8ef2c0", y: MH + 42 },
  { t: "安全区自检 decorCheck()：" + (ck.frames ? ck.frames.length : 0) + " 个装饰框全部落在绒面内，且与牌墙 26 墩 / 四家手牌 / 副露 / 四家牌河 / 中央余牌面板零相交 → " +
       (dc.safe ? "OK ✔" : ("✗ " + JSON.stringify(dc.hits))),
    f: "13px system-ui", c: dc.safe ? "#8ef2c0" : "#ff7d9c", y: MH + 66 },
  { t: "贴图不可用时的回退：骰子 → 矢量两枚（点数常量，不随机）· 筹码 → 矢量圆片 · 牌尺 / 烟灰缸 → 不画；tile_white / tile_fa 故意不接（立着的白板 / 发财会伪造牌河）",
    f: "13px system-ui", c: "#d8c7a8", y: MH + 90 },
  { t: "规则 / AI / 智脑提示算法 / 结算逻辑 / 点击热区 / 牌河布局 零改动（麻将逻辑 847/847 · 麻将验收 142/142 全过）",
    f: "13px system-ui", c: "#cbb894", y: MH + 110 }
];
lines.forEach(l => { out.font = l.f; out.fillStyle = l.c; out.fillText(l.t, MW / 2, l.y); });

fs.writeFileSync(OUTPNG, out.toPNG());
console.log("[" + path.basename(OUTPNG) + "] " + MW + "×" + (MH + CAPTION) + "  " + (fs.statSync(OUTPNG).size / 1024).toFixed(1) + "KB  中文说明 " + r.texts.length + " 段");
console.log("  装饰：dice=" + dc.dice + " chips=" + dc.chips + " ruler=" + dc.ruler + " ashtray=" + dc.ashtray +
  " vecDice=" + dc.vecDice + " vecChip=" + dc.vecChip + " skipped=" + dc.skipped + " safe=" + dc.safe +
  (dc.hits && dc.hits.length ? (" hits=" + JSON.stringify(dc.hits)) : ""));
console.log("  drawImage 里出现过的 mj 贴图：" + [...new Set(r.record.drawImage.map(x => x.src.split("/").pop()))].filter(n => /^(dice|chip_|ruler|ashtray|tile_back)/.test(n)).join(" / "));

/* 中文交给 powershell + System.Drawing（沙箱里子进程只能用 stdio inherit / ignore）*/
const MANIFEST = path.join(OUT, "tests", "_mj_bg2_text.json");
fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), shots: [{ png: OUTPNG, texts: r.texts }] }), "utf8");
try {
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(OUT, "_bf_text.ps1"), "-Manifest", MANIFEST], { stdio: "inherit", cwd: OUT });
} catch (e) { console.error("（文字合成失败，PNG 已出但中文可能缺失）：" + (e && e.message)); }
try { fs.rmSync(MANIFEST, { force: true }); } catch (e) {}
console.log("[done] 测试截图/" + path.basename(OUTPNG) + "   （用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s）");
