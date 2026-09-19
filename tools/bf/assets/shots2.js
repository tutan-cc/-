/* ═══════════════════════════════════════════════════════════════════════════
   _bf_assets2_shots.cjs — 第二批素材的出图（软件光栅化 + 系统字体合成中文）

   产物（都在 测试截图/ 下）：
     bf_plates6.png   6 种盘面平铺（空盘 / 煎蛋 / 培根 / 三明治 / 包子 / 沙拉）
     bf_kitchen2.png  背景 v2 单独出图（带「木台面上沿 → 画布 y」标线说明）
     mj_icons9.png    麻将道具 9 张平铺（牌背 / 骰子 / 筹码 / 牌尺 / 烟灰缸 / 白板 / 發）
   说明：本沙箱起不了 Chrome/Edge，最终验收图 bf_game_bg2.png / mj_bg.png 由
        tools/bf/shots/panel2.js 出（那两张要真跑 breakfast.js / mahjong.js）。
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path");
const { createCanvas } = require("../../lib/raster.js");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "..", "..", "..");
const SHOT = path.join(OUT, "测试截图");
if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });
const REP = JSON.parse(fs.readFileSync(path.join(OUT, "art", "_assets2_report.json"), "utf8"));
const ITEM = {};
REP.groups.forEach(g => g.items.forEach(it => { ITEM[g.key + "/" + it.id] = it; }));

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG：" + file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function ImageCtor() {
  return function Image() {
    return { naturalWidth: 0, naturalHeight: 0, complete: false, onload: null, onerror: null, _src: "",
      get src() { return this._src; },
      set src(v) {
        this._src = String(v);
        let sz = null; try { sz = pngSize(v); } catch (e) { sz = null; }
        if (sz) { this.naturalWidth = sz.w; this.naturalHeight = sz.h; this.complete = true; if (this.onload) this.onload({ target: this }); }
        else if (this.onerror) this.onerror({ target: this });
      } };
  };
}
function tile(cv, rows, group, cn, opt) {
  const o = opt || {};
  const CELL = o.cell || 200, GAPX = o.gapx || 44, GAPY = o.gapy || 76, PADX = o.padx || 60, PADY = o.pady || 132;
  let n = 0;
  cv.textAlign = "center"; cv.textBaseline = "middle";
  rows.forEach((row, ry) => row.forEach((id, rx) => {
    const file = path.join(OUT, "art", "icons", group, id + ".png");
    const sz = pngSize(file);
    const it = ITEM[group + "/" + id] || null;
    const cx = PADX + rx * (CELL + GAPX), cy = PADY + ry * (CELL + GAPY);
    for (let y = 0; y < CELL; y += 20) for (let x = 0; x < CELL; x += 20) {
      const dark = ((x / 20 | 0) + (y / 20 | 0)) % 2;
      /* 盘面是白瓷 → 底用深浅棋盘，才看得出盘沿与白底的边界 */
      cv.fillStyle = dark ? "#4a4438" : "#5d5647";
      cv.fillRect(cx + x, cy + y, Math.min(20, CELL - x), Math.min(20, CELL - y));
    }
    const img = ImageCtor()();
    img.src = file;
    const k = CELL / sz.w * 0.92;
    cv.drawImage(img, cx + CELL / 2 - sz.w * k / 2, cy + CELL / 2 - sz.h * k / 2, sz.w * k, sz.h * k);
    cv.strokeStyle = "rgba(255,214,110,.40)"; cv.lineWidth = 1;
    cv.strokeRect(cx + 0.5, cy + 0.5, CELL - 1, CELL - 1);
    cv.font = "bold 15px system-ui"; cv.fillStyle = "#fff3dc";
    cv.fillText((cn[id] && cn[id][0]) || id, cx + CELL / 2, cy + CELL + 20);
    cv.font = "12px system-ui"; cv.fillStyle = "#cbb894";
    cv.fillText((cn[id] && cn[id][1]) || "", cx + CELL / 2, cy + CELL + 42);
    n++;
  }));
  return n;
}
function bg(cv, W, H, color) {
  cv.fillStyle = color || "#181119"; cv.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) { cv.fillStyle = "rgba(255,205,150," + (0.014 + (i % 5) * 0.007).toFixed(3) + ")"; cv.fillRect(0, i * (H / 70), W, 2); }
}

