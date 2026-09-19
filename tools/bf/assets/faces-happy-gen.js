/* ═══════════════════════════════════════════════════════════════════════════
   tools/bf/assets/faces-happy-gen.js — 补齐三位顾客的「满意(happy)」表情头像

   背景：art/icons/faces/ 里 fang_happy / lu_happy 已由 tools/bf/assets/gen2.js 切好，
   但 stud / office / uncle 三位**只有 calm / urgent**，于是「订单全部拿到」时
   breakfast.js 的 drawCustomerFace 走了 fallback（happy → calm → 矢量）。

   本批用 Lovart 生成了一张 **3 列 × 1 行** 的满意表情表
   （学生红色鸭舌帽 / 女白领 / 胖大爷，三人开心笑，纯白底）：
       art/lovart_cca01cd7ba70.png   2172×724

   ⚠ 本脚本**不重写**任何切片 / 去白底算法：它 require 同目录的 gen2.js，
     直接调用那里已经在用的 sliceGrid()（内容包围盒 + 全白间隙找真实格线 +
     whiteToAlphaCfg 白底转 alpha + fitCanvas 面积平均缩放 + 192×192 画布），
     参数与既有 faces 组完全一致（target 192 / pad 8 / alpha AL）。
     这样新三张与已有的 calm/urgent/happy 是同一条管线、同一套参数出来的。

   运行（仓库根）：node tools/bf/assets/faces-happy-gen.js [源图路径]
   产物：art/icons/faces/{stud,office,uncle}_happy.png  +  art/_faces_happy3_report.json
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs");
const path = require("path");
const A2 = require("./gen2.js");                     // ← 复用既有切片实现，不重写

const OUT = path.join(__dirname, "..", "..", "..");
const ART = path.join(OUT, "art");
const DEFAULT_SRC = path.join(ART, "lovart_cca01cd7ba70.png");
const SRC = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SRC;
const REPORT = path.join(ART, "_faces_happy3_report.json");

if (!fs.existsSync(SRC)) {
  console.error("✗ 源图不存在：" + SRC);
  process.exit(2);
}

/* 与既有 faces 组（tools/bf/assets/gen2.js 的 GROUPS[1]）逐项对齐：
   target/pad/out/alpha 全部照抄；只有 rows/cols/ids 按本批「3 列 × 1 行」改。 */
const GROUP = {
  key: "faces_happy3",
  src: SRC,
  rows: 1, cols: 3,
  target: 192, pad: 8,
  out: "icons/faces",
  alpha: A2.AL,
  ids: [["stud_happy", "office_happy", "uncle_happy"]]
};

const r = A2.sliceGrid(GROUP);
const report = {
  at: new Date().toISOString(),
  note: "三位顾客「满意」头像的切片参数（由 tools/bf/assets/faces-happy-gen.js 调用 tools/bf/assets/gen2.js 的 sliceGrid 自动求出，未写死）",
  reuse: "sliceGrid() / whiteToAlphaCfg() / fitCanvas() 全部来自 tools/bf/assets/gen2.js，未重写",
  source: path.relative(OUT, SRC).replace(/\\/g, "/"),
  param: { rows: GROUP.rows, cols: GROUP.cols, target: GROUP.target, pad: GROUP.pad, out: GROUP.out, alpha: GROUP.alpha },
  group: r
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

const WANT = ["stud_happy", "office_happy", "uncle_happy"];
const missing = WANT.filter(function (id) { return !fs.existsSync(path.join(ART, "icons", "faces", id + ".png")); });

console.log("\n══════ 汇总 ══════");
console.log("  源图 " + report.source + "  " + r.srcW + "×" + r.srcH + "  网格 " + r.grid.rows + " 行 × " + GROUP.cols + " 列");
r.items.forEach(function (it) {
  console.log("  " + it.file + "  " + it.target + "×" + it.target + "  " + it.kb + "KB  不透明 " + it.coverage +
    "%  crop=" + it.crop.w + ":" + it.crop.h + ":" + it.crop.x + ":" + it.crop.y + (it.warn || ""));
});
console.log("  报告 → art/_faces_happy3_report.json");
console.log(missing.length ? ("✗ 缺失：" + missing.join(", ")) : "✔ 三张 happy 头像全部就位");
process.exit(missing.length ? 1 : 0);
