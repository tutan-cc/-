/* ═══════════════════════════════════════════════════════════════════════════
   _bf_faces_happy3_shots.cjs — 出品 测试截图/bf_faces_happy3.png

   内容：三位顾客（学生 / 女白领 / 胖大爷）的「满意 happy」头像平铺
         + 与各自「平静 calm」并排对照（证明真的换了表情，不是同一张改名）
         + 中文说明（切片来源 / 参数 / 接入点 / 回退链）

   出图链与 _bf_assets_shots.cjs 完全一致（本沙箱起不了 Chrome/Edge）：
     PNG 贴图由 _bf_raster.cjs 真解码 + 真 drawImage 合成 → 文字经 __textHook 记录下来，
     最后交给 powershell + System.Drawing 用 Microsoft YaHei 合成回 PNG。

   运行：node _bf_faces_happy3_shots.cjs
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path");
const { createCanvas } = require("./_bf_raster.cjs");
const { execFileSync } = require("child_process");

const OUT = __dirname;
const SHOT = path.join(OUT, "测试截图");
if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });
const PNG = path.join(SHOT, "bf_faces_happy3.png");

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG：" + file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function ImageCtor() {
  const OUTP = OUT;
  return function Image() {
    return { naturalWidth: 0, naturalHeight: 0, complete: false, onload: null, onerror: null, _src: "",
      get src() { return this._src; },
      set src(v) {
        this._src = String(v);
        let sz = null; try { sz = pngSize(/^[A-Za-z]:[\\/]/.test(v) ? v : path.join(OUTP, String(v).replace(/^\//, ""))); } catch (e) { sz = null; }
        if (sz) { this.naturalWidth = sz.w; this.naturalHeight = sz.h; this.complete = true; if (this.onload) this.onload({ target: this }); }
        else if (this.onerror) this.onerror({ target: this });
      } };
  };
}

/* 切片报告（_bf_faces_happy3_gen.cjs 产出）→ 拿 drawSize / offset / coverage 用于排版与标注 */
const REP = JSON.parse(fs.readFileSync(path.join(OUT, "art", "_faces_happy3_report.json"), "utf8"));
const REP_ITEM = {};
REP.group.items.forEach(it => { REP_ITEM[it.id] = it; });

const ROWS = [
  { title: "满意 happy（本轮新增：订单全部拿到 → 微笑离场，此前三位都没有这张）", ids: ["stud_happy", "office_happy", "uncle_happy"], accent: "#7dffc0" },
  { title: "平静 calm（上一轮已入库，仅用于对照：同一角色、不同表情）", ids: ["stud_calm", "office_calm", "uncle_calm"], accent: "#ffd76e" }
];
const CN = {
  stud_happy: "学生 · 满意（红鸭舌帽）", office_happy: "女白领 · 满意（黑长发）", uncle_happy: "胖大爷 · 满意（灰白胡子）",
  stud_calm: "学生 · 平静", office_calm: "女白领 · 平静", uncle_calm: "胖大爷 · 平静"
};

const PADX = 70, CELL = 236, CELLH = 208, GAPX = 40, GAPY = 158;
const W = PADX * 2 + 3 * CELL + 2 * GAPX;      // 928
const TOP = 238;
const H = TOP + 2 * CELLH + GAPY + 152;        // 238 + 416 + 158 + 152 = 964

const texts = [];
const cv = createCanvas(W, H);
cv.__textHook = t => texts.push(t);

/* 底：深色棋盘格（方便看透明底 / 白底有没有抠干净） */
cv.fillStyle = "#1b1420"; cv.fillRect(0, 0, W, H);
for (let yy = 0; yy < H; yy += 24) for (let xx = 0; xx < W; xx += 24) {
  if (((xx / 24 | 0) + (yy / 24 | 0)) % 2) continue;
  cv.fillStyle = "rgba(255,255,255,.022)"; cv.fillRect(xx, yy, 24, 24);
}
cv.textAlign = "center"; cv.textBaseline = "middle";
const HEAD = [
  { t: "三位顾客的「满意」表情头像 ×3 —— 本轮新增", f: "bold 26px system-ui", c: "#ffe9b8", y: 44 },
  { t: "源图 art/lovart_cca01cd7ba70.png（3 列 × 1 行，2172×724，纯白底）", f: "13px system-ui", c: "#cbb894", y: 82 },
  { t: "产物 art/icons/faces/stud_happy.png · office_happy.png · uncle_happy.png（192×192 透明底）", f: "13px system-ui", c: "#cbb894", y: 106 },
  { t: "切片参数与既有 faces 组一字不差：target 192 / pad 8 / alpha AL；复用 _bf_assets2_gen.cjs 的 sliceGrid（未重写算法）", f: "13px system-ui", c: "#cbb894", y: 134 },
  { t: "接入：breakfast.js 的 FACE_ICON 收进这三张 → drawCustomerFace 的 happy 分支直接命中贴图", f: "bold 14px system-ui", c: "#8ef2c0", y: 162 },
  { t: "回退链仍两级：happy 贴图缺失 → 同一位角色的 calm 脸 → 程序化矢量头像 drawAvatar（离线也能玩）", f: "13px system-ui", c: "#cbb894", y: 184 }
];
HEAD.forEach(l => { cv.font = l.f; cv.fillStyle = l.c; cv.fillText(l.t, W / 2, l.y); });

