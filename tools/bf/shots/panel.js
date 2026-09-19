/* ═══════════════════════════════════════════════════════════════════════════
   tools/bf/shots/panel.js — 出图：用自写软件光栅化器回放 breakfast.js 真实发出的 Canvas2D 指令
   产物：测试截图/bf_game.png   放大后的进行中画面（1770×1185，1080p 级别）
        测试截图/bf_plates.png 灶位 + 专属盘特写（2360×580，其中几盘已备好、一盘糊了）
        测试截图/bf_pass.png   通过结算（含好感变化）
        测试截图/bf_fail.png   失败结算（含好感变化）
   流程：① Node 真跑 breakfast.js（真动画循环）→ 记录式 Canvas2D
        ② 形状交给 tools/lib/raster.js 软件光栅化
        ③ 文字交给 __textHook 收集 → tools/lib/text-compose.ps1 用 System.Drawing + 系统字体（微软雅黑）
           把真汉字合成回 PNG —— 出图里的中文是清楚的系统字体，不是 5×7 点阵/方块。
   运行：node tools/bf/shots/panel.js          （会顺带调用 pwsh 合成文字；失败会提示手动跑）
        pwsh -File tools/lib/text-compose.ps1     （只重跑文字合成）
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createCanvas } = require("../../lib/raster.js");

const OUT = path.join(__dirname, "..", "..", "..");
const SHOT = path.join(OUT, "测试截图");
const SRC = fs.readFileSync(path.join(OUT, "breakfast.js"), "utf8");
if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });

/* ── 本地食材贴图：真去文件系统读 art/icons/<foodId>.png ──
   breakfast.js 现在会预加载这些 PNG 并 drawImage；出图要看到真图标，
   所以这里给一个 src 一赋值就同步读 PNG 头的 Image 替身
   （自然宽高 = 真文件的 IHDR），像素则交给 tools/lib/raster.js 的 drawImage 现解现合成。 */
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
function ImageCtorFor() {
  return function Image() {
    const img = {
      naturalWidth: 0, naturalHeight: 0, complete: false, width: 0, height: 0,
      onload: null, onerror: null, _src: "",
      get src() { return this._src; },
      set src(v) {
        this._src = String(v);
        let sz = null;
        try { sz = pngSize(resolveImgPath(v)); } catch (e) { sz = null; }
        if (sz) {
          this.naturalWidth = sz.w; this.naturalHeight = sz.h; this.width = sz.w; this.height = sz.h; this.complete = true;
          if (typeof this.onload === "function") this.onload({ target: this });
        } else if (typeof this.onerror === "function") this.onerror({ target: this });
      }
    };
    return img;
  };
}

const BITMAP_TEXT = process.argv.indexOf("--bitmap-text") >= 0;   // 兜底：用点阵文字直接出图

/* ── 最小 DOM（只为让 start() 跑起来；玩法与绘制全在 breakfast.js）── */
function makeEl(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), children: [], parentNode: null,
    id: "", className: "", _html: "", textContent: "", type: "", value: "",
    style: {}, dataset: {}, _handlers: {},
    set innerHTML(v) { this._html = String(v); this.children = []; }, get innerHTML() { return this._html; },
    setAttribute(k, v) { if (k === "id") this.id = v; if (k === "class") this.className = v; this[k] = v; },
    getAttribute(k) { return this[k] === undefined ? null : this[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener(t, f) { (this._handlers[t] = this._handlers[t] || []).push(f); },
    removeEventListener() {},
    dispatch() {},
    all() { const o = []; (function w(n) { (n.children || []).forEach(c => { o.push(c); w(c); }); })(this); return o; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return this._ctx; },
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
  };
  return e;
}

/** 起一局（scale = 位图放大倍数 = devicePixelRatio；bufW/bufH = 位图缓冲区尺寸（逻辑像素），
    用来裁切特写 —— breakfast.js 只认 1180×790 的逻辑画面，缓冲区可以只覆盖要出图的那一块） */
function boot(scale, bufW, bufH) {
  const VW = 1180 * scale, VH = 790 * scale;                    // breakfast.js 眼里的画布尺寸
  const BW = Math.round((bufW || 1180) * scale), BH = Math.round((bufH || 790) * scale);
  const canvas = createCanvas(BW, BH);
  const texts = [];
  if (!BITMAP_TEXT) canvas.__textHook = (t) => texts.push(t);
  const body = makeEl("body");
  const host = makeEl("div"); host.id = "bfGameHost"; body.appendChild(host);
  const frames = [];
  let clock = 0;
  const win = {
    devicePixelRatio: scale,
    performance: { now: () => clock },
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: id => { frames[id - 1] = null; },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    document: null,
    Image: ImageCtorFor(),
    /* 贴图按「当前页面目录」解析 → art/icons/<foodId>.png 落到 OUT/art/icons/ */
    location: { href: "file:///" + path.join(OUT, "index.html").replace(/\\/g, "/"), pathname: "/" + path.join(OUT, "index.html").replace(/\\/g, "/") },
  };
  win.document = {
    body, createElement: (tag) => {
      const e = makeEl(tag);
      if (e.tagName === "CANVAS") { e._ctx = canvas; canvas.canvas = e; e.width = VW; e.height = VH; }
      return e;
    },
    getElementById: id => (id === "bfGameHost" ? host : null),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, removeEventListener: () => {},
  };
  const ctx = vm.createContext(Object.assign(win, { console, Math, Date, isFinite, Number, String, Object, Array }));
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(SRC + "\n;globalThis.__BF = window.Breakfast;", ctx);
  function pump(n, ms) {
    for (let i = 0; i < n; i++) {
      clock += (ms === undefined ? 16 : ms);
      const l = frames.slice(); frames.length = 0;
      l.forEach(cb => cb && cb(clock));
      if (!frames.length) break;
    }
  }
  return { B: ctx.__BF, host, pump, canvas, texts, s: scale };
}

