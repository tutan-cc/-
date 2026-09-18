/* ═══════════════════════════════════════════════════════════════════════════
   无头渲染验收（Chrome / Edge / mshta 都被当前沙箱拦住时的降级证据链）
   做法：在 Node 里给 breakfast.js 套一个「最小 DOM + 记录式 Canvas2D + 可手动泵的 rAF」环境，
        真实调用 start()，然后一帧帧泵动画循环，统计：
          · 绘制指令数 / 用色数量 / 食物矢量图元（煎蛋/培根/三明治/粥/沙拉/果汁…）
          · 灶位、出餐盘、食材桶、顾客订单卡、顶栏倒计时的绘制证据
          · 火候三态（生 / 恰好 / 糊）描边色是否按规则变化
          · 真实鼠标事件（mousedown/mousemove/mouseup）能不能把食材放进灶位
          · debug 驱动一条通过路径 + 一条失败路径，读结算 result 与 onFinish
        这不是像素级证据（那需要真浏览器），但足以证明「渲染层真的在画、且画的是该画的东西」。
   运行：node _e2e_bf_headless.cjs
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const OUT = __dirname;
const SHOT_DIR = path.join(OUT, "测试截图");
const SRC = fs.readFileSync(path.join(OUT, "breakfast.js"), "utf8");
/* 画面逻辑尺寸（放大后的规格：要求 B ≥1100×680）*/
const VW = 1180, VH = 790;

/* ── 固定随机种子（可复现）───────────────────────────────────────────────
   breakfast.js 里所有随机都走 rnd01() → Math.random()（顾客进店 / 订单长度 / 订单内容 /
   进店间隔）。无头链把宿主 Math 换成一个定种子 PRNG，场景就完全可复现：
   不会因为「某次随机到 3 张单子刚好覆盖 9 样菜」「某个顾客的耐心刚好在这一帧归零」
   这类偶发场景让验收飘。默认种子固定 → 连跑结果逐字一致；
   BF_SEED=123 可以换种子做鲁棒性扫测（用于确认断言不是只对某一个种子成立）。 */
const BF_SEED = (process.env.BF_SEED === undefined || process.env.BF_SEED === "") ? 20260917 : (Number(process.env.BF_SEED) || 20260917);
function makeRng(seed) {                       // mulberry32
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 宿主 Math：继承真 Math 的全部常量/函数，只把 random 换成本局的定种子 PRNG */
function seededMath(seed) { const M = Object.create(Math); M.random = makeRng(seed); return M; }

/* ── 极简选择器匹配：tag / .class / #id / tag.class / [attr="v"] / :not(.x) ── */
function matchSel(el, sel) {
  let s = String(sel).trim();
  const nots = [];
  s = s.replace(/:not\(([^)]*)\)/g, (_, inner) => { nots.push(inner.trim()); return ""; });
  let attr = null;
  s = s.replace(/\[([^\]=]+)(?:=("?)([^\]"]*)\2)?\]/g, (_, k, _q, v) => { attr = { k: k.trim(), v: v }; return ""; });
  let tag = null;
  const tagM = s.match(/^[a-zA-Z][a-zA-Z0-9]*/);
  if (tagM) { tag = tagM[0].toUpperCase(); s = s.slice(tagM[0].length); }
  const idM = s.match(/#([\w-]+)/); const id = idM ? idM[1] : null;
  const clsM = s.match(/\.([\w-]+)/g); const clss = clsM ? clsM.map(x => x.slice(1)) : [];
  if (tag && el.tagName !== tag) return false;
  if (id && el.id !== id) return false;
  for (const c of clss) if (String(el.className).split(/\s+/).indexOf(c) < 0) return false;
  if (attr) {
    const val = el.getAttribute ? el.getAttribute(attr.k) : el[attr.k];
    if (val === null || val === undefined) return false;
    if (attr.v !== undefined && String(val) !== String(attr.v)) return false;
  }
  for (const n of nots) if (matchSel(el, n)) return false;
  return true;
}

/* ── 记录式 Canvas2D mock ── */
function makeCtx() {
  const log = { ops: 0, fills: 0, strokes: 0, arcs: 0, ellipses: 0, rects: 0, texts: 0, gradients: 0 };
  const colors = {}, strokes = {}, texts = [];
  let cur = { fill: "#000", stroke: "#000", font: "10px sans-serif", alpha: 1, lineWidth: 1 };
  const stack = [];
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const ctx = {
    canvas: null,
    get fillStyle() { return cur.fill; }, set fillStyle(v) { cur.fill = v; bump(colors, String(v)); },
    get strokeStyle() { return cur.stroke; }, set strokeStyle(v) { cur.stroke = v; bump(strokes, String(v)); },
    get font() { return cur.font; }, set font(v) { cur.font = v; },
    get globalAlpha() { return cur.alpha; }, set globalAlpha(v) { cur.alpha = v; },
    get lineWidth() { return cur.lineWidth; }, set lineWidth(v) { cur.lineWidth = v; },
    textAlign: "left", textBaseline: "alphabetic",
    save() { log.ops++; stack.push(Object.assign({}, cur)); },
    restore() { log.ops++; if (stack.length) cur = stack.pop(); },
    translate() { log.ops++; }, scale() { log.ops++; }, rotate() { log.ops++; }, setTransform() { log.ops++; },
    beginPath() { log.ops++; }, closePath() { log.ops++; },
    moveTo() { log.ops++; }, lineTo() { log.ops++; }, quadraticCurveTo() { log.ops++; }, bezierCurveTo() { log.ops++; },
    arc() { log.ops++; log.arcs++; }, ellipse() { log.ops++; log.ellipses++; }, rect() { log.ops++; log.rects++; },
    fillRect() { log.ops++; log.rects++; log.fills++; }, strokeRect() { log.ops++; log.strokes++; },
    fill() { log.ops++; log.fills++; }, stroke() { log.ops++; log.strokes++; }, clip() { log.ops++; },
    fillText(t) { log.ops++; log.texts++; texts.push(String(t)); },
    strokeText(t) { log.ops++; log.texts++; texts.push(String(t)); },
    measureText(t) { return { width: String(t).length * 6 }; },
    createLinearGradient() { log.gradients++; return { addColorStop() {} }; },
    createRadialGradient() { log.gradients++; return { addColorStop() {} }; },
    createPattern() { return null; },
    drawImage() { throw new Error("breakfast.js 不应调用 drawImage（规格：零外部图片）"); },
    getImageData() { return { data: new Uint8ClampedArray(4) }; },
    putImageData() {},
  };
  return { ctx, log, colors, strokes, texts };
}