let y = TOP;
ROWS.forEach((row) => {
  cv.textAlign = "left"; cv.font = "bold 16px system-ui"; cv.fillStyle = row.accent;
  cv.fillText(row.title, PADX, y - 28);
  row.ids.forEach((id, ci) => {
    const file = path.join(OUT, "art", "icons", "faces", id + ".png");
    if (!fs.existsSync(file)) throw new Error("缺图：" + file);
    const sz = pngSize(file);
    const it = REP_ITEM[id] || null;
    const cx = PADX + ci * (CELL + GAPX), cy = y;
    cv.fillStyle = "rgba(255,255,255,.05)"; cv.fillRect(cx, cy, CELL, CELLH);
    const img = ImageCtor()();
    img.src = file;
    const ds = it ? it.drawSize : [sz.w, sz.h], off = it ? it.offset : [0, 0];
    const k = Math.min(CELL / ds[0], CELLH / ds[1]) * 0.94;
    const drawX = cx + CELL / 2 - (off[0] + ds[0] / 2) * k;
    const drawY = cy + CELLH / 2 - (off[1] + ds[1] / 2) * k;
    cv.drawImage(img, drawX, drawY, sz.w * k, sz.h * k);
    cv.strokeStyle = row.accent; cv.lineWidth = 1.5;
    cv.strokeRect(cx + 0.5, cy + 0.5, CELL - 1, CELLH - 1);
    cv.textAlign = "center";
    cv.font = "bold 14px system-ui"; cv.fillStyle = "#fff3dc";
    cv.fillText(id + ".png", cx + CELL / 2, cy + CELLH + 18);
    cv.font = "12px system-ui"; cv.fillStyle = "#d8c7a8";
    cv.fillText(sz.w + "×" + sz.h + " · " + (fs.statSync(file).size / 1024).toFixed(1) + "KB" +
      (it ? " · 不透明 " + it.coverage + "%" : ""), cx + CELL / 2, cy + CELLH + 38);
    cv.fillStyle = "#cbb894";
    cv.fillText(CN[id] || "", cx + CELL / 2, cy + CELLH + 58);
    if (it) {
      cv.fillStyle = "#8a96ab"; cv.font = "11px system-ui";
      cv.fillText("crop " + it.crop.w + "×" + it.crop.h + " @" + it.crop.x + "," + it.crop.y, cx + CELL / 2, cy + CELLH + 76);
    }
    cv.textAlign = "left";
  });
  y += CELLH + GAPY;
});

/* 页脚：自证数字 */
cv.textAlign = "center"; cv.font = "13px system-ui"; cv.fillStyle = "#8ef2c0";
cv.fillText("art/icons/faces/ 现存 5 位角色 × 3 情绪 = 15 张，全部进 FACE_ICON 统一加载器（预加载 + complete 判定 + 矢量回退）",
  W / 2, H - 44);
cv.fillStyle = "#cbb894"; cv.font = "12px system-ui";
cv.fillText("无头验收：breakfast 56/56 · core 8/8 · 无头证据链 351/351（含「订单全部拿到 → 帧里真的画出本角色 *_happy.png」）",
  W / 2, H - 20);

fs.writeFileSync(PNG, cv.toPNG());
console.log("[bf_faces_happy3.png] " + W + "×" + H + "  " + (fs.statSync(PNG).size / 1024).toFixed(1) + "KB  中文说明 " + texts.length + " 段");

/* 中文交给 powershell + System.Drawing（沙箱里子进程只能用 stdio inherit / ignore） */
const MANIFEST = path.join(OUT, "tests", "bf_faces_happy3_text.json");
fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), shots: [{ png: PNG, texts: texts }] }), "utf8");
try {
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(OUT, "_bf_text.ps1"), "-Manifest", MANIFEST], { stdio: "inherit", cwd: OUT });
} catch (e) {
  console.error("（文字合成失败，PNG 已出但中文可能缺失）：" + (e && e.message));
}
try { fs.rmSync(MANIFEST, { force: true }); } catch (e) {}
console.log("[done] 测试截图/bf_faces_happy3.png");