/** 推进 d 秒游戏逻辑：step() 内部把单次 dt 夹到 0.5s，所以要按 1/60 小步走 */
function adv(d, seconds) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n && !d.state().over; i++) d.tick(1 / 60);
}

/** 机器人：看单下料（每样只进自己那一列）+ 熟了自动落盘 + 单击盘出餐（把「通过路径」真跑出来） */
function bot(B, maxSteps) {
  const d = B.debug;
  let guard = 0;
  while (!d.state().over && guard++ < (maxSteps || 5000)) {
    for (const c of d.orders()) for (const f of c.order) {
      if (c.done.indexOf(f) >= 0) continue;
      if (d.stations().some(s => s.food === f)) continue;
      if (d.plates().some(p => p.food === f && p.state !== "burnt")) continue;
      d.drop(f, null);
    }
    for (let n = 0; n < 60 && !d.state().over; n++) {
      d.tick(1 / 60);
      if (d.plates().some(p => p.state === "perfect")) break;      // 有东西落到盘上了
    }
    if (d.state().over) break;
    d.stations().forEach((s, i) => { if (s.plate && s.plateState !== "burnt") d.serveCol(i); });   // 单击盘出餐
    d.stations().forEach((s, i) => {
      if (s.state === "burnt" || s.plateState === "burnt") { d.trash(i); return; }
      if (s.plate) { const r = d.serveCol(i); if (!r.ok && r.why === "no-want") d.trash(i); }
    });
    d.tick(0.12);
  }
}

/* ── 结算面板（本体是 DOM，这里按同源数据画到画布上，方便一张图看全）── */
function drawPanel(cv, r, B) {
  const V = B.VIEW;
  const px = 150, pw = V.w - 300, py = 150, ph = 470;
  const g = cv;
  g.save();
  g.fillStyle = "rgba(6,4,9,.72)"; g.fillRect(0, 0, V.w, V.h);
  g.fillStyle = "rgba(14,11,22,.98)";
  g.beginPath(); g.rect(px, py, pw, ph); g.fill();
  g.strokeStyle = r.win ? "#5dffa0" : "#ff4d6d"; g.lineWidth = 4;
  g.beginPath(); g.rect(px, py, pw, ph); g.stroke();
  g.textAlign = "left"; g.textBaseline = "middle";
  g.fillStyle = "#ffd76e"; g.font = "bold 40px 'Microsoft YaHei',sans-serif";
  g.fillText(r.win ? "🍳 送出热乎早餐" : "…早餐烧坏了", px + 40, py + 56);
  g.fillStyle = "#cfe8ff"; g.font = "bold 24px 'Microsoft YaHei',sans-serif";
  g.fillStyle = "#a9d8ff";
  g.fillText("顾客：" + (r.quote || ""), px + 40, py + 112);
  const tgt = r.target || { name: "对方", bond: "-" };
  const rows = [
    ["服务顾客", r.served + " / " + r.goal],
    ["完美份数", r.perfect + "（热乎 " + r.hot + "）"],
    ["热乎/温/凉", r.heat.hot + " / " + r.heat.warm + " / " + r.heat.cold],
    ["出餐预备", r.prepped + " 份（9 列专属盘）"],
    ["烧糊份数", String(r.burnt)],
    ["用时", r.elapsed.toFixed(1) + "s / " + r.duration + "s"],
    ["本局得分", String(r.score)],
    [tgt.name + " 好感", (r.bondDelta > 0 ? "+" : "") + r.bondDelta +
      "（" + tgt.bond + " → " + Math.max(0, Math.min(100, Number(tgt.bond) + r.bondDelta)) + "）"],
  ];
  let y = py + 158;
  g.font = "25px 'Microsoft YaHei',sans-serif";
  rows.forEach((kv, i) => {
    const x = px + 40 + (i % 2) * (pw / 2 - 10);
    if (i % 2 === 0) y += 46;
    g.fillStyle = "#b0a08c"; g.fillText(kv[0], x, y);
    g.fillStyle = (i === 7) ? (r.bondDelta > 0 ? "#5dffa0" : "#ff4d6d") : "#ffd76e";
    g.font = "bold 26px 'Microsoft YaHei',sans-serif";
    g.fillText(kv[1], x + 178, y);
    g.font = "25px 'Microsoft YaHei',sans-serif";
  });
  g.fillStyle = "#b0a08c"; g.font = "22px 'Microsoft YaHei',sans-serif";
  g.fillText("📌 " + (r.impact || ""), px + 40, y + 52, pw - 80);
  g.fillStyle = "rgba(176,160,140,.75)"; g.font = "19px 'Microsoft YaHei',sans-serif";
  g.fillText("（结算面板本体是 DOM 弹层；这里按同源 result 数据画到画布上，便于一张图看全）", px + 40, py + ph - 34, pw - 80);
  g.restore();
}