/* ── 最小 DOM mock ── */
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), children: [], parentNode: null,
    id: "", className: "", _html: "", textContent: "", type: "", value: "",
    style: {}, dataset: {}, _handlers: {},
    set innerHTML(v) { this._html = String(v); this.children = []; }, get innerHTML() { return this._html; },
    setAttribute(k, v) { if (k === "id") this.id = v; if (k === "class") this.className = v; this[k] = v; },
    getAttribute(k) { return this[k] === undefined ? null : this[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener(t, f) { (this._handlers[t] = this._handlers[t] || []).push(f); },
    removeEventListener(t, f) { const h = this._handlers[t] || []; const i = h.indexOf(f); if (i >= 0) h.splice(i, 1); },
    dispatch(t, ev) { (this._handlers[t] || []).slice().forEach(f => f(ev || {})); },
    /** 真按钮语义：点一下 = 派发 click（无头里验 #bfGo 出口） */
    click() { this.dispatch("click", { preventDefault() {}, stopPropagation() {} }); },
    all() { const out = []; (function walk(n) { (n.children || []).forEach(c => { out.push(c); walk(c); }); })(this); return out; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { return this.all().filter(e => matchSel(e, sel)); },
    getBoundingClientRect() { return { left: 0, top: 0, width: VW, height: VH, right: VW, bottom: VH }; },
    getContext() { return this._ctx; },
    classList: null,
  };
  el.classList = {
    /* 注意：[].slice.call(Set) 恒为 []（Set 不是数组式对象）→ 会把 className 抹成空串。
       这里必须用 [...s] / Array.from(s)，否则 classList.add 等于「清空 class」。 */
    add(c) { const s = new Set(String(el.className).split(/\s+/).filter(Boolean)); s.add(c); el.className = [...s].join(" "); },
    remove(c) { const s = new Set(String(el.className).split(/\s+/).filter(Boolean)); s.delete(c); el.className = [...s].join(" "); },
    contains(c) { return String(el.className).split(/\s+/).indexOf(c) >= 0; },
    toggle(c, on) { if (on === undefined) on = !this.contains(c); on ? this.add(c) : this.remove(c); },
  };
  if (el.tagName === "CANVAS") {
    const m = makeCtx();
    el._ctx = m.ctx; m.ctx.canvas = el; el._m = m;
    el.width = 300; el.height = 150;
  }
  return el;
}

/* ── 装载：可手动泵的 rAF + 可控时钟 ── */
function boot() {
  const body = makeEl("body");
  const host = makeEl("div"); host.id = "bfGameHost"; body.appendChild(host);
  const frames = [];
  let clock = 0;
  const listeners = { window: {}, document: {} };
  const win = {
    devicePixelRatio: 2,
    performance: { now: () => clock },
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: id => { frames[id - 1] = null; },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    addEventListener: (t, f) => { (listeners.window[t] = listeners.window[t] || []).push(f); },
    removeEventListener: (t, f) => { const h = listeners.window[t] || []; const i = h.indexOf(f); if (i >= 0) h.splice(i, 1); },
    document: null,
  };
  win.document = {
    body,
    createElement: makeEl,
    getElementById: id => (id === "bfGameHost" ? host : null),
    querySelector: sel => body.querySelector(sel),
    querySelectorAll: sel => body.querySelectorAll(sel),
    /* 记录 keydown：ESC = 点出口按钮（#bfGo）要能在无头里验 */
    addEventListener: (t, f) => { (listeners.document[t] = listeners.document[t] || []).push(f); },
    removeEventListener: (t, f) => { const h = listeners.document[t] || []; const i = h.indexOf(f); if (i >= 0) h.splice(i, 1); },
  };
  const ctx = vm.createContext(Object.assign(win, { console, Math: seededMath(BF_SEED), Date, isFinite, Number, String, Object, Array }));
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(SRC + "\n;globalThis.__BF = window.Breakfast;", ctx);
  /** 泵 n 帧（每帧把时钟往前推 ms 毫秒），返回渲染次数 */
  function pump(n, ms) {
    let rendered = 0;
    for (let i = 0; i < n; i++) {
      clock += (ms === undefined ? 16 : ms);
      const list = frames.slice();
      frames.length = 0;
      list.forEach(cb => { if (cb) { cb(clock); rendered++; } });
      if (!frames.length) break;                 // 循环已结束（结算/销毁）
    }
    return rendered;
  }
  return { B: ctx.__BF, body, host, pump, listeners, win: ctx, now: () => clock, canvas: () => host.querySelector("canvas.bf-cv"),
           /** ESC = 点 #bfGo（无头里把 keydown 递给 breakfast.js 挂上去的那个监听） */
           esc: () => (listeners.document.keydown || []).slice().forEach(f => f({ key: "Escape", preventDefault() {}, stopPropagation() {} })),
           docKeys: () => (listeners.document.keydown || []).length };
}

/* ── 测试 ── */
const checks = [], errors = [];
const A = (ok, name, extra) => { if (ok) checks.push(name + (extra ? "（" + extra + "）" : "")); else errors.push(name + (extra ? " → " + extra : "")); };

function runMain() {
  const { B, host, pump, listeners, canvas } = boot();
  A(!!B && typeof B.start === "function", "breakfast.js 在无 DOM 依赖环境里装载成功");
  A(!!B.rules && !!B.ui && !!B.debug, "对外 API 齐全（start/isBusy/dispose + rules/ui/debug）");

  /* ① 开局 + 首帧渲染 */
  let finished = null;
  const okStart = B.start(host, { target: { id: "su", name: "苏晚晴", bond: 40 }, duration: 75, goal: 8, onFinish: r => { finished = r; } });
  A(okStart === true, "start() 返回 true，游戏挂载到宿主节点");
  A(B.isBusy() === true, "isBusy() === true");
  const cv = canvas();
  A(!!cv, "宿主里生成了 canvas.bf-cv");
  const m = cv._m;
  A(VW >= 1100 && VH >= 680, "画面规格 ≥1100×680（要求 B1）", VW + "×" + VH);
  A(cv.width === VW * 2 && cv.height === VH * 2, "位图按 devicePixelRatio=2 绘制", cv.width + "×" + cv.height);
  {
    const v = B.debug.view();
    A(!!v && v.w === VW && v.h === VH, "debug.view() 报告的画布逻辑尺寸与规格一致", v && (v.w + "×" + v.h));
    A(v.font.body >= 16 && v.font.tiny >= 16, "正文字号 ≥16px（要求 B2）", "正文 " + v.font.body + "px / 最小 " + v.font.tiny + "px");
    A(v.font.micro >= 13, "列头小字 ≥13px（用户要求「小字」）", "列头 " + v.font.micro + "px");
    A(v.font.clock >= 28 && v.font.score >= 28 && v.font.patience >= 28, "关键数字 ≥28px（倒计时/分数/耐心）",
      "倒计时 " + v.font.clock + " / 分数 " + v.font.score + " / 耐心 " + v.font.patience);
    A(v.icon.food >= 64, "单份食物视觉尺寸 ≥64px（要求 B3）", v.icon.food + "px");
    A(v.lay.stove.panW >= 110, "每个锅位 ≥110px（要求 B5）", v.lay.stove.panW + "px");
    A(v.lay.cards.w >= 220, "顾客卡宽度 ≥220（要求 B6）", v.lay.cards.w + "×" + v.lay.cards.h + "（为让出 9 列，卡片压矮了）");
  }
  A(m.log.ops > 800, "首帧真的画了一堆东西（绘制指令数）", m.log.ops + " ops");
  A(m.log.fills > 80 && m.log.strokes > 40, "有大量填充与描边（不是空画布）", m.log.fills + " fills / " + m.log.strokes + " strokes");
  A(Object.keys(m.colors).length >= 10, "用到了多种颜色（暖木 + 锅具 + 食物）", Object.keys(m.colors).length + " 种");
  A(m.log.gradients >= 3, "用了渐变（暖木背景 / 锅体）", m.log.gradients + " 个渐变");

  /* ② 食材桶 / 9 列灶位 / 9 个专属盘 */
  const FOODN = ["煎蛋", "培根", "三明治", "白粥", "热牛奶", "包子", "沙拉", "果汁", "清汤"];
  const shown = FOODN.filter(n => m.texts.some(t => t.indexOf(n) >= 0));
  A(shown.length === 9, "底部食材桶 9 样全部画出（含文字标签）", shown.join("/"));
  A(m.texts.some(t => /汤锅/.test(t)) && m.texts.some(t => /煎盘/.test(t)) && m.texts.some(t => /蒸格/.test(t)) && m.texts.some(t => /沙拉台/.test(t)) && m.texts.some(t => /果汁机/.test(t)),
    "五类厨具（汤锅/煎盘/蒸格/沙拉台/果汁机）都画出来了");
  A(m.texts.filter(t => /· 空/.test(t)).length >= 9, "9 个专属空盘都画了（浅色轮廓 + 列归属标签）",
    "「…· 空」×" + m.texts.filter(t => /· 空/.test(t)).length);
  A(m.texts.some(t => /点食材/.test(t)) && m.texts.some(t => /双击盘/.test(t)),
    "画布图例写清三条操作：点食材 → 自动下锅 ｜ 点盘 → 送给顾客 ｜ 双击盘 → 丢垃圾桶");
  A(m.texts.some(t => /苏晚晴/.test(t)), "顶栏画出了本次赠送对象");
  A(m.texts.some(t => /⏱/.test(t)) && m.texts.some(t => /顾客 \d+ \/ \d+/.test(t)), "顶栏画出了倒计时与目标进度");
  {
    const barEl = host.querySelector(".bf-bar");
    const tipEl = host.querySelector(".bf-tip");
    const titleEl = host.querySelector(".bf-title");
    A(!!barEl && !!tipEl && !!titleEl && /苏晚晴/.test(String(titleEl._html)) &&
      /点食材/.test(String(tipEl._html)) && /双击盘/.test(String(tipEl._html)),
      "标题栏 / 提示行 DOM 里写着赠送对象与三条操作提示",
      String((tipEl && tipEl._html) || "").slice(0, 60));
  }
  A(m.log.ellipses > 20, "食物矢量图元（椭圆/白黄蛋、碗口、包子褶皱）在画", m.log.ellipses + " 个 ellipse");
  A(m.log.arcs > 5, "圆形图元（炉口火焰 / 樱瓣）在画", m.log.arcs + " 个 arc");
  A(!m.colors["#8a87a3"], "9 样食材都有自己的矢量图（没有落到 drawFood 的兜底灰块）",
    m.colors["#8a87a3"] ? "有食材缺图（兜底灰块 ×" + m.colors["#8a87a3"] + "）" : "全部有图");

  /* ③ 泵帧：顾客进店 → 订单卡 + 耐心条 + 顶栏进度 */
  const t0 = m.texts.length;
  const rendered = pump(400, 16);                // ≈6.4 秒
  A(rendered >= 10, "动画循环可持续泵帧（rAF 正常重绘）", rendered + " 帧");
  const frameTexts = m.texts.slice(t0);
  const os0 = B.debug.orders();
  A(os0.length >= 1, "顾客陆续进店并生成订单", os0.length + " 位");
  A(os0[0].order.length >= 1 && os0[0].order.length <= 3, "订单长度 1~3 样", JSON.stringify(os0[0].order));
  A(frameTexts.some(t => /顾客 #/.test(t)), "订单卡画出了顾客编号");
  A(frameTexts.some(t => /^\d+(\.\d+)?s$/.test(t)), "订单卡画出了耐心倒计时（秒）", (frameTexts.filter(t => /^\d+(\.\d+)?s$/.test(t))[0] || ""));
  A(frameTexts.some(t => /顾客 \d+ \/ \d+/.test(t)), "顶栏画出了「顾客 N / 8」进度", (frameTexts.filter(t => /顾客 \d+ \/ \d+/.test(t))[0] || ""));
  A(frameTexts.some(t => /⏱/.test(t)), "顶栏画出了倒计时");
  A(frameTexts.filter(t => FOODN.indexOf(t) >= 0).length >= 1, "订单卡里画出了所需食物的矢量图标");
  A(B.debug.stations().length === 9, "9 列 = 9 灶位（3 锅 + 3 煎盘 + 蒸格 + 沙拉台 + 果汁机）", B.debug.stations().length + " 个");

  /* ④ 火候三态描边色（生 → 恰好 → 糊） */
  const beforeOps = m.log.ops;
  pump(30, 16);
  A(m.log.ops > beforeOps + 30 * m.log.ops / 1e9, "运行中每帧都在重绘", (m.log.ops - beforeOps) + " ops / 30 帧");
  B.debug.place("egg", 3);
  A(B.debug.stations()[3].food === "egg", "debug.place 把煎蛋放到 1 号煎盘");
  const strokesAt = () => Object.assign({}, m.strokes);
  B.debug.setCook(3, 0.5); pump(2); const sRaw = strokesAt();
  B.debug.setCook(3, 3.2); pump(2); const sPerf = strokesAt();
  const grew = (a, b, k) => (b[k] || 0) > (a[k] || 0);
  A(grew(sRaw, sPerf, "#5dffa0"), "「恰好」时出现绿色描边（完美窗口）", "#5dffa0 ×" + (sPerf["#5dffa0"] || 0));
  B.debug.setCook(3, 5.2); pump(2); const sBurn = strokesAt();
  A(grew(sPerf, sBurn, "#ff4d6d"), "「糊」时出现红色描边（焦黑警告）", "#ff4d6d ×" + (sBurn["#ff4d6d"] || 0));
  A(B.debug.stations()[3].state === "burnt", "state() 报告该灶位已糊");
  B.debug.trash(3);                              // 清掉这一列，后面的鼠标用例要重新用第 3 列
  A(B.debug.stations()[3].food === null, "双击/右键清空这一列后锅位恢复");
  const t1 = m.texts.length;
  B.debug.place("congee", 0);                    // 白粥：5.0s 恰好 / 7.8s 糊
  pump(540, 16);                                 // ≈8.6 秒：走完 生 → 恰好 → 糊，飘字会被真的画出来
  A(B.debug.stations()[0].state === "burnt", "汤锅里的白粥在真实帧推进下烧糊了", B.debug.stations()[0].state + " @ " + B.debug.stations()[0].t + "ms");
  A(m.texts.slice(t1).some(t => /糊了/.test(t)), "糊掉时画了「糊了！」飘字", (m.texts.slice(t1).filter(t => /糊/.test(t))[0] || ""));
  A(m.texts.slice(t1).some(t => /丢掉了/.test(t)) === false, "（丢垃圾桶前还没丢）");
  B.debug.trash(0);
  A(B.debug.stations()[0].food === null, "垃圾桶：糊掉的食物丢掉后灶位清空，且不扣分");
  A(B.debug.score() !== null, "debug.score() 可读");

  /* ⑤ 列绑定（要求 A1）+ 真实鼠标事件（不走 debug API） */
  const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  {
    /* 9 列列对齐：底部食材桶 / 中列锅 / 上列专属盘 同一 x 中心线（±2px） */
    let worst = 0;
    for (let i = 0; i < 9; i++) {
      const sb = B.stationBox(i), pb = B.plateBox(i), bb = B.bucketBox(i);
      const cxs = sb.x + sb.w / 2, cxp = pb.x + pb.w / 2, cxb = bb.x + bb.w / 2;
      worst = Math.max(worst, Math.abs(cxs - cxp), Math.abs(cxs - cxb));
      A(pb.y + pb.h <= sb.y, "第 " + i + " 列：专属盘在锅的正上方");
      A(bb.y >= sb.y + sb.h, "第 " + i + " 列：食材桶在锅的正下方（底排）");
      A(pb.x >= 0 && pb.x + pb.w <= VW && bb.x >= 0 && bb.x + bb.w <= VW, "第 " + i + " 列不越界");
    }
    A(worst <= 2, "9 列列对齐：食材桶 / 锅 / 专属盘 同一 x 中心线（最大偏差 " + worst.toFixed(2) + "px ≤ 2px）");
    A(B.FOOD_IDS.length === 9 && B.COL_N === 9, "9 列 = 9 样食材（底部一排 9 个桶）",
      B.FOOD_IDS.map(f => B.FOOD[f].n).join("/"));
    A(B.debug.columns().length === 9, "9 个灶位");
    A(B.debug.plates().length <= 9 && B.PLATES_TOTAL === 9, "9 个专属盘（每列 1 个）");
    const cols = B.debug.columns();
    A(cols.every((c, i) => c.col === i && c.food === B.FOOD_IDS[i] && c.stationName === B.COLS[i].station),
      "列绑定一一对应且索引稳定：food ↔ 灶位 ↔ 盘",
      cols.map(c => c.food + "→" + c.stationName).join(" "));
    A(cols.every(c => c.plateName.indexOf(B.FOOD[c.food].n) === 0), "每列的盘都带自己的归属标签（如「煎蛋盘」）",
      cols.slice(3, 6).map(c => c.plateName).join(" / "));
    A(bucketBoxAll9(), "底部食材桶与上方锅与盘数量一致（各 9 个）");
  }
  function bucketBoxAll9() {
    let n = 0;
    for (let i = 0; i < 9; i++) { const b = B.bucketBox(i); if (b && b.w > 0) n++; }
    return n === 9;
  }
  /* 单击食材（真实鼠标）→ 自动进它自己那一列的锅 */
  const BUCKET3 = center(B.bucketBox(3));      // 煎蛋桶（第 3 列）
  const POT0 = center(B.stationBox(0));        // 白粥锅（第 0 列）
  A(BUCKET3.y > VH * 0.8 && POT0.y > VH * 0.45, "食材桶在最底部、锅位在中部（布局纪律）",
    "桶 y=" + Math.round(BUCKET3.y) + " · 锅 y=" + Math.round(POT0.y));
  const stBefore = B.debug.stations().filter(s => s.food).map(s => s.food);
  cv.dispatch("mousedown", { clientX: BUCKET3.x, clientY: BUCKET3.y, preventDefault() {} });
  (listeners.window["mouseup"] || []).slice().forEach(f => f({ clientX: BUCKET3.x, clientY: BUCKET3.y, preventDefault() {} }));
  A(B.debug.stations()[3].food === "egg", "真实鼠标单击食材桶 → 食物自动进入它正上方那一列的锅（第 3 列煎蛋盘）",
    JSON.stringify(B.debug.stations().filter(s => s.food).map(s => s.food)));
  A(B.debug.stations().filter(s => s.food).length === stBefore.length + 1, "只下了一份");
  A(B.debug.stations()[3].state === "raw" || B.debug.stations()[3].phase === "raw" || B.debug.stations()[3].phase === "cooking",
    "对应那一列进入 cooking", B.debug.stations()[3].phase);
  /* 拖到别人的锅（煎蛋 → 白粥锅）会被拒（原因码 wrong-column） */
  const t3 = m.texts.length;
  cv.dispatch("mousedown", { clientX: BUCKET3.x, clientY: BUCKET3.y, preventDefault() {} });
  cv.dispatch("mousemove", { clientX: POT0.x, clientY: POT0.y, preventDefault() {} });
  (listeners.window["mouseup"] || []).slice().forEach(f => f({ clientX: POT0.x, clientY: POT0.y, preventDefault() {} }));
  A(B.debug.stations()[0].food === null, "拖到别人的锅（煎蛋 → 白粥锅）会被拒绝");
  A(m.texts.slice(t3).some(x => /别人的锅|只进自己那一列/.test(x)), "被拒时给了原因文案",
    (m.texts.slice(t3).filter(x => /别人的锅|只进自己那一列/.test(x))[0] || ""));
  /* 单击盘 → 自动送给正在需要这份、且耐心最少的顾客 */
  for (let i = 0; i < 300 && !B.debug.stations()[3].plate; i++) B.debug.tick(1 / 60);
  A(B.debug.stations()[3].plate === "egg", "熟了自动落到本列专属盘（第 3 列）", String(B.debug.stations()[3].plate));
  A(B.debug.stations()[3].food === null, "落盘后锅位立刻空出来");
  B.debug.pushCustomer(["egg"]);                       // 保证此刻真的有人要这份
  const PLATE3 = center(B.plateBox(3));
  /* 这一下只比较「点击本身造成的改变」：点在 handler 里同步完成，不推进时钟，
     所以分数变化只可能来自这次出餐（+14/10/6），不会被旁边顾客流失干扰。
     也不再拿 state().served 当判据 —— served 是「整单做齐的顾客数」，
     如果规则挑中的是位「两样菜只上了第一样」的顾客，served 不会 +1（旧断言因此偶发失败）。 */
  const scServe = B.debug.state().score;
  const eggDoneBefore = B.debug.orders().filter(c => c.done.indexOf("egg") >= 0).map(c => c.id);
  const expEgg = B.debug.pickFor("egg");               // 规则层：该送给「正需要这份 + 耐心最少」的那位
  cv.dispatch("mousedown", { clientX: PLATE3.x, clientY: PLATE3.y, preventDefault() {} });
  const ordersAfterClick = B.debug.orders();
  const gotEgg = ordersAfterClick.filter(c => c.done.indexOf("egg") >= 0 && eggDoneBefore.indexOf(c.id) < 0).map(c => c.id);
  const eggLeftFull = !ordersAfterClick.some(c => c.id === expEgg);   // 整单做齐 → 当场离场（served++）
  const serveGain = B.debug.state().score - scServe;
  A(expEgg >= 0 && serveGain > 0 && (gotEgg.indexOf(expEgg) >= 0 || eggLeftFull),
    "真实鼠标单击专属盘 → 自动送给需要这份的顾客（规则＝耐心最少的那位）",
    "期望 #" + expEgg + " · 拿到煎蛋 #" + gotEgg.join("/") + " · 整单离场=" + eggLeftFull + " · 分数 " + scServe + " → " + B.debug.state().score);
  pump(1, 420);                                        // 让双击窗口过去（下一次点击算单击）
  A(B.debug.stations()[3].plate === null, "送出后盘清空、这一列恢复可用");
  /* 糊的那份：单击被拒（留在盘上）→ 双击才丢得掉（清锅 + 清盘，不扣分） */
  B.debug.drop("egg", null);
  for (let i = 0; i < 300 && !B.debug.stations()[3].plate; i++) B.debug.tick(1 / 60);
  A(B.debug.stations()[3].plate === "egg", "再做一份，等着它落盘");
  B.debug.setPlateAge(3, B.SERVE_WINDOW + 0.5);         // 拨到「过火计时」之后
  B.debug.tick(1 / 60);
  A(B.debug.plates().some(p => p.station === 3 && p.state === "burnt"), "盘上停留超过过火计时 → 变糊（要求 A5）");
  pump(1, 420);
  cv.dispatch("mousedown", { clientX: PLATE3.x, clientY: PLATE3.y, preventDefault() {} });
  pump(1, 420);
  A(B.debug.stations()[3].plate === "egg", "糊的那份单击被拒：还留在盘上（提示「糊了，只能丢掉」）",
    (m.texts.slice(-40).filter(x => /糊/.test(x))[0] || ""));
  /* 分数快照放在「两次点击之间」：这一段等待会推进时钟（顾客耐心在走、可能有顾客流失 −8），
     从更早的地方取快照会把「别人耐心归零」记到双击头上。点击本身不推进时钟 → 只比较点击前后的差。 */
  const scoreBefore = B.debug.state().score;
  cv.dispatch("mousedown", { clientX: PLATE3.x, clientY: PLATE3.y, preventDefault() {} });
  cv.dispatch("mousedown", { clientX: PLATE3.x, clientY: PLATE3.y, preventDefault() {} });   // 双击（同一帧内 350ms 内）
  A(B.debug.stations()[3].plate === null, "真实鼠标双击专属盘 → 清空这一列（锅 + 盘）");
  A(B.debug.state().score === scoreBefore, "双击丢弃不扣分",
    "scoreBefore=" + scoreBefore + " after=" + B.debug.state().score);
  A(B.debug.state().tossed >= 1, "记了一次丢弃（结算面板用）");
  /* 单击食材 → 这一列立刻能再开工（锅与盘都空了） */
  cv.dispatch("mousedown", { clientX: BUCKET3.x, clientY: BUCKET3.y, preventDefault() {} });
  A(B.debug.stations()[3].food === "egg", "丢掉后同一列马上能再下一份");

  /* ⑥ dispose 清空宿主 */
  B.dispose();
  A(B.isBusy() === false, "dispose() 后 isBusy() === false");
  A(host.children.length === 0, "dispose() 清空了宿主节点");
  A(B.start(host, { target: { id: "su", name: "x", bond: 20 } }) === true, "dispose 后可以再开一局");
  B.dispose();

  /* ⑥.5 新操作模型：9 列各 1 专属盘 + 自动落盘 + 单击盘出餐 + 盘上过火报废 */
  const d4b = boot();
  d4b.B.start(d4b.host, { target: { id: "lin", name: "林溪", bond: 44 }, duration: 999, goal: 99, onFinish: () => {} });
  const d4 = d4b.B.debug;
  A(d4.state().autoPlate === true, "页面开局默认打开「熟了自动落到本列专属盘」");
  A(d4.state().platesTotal === 9 && d4.state().columns === 9, "9 列 × 每列 1 个专属盘（不再限量 3 盘）");
  A(d4.state().plateLife === 4.5 && d4.state().serveWindow === 4.5, "过火计时 = 4.5s（SERVE_WINDOW）");
  const pm = d4.prepMap();
  A(pm.prep.length === 9 && pm.serve.length === 0, "9 列都有盘，没有「无盘现做灶位」", JSON.stringify(pm.prep));
  const map0 = d4.plateMap();
  A(map0.length === 9, "9 个灶位都在 plateMap 里");
  A(map0.every((x, i) => x.hasPlate === true && x.colFood === d4b.B.FOOD_IDS[i]), "每列的灶位 ↔ 食材 ↔ 盘一一对应，不可互换",
    JSON.stringify(map0.map(x => x.station + ":" + x.colFood)));
  A(map0.every(x => x.plateStation === -1 || x.plateStation === x.station), "不存在两个灶位共用一盘");
  /* 单击食材 → 只进它自己那一列 */
  A(d4.drop("congee", null) === true, "点白粥 → 进第 0 列（白粥锅）");
  A(d4.stations()[0].food === "congee", "就在它那一列");
  A(d4.placeEx("congee", 4).why === "wrong-column", "拖到培根盘 → wrong-column");
  /* 熟了自动落到本列专属盘 */
  for (let i = 0; i < 320 && !d4.stations()[0].plate; i++) d4.tick(1 / 60);
  A(d4.stations()[0].plate === "congee", "熟了自动落到第 0 列的专属盘（不用手动出锅）", JSON.stringify(d4.plates()));
  A(d4.stations()[0].phase === "plated", "状态机走到 plated（cooking → plated）", d4.stations()[0].phase);
  A(d4.stations()[0].food === null, "落盘后锅位立刻空出来");
  const p0 = d4.plates()[0];
  A(p0.tier === "hot" && p0.hot === true, "刚落盘 = 热乎（14 分档）", p0.tier);
  A(p0.station === 0, "这盘记录着自己的归属灶位", "station=" + p0.station);
  A(p0.left > 4.0 && p0.left <= 4.5, "盘上倒计时 ≈ 4.5s（过火计时在走）", "left=" + p0.left);
  d4b.pump(2);                                   // 泵两帧让渲染层把本帧的绘制统计刷新出来
  const V4 = d4.view();
  A(V4.drawn.plates === 9 && V4.drawn.pans === 9, "本帧画出 9 个锅位 + 9 个专属盘",
    V4.drawn.plates + " 盘 / " + V4.drawn.pans + " 锅");
  A(V4.plateCount === 1 && V4.drawn.foods >= 1, "落盘的那份真的在盘上（plateCount=1）", "plateCount=" + V4.plateCount);
  /* 盘占用 / 锅忙 → 明确原因码 */
  const rej = d4.placeEx("congee", null);
  A(rej.ok === false && rej.why === "plate-occupied", "盘里有东西时拒绝下料（原因码 plate-occupied）", rej.why);
  A(/盘里还有一份/.test(rej.hint || ""), "提示语：盘里还有一份，先送出去", rej.hint);
  /* 热乎度降档 + 过火报废（放在同一列上验边界） */
  d4.setPlateAge(0, B.HEAT.hotSec + 0.2);
  d4.tick(1 / 60);
  A(d4.plates()[0].tier === "warm", "盘上停 1.7s → 温（10 分档）", d4.plates()[0].tier + " age=" + d4.plates()[0].age);
  d4.setPlateAge(0, B.HEAT.warmSec + 0.2);
  d4.tick(1 / 60);
  A(d4.plates()[0].tier === "cold", "盘上停 3.2s → 凉（6 分档，仍可上餐）", d4.plates()[0].tier + " age=" + d4.plates()[0].age);
  /* 单击盘 → 自动送给正在需要 + 耐心最少的顾客 */
  d4.pushCustomer(["congee"]);
  const cands = d4.orders().filter(function(c){ return c.order.indexOf("congee") >= 0 && c.done.indexOf("congee") < 0; });
    var expId = null, bestPat = Infinity;
    cands.forEach(function(c){ var p = Number(c.patience); if (isFinite(p) && p < bestPat - 1e-9) { bestPat = p; expId = c.id; } });
    /* orders() 里的 patience 只留两位小数：两位候选可能「并列最少」→ 允许落在并列集合里，
       并在失败信息里把候选与各自 patience 都打出来（便于诊断是不是规则/取值口径不一致）。 */
    const bestCands = cands.filter(function(c){ return Math.abs(Number(c.patience) - bestPat) < 1e-9; }).map(function(c){ return c.id; });
    const who = d4.pickFor("congee");
  A(expId !== null && bestCands.indexOf(who) >= 0, "单击盘自动挑「正需要这份」且耐心最少的顾客（平手取先来的）",
    "挑中 #" + who + " · 耐心最少候选 #" + bestCands.join("/") + " · 全部候选 " +
    cands.map(function(c){ return "#" + c.id + "(耐心 " + c.patience + " · 单 " + c.order.join("+") + ")"; }).join(" "));
  const srv = d4.serveCol(0);
  A(srv.ok === true && srv.heat === "cold" && srv.delta === 6, "凉的那份照样能上餐（+6 · 不劝退）",
    JSON.stringify({ heat: srv.heat, delta: srv.delta }));
  A(d4.stations()[0].plate === null && d4.plates().length === 0, "盘被取走 → 归属灶位立即可用");
  A(d4.placeEx("congee", null).ok === true, "灶位恢复可用：马上又能下一份");
  /* 没人要这份 → 不消耗、留在盘上（先挑一个「此刻场上没人还缺」的食材，避免随机点单干扰） */
  d4.trash(0);
  {
    const B9 = d4b.B;
    const wanted = {};
    d4.orders().forEach(c => c.order.forEach(f => { if (c.done.indexOf(f) < 0) wanted[f] = 1; }));
    let nowant = null;
    for (const f of B9.FOOD_IDS) {
      const col = B9.columnOf(f);
      if (wanted[f]) continue;
      if (d4.stations()[col].plate || d4.stations()[col].food) continue;
      d4.drop(f, null);
      for (let i = 0; i < 340 && !d4.stations()[col].plate; i++) d4.tick(1 / 60);
      if (d4.stations()[col].plate !== f) continue;
      const r = d4.serveCol(col);
      if (!r.ok && r.why === "no-want") { nowant = { r: r, col: col, f: f }; break; }
      /* 这一份刚好有人要 → 正常送掉了，换下一样接着验 */
    }
    A(!!nowant, "此刻没人要这份 → 拒绝出餐（原因码 no-want）",
      nowant ? (B9.FOOD[nowant.f].n + " @ 第 " + nowant.col + " 列：" + nowant.r.hint) : "候选食材都被人要走了");
    if (nowant) {
      A(d4.stations()[nowant.col].plate === nowant.f, "这份留在盘上继续走热乎度衰减（不消耗）");
      d4.setPlateAge(nowant.col, B.SERVE_WINDOW - 0.1);
      d4.tick(1 / 60);
      A(d4.plates().some(p => p.station === nowant.col && p.state === "perfect"), "窗口前 0.1s：还是好的（未糊）");
      d4.setPlateAge(nowant.col, B.SERVE_WINDOW + 0.05);
      d4.tick(1 / 60);
      A(d4.plates().some(p => p.station === nowant.col && p.state === "burnt"), "盘上停留超过 4.5s → 变糊");
      A(d4.state().expire === 1, "记在「忘取」账上");
      const rBurn = d4.serveCol(nowant.col);
      A(rBurn.ok === false && rBurn.why === "burnt", "糊的单击被拒（原因码 burnt，只能丢）", rBurn.why);
      const sc5 = d4.state().score;
      A(d4.trashCol(nowant.col) === true, "双击（trashCol）才丢得掉");
      A(d4.state().score === sc5, "丢垃圾桶不扣分");
      A(d4.stations()[nowant.col].plate === null && d4.placeEx(nowant.f, null).ok === true, "丢完这一列立刻能再用");
    }
  }
  d4.close();

  /* ⑥.6 过火计时的边界：窗口前还活着 / 一过窗口就糊（盘上） */
  const d5b = boot();
  d5b.B.start(d5b.host, { target: { id: "su", name: "苏晚晴", bond: 40 }, duration: 999, goal: 99, onFinish: () => {} });
  const d5 = d5b.B.debug;
  A(d5.drop("egg", null) === true, "煎蛋下到第 3 列");
  for (let i = 0; i < 300 && !d5.stations()[3].plate; i++) d5.tick(1 / 60);
  A(d5.stations()[3].plate === "egg", "熟了自动落到第 3 列的专属盘");
  d5.setPlateAge(3, B.SERVE_WINDOW - 0.1);
  d5.tick(1 / 60);
  A(d5.stations()[3].plateState === "perfect", "窗口前 0.1s：还是好的（未糊）", d5.stations()[3].plateState);
  A(d5.stations()[3].tier === "cold", "此时只剩「凉」档（越拖越差）", d5.stations()[3].tier);
  A(d5.state().burnt === 0, "还没糊");
  d5.setPlateAge(3, B.SERVE_WINDOW + 0.01);
  d5.tick(1 / 60);
  A(d5.stations()[3].plateState === "burnt", "窗口后 0.01s：已经糊了", d5.stations()[3].plateState);
  A(d5.state().burnt === 1 && d5.state().expire === 1, "糊掉 / 忘取各记一次");
  A(d5.state().score === 0, "糊掉不扣分（丢垃圾桶才清空）");
  A(d5.placeEx("egg", null).why === "plate-occupied", "糊的那份还堵着这一列（先双击丢掉）");
  A(d5.trashCol(3) === true && d5.placeEx("egg", null).ok === true, "丢掉后才能再用");
  /* 糊菜端给顾客（点顾客卡自动配盘那条路）→ 顾客当场离开（现有规则不变） */
  A(d5.drop("congee", null) === true, "第 0 列下一份白粥");
  for (let i = 0; i < 320 && !d5.stations()[0].plate; i++) d5.tick(1 / 60);
  d5.setPlateAge(0, B.SERVE_WINDOW + 0.05);
  d5.tick(1 / 60);
  A(d5.plates().some(p => p.state === "burnt"), "白粥在盘上放糊");
  const sB = d5.state().served, aB = d5.state().angry;
  d5.pushCustomer(["congee"]);
  const rb = d5.serveId(d5.orders()[d5.orders().length - 1].id, -1);
  A(rb.kind === "burnt" && rb.delta === -5, "糊菜端上桌 → 顾客当场离开（−5，现有规则不变）",
    JSON.stringify({ kind: rb.kind, delta: rb.delta }));
  A(d5.state().served === sB && d5.state().angry === aB + 1, "糊菜不算服务成功，只记一次跑单");
  A(d5.stations()[0].plate === null, "糊盘被端走后这一列清空");
  A(d5.placeEx("egge", null).why === "no-food", "不存在的食材 → 原因码 no-food");
  d5.close();

  /* ⑥.7 列对齐 / 列头小字 / 三条操作提示的渲染证据 */
  const d6b = boot();
  d6b.B.start(d6b.host, { target: { id: "su", name: "苏晚晴", bond: 40 }, duration: 999, goal: 99, onFinish: () => {} });
  const d6 = d6b.B.debug;
  d6b.canvas()._m.texts.length = 0;
  d6b.pump(1);
  const t6 = d6b.canvas()._m.texts;
  A(t6.some(x => /白粥 · 汤锅 · 5\.0s/.test(x)), "列头小字：食材 · 厨具 · 时长", (t6.filter(x => /汤锅/.test(x))[0] || ""));
  A(t6.filter(x => / · (汤锅|煎盘|蒸格|沙拉台|果汁机) · /.test(x)).length >= 9, "9 列每列都有列头小字",
    "×" + t6.filter(x => / · (汤锅|煎盘|蒸格|沙拉台|果汁机) · /.test(x)).length);
  A(t6.some(x => /鸡蛋|煎蛋盘 · 空/.test(x)) || t6.filter(x => /· 空/.test(x)).length >= 9, "空盘画出列归属标签（「煎蛋盘 · 空」）",
    (t6.filter(x => /· 空/.test(x))[0] || ""));
  A(t6.filter(x => /· 空/.test(x)).length >= 9, "9 个空盘都有归属标签", "×" + t6.filter(x => /· 空/.test(x)).length);
  A(t6.some(x => /点食材/.test(x)) && t6.some(x => /双击盘/.test(x)) && t6.some(x => /送给正在等的顾客/.test(x)),
    "操作图例写清三条：点食材 → 自动下锅 ｜ 点盘 → 送给顾客 ｜ 双击盘 → 丢垃圾桶");
  A(t6.some(x => /点我下锅/.test(x)), "底排食材桶写着「点我下锅」", "×" + t6.filter(x => x === "点我下锅").length);
  A(t6.some(x => /9 列 × 每列 1 锅 1 专属盘/.test(x)), "盘区标题写明「9 列 × 每列 1 锅 1 专属盘」");
  A(t6.some(x => /备菜盘/.test(x)) === false, "旧文案「备菜盘 ×3」已经不在");
  A(t6.some(x => /现做现送/.test(x)) === false, "旧文案「现做现送」已经不在");
  /* 有食物 / 糊了的盘：画出档位与倒计时 / 只能丢 */
  d6.drop("egg", null);
  for (let i = 0; i < 300 && !d6.stations()[3].plate; i++) d6.tick(1 / 60);
  d6b.canvas()._m.texts.length = 0;
  d6b.pump(1);
  const t6b = d6b.canvas()._m.texts;
  A(t6b.some(x => /煎蛋·热乎/.test(x)) && t6b.some(x => /s 内送出/.test(x)), "盘上有食物时画出档位 + 倒计时",
    (t6b.filter(x => /·热乎/.test(x))[0] || "") + " / " + (t6b.filter(x => /s 内送出/.test(x))[0] || ""));
  d6.setPlateAge(3, B.SERVE_WINDOW + 0.05);
  d6.tick(1 / 60);
  d6b.canvas()._m.texts.length = 0;
  const strokes6 = Object.assign({}, d6b.canvas()._m.strokes);
  d6b.pump(1);
  const t6c = d6b.canvas()._m.texts;
  A(t6c.some(x => /糊了/.test(x)) && t6c.some(x => /只能丢/.test(x)), "糊了的盘画出「糊了 · 只能丢（双击）」",
    (t6c.filter(x => /只能丢/.test(x))[0] || ""));
  A((d6b.canvas()._m.strokes["#ff4d6d"] || 0) > (strokes6["#ff4d6d"] || 0), "糊了画出红色警告（红叉）",
    "#ff4d6d " + (strokes6["#ff4d6d"] || 0) + " → " + (d6b.canvas()._m.strokes["#ff4d6d"] || 0));
  d6.close();

  /* ⑦ 通过路径 */
  const d2b = boot();
  let winRes = null, winN = 0;
  d2b.B.start(d2b.host, { target: { id: "su", name: "苏晚晴", bond: 40 }, duration: 75, goal: 8, onFinish: r => { winN++; winRes = r; } });
  const d2 = d2b.B.debug;
  let guard = 0;
  while (!d2.state().over && guard++ < 4000) {
    const os = d2.orders();
    for (const c of os) for (const f of c.order) {
      if (c.done.indexOf(f) >= 0) continue;
      if (d2.stations().some(s => s.food === f)) continue;
      if (d2.plates().some(p => p.food === f && p.state !== "burnt")) continue;   // 这一列盘上已有
      d2.drop(f, null);                                                            // 食材只进它自己那一列（自动落盘）
    }
    for (let n = 0; n < 60 && !d2.state().over; n++) { d2.tick(1 / 60); if (d2.plates().some(p => p.state === "perfect")) break; }
    if (d2.state().over) break;
    /* 单击每一列的专属盘 → 自动送给「正在需要 + 耐心最少」的顾客（新玩法的连做节奏） */
    d2.stations().forEach((s, i) => { if (s.plate && s.plateState !== "burnt") d2.serveCol(i); });
    /* 糊的 / 没人要的存货清掉，别堵着某一列 */
    d2.stations().forEach((s, i) => {
      if (s.state === "burnt" || s.plateState === "burnt") { d2.trash(i); return; }
      if (s.plate) { const r = d2.serveCol(i); if (!r.ok && r.why === "no-want") d2.trash(i); }
    });
    d2.tick(0.15);
  }
  const win = d2.state();
  A(win.over === true, "通过路径：debug 驱动跑完整局");
  A(win.win === true, "拿到 win:true", "served " + win.served + "/" + win.goal);
  A(win.served >= 8, "服务满 8 位顾客", win.served + " 位");
  A(!!win.result && win.result.bondDelta > 0, "结算：好感上升", win.result && ("+" + win.result.bondDelta));
  A(!!win.result.quote && win.result.quote.length > 4, "通过有专属台词", win.result && win.result.quote);
  A(/苏晚晴/.test((win.result && win.result.impact) || ""), "本局影响一句话带对方名字");
  A(!!d2b.host.querySelector(".bf-result"), "结算面板 DOM 已渲染");
  pumpSettle(d2b);                               // 泵几帧让画布循环走到 showResult()，面板才有内容
  const panelEl = d2b.host.querySelector(".bf-result");
  const panelTxt = String(panelEl ? (panelEl._html || panelEl.innerHTML) : "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  A(/服务顾客/.test(panelTxt) && /完美份数/.test(panelTxt) && /烧糊份数/.test(panelTxt) && /用时/.test(panelTxt) && /好感/.test(panelTxt),
    "结算面板含 服务顾客/目标 · 完美份数 · 烧糊份数 · 用时 · 好感变化",
    panelTxt.slice(6, 90));
  /* ── 出口按钮 #bfGo：通过路径点它 → 面板关闭 + onFinish 收到 win:true **一次** ── */
  const goWin = d2b.host.querySelector("#bfGo");
  A(!!goWin, "通过路径的结算面板里有出口按钮 #bfGo（真 DOM 节点）");
  A(!!goWin && /收下早餐\s*·\s*继续/.test(goWin.textContent), "通过时按钮文案「收下早餐 · 继续」", goWin && goWin.textContent);
  A(!!goWin && goWin.getAttribute("data-act") === "close", "保留 data-act=close（兼容旧验收脚本选择器）");
  A(winN === 0, "结算面板出来时 onFinish 还没被调用（等玩家点出口）");
  if (goWin) { goWin.click(); goWin.click(); goWin.click(); }        // 连点 3 次
  A(winN === 1, "点 #bfGo → onFinish 恰好一次（连点 3 次仍为 " + winN + "）");
  A(d2b.B.isBusy() === false, "点 #bfGo 后模块已 dispose");
  A(d2b.host.children.length === 0, "点 #bfGo 后 #bfGameHost 已清空（覆盖层不留死界面）");
  A(d2b.docKeys() === 0, "点 #bfGo 后 document 上不留 keydown 监听");
  const life2 = d2b.B.debug.lifecycle();
  A(life2.rafCancelled >= 1 && life2.escBound === life2.escRemoved && life2.escActive === false,
    "dispose() 清理干净：rAF 已取消 / ESC 监听挂摘配平（挂 " + life2.escBound + " 摘 " + life2.escRemoved + "）");
  A(!!winRes && winRes.win === true, "onFinish 回调收到同一份 result", winRes && winRes.quote);

  /* ⑧ 失败路径 */
  const d3b = boot();
  let loseRes = null, loseN = 0;
  d3b.B.start(d3b.host, { target: { id: "guo", name: "陈果", bond: 30 }, duration: 20, goal: 8, onFinish: r => { loseN++; loseRes = r; } });
  const d3 = d3b.B.debug;
  guard = 0;
  while (!d3.state().over && guard++ < 20000) d3.tick(0.2);
  const lose = d3.state();
  A(lose.over === true, "失败路径：已结算");
  A(lose.win === false, "拿到 win:false", lose.reason);
  A(!!lose.result && lose.result.bondDelta < 0 && lose.result.bondDelta >= -6, "失败 → 好感 −3~−6", lose.result && ("" + lose.result.bondDelta));
  A(!!lose.result && !!lose.result.quote && lose.result.quote.length > 4, "失败有专属尴尬台词", lose.result && lose.result.quote);
  pumpSettle(d3b);
  const failTxt = String(d3b.host.querySelector(".bf-result").innerHTML).replace(/<[^>]+>/g, " ");
  A(/好感/.test(failTxt), "失败结算面板也显示好感变化");
  A(/明天再来|台阶/.test(failTxt), "失败面板给了「下次再来」的台阶（不虐主）");
  const goFail = d3b.host.querySelector("#bfGo");
  A(!!goFail && /算了，明天再来\s*·\s*继续/.test(goFail.textContent), "失败时按钮文案「算了，明天再来 · 继续」", goFail && goFail.textContent);
  if (goFail) { goFail.click(); goFail.click(); goFail.click(); }
  A(loseN === 1, "失败路径点 #bfGo → onFinish 恰好一次（连点 3 次仍为 " + loseN + "）");
  A(d3b.B.isBusy() === false, "失败路径点 #bfGo 后模块已 dispose");
  A(!!loseRes && loseRes.win === false, "失败路径 onFinish 也收到 result");

  /* ⑧b ESC = 点 #bfGo（第三个无头局：不点鼠标，只按 ESC） */
  const d7b = boot();
  let escRes = null, escN = 0;
  d7b.B.start(d7b.host, { target: { id: "guo", name: "陈果", bond: 30 }, duration: 20, goal: 8, onFinish: r => { escN++; escRes = r; } });
  const d7 = d7b.B.debug;
  let g7 = 0;
  while (!d7.state().over && g7++ < 20000) d7.tick(0.2);
  pumpSettle(d7b);
  A(d7b.docKeys() === 1, "开局时 document 上恰好挂了 1 个 keydown（ESC 出口）");
  d7b.esc();
  A(escN === 1 && !!escRes && escRes.win === false, "ESC = 点 #bfGo：退出但不丢结算结果（onFinish 一次）");
  d7b.esc(); d7b.esc();
  A(escN === 1, "ESC 连按仍是 1 次（幂等 + 监听已摘）");
  A(d7b.B.isBusy() === false && d7b.docKeys() === 0, "ESC 之后已收摊且不留监听");

  /* ⑨ 零外部图片 / 自包含 */
  A(!/drawImage/.test(SRC), "breakfast.js 源码不含 drawImage（不引用外部图片）");
  A(!/new\s+Image\b/.test(SRC) && !/\.src\s*=/.test(SRC), "源码不创建 Image 对象、不设 src");
  A(!/url\(/.test(SRC), "源码不使用 url() 贴图");
  A(!/^\s*(import|export)\s/m.test(SRC.replace(/\/\*[\s\S]*?\*\//g, "")), "不使用 ES module（自包含 IIFE）");
  A(/\(function \(root\)/.test(SRC) && /root\.Breakfast = api/.test(SRC), "IIFE + window.Breakfast 暴露方式与 mahjong.js 一致");

  /* ⑩ 剧情入口链路：sister_bf →（选对象）→ 局 → #bfGo → afterInter → after 镜头 → finishNode
        → S.done 含 sister_bf → next 解锁 flashback；自由局则回沙盘 + 结算 toast。
       做法：把 index.html 里**真实的内联胶水层**（applyFx / afterInter / finishNode / advance / isAvail
       + 早餐店整段 glue）逐字抽出来，和真 breakfast.js 一起跑在同一个无头 vm 里（S / render / toast
       等页面副作用用桩），这样链路断言的是真代码，而不是复刻一份。 */
  runGlueChain(A);

  /* ⑪ 其它玩法的结算出口（麻将 #mjmGo）也做了同样的视口兜底 */
  const MJ = fs.readFileSync(path.join(OUT, "mahjong.js"), "utf8");
  A(/\.mjm-card\.wide\{[^}]*max-height:min\(94%,calc\(100vh - 56px\)\)/.test(MJ), "麻将结算卡 max-height 也按视口收敛");
  A(/#mjmGo\{position:sticky;bottom:0/.test(MJ), "麻将结算卡「继 续」#mjmGo sticky 钉在卡底部");
  A(/\.mjm-card\.wide\{[^}]*overflow-y:auto/.test(MJ), "麻将结算卡内部可滚动（四家手牌再长也滚得动）");
}

/** 结算面板出现后，泵几帧让飘字/面板渲染完（面板关闭按钮不在 canvas 上） */
function pumpSettle(b) { b.pump(6); }

/* ═══════════════════════════════════════════════════════════════════════════
   ⑩ 剧情入口链路：真 index.html 胶水层 × 真 breakfast.js（同一个无头 vm）
   ═══════════════════════════════════════════════════════════════════════════ */
const HTML = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
const PAGE = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
/** 从内联脚本里按「字面签名 + 大括号配平」整段抽出一个函数（逐字复制，不猜、不切片猜） */
function grabFn(script, signature) {
  const i = script.indexOf(signature);
  if (i < 0) throw new Error("找不到函数：" + signature);
  let depth = 0;
  for (let k = script.indexOf("{", i); k < script.length; k++) {
    const c = script[k];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return script.slice(i, k + 1); }
  }
  throw new Error("大括号不配平：" + signature);
}
const GLUE_TAIL = '$("bfBtn").addEventListener("click", function(){ openBreakfast(); });';
/** 早餐店整段胶水（从段落注释到侧栏按钮绑定，逐字） */
function glueSrc() {
  const i = PAGE.indexOf("/* ═══════════════ 早餐店 · 拼手速");
  const j = PAGE.indexOf(GLUE_TAIL);
  if (i < 0 || j < 0) throw new Error("找不到 index.html 里的早餐店胶水层");
  return PAGE.slice(i, j + GLUE_TAIL.length);
}
/** 页面里被胶水层调用的真函数：结算落地 / afterInter / finishNode / advance / isAvail 解锁判定 */
function pageFns() {
  return ["function applyFx(r, why){", "function bumpStat(k){", "function afterInter(fxR, why){",
          "function finishNode(){", "function advance(){", "function isAvail(id){"]
    .map(s => grabFn(PAGE, s)).join("\n");
}
const GLUE_PRELUDE = [
  "var __trace = { xp:0, achv:0, render:0, save:0, toast:[], playShot:0, openInter:0, good:0, bad:0, invite:0, endcard:false };",
  "function gainXp(n){ __trace.xp += n; }",
  "function checkAchv(){ __trace.achv++; }",
  "function clearActive(){ if(S) S.active = null; }",
  "function render(){ __trace.render++; }",
  "function save(){ __trace.save++; }",
  "function toast(h){ __trace.toast.push(String(h)); }",
  "function stopVO(){}",
  "function playShot(){ __trace.playShot++; }",
  "function openInter(it){ __trace.openInter++; }",
  "function showEndcard(){ __trace.endcard = true; }",
  "function map3dPause(){}",
  "function mjMaybeInvite(){ __trace.invite++; }",
  "function grantItem(){}",
  "var $ = function(id){ return document.getElementById(id); };",
  "var fx = { pause:function(){}, removeAttribute:function(){}, load:function(){} };",
  "var AudioSys = { init:function(){}, click:function(){}, good:function(){ __trace.good++; }, bad:function(){ __trace.bad++; } };",
  "var map3dReady = false, Map3D = { setMood:function(){} };",
  "var curNode = null, shotIdx = 0, shotQueue = [], phase = \"shots\";",
  "var S = null;",
].join("\n");
/** 胶水层内部的 let 变量（bfRunning / bfNode / bfLastResult）用探针读出来 */
const GLUE_PROBE = "globalThis.__glueProbe = function(){ return { running:bfRunning, node:bfNode, last:bfLastResult }; };";
/** 起一个「页面级」无头宿主：真 breakfast.js + 真 DATA + 真胶水层 + 桩掉的页面副作用 */
function bootGlue() {
  const body = makeEl("body");
  const ids = {};
  const docListeners = {};
  function slot(id, cls, parent) {
    const e = makeEl("div"); e.id = id; e.className = cls || "";
    (parent || body).appendChild(e); ids[id] = e; return e;
  }
  const bfGame = slot("bfGame", "overlay bf-overlay");
  const bfGameHost = slot("bfGameHost", "panel bf-panel bf-game-panel", bfGame);
  const bfPick = slot("bfPick", "overlay bf-overlay");
  const bfPickHost = slot("bfPickHost", "panel bf-panel", bfPick);
  slot("bfBtn", "btn-m"); slot("cine", "");
  const frames = []; let clock = 0;
  const doc = {
    body, createElement: makeEl,
    getElementById: id => ids[id] || slot(id, ""),
    querySelector: sel => body.querySelector(sel),
    querySelectorAll: sel => body.querySelectorAll(sel),
    addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); },
    removeEventListener: (t, f) => { const h = docListeners[t] || []; const i = h.indexOf(f); if (i >= 0) h.splice(i, 1); },
  };
  const ctx = vm.createContext({
    console, Math, Date, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat, Set, Map,
    document: doc, devicePixelRatio: 1, __cs2: {},
    performance: { now: () => clock },
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: id => { frames[id - 1] = null; },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(SRC + "\n;globalThis.__BF = window.Breakfast;", ctx);            // 真玩法模块
  const DATA = PAGE.slice(PAGE.indexOf("const PLACES"), PAGE.indexOf("/* ═══════════════ 音频层"));
  vm.runInContext(DATA + "\n;globalThis.NODES=NODES;globalThis.BONDS=BONDS;globalThis.STATS=STATS;globalThis.ACHV=ACHV;", ctx);
  vm.runInContext(GLUE_PRELUDE, ctx);
  vm.runInContext(pageFns() + "\n" + glueSrc() + "\n" + GLUE_PROBE, ctx);
  function pump(n, ms) {
    for (let i = 0; i < n; i++) {
      clock += (ms === undefined ? 16 : ms);
      const list = frames.slice(); frames.length = 0;
      list.forEach(cb => { if (cb) cb(clock); });
      if (!frames.length) break;
    }
  }
  return {
    ctx, ids, doc, pump, B: ctx.__BF, NODES: ctx.NODES, BONDS: ctx.BONDS,
    trace: () => ctx.__trace,
    probe: () => ctx.__glueProbe(),
    docKeys: () => (docListeners.keydown || []).length,
    setS(bonds, extra) {
      const b = {}; for (const k in ctx.BONDS) b[k] = 30;
      for (const k in (bonds || {})) b[k] = bonds[k];
      ctx.S = Object.assign({
        done: [], stats: { cash: 120, cha: 20, phy: 18, int: 40 }, bonds: b, flags: [], achv: [],
        day: 7, per: 0, card1: 1, card2: 0, history: [], active: null,
        rpg: { xp: 0, owned: [], equipped: { hand: null, outfit: null, accessory: null }, bag: {} },
        buffs: { time: 0, window: 0, hp: 0, capital: 0 },
      }, extra || {});
      return ctx.S;
    },
  };
}
/** 真打赢一局（看单下料 → 熟了自动落盘 → 单击盘出餐） */
function driveWin(B) {
  const d = B.debug;
  let guard = 0;
  while (!d.state().over && guard++ < 6000) {
    for (const c of d.orders()) for (const f of c.order) {
      if (c.done.indexOf(f) >= 0) continue;
      if (d.stations().some(s => s.food === f)) continue;
      if (d.plates().some(p => p.food === f && p.state !== "burnt")) continue;
      d.drop(f, null);
    }
    for (let n = 0; n < 60 && !d.state().over; n++) { d.tick(1 / 60); if (d.plates().some(p => p.state === "perfect")) break; }
    if (d.state().over) break;
    d.stations().forEach((s, i) => { if (s.plate && s.plateState !== "burnt") d.serveCol(i); });
    d.stations().forEach((s, i) => {
      if (s.state === "burnt" || s.plateState === "burnt") { d.trash(i); return; }
      if (s.plate) { const r = d.serveCol(i); if (!r.ok && r.why === "no-want") d.trash(i); }
    });
    d.tick(0.15);
  }
  return d.state();
}

function runGlueChain(A) {
  /* ── 入口 A · 剧情节点 sister_bf（inter.type === "cook"）── */
  const G = bootGlue();
  const N = G.NODES;
  A(!!N.sister_bf && !!N.sister_bf.inter && N.sister_bf.inter.type === "cook",
    "剧情入口数据齐：sister_bf.inter.type === \"cook\"");
  A((N.sister_bf.next || []).indexOf("flashback") >= 0, "sister_bf.next 指向 flashback");
  A(Array.isArray(N.sister_bf.after) && N.sister_bf.after.length >= 1, "sister_bf 有 after 镜头（结算后要接着播）");
  const S = G.setS({ su: 40 });                       // 苏晚晴好感 40 → 今天还没送过 → 可选
  const node = N.sister_bf; node.id = "sister_bf";
  G.ctx.curNode = node;
  const cha0 = S.stats.cha, phy0 = S.stats.phy, bond0 = S.bonds.su;

  G.ctx.startCook(node.inter);                        // openInter(cook) → startCook → openBreakfast
  A(G.ids.bfPick.classList.contains("on"), "从剧情节点进：startCook 打开「做份早餐·送给谁」面板");
  A(G.ids.bfGame.classList.contains("on") === false, "这时游戏覆盖层还没开");
  const wrap = G.ids.bfPickHost.children[0];
  A(!!wrap && wrap.querySelectorAll(".bf-card").length === 9, "选对象面板列出 9 位可攻略角色");
  const card = wrap.querySelector('.bf-card[data-id=su]');
  A(!!card, "拿到苏晚晴那张卡（好感 40 · 今天没送过 → 可选）");
  card.dispatch("click");                             // = 玩家点这张卡
  A(G.ids.bfPick.classList.contains("on") === false, "选完 → 选对象面板关闭");
  A(G.ids.bfGame.classList.contains("on") === true, "选完 → 早餐店游戏覆盖层打开");
  const p1 = G.probe();
  A(p1.running === true && p1.node === true, "胶水层记住「本局是从剧情节点进来的」（bfRunning / bfNode 都是 true）");

  const st = driveWin(G.B);                            // 真打一局
  A(st.win === true, "剧情局真打赢了", "served " + st.served + "/" + st.goal);
  G.pump(3);
  const go = G.ids.bfGameHost.querySelector("#bfGo");
  A(!!go, "剧情局结算面板里也有出口按钮 #bfGo");
  A(!!go && /收下早餐\s*·\s*继续/.test(go.textContent), "剧情局按钮文案「收下早餐 · 继续」");
  A(G.probe().last === null, "结算面板出来时还没把结果交出去");
  if (go) { go.click(); go.click(); go.click(); }      // 连点 3 次
  A(G.probe().running === false && G.probe().node === false, "点 #bfGo → 胶水层收摊（bfRunning / bfNode 复位）");
  A(G.ids.bfGame.classList.contains("on") === false, "点 #bfGo → #bfGame 覆盖层关闭");
  A(!!G.probe().last && G.probe().last.win === true, "点 #bfGo → onFinish 把 win:true 的 result 交给胶水层");
  A(S.bonds.su === bond0 + G.probe().last.bondDelta, "好感真落地：苏晚晴 " + bond0 + " → " + S.bonds.su,
    "Δ" + G.probe().last.bondDelta);
  A(!!S.breakfastDay && S.breakfastDay.sent.indexOf("su") >= 0, "每日一次记账：su 进了今天的已送名单");
  A(S.bfWin === true, "通过 → S.bfWin 记上（成就链要用）");
  /* afterInter：结算退出后接着播节点自己的 after 镜头 */
  A(G.ctx.phase === "after", "afterInter 把演出切到 after 阶段（不是直接丢回沙盘）");
  A(G.ctx.shotQueue === node.after, "afterInter 播放的是 sister_bf 自己的 after 镜头队列");
  A(G.trace().playShot >= 1, "after 镜头真的被播放（playShot 被调用）");
  A(S.done.indexOf("sister_bf") < 0, "after 镜头还没走完 → 节点还没算完成（finishNode 未跑）");
  G.ctx.advance();                                     // 玩家点「继续 ▸」把 after 镜头走完
  A(S.done.indexOf("sister_bf") >= 0, "after 镜头走完 → finishNode 把 sister_bf 记进 S.done");
  A(G.ctx.isAvail("flashback") === true, "next 节点因此解锁：isAvail(\"flashback\") === true");
  A(S.stats.cha === cha0 + 3 && S.stats.phy === phy0 + 1,
    "节点奖励真落地：魅力 " + cha0 + "→" + S.stats.cha + " · 体质 " + phy0 + "→" + S.stats.phy);
  A(S.active === null, "finishNode → clearActive：演出快照已清（回沙盘不是半路状态）");
  A(G.trace().render >= 1, "finishNode → render()：HUD / 侧栏恢复可用");
  A(G.ids.bfPick.classList.contains("on") === false && G.ids.bfGame.classList.contains("on") === false,
    "两个覆盖层都已关掉（不留挡住沙盘的死界面）");
  A(G.docKeys() === 0, "剧情局收摊后 document 上不留 keydown 监听");

  /* ── 入口 B · 侧栏自由局：退出后回沙盘 + 结算 toast ── */
  const G2 = bootGlue();
  const S2 = G2.setS({ guo: 30 });
  G2.ctx.curNode = null;                               // 自由局：不在任何剧情节点里
  G2.ctx.openBreakfast();                              // 侧栏「🍳 做份早餐」
  const wrap2 = G2.ids.bfPickHost.children[0];
  const card2 = wrap2 && wrap2.querySelector('.bf-card[data-id=guo]');
  A(!!card2, "侧栏入口同样能开出选对象面板");
  card2.dispatch("click");
  A(G2.ids.bfGame.classList.contains("on") === true, "侧栏入口开局：游戏覆盖层打开");
  A(G2.probe().node === false, "侧栏自由局不是剧情局（bfNode === false）");
  const st2 = driveWin(G2.B);
  A(st2.win === true, "自由局也真打赢了");
  G2.pump(3);
  const go2 = G2.ids.bfGameHost.querySelector("#bfGo");
  A(!!go2, "自由局结算面板里也有 #bfGo");
  if (go2) { go2.click(); go2.click(); }
  A(G2.probe().running === false && G2.ids.bfGame.classList.contains("on") === false,
    "自由局点 #bfGo → 回沙盘（覆盖层关闭）");
  A(S2.done.length === 0, "自由局不往 S.done 里塞节点（不误触剧情推进）");
  A(G2.ctx.phase === "shots", "自由局不走 afterInter（phase 没被改动）");
  const toasts2 = G2.trace().toast.join(" || ");
  A(/本局影响/.test(toasts2), "自由局退出后给「本局影响」结算 toast", toasts2.slice(0, 60));
  A(/接下来/.test(toasts2), "自由局退出后给「接下来还能干什么」toast");
  A(/服务\s*\d+\/\d+/.test(toasts2), "结算 toast 带今日战绩（服务 x/8 · 完美 · 糊 · 得分）");
  A(!!S2.bfLast && S2.bfLast.target === "guo", "S.bfLast 记下今日战绩（侧栏「上次」那一行要用）");
  A(G2.trace().render >= 2, "自由局退出后 render() 被调用 → 侧栏 / HUD 恢复可用");
  A(G2.docKeys() === 0, "自由局收摊后 document 上不留 keydown 监听");
}

runMain();

const shots = fs.existsSync(SHOT_DIR) ? fs.readdirSync(SHOT_DIR).filter(f => /^bf_/.test(f)) : [];
const res = {
  success: errors.length === 0,
  testedAt: new Date().toISOString(),
  mode: "node-headless-canvas-stub",
  note: "Chrome / Edge 在当前沙箱一律 mojo platform_channel 0x5（拒绝访问）无法启动；mshta(Trident) 能起进程但落盘被拦。故用 Node + 记录式 Canvas2D + 可泵 rAF 真跑渲染与玩法，作为降级证据链。",
  checks, errors,
  limits: { pixelEvidence: false, screenshotAvailable: shots.length > 0, reason: "像素级截图与 CDP 真实鼠标需要可启动的浏览器；本沙箱不具备（已尝试 Chrome / Edge / mshta）" }
};
fs.writeFileSync(path.join(OUT, "tests", "breakfast-headless-results.json"), JSON.stringify(res, null, 1), "utf8");
console.log("[无头渲染验收] 模式=" + res.mode);
checks.forEach(c => console.log("  ✔ " + c));
errors.forEach(e => console.log("  ✖ " + e));
console.log("通过 " + checks.length + "，失败 " + errors.length);
process.exit(errors.length ? 1 : 0);