/* ═══ ① bf_plates6.png ═══ */
function platesSheet() {
  const CELL = 200, GAPX = 46, GAPY = 78, PADX = 62, PADY = 138, COLS = 3;
  const W = PADX * 2 + COLS * CELL + (COLS - 1) * GAPX;
  const H = PADY + 2 * (CELL + GAPY) + 46;
  const texts = [];
  const cv = createCanvas(W, H);
  cv.__textHook = t => texts.push(t);
  bg(cv, W, H, "#3b3630");
  cv.textAlign = "center"; cv.textBaseline = "middle";
  cv.font = "bold 22px system-ui"; cv.fillStyle = "#ffe9b8";
  cv.fillText("盘面贴图 ×6 —— art/icons/gear/plate_*.png（切自 art/lovart_d227a60381a7.png，3×2 六宫格）", W / 2, 40);
  cv.font = "14px system-ui"; cv.fillStyle = "#cbb894";
  cv.fillText("上一轮的缺陷：煎蛋盘与培根盘共用 plate_egg_bacon.png → 盘上分不清食材。本批 6 张一一对应，盘面自带食物", W / 2, 70);
  cv.fillText("192×192 透明底 · 白瓷盘压白底 → 专用白阈值（NW_BG=252 / T1=244）+ 内容盒外扩 1.10 保证盘沿完整", W / 2, 94);
  cv.font = "13px system-ui"; cv.fillStyle = "#9fd8ff";
  cv.fillText("映射：egg→plate_egg · bacon→plate_bacon · sandwich→plate_sandwich · bun→plate_bun · salad→plate_salad · 其余→plate_empty + 食材贴图", W / 2, 118);
  const CN = {
    plate_empty: ["空盘 plate_empty", "未放食物 / 没有专属盘贴图的食材"],
    plate_egg: ["只装煎蛋 plate_egg", "egg（煎盘列）"],
    plate_bacon: ["只装培根 plate_bacon", "bacon（煎盘列）"],
    plate_sandwich: ["只装三明治 plate_sandwich", "sandwich（木托盘列）"],
    plate_bun: ["只装包子 plate_bun", "bun（蒸笼列）"],
    plate_salad: ["只装沙拉 plate_salad", "salad（沙拉台列）"]
  };
  const n = tile(cv, [["plate_empty", "plate_egg", "plate_bacon"], ["plate_sandwich", "plate_bun", "plate_salad"]], "gear", CN,
    { cell: CELL, gapx: GAPX, gapy: GAPY, padx: PADX, pady: PADY });
  fs.writeFileSync(path.join(SHOT, "bf_plates6.png"), cv.toPNG());
  return { W, H, texts, n };
}

/* ═══ ② mj_icons9.png ═══ */
function mjSheet() {
  const CELL = 176, GAPX = 40, GAPY = 70, PADX = 58, PADY = 130, COLS = 3;
  const W = PADX * 2 + COLS * CELL + (COLS - 1) * GAPX;
  const H = PADY + 3 * (CELL + GAPY) + 44;
  const texts = [];
  const cv = createCanvas(W, H);
  cv.__textHook = t => texts.push(t);
  bg(cv, W, H, "#101a16");
  cv.textAlign = "center"; cv.textBaseline = "middle";
  cv.font = "bold 22px system-ui"; cv.fillStyle = "#ffe9b8";
  cv.fillText("麻将道具贴图 ×9 —— art/icons/mj/*.png（切自 art/lovart_cef6ccfa89a5.png，3×3 九宫格）", W / 2, 40);
  cv.font = "14px system-ui"; cv.fillStyle = "#9fd8ff";
  cv.fillText("接入优先级：牌背 tile_back（替换程序化斜纹）> 骰子 dice > 筹码 chip_* ；其余先入库备用", W / 2, 68);
  cv.fillText("256×256 透明底 · 白底→透明（NW_BG=252 / T1=244）· 每处贴图都有矢量回退，规则/AI/提示算法零改动", W / 2, 92);
  const CN = {
    tile_white: ["白板牌 tile_white", "牌面备用"],
    tile_fa: ["發牌 tile_fa", "牌面备用"],
    dice: ["两骰子 dice", "牌桌中央装饰"],
    chip_blue: ["蓝筹码 chip_blue", "筹码堆装饰"],
    chip_red: ["红筹码 chip_red", "筹码堆装饰"],
    chip_gold: ["金筹码堆 chip_gold", "筹码堆装饰"],
    tile_back: ["深蓝斜纹牌背 tile_back", "★ 已接入：对手手牌 / 牌墙背面"],
    ruler: ["木牌尺 ruler", "装饰备用"],
    ashtray: ["烟灰缸 ashtray", "装饰备用"]
  };
  const n = tile(cv, [["tile_white", "tile_fa", "dice"], ["chip_blue", "chip_red", "chip_gold"], ["tile_back", "ruler", "ashtray"]], "mj", CN,
    { cell: CELL, gapx: GAPX, gapy: GAPY, padx: PADX, pady: PADY });
  fs.writeFileSync(path.join(SHOT, "mj_icons9.png"), cv.toPNG());
  return { W, H, texts, n };
}

const t0 = Date.now();
const p = platesSheet();
const m = mjSheet();
const kb = f => (fs.statSync(path.join(SHOT, f)).size / 1024).toFixed(1) + "KB";
console.log("[bf_plates6.png] " + p.W + "×" + p.H + "  " + kb("bf_plates6.png") + "  " + p.n + " 张盘面");
console.log("[mj_icons9.png]  " + m.W + "×" + m.H + "  " + kb("mj_icons9.png") + "  " + m.n + " 张麻将道具");
const manifest = { at: new Date().toISOString(), shots: [
  { png: path.join(SHOT, "bf_plates6.png"), texts: p.texts },
  { png: path.join(SHOT, "mj_icons9.png"), texts: m.texts }] };
fs.writeFileSync(path.join(OUT, "tests", "bf_assets2_text.json"), JSON.stringify(manifest), "utf8");
try {
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(OUT, "tools/lib/text-compose.ps1"), "-Manifest", path.join(OUT, "tests", "bf_assets2_text.json")],
    { cwd: OUT, stdio: ["ignore", "inherit", "inherit"] });
} catch (e) {
  console.log("⚠ 中文合成没跑成（" + (e.message || e) + "）→ 请手动执行：powershell -File tools/lib/text-compose.ps1 -Manifest tests\\bf_assets2_text.json");
}
console.log("[出图完成] 测试截图/bf_plates6.png · mj_icons9.png   （用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s）");