const manifest = [];
function save(cv, name, texts, note) {
  const png = path.join(SHOT, name);
  fs.writeFileSync(png, cv.toPNG());
  manifest.push({ png, texts: texts || [], note: note || "" });
  console.log("  出图 " + name + " · " + fs.statSync(png).size + " 字节 · " + (texts ? texts.length : 0) + " 段文字");
}

/* ══════════ ① 进行中（放大后的整屏 · 1770×1185） ══════════
   局面按用户要求摆：底部 9 个食材桶 → 中列 9 口锅（2 口在烧）→ 上列 9 个专属盘
   （1 盘热乎、1 盘温、1 盘凉、1 盘糊了） */
{
  const SC = 1.5;
  const b = boot(SC);
  b.B.start(b.host, { target: { id: "su", name: "苏晚晴", bond: 40 }, duration: 75, goal: 8, onFinish: () => {} });
  const d = b.B.debug;
  adv(d, 4.2);                                        // 逻辑推进（不渲染）：顾客进门、订单卡出来
  /* 四列先各做一份（熟了各自落到本列专属盘） */
  d.drop("milk", null); d.drop("sandwich", null); d.drop("salad", null); d.drop("bun", null);
  { let g = 0; while (g++ < 400 && d.plates().length < 4) d.tick(1 / 60); }
  /* 再让两列正在烧：0 列白粥（5.0s）、3 列煎蛋（3.0s）—— 画面里能看到火候进度环 */
  d.drop("congee", null); d.drop("egg", null);
  adv(d, 0.7);
  /* 摆盘上的档位：先让一列糊掉（忘取 → 过火计时走完），等飘字播完再定三档 */
  d.setPlateAge(6, b.B.SERVE_WINDOW + 0.5);           // 包子 → 忘取，超时变糊
  d.tick(1 / 60);
  adv(d, 1.0);                                        // 让「忘取了 · 糊了！」飘字播完，出图干净
  d.setPlateAge(1, 0.4);                              // 热牛奶 → 热乎（14 分档）
  d.setPlateAge(5, 2.2);                              // 三明治 → 温（10 分档）
  d.setPlateAge(7, 3.6);                              // 沙拉 → 凉（6 分档）
  b.texts.length = 0;                                  // 只保留最后一帧的文字（否则会把历史帧叠在一起）
  b.pump(1, 16);                                       // 只渲染最后这一帧
  save(b.canvas, "bf_game.png", b.texts,
    "进行中：9 列列对齐（底部食材 → 中列锅 → 上列专属盘）+ 0/3 列在烧 + 盘上 热乎/温/凉 三档 + 6 列糊了（双击才能丢）+ 三条操作图例");
  const st = d.state();
  console.log("    [进行中] 顾客 " + d.orders().length + " 位 · 锅里 " + d.stations().filter(s => s.food).length +
              " 样 · 盘上 " + d.plates().length + "/9 份 " + JSON.stringify(d.plates().map(p => p.food + ":" + (p.state === "burnt" ? "糊" : p.tier))) +
              " · 糊 " + st.burnt + " 份 · 分 " + st.score);
}

