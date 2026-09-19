/* ═══════════════════════════════════════════════════════════════════════════
   _bf_assets_shots.cjs — 本轮素材的出图（软件光栅化 + 系统字体合成中文）

   产物（都在 测试截图/ 下）：
     bf_game_bg.png   完整游戏画面：**背景底图 + 食材贴图 + 厨具贴图 + 头像 + UI**
                      —— 由真 breakfast.js 真发出的 Canvas2D 指令光栅化而来
     bf_gears.png     9 个厨具贴图平铺（含文件名 / 真实像素尺寸 / 不透明占比 / 用途）
     bf_faces_ui.png  6 张顾客头像 + 9 个 UI 元素平铺

   证据链同上一轮：本沙箱起不了 Chrome/Edge，所以
     breakfast.js 真跑（无头 vm）→ 它发出的每条 Canvas2D 指令进 tools/lib/raster.js
     真光栅化（drawImage 是**真实现**：现解 PNG、按当前变换 + globalAlpha 合成，
     不是 no-op）→ 文字经 __textHook 记下来，最后交给 powershell + System.Drawing
     用 Microsoft YaHei 合成回 PNG（所以图里的中文是清楚的系统字体，不是点阵）。

   运行：node _bf_assets_shots.cjs            （会顺带调用 powershell 合成文字）
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { resultsFile } = require("../../lib/dist.js");
const { createCanvas } = require("../../lib/raster.js");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "..", "..", "..");
const SHOT = path.join(OUT, "测试截图");
if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });
const VW = 1180, VH = 790;

/* ── Image 替身：src 一赋值就真去磁盘读 PNG 的 IHDR（宽高是真数据），像素交给光栅化器现解 ── */
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
    const img = { naturalWidth: 0, naturalHeight: 0, complete: false, onload: null, onerror: null, _src: "",
      get src() { return this._src; },
      set src(v) {
        this._src = String(v);
        let sz = null; try { sz = pngSize(resolveImgPath(v)); } catch (e) { sz = null; }
        if (sz) { this.naturalWidth = sz.w; this.naturalHeight = sz.h; this.complete = true; if (this.onload) this.onload({ target: this }); }
        else if (this.onerror) this.onerror({ target: this });
      } };
    return img;
  };
}
function makeEl(tag, canvas) {
  const e = {
    tagName: String(tag).toUpperCase(), children: [], parentNode: null,
    id: "", className: "", _html: "", textContent: "", type: "", value: "",
    style: {}, dataset: {}, _handlers: {},
    set innerHTML(v) { this._html = String(v); this.children = []; }, get innerHTML() { return this._html; },
    setAttribute(k, v) { if (k === "id") this.id = v; if (k === "class") this.className = v; this[k] = v; },
    getAttribute(k) { return this[k] === undefined ? null : this[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { return c; },
    addEventListener() {}, removeEventListener() {}, dispatch() {},
    all() { return []; }, querySelector() { return null; }, querySelectorAll() { return []; },
    getContext() { return this._ctx; },
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
  };
  if (e.tagName === "CANVAS") { e._ctx = canvas; canvas.canvas = e; e.width = VW; e.height = VH; }
  return e;
}
/* ── 无头 vm 里真跑 breakfast.js，画面画到给定的光栅化 canvas 上 ── */
function bootGame(canvas, texts) {
  const SRC = fs.readFileSync(path.join(OUT, "breakfast.js"), "utf8");
  canvas.__textHook = t => texts.push(t);
  const body = makeEl("body"), host = makeEl("div");
  host.id = "bfGameHost"; body.appendChild(host);
  const frames = []; let clock = 0;
  const win = {
    devicePixelRatio: 1,
    performance: { now: () => clock },
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: id => { frames[id - 1] = null; },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    addEventListener() {}, removeEventListener() {},
    document: null,
    location: { href: "file:///" + path.join(OUT, "index.html").replace(/\\/g, "/") },
    Image: ImageCtor(),
    Math: Math,
  };
  win.document = {
    body,
    createElement: tag => makeEl(tag, String(tag).toUpperCase() === "CANVAS" ? canvas : null),
    getElementById: id => (id === "bfGameHost" ? host : null),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  const ctx = vm.createContext(Object.assign(win, { console, Date, isFinite, Number, String, Object, Array }));
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(SRC + "\n;globalThis.__BF = window.Breakfast;", ctx);
  const B = ctx.__BF;
  function pump(n, ms) {
    for (let i = 0; i < n; i++) { clock += (ms === undefined ? 16 : ms); const l = frames.slice(); frames.length = 0; l.forEach(cb => cb && cb(clock)); if (!frames.length) break; }
  }
  return { B, host, canvas, texts, pump };
}

/* ═══ ① bf_game_bg.png：完整游戏画面 ═══ */
function buildGameShot() {
  const CAPTION = 46;
  const texts = [];
  const canvas = createCanvas(VW, VH + CAPTION);
  const game = bootGame(canvas, texts);
  const B = game.B, d = B.debug;
  B.start(game.host, { target: { id: "su", name: "苏晚晴", bond: 40 }, duration: 75, goal: 8, onFinish: () => {} });

  /* 三位顾客：耐心 82% / 55% / 22% → 平静 / 平静 / 着急（头像贴图按阈值切换）。
     开局那一刻还没有自动进店的顾客，所以这三张卡就是卡位 0/1/2。
     食物一律用 debug.plateNow() 一步落到盘上（**不推进游戏时间**），
     否则先做好的那份会等后面的菜等到过火糊掉。 */
  const ids = [d.pushCustomer(["congee", "egg"]), d.pushCustomer(["sandwich", "juice"]), d.pushCustomer(["bun", "soup"])];
  d.setPatience(ids[0], 0.9); d.setPatience(ids[1], 0.9); d.setPatience(ids[2], 0.9);
  /* 第 1 位顾客的煎蛋上桌 → 订单项打勾（check.png）*/
  d.drop("egg", null); d.plateNow(3); d.serveCol(3);
  /* 盘位贴图各来一份：煎蛋培根盘（bacon·热乎）/ 包子盘（bun·温）/ 糊掉的红叉盘（congee）*/
  d.drop("bacon", null); d.plateNow(4);
  d.drop("bun", null); d.plateNow(6);
  d.drop("congee", null); d.plateNow(0);
  /* 锅里留几份在烧（能看到火候进度环 + 锅具贴图）*/
  d.drop("soup", null); d.drop("salad", null); d.drop("juice", null);
  d.tick(0.6);
  d.setPlateAge(4, 0.5);                       // 热乎
  d.setPlateAge(6, 2.0);                       // 温
  d.burnPlate(0);                              // 糊 → 红叉
  const PAT = [0.82, 0.55, 0.22];
  d.faces().forEach((f, i) => d.setPatience(f.id, PAT[Math.min(i, PAT.length - 1)]));
  texts.length = 0;                            // 文字钩子会把**每一帧**的 fillText 都记下来，
  game.pump(1);                                // 所以只留最后一帧的文字（否则早期帧的提示会留在图上）
  const tex = d.tex(), faces = d.faces(), ready = B.art.ready();

  /* 底部说明条（也走文字钩子，交给 GDI 合成中文）*/
  const y0 = VH;
  canvas.fillStyle = "rgba(8,6,10,.94)"; canvas.fillRect(0, y0, VW, CAPTION);
  canvas.font = "bold 15px system-ui"; canvas.textAlign = "center"; canvas.textBaseline = "middle";
  canvas.fillStyle = "#ffe9b8";
  canvas.fillText("真跑 breakfast.js + 软件光栅化：背景 art/bg/kitchen.png 铺满（木台面上沿 y≈318）· 9 列厨具/盘位贴图 · 3 位顾客头像按耐心切换（平静/平静/着急）· 顶栏星级+金币 · 糊了红叉",
    VW / 2, y0 + 15);
  canvas.font = "12px system-ui"; canvas.fillStyle = "#cbb894";
  canvas.fillText("贴图可用 food " + ready.food + "/9 · gear " + ready.gear + "/9 · face " + ready.face + "/6 · ui " + ready.ui + "/9 · bg " + ready.bg + "/1" +
    "　｜　本帧 drawImage：背景 " + (tex.bg ? 1 : 0) + " · 锅位 " + tex.panTex + " · 盘位 " + tex.plateTex + " · 头像 " + tex.faces +
    " · 耐心条 " + tex.uiBar + "(前景 " + tex.uiBarFill + ") · 星级 " + tex.uiStars + " · 金币 " + tex.uiCoin + " · 勾 " + tex.uiCheck + " · 叉 " + tex.uiCross +
    "　｜　头像：" + faces.map(f => f.name || "矢量").join(" / "),
    VW / 2, y0 + 33);
  canvas.textAlign = "left";
  fs.writeFileSync(path.join(SHOT, "bf_game_bg.png"), canvas.toPNG());
  return { tex: tex, faces: faces, ready: ready, texts: texts };
}

/* ═══ 平铺工具：用光栅化器的 drawImage（真实现）把切片贴到棋盘底上 ═══
   art/_assets_report.json 里的 drawSize / offset 直接拿来用：每格都把**内容**
   （而不是整张 256 画布）铺到最大，顺便验证报告里的数字与文件对得上。 */
const REPORT = JSON.parse(fs.readFileSync(path.join(OUT, "art", "_assets_report.json"), "utf8"));
const REP_ITEM = {};
REPORT.groups.forEach(g => g.items.forEach(it => { REP_ITEM[g.key + "/" + it.id] = it; }));

function tileImages(cv, rows, group, padx, pady, cell, gapx, gapy, cn, cellH) {
  const ch = cellH || cell;
  let n = 0;
  cv.textAlign = "center"; cv.textBaseline = "middle";
  rows.forEach((row, ry) => row.forEach((id, rx) => {
    const file = path.join(OUT, "art", "icons", group, id + ".png");
    const sz = pngSize(file);
    const it = REP_ITEM[group + "/" + id] || null;
    const cx = padx + rx * (cell + gapx), cy = pady + ry * (ch + gapy);
    for (let y = 0; y < ch; y += 16) for (let x = 0; x < cell; x += 16) {
      const dark = ((x / 16 | 0) + (y / 16 | 0)) % 2;
      cv.fillStyle = dark ? "#2b2330" : "#3a3040";
      cv.fillRect(cx + x, cy + y, Math.min(16, cell - x), Math.min(16, ch - y));
    }
    const img = ImageCtor()();                       // 每格一个 Image（光栅化按 src 缓存，别复用）
    img.src = file;
    const ds = it ? it.drawSize : [sz.w, sz.h], off = it ? it.offset : [0, 0];
    const k = Math.min(cell / ds[0], ch / ds[1]) * 0.94;
    const drawX = cx + cell / 2 - (off[0] + ds[0] / 2) * k;
    const drawY = cy + ch / 2 - (off[1] + ds[1] / 2) * k;
    cv.drawImage(img, drawX, drawY, sz.w * k, sz.h * k);
    cv.strokeStyle = "rgba(255,214,110,.35)"; cv.lineWidth = 1;
    cv.strokeRect(cx + 0.5, cy + 0.5, cell - 1, ch - 1);
    cv.font = "bold 13px system-ui"; cv.fillStyle = "#fff3dc";
    cv.fillText(id + ".png", cx + cell / 2, cy + ch + 14);
    cv.font = "12px system-ui"; cv.fillStyle = "#d8c7a8";
    cv.fillText(sz.w + "×" + sz.h + (it ? "　不透明 " + it.coverage + "%" : ""), cx + cell / 2, cy + ch + 30);
    cv.fillStyle = "#cbb894";
    cv.fillText(cn[id] || "", cx + cell / 2, cy + ch + 46);
    n++;
  }));
  cv.textAlign = "left";
  return n;
}

const GEAR_ROWS = [
  ["pot", "griddle", "steamer"],
  ["plate_empty", "plate_egg_bacon", "plate_bun"],
  ["juice_jug", "tray", "tools"]
];
const GEAR_CN = { pot:"汤锅（3 个锅列）", griddle:"三格煎盘（3 个煎列）", steamer:"竹蒸笼（包子列）",
  plate_empty:"空盘（默认盘位）", plate_egg_bacon:"煎蛋培根盘（egg/bacon）", plate_bun:"包子盘（bun）",
  juice_jug:"果汁壶（果汁列）", tray:"木托盘（沙拉台）", tools:"锅铲+夹子（图例条右端）" };

function buildGearSheet() {
  const CELL = 200, GAPX = 44, GAPY = 82, PADX = 60, PADY = 132, COLS = 3;
  const W = PADX * 2 + COLS * CELL + (COLS - 1) * GAPX;
  const H = PADY + 3 * CELL + 2 * GAPY + 40;
  const texts = [];
  const cv = createCanvas(W, H);
  cv.__textHook = t => texts.push(t);
  cv.fillStyle = "#2a1d13"; cv.fillRect(0, 0, W, H);
  for (let i = 0; i < 60; i++) {
    cv.fillStyle = "rgba(255,205,150," + (0.02 + (i % 5) * 0.01).toFixed(3) + ")";
    cv.fillRect(0, i * (H / 60), W, 2);
  }
  cv.textAlign = "center"; cv.textBaseline = "middle";
  cv.font = "bold 20px system-ui"; cv.fillStyle = "#ffe9b8";
  cv.fillText("厨具贴图 ×9 —— art/icons/gear/*.png", W / 2, 38);
  cv.font = "14px system-ui"; cv.fillStyle = "#cbb894";
  cv.fillText("192×192 透明底，切自 art/lovart_7f81bea2418a.png（3×3 九宫格）", W / 2, 64);
  cv.fillText("锅位映射：kind → pot / griddle / steamer / tray / juice_jug", W / 2, 88);
  cv.fillText("盘位映射：空盘 plate_empty；煎蛋·培根 → plate_egg_bacon；包子 → plate_bun", W / 2, 110);
  tileImages(cv, GEAR_ROWS, "gear", PADX, PADY, CELL, GAPX, GAPY, GEAR_CN);
  fs.writeFileSync(path.join(SHOT, "bf_gears.png"), cv.toPNG());
  return { W: W, H: H, texts: texts };
}

const FACE_ROWS = [["stud_calm", "office_calm", "uncle_calm"], ["stud_urgent", "office_urgent", "uncle_urgent"]];
const FACE_CN = { stud_calm:"学生·平静（耐心>40%）", office_calm:"女白领·平静", uncle_calm:"胖大爷·平静",
  stud_urgent:"学生·着急（耐心≤40%）", office_urgent:"女白领·着急", uncle_urgent:"胖大爷·着急" };
const UI_ROWS = [["bar_empty", "bar_full", "stars"], ["btn_wood", "btn_red", "coin"], ["bulb", "check", "cross"]];
const UI_CN = { bar_empty:"耐心条底槽", bar_full:"耐心条前景(按比例裁源矩形)", stars:"三星(运行期取单颗)",
  btn_wood:"木牌按钮(顶栏·收摊)", btn_red:"红漆按钮(结算主按钮)", coin:"金币(顶栏得分)",
  bulb:"灯泡(结算·接下来)", check:"绿勾(上桌打勾/结算)", cross:"红叉(糊了)" };

function buildFacesUiSheet() {
  const PADX = 60, W = 3 * 206 + 2 * 30 + PADX * 2;
  const FCELL = 176, FCELLH = 168, FGAP = 34, ROWGAP = 62;
  const UCELL = 206, UCELLH = 168, UGAP = 52;
  const yA = 132;
  const y2 = yA + FCELLH + ROWGAP;                 // 头像第二排
  const yB = y2 + FCELLH + 62 + 44;                // UI 第一排（留出小标题的位置）
  const H = yB + 3 * UCELLH + 2 * UGAP + 74;
  const texts = [];
  const cv = createCanvas(W, H);
  cv.__textHook = t => texts.push(t);
  cv.fillStyle = "#1b1420"; cv.fillRect(0, 0, W, H);
  cv.textAlign = "center"; cv.textBaseline = "middle";
  cv.font = "bold 20px system-ui"; cv.fillStyle = "#ffe9b8";
  cv.fillText("顾客头像 ×6 ＋ UI 元素 ×9", W / 2, 38);
  cv.font = "14px system-ui"; cv.fillStyle = "#cbb894";
  cv.fillText("头像 art/icons/faces/*.png（切自 lovart_a5fddf40cc93.png，3 列 × 2 行，192×192 透明底）", W / 2, 64);
  cv.fillText("UI   art/icons/ui/*.png（切自 lovart_d72b7b15758c.png，3×3，256×256 透明底）", W / 2, 86);
  cv.font = "bold 16px system-ui"; cv.fillStyle = "#ffd76e";
  cv.fillText("顾客头像：上排 = 平静（耐心 > 40%）/ 下排 = 着急（耐心 ≤ 40%，阈值 FACE_ICON.urgentAt = 0.40）", W / 2, 114);
  tileImages(cv, FACE_ROWS, "faces", PADX, yA, FCELL, FGAP, ROWGAP, FACE_CN, FCELLH);
  cv.font = "bold 16px system-ui"; cv.fillStyle = "#ffd76e";
  cv.fillText("UI 元素：耐心条 / 星级 / 按钮 / 金币 / 灯泡 / 勾叉", W / 2, yB - 22);
  tileImages(cv, UI_ROWS, "ui", PADX, yB, UCELL, UGAP, UGAP, UI_CN, UCELLH);
  fs.writeFileSync(path.join(SHOT, "bf_faces_ui.png"), cv.toPNG());
  return { W: W, H: H, texts: texts };
}

/* ═══ 主流程：出图 → 交给 powershell 合成中文 ═══ */
const t0 = Date.now();
const game = buildGameShot();
const gears = buildGearSheet();
const faces = buildFacesUiSheet();
const kb = f => (fs.statSync(path.join(SHOT, f)).size / 1024).toFixed(1) + "KB";
console.log("[bf_game_bg.png] " + VW + "×" + (VH + 46) + "  " + kb("bf_game_bg.png") +
  "  贴图可用 food " + game.ready.food + "/9 gear " + game.ready.gear + "/9 face " + game.ready.face + "/6 ui " + game.ready.ui + "/9 bg " + game.ready.bg + "/1");
console.log("   本帧：背景 " + (game.tex.bg ? "已绘制(" + game.tex.bgMode + ")" : "未绘制") +
  " · 锅位 " + game.tex.panTex + " · 盘位 " + game.tex.plateTex + " · 头像 " + game.tex.faces +
  "(" + game.faces.map(f => f.mood).join(",") + ") · 耐心条 " + game.tex.uiBar + "/前景 " + game.tex.uiBarFill +
  " · 星级 " + game.tex.uiStars + " · 金币 " + game.tex.uiCoin + " · 勾 " + game.tex.uiCheck + " · 叉 " + game.tex.uiCross);
console.log("[bf_gears.png] " + gears.W + "×" + gears.H + "  " + kb("bf_gears.png") + "  9 张厨具 + 中文说明 " + gears.texts.length + " 段文字");
console.log("[bf_faces_ui.png] " + faces.W + "×" + faces.H + "  " + kb("bf_faces_ui.png") + "  6 头像 + 9 UI 元素 + 中文说明 " + faces.texts.length + " 段文字");

const manifest = {
  at: new Date().toISOString(),
  shots: [
    { png: path.join(SHOT, "bf_game_bg.png"), texts: game.texts },
    { png: path.join(SHOT, "bf_gears.png"), texts: gears.texts },
    { png: path.join(SHOT, "bf_faces_ui.png"), texts: faces.texts }
  ]
};
fs.writeFileSync(resultsFile("bf_assets_text.json"), JSON.stringify(manifest), "utf8");

/* 合成中文（System.Drawing + Microsoft YaHei）—— 沙箱里起 powershell 只能用 inherit
   （子进程管道在本沙箱会 EPERM）；失败就提示手动跑。 */
try {
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(OUT, "tools/lib/text-compose.ps1"), "-Manifest", resultsFile("bf_assets_text.json")],
    { cwd: OUT, stdio: ["ignore", "inherit", "inherit"] });
} catch (e) {
  console.log("⚠ 中文合成没跑成（" + (e.message || e) + "）→ 请手动执行：powershell -File tools/lib/text-compose.ps1 -Manifest tests\\bf_assets_text.json");
}
console.log("[出图完成] 测试截图/bf_game_bg.png · bf_gears.png · bf_faces_ui.png  （用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s）");