/* ══════════ ② 列对齐特写（3 列完整竖列 + 标注） ══════════
   取第 3/4/5 列（煎蛋盘 / 培根盘 / 三明治盘）：左边多留一块「注解栏」、上面留标题带、
   下面留操作提示带（缓冲区比画面大，多出来的部分专门写注解）。 */
{
  const SC = 3;
  const CX0 = 13 + 3 * 129, CW = 3 * 129 - 8;            // 第 3~5 列（400 → 779）
  const CY0 = 300, CH = 486;                             // 列头下方 → 食材桶底
  const PAD = 380, TOP = 130, BAND = 162;                // 左注解栏 / 上标题带 / 下提示带（设备像素）
  const b = boot(SC, (CW * SC + PAD) / SC, (TOP + CH * SC + BAND) / SC);
  b.B.start(b.host, { target: { id: "su", name: "苏晚晴", bond: 40 }, duration: 999, goal: 9, onFinish: () => {} });
  const d = b.B.debug;
  adv(d, 1.2);
  /* 三列摆出三种状态：煎蛋在烧、培根熟了刚落盘（热乎）、三明治在烧 */
  d.drop("egg", null); d.drop("bacon", null); d.drop("sandwich", null);
  { let g = 0; while (g++ < 260 && !d.stations()[4].plate) d.tick(1 / 60); }
  d.tick(1 / 60);
  adv(d, 1.0);                                           // 让「熟了 · 落到专属盘」飘字播完再出图
  d.setPlateAge(4, 0.4);                                 // 培根那份 → 热乎档（14 分）
  b.canvas.setTransform(SC, 0, 0, SC, PAD - CX0 * SC, TOP - CY0 * SC);
  b.texts.length = 0;
  b.pump(1, 16);
  /* 画面里落在「注解栏 / 标题带 / 提示带」那几块上的游戏文字要剔掉，否则会盖在注解上
     （文字是最后用系统字体合成上去的，光靠底板盖不住） */
  const W0 = Math.round(CW * SC + PAD), H0 = Math.round(TOP + CH * SC + BAND);
  const keep = b.texts.filter(t => t.x >= PAD - 4 && t.x <= W0 + 4 && t.y >= TOP - 4 && t.y <= TOP + CH * SC + 4);
  b.texts.length = 0; keep.forEach(t => b.texts.push(t));
  /* ── 注解：重置成设备像素坐标后直接画 ── */
  const dx = (lx) => PAD + (lx - CX0) * SC;
  const dy = (ly) => TOP + (ly - CY0) * SC;
  const colC = [3, 4, 5].map(i => dx(13 + i * 129 + 60.5));      // 三列的中心线（设备 x）
  const plateRowY = dy(378), panRowY = dy(529), bucketRowY = dy(694);
  const W = W0, H = H0;
  b.canvas.setTransform(1, 0, 0, 1, 0, 0);
  const put = (t, x, y, px, color, align) => {
    b.canvas.fillStyle = color; b.canvas.font = (px >= 26 ? "bold " : "") + px + "px 'Microsoft YaHei',sans-serif";
    b.canvas.textAlign = align || "left"; b.canvas.textBaseline = "middle";
    b.canvas.fillText(t, x, y);
    b.canvas.textAlign = "left";
  };
  const line = (x1, y1, x2, y2, color, lw) => {
    b.canvas.strokeStyle = color; b.canvas.lineWidth = lw || 3;
    b.canvas.beginPath(); b.canvas.moveTo(x1, y1); b.canvas.lineTo(x2, y2); b.canvas.stroke();
  };
  /* 左侧注解栏底板 */
  b.canvas.fillStyle = "rgba(9,6,11,.97)"; b.canvas.fillRect(0, 0, PAD, H);
  line(PAD - 1, 0, PAD - 1, H, "rgba(255,214,110,.45)", 4);
  /* 三行标签 + 指向三列的引线 */
  put("专属盘", 20, plateRowY - 30, 30, "#ffd76e");
  put("（点一下 → 送给顾客）", 20, plateRowY + 6, 18, "#cfe8ff");
  line(22, plateRowY + 34, PAD + 40, plateRowY + 34, "rgba(255,214,110,.8)", 3);
  put("锅 / 煎盘", 20, panRowY - 30, 30, "#ffd76e");
  put("（点食材 → 自动下锅）", 20, panRowY + 6, 18, "#cfe8ff");
  line(22, panRowY + 34, PAD + 40, panRowY + 34, "rgba(255,214,110,.8)", 3);
  put("食材桶", 20, bucketRowY - 30, 30, "#ffd76e");
  put("（点我下锅）", 20, bucketRowY + 6, 18, "#cfe8ff");
  line(22, bucketRowY + 34, PAD + 40, bucketRowY + 34, "rgba(255,214,110,.8)", 3);
  /* 每列的竖直中心线：证明「食材 / 锅 / 专属盘」同一 x 中心线 */
  colC.forEach(cx => line(cx, TOP + 5, cx, TOP + CH * SC - 5, "rgba(93,255,160,.55)", 2));
  put("同一 x 中心线", PAD + 8, TOP - 26, 22, "#5dffa0");
  /* 顶部标题带 */
  b.canvas.fillStyle = "rgba(9,6,11,.97)"; b.canvas.fillRect(0, 0, W, TOP);
  line(0, TOP - 1, W, TOP - 1, "rgba(255,214,110,.45)", 4);
  put("列对齐：一列 = 食材 ↔ 锅 ↔ 专属盘（三者同一条竖线）", 20, 40, 34, "#ffd76e");
  put("本图取第 3~5 列（煎蛋盘 / 培根盘 / 三明治盘）：底部食材 → 中列锅 → 上列专属盘", 20, 88, 24, "#b0a08c");
  /* 底部操作提示带 */
  const bandY = TOP + CH * SC;
  b.canvas.fillStyle = "rgba(9,6,11,.97)"; b.canvas.fillRect(0, bandY, W, BAND);
  line(0, bandY + 1, W, bandY + 1, "rgba(255,214,110,.45)", 4);
  put("操作：① 点食材 → 自动进它正上方那一列的锅　　② 点上方专属盘 → 送给正在等的顾客（优先最急的）",
    20, bandY + 48, 27, "#f6efe2");
  put("③ 双击盘 → 丢垃圾桶（不扣分）　　盘上停留超过 4.5s 会糊，糊了只能双击丢掉",
    20, bandY + 104, 27, "#ffb347");
  save(b.canvas, "bf_columns.png", b.texts,
    "特写：3 列完整竖列（食材桶 → 锅 → 专属盘 同一 x 中心线）+ 左侧「专属盘/锅/食材」注解 + 顶部列对齐说明 + 底部三条操作提示");
  console.log("    [列特写] 三列状态 " +
    JSON.stringify(d.stations().slice(3, 6).map(s => s.colFood + ":" + s.state + "/" + (s.plate ? s.plate + "@" + s.tier : "空"))));
}

/* ══════════ ③ 通过结算 ══════════ */
{
  const b = boot(1.5);
  let res = null;
  b.B.start(b.host, { target: { id: "su", name: "苏晚晴", bond: 40 }, duration: 75, goal: 8, onFinish: r => { res = r; } });
  bot(b.B);
  b.texts.length = 0;
  b.pump(1, 16);
  const st = b.B.debug.state();
  if (!st.win) throw new Error("通过路径没跑成（win=" + st.win + "）");
  b.texts.length = 0;                                 // 面板是弹层：只合成面板自己的文字
  drawPanel(b.canvas, st.result, b.B);
  save(b.canvas, "bf_pass.png", b.texts, "通过结算：服务满 8 位 + 好感上升 + 热乎度分布");
  console.log("    [通过] served=" + st.served + "/" + st.goal + " · 完美 " + st.perfect + " · 糊 " + st.burnt +
              " · 热乎度 " + JSON.stringify(st.result.heat) + " · 好感 +" + st.result.bondDelta);
}

/* ══════════ ④ 失败结算 ══════════ */
{
  const b = boot(1.5);
  b.B.start(b.host, { target: { id: "guo", name: "陈果", bond: 30 }, duration: 30, goal: 8, onFinish: () => {} });
  const d = b.B.debug;
  // 一边手忙脚乱做一点、一边让顾客等到走：失败但做出过东西（−3~−6 不虐主）
  d.drop("egg", null); d.drop("bacon", null); d.drop("congee", null);
  let g2 = 0;
  while (!d.state().over && g2++ < 30000) d.tick(0.2);
  const st = d.state();
  if (st.win !== false) throw new Error("失败路径没跑成");
  b.texts.length = 0;
  b.pump(1, 16);
  b.texts.length = 0;                                 // 面板是弹层：只合成面板自己的文字
  drawPanel(b.canvas, st.result, b.B);
  save(b.canvas, "bf_fail.png", b.texts, "失败结算：跑单/糊掉 + 好感下降（仍在 −3~−6 的台阶内）");
  console.log("    [失败] served=" + st.served + " · 糊 " + st.burnt + " · 跑单 " + st.angry +
              " · 好感 " + st.result.bondDelta + " · " + st.reason);
}

/* ══════════ ⑤ 结算出口可见性：整屏 1440×900（证明「收下早餐 · 继续」在视口里） ══════════
   断点是「1440×900 窗口里 顶栏 + 1180×790 等比画布 已经把面板撑出视口，结算面板排在画布下面
   → 被裁掉，没有任何出口」。这张图按同一档视口出整屏：
     ① 真跑 breakfast.js 打到通过 → 真 Canvas2D 回放画进「舞台区」
     ② 面板 / 结算面板 / 出口按钮的盒子按 index.html 里**真实生效的 CSS** 摆：
        #bfGameHost max-height:calc(100vh-20px)=880 居中 → .bf-result sticky bottom:0 贴底 →
        .bf-row sticky bottom:0 → 按钮永远落在面板可见底边内侧
     ③ 标出视口边界、按钮底边 y 值、以及与视口底的距离 —— 一眼能看出按钮没被裁在下面
   注：盒子位置由 CSS 推导（本沙箱起不了浏览器，没有 layout engine）；图里的游戏画面与按钮文案
       都是 breakfast.js 真跑出来的，不是画的示意图。 */
{
  const SC = 1.5;                                   // 设备像素 / CSS 像素
  const VW = 1440, VH = 900;                        // 用户实测的窗口档位
  const BAND = 200;                                 // 视口下方注解带（在视口之外，不遮挡整屏）
  const HTML_S = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
  const STYLE_S = (HTML_S.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1];
  const rule = (sel) => { const i = STYLE_S.indexOf(sel + "{"); return i < 0 ? "" : STYLE_S.slice(i + sel.length + 1, STYLE_S.indexOf("}", i)); };
  const vhCalc = (decl) => { const m = /max-height:\s*calc\(100vh\s*-\s*(\d+)px\)/.exec(decl || ""); return m ? VH - Number(m[1]) : null; };
  const panelDecl = rule("#bfGame .panel.bf-panel.bf-game-panel");
  const resDecl = rule(".bf-result");
  const rowDecl = rule(".bf-result .bf-row");
  const goDecl = rule("#bfGo");

  const b = boot(SC, VW, VH + BAND);                 // 缓冲区 = 整屏 + 注解带
  let res = null;
  b.B.start(b.host, { target: { id: "su", name: "苏晚晴", bond: 40 }, duration: 75, goal: 8, onFinish: r => { res = r; } });
  bot(b.B);
  const st = b.B.debug.state();
  if (!st.win) throw new Error("结算出口出图：通过路径没跑成（win=" + st.win + "）");

  /* ── 面板盒子（真实 CSS 推导）── */
  const padX = 14, padTop = 12, padBot = 14, border = 1;
  const panelW = Math.min(1180, VW * 0.96);
  const panelMaxH = vhCalc(panelDecl);               // 880
  const resultMaxH = vhCalc(resDecl);                // 860
  const contentW = panelW - padX * 2 - border * 2;   // 1150
  const stageH = 790 * contentW / 1180;              // 画布等比放大后的高度 770
  const barH = 48;                                   // 顶栏（标题 22px + 提示 + 收摊按钮）
  /* 结算面板内容高度：按 CSS 字号 / 行高 / 内边距逐行累加 */
  const R = st.result;
  const kv = [
    ["服务顾客", R.served + " / " + R.goal],
    ["完美份数", String(R.perfect) + (R.hot ? ("（热乎 " + R.hot + "）") : "")],
    ["热乎度", "热乎 " + R.heat.hot + " · 温 " + R.heat.warm + " · 凉 " + R.heat.cold],
    ["出餐预备", R.prepped + " 份（9 列专属盘 ×" + R.platesTotal + "）"],
    ["烧糊份数", String(R.burnt) + (R.expire ? ("（忘取 " + R.expire + "）") : "")],
    ["用时", R.elapsed.toFixed(1) + "s / " + R.duration + "s"],
    ["本局得分", String(R.score)],
    [R.target.name + " 好感", (R.bondDelta > 0 ? "+" : "") + R.bondDelta],
  ];
  const gridCols = Math.max(1, Math.floor((contentW + 22) / (250 + 22)));   // .bf-grid auto-fit minmax(250px,1fr) gap 22
  const gridRows = Math.ceil(kv.length / gridCols);
  let resContentH = 16;
  resContentH += Math.round(24 * 1.2) + 6;                                   // h3
  resContentH += Math.round(17 * 1.85) + 6 + 12;                             // .bf-q（一行）
  resContentH += gridRows * (Math.round(17 * 1.4) + 10) + 12;                // .bf-kv ×行
  resContentH += Math.round(16 * 1.9) + 10;                                  // 📌 本局影响（一行）
  resContentH += Math.round(16 * 1.9) * 2 + 10;                              // 🎯 接下来（两行）
  resContentH += 4 + 12 + 46 + 2;                                            // .bf-row margin/padding/按钮
  resContentH += 16;
  const resultH = Math.min(resultMaxH, resContentH);
  const panelContentH = padTop + barH + 8 + stageH + 8 + resultH + padBot;
  const panelH = Math.min(panelMaxH, panelContentH);
  const panelX = Math.round((VW - panelW) / 2), panelY = Math.round((VH - panelH) / 2);
  const resultBottom = panelY + panelH - border - padBot;
  const resultTop = resultBottom - resultH;
  const resultX = panelX + border + padX, resultW = contentW;
  const rowBottom = resultBottom - 16;                                     // .bf-result padding-bottom:16px
  const btnBottom = rowBottom - 2;                                          // .bf-row padding-bottom:2px
  const btnFont = 18, btnPadY = 12, btnPadX = 28;
  const btnH = btnPadY * 2 + Math.round(btnFont * 1.2);

  /* ── 先画游戏画面（真回放）到舞台区；泵这一帧同时把结算面板填上 ── */
  const stageX = panelX + border + padX, stageY = panelY + border + padTop + barH + 8;
  const gs = SC * contentW / 1180;
  b.texts.length = 0;
  b.canvas.setTransform(gs, 0, 0, gs, stageX * SC, stageY * SC);
  b.pump(1, 16);                                     // 画最后一帧（结算那一帧）+ showResult()
  /* 文字是最后用系统字体合成上去的（底板盖不住文字）：结算面板会盖住画面下半部分，
     落在那里的游戏文字必须剔掉，否则会浮在结算面板上面。 */
  const keep = b.texts.filter(t => t.y < (resultTop - 2) * SC);
  b.texts.length = 0; keep.forEach(t => b.texts.push(t));
  /* 真结算面板已经在 host 里：出口按钮文案直接读模块真建的节点（不是图里另写的） */
  const wrapEl = b.host.children[0];
  const panelEl = wrapEl.children[2];
  const rowEl = panelEl.children[panelEl.children.length - 1];
  const goEl = rowEl.children[rowEl.children.length - 1];
  const goText = goEl.textContent;                   // 「收下早餐 · 继续」
  const escText = rowEl.children[0].textContent;     // ESC 提示
  const btnW = btnPadX * 2 + Math.round(goText.replace(/\s/g, "").length * btnFont * 0.92);
  const btnX = resultX + resultW - 18 - btnW, btnY = btnBottom - btnH;

  /* ── 再画整屏外壳 / 面板 / 结算面板 / 出口按钮（设备像素） ── */
  const g = b.canvas;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const d = (v) => Math.round(v * SC);
  const put = (t, x, y, px, color, align, bold) => {
    g.fillStyle = color;
    g.font = ((bold === undefined ? px >= 26 : bold) ? "bold " : "") + Math.round(px) + "px 'Microsoft YaHei',sans-serif";
    g.textAlign = align || "left"; g.textBaseline = "middle";
    g.fillText(t, x, y); g.textAlign = "left";
  };
  const box = (x, y, w2, h2, fill, stroke, lw) => {
    if (fill) { g.fillStyle = fill; g.fillRect(x, y, w2, h2); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 2; g.beginPath(); g.rect(x, y, w2, h2); g.stroke(); }
  };
  /* 页面底 + 覆盖层蒙版（.overlay 的 rgba(4,3,8,.72)） */
  box(0, 0, d(VW), d(VH), "#060409", null);
  box(0, 0, d(VW), d(VH), "rgba(4,3,8,.72)", null);
  /* 游戏面板（.panel: rgba(14,12,22,.96) + 1px var(--line)） */
  box(d(panelX), d(panelY), d(panelW), d(panelH), "rgba(14,12,22,.96)", "rgba(120,110,160,.45)", Math.max(1, d(1)));
  /* 顶栏：标题 + 提示 + 收 摊 */
  g.save(); g.beginPath(); g.rect(d(panelX + border), d(stageY - barH - 8), d(contentW), d(barH + 8)); g.clip();
  put("🍳 早餐店 · 拼手速　→ 苏晚晴", d(stageX), d(panelY + border + padTop + 14), d(22), "#ffd76e", "left", true);
  put("① 点食材 → 自动进它正上方那一列的锅　② 点上方专属盘 → 自动送给正在等的顾客　③ 双击盘 → 丢垃圾桶",
      d(stageX), d(panelY + border + padTop + 38), d(15), "#a9a2bd", "left", false);
  box(d(panelX + panelW - padX - 96), d(panelY + border + padTop + 6), d(96), d(34), "rgba(255,214,110,.08)", "rgba(255,214,110,.45)", Math.max(1, d(1)));
  put("收 摊", d(panelX + panelW - padX - 48), d(panelY + border + padTop + 23), d(16), "#ffd76e", "center", false);
  g.restore();
  /* 结算面板（sticky 贴底）+ 内容 */
  box(d(resultX), d(resultTop), d(resultW), d(resultH), "rgba(12,9,18,.94)", R.win ? "rgba(93,255,160,.55)" : "rgba(255,77,109,.55)", Math.max(2, d(2)));
  let cy = resultTop + 16;
  put("🍳 送出热乎早餐", d(resultX + 18), d(cy + 14), d(24), "#ffd76e", "left", true);
  cy += Math.round(24 * 1.2) + 6;
  put(R.quote, d(resultX + 18), d(cy + 16), d(17), "#e8e2f2", "left", false);
  cy += Math.round(17 * 1.85) + 6 + 12;
  for (let i = 0; i < kv.length; i++) {
    const col = i % gridCols, rowI = Math.floor(i / gridCols);
    const cw = contentW / gridCols, x = resultX + 18 + col * cw, y = cy + rowI * (Math.round(17 * 1.4) + 10) + 5;
    put(kv[i][0], d(x), d(y + 10), d(17), "#a9a2bd", "left", false);
    put(String(kv[i][1]), d(x + cw - 22), d(y + 10), d(18), i === 7 ? (R.bondDelta > 0 ? "#5dffa0" : "#ff4d6d") : "#ffd76e", "right", true);
    g.strokeStyle = "rgba(120,110,160,.35)"; g.lineWidth = Math.max(1, d(1));
    g.beginPath(); g.moveTo(d(x), d(y + 20)); g.lineTo(d(x + cw - 22), d(y + 20)); g.stroke();
  }
  cy += gridRows * (Math.round(17 * 1.4) + 10) + 12;
  put("📌 本局影响 · " + R.impact, d(resultX + 18), d(cy + 15), d(16), "#a9a2bd", "left", false);
  cy += Math.round(16 * 1.9) + 10;
  put("🎯 接下来 · " + R.quota, d(resultX + 18), d(cy + 15), d(16), "#a9a2bd", "left", false);
  cy += Math.round(16 * 1.9) * 2 + 10;
  /* 出口那一行：sticky bottom:0（渐变底 + ESC 提示 + 按钮） */
  const rowTop = rowBottom - (12 + btnH + 2);
  const grad = g.createLinearGradient(0, d(rowTop), 0, d(rowBottom));
  grad.addColorStop(0, "rgba(12,9,18,0)"); grad.addColorStop(0.45, "rgba(12,9,18,.97)"); grad.addColorStop(1, "rgba(12,9,18,.97)");
  box(d(resultX), d(rowTop), d(resultW), d(rowBottom - rowTop), grad, null);
  put(escText, d(resultX + 18), d(btnY + btnH / 2), d(14), "#a9a2bd", "left", false);
  box(d(btnX), d(btnY), d(btnW), d(btnH), "rgba(93,255,160,.10)", "rgba(93,255,160,.75)", Math.max(2, d(1.5)));
  put(goText, d(btnX + btnW / 2), d(btnY + btnH / 2), d(btnFont), "#5dffa0", "center", true);
  /* ── 视口内的标记：红框圈出出口按钮（其余说明放在视口下方的注解带） ── */
  g.setLineDash([d(8), d(6)]);
  g.strokeStyle = "#ff4d6d"; g.lineWidth = Math.max(2, d(2));
  g.beginPath(); g.rect(d(btnX - 6), d(btnY - 6), d(btnW + 12), d(btnH + 12)); g.stroke();
  g.setLineDash([]);
  /* 视口边框（整屏边界 = 浏览器视口边界） */
  g.strokeStyle = "rgba(255,255,255,.5)"; g.lineWidth = Math.max(2, d(2));
  g.beginPath(); g.rect(d(1), d(1), d(VW) - d(2), d(VH) - d(2)); g.stroke();
  /* 按钮底边 → 视口底边 的余量标尺 */
  g.strokeStyle = "#5dffa0"; g.lineWidth = Math.max(1, d(1));
  g.beginPath(); g.moveTo(d(VW) - d(56), d(btnBottom)); g.lineTo(d(VW) - d(56), d(VH)); g.stroke();
  g.beginPath(); g.moveTo(d(VW) - d(62), d(btnBottom)); g.lineTo(d(VW) - d(50), d(btnBottom)); g.stroke();
  g.beginPath(); g.moveTo(d(VW) - d(62), d(VH)); g.lineTo(d(VW) - d(50), d(VH)); g.stroke();

  /* ── 视口下方注解带：整屏之外，写明每一条 CSS 兜底与实测 y 值 ── */
  const bandTop = d(VH);
  box(0, bandTop, d(VW), d(BAND), "#0b0912", null);
  box(0, bandTop, d(VW), Math.max(2, d(2)), "#ffd76e", null);
  put("▲ 以上 = 浏览器视口 " + VW + "×" + VH + "（CSS px，整屏截图；视口里除了红框没有任何注解）",
      d(20), bandTop + d(26), d(20), "#ffd76e", "left", true);
  put("· 面板 #bfGameHost：max-height:calc(100vh - 20px) = " + panelMaxH + " → 居中在 y " + panelY + " ~ " + (panelY + panelH) + "（内部可滚，画布再高也不会把出口挤出视口）",
      d(20), bandTop + d(56), d(17), "#cbd6e6", "left", false);
  put("· 结算面板 .bf-result：max-height:calc(100vh - 40px) = " + resultMaxH + " + overflow-y:auto + position:sticky;bottom:0 → 钉在面板可见底边 y " + resultTop + " ~ " + resultBottom,
      d(20), bandTop + d(82), d(17), "#cbd6e6", "left", false);
  put("· 出口那一行 .bf-row：position:sticky;bottom:0 → 按钮「" + goText + "」底边 y = " + btnBottom + " ≤ 视口 " + VH + "（距视口底还有 " + (VH - btnBottom) + " px；红框 = 按钮真实位置）",
      d(20), bandTop + d(108), d(17), "#5dffa0", "left", false);
  put("· 断点根因：原来 .bf-result 排在 1180×790 等比放大的画布下面，.panel 没有 max-height / 内滚 → 1440×900 下整块被裁在视口外，按钮与 onFinish 都够不到",
      d(20), bandTop + d(134), d(17), "#ff9ec7", "left", false);
  put("· 画面：真跑 breakfast.js 打到通过后的最后一帧（软件光栅化回放）+ 真结算面板内容；按钮文案直接读模块真建的 #bfGo 节点",
      d(20), bandTop + d(160), d(17), "#a9a2bd", "left", false);
  save(b.canvas, "bf_result_exit.png", b.texts,
    "结算出口可见性：1440×900 整屏 + 面板 max-height/sticky 的真实 CSS 推导 + 真回放的游戏画面；红框 = #bfGo「" + goText + "」按钮，底边 y=" + btnBottom + " ≤ 900");
  console.log("    [结算出口] 面板 y " + panelY + "~" + (panelY + panelH) + "（max " + panelMaxH + "）· 结算面板 y " +
              resultTop + "~" + resultBottom + " · 按钮底边 y=" + btnBottom + " ≤ 视口 " + VH +
              " · 按钮文案「" + goText + "」");
}

fs.writeFileSync(path.join(OUT, "dist", "test-results", "bf_shots_text.json"),
  JSON.stringify({ at: new Date().toISOString(), shots: manifest }, null, 1), "utf8");
fs.writeFileSync(path.join(OUT, "dist", "test-results", "breakfast-shots.json"),
  JSON.stringify({
    at: new Date().toISOString(),
    mode: BITMAP_TEXT ? "software-raster-replay+bitmap-text" : "software-raster-replay+system-font-text",
    note: "非浏览器截图：把 breakfast.js 真发出的 Canvas2D 指令在 Node 里光栅化；文字由 tools/lib/text-compose.ps1 用系统字体（微软雅黑）合成",
    files: manifest.map(m => ({ png: path.basename(m.png), note: m.note, texts: m.texts.length })),
  }, null, 1), "utf8");
console.log("[出图完成] " + manifest.length + " 张 → " + SHOT);
if (!BITMAP_TEXT) {
  const { spawnSync } = require("child_process");
  const ps = path.join(OUT, "tools/lib/text-compose.ps1");
  let r = spawnSync("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps], { stdio: "inherit" });
  if (r.error || r.status !== 0) r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps], { stdio: "inherit" });
  if (r.error || r.status !== 0) {
    console.log("[文字合成] 调用 PowerShell 失败(" + ((r.error && r.error.message) || ("exit " + r.status)) +
                ") → 请手动执行：powershell -File tools/lib/text-compose.ps1（或 node tools/bf/shots/panel.js --bitmap-text 用点阵字兜底）");
  }
}
