/* ═══════════════════════════════════════════════════════════════════════════
   tools/lib/dist.js — 产物目录（dist/）助手

   背景：测试与出图产物按约定落 `dist/test-results/`，且 `dist/` **不入库**
   （见 tools/README.md 第 2 条）。既然不入库，clone 下来就没有这个目录 ——
   而 `fs.writeFileSync` 不会自动建目录，于是「第一次跑测试」必然 ENOENT 崩掉。
   这个助手就是那条「谁写产物谁先建目录」的统一入口，避免每个脚本各写一遍。

   用法：
     const { OUT, resultsDir, resultsFile } = require("../lib/dist.js");
     fs.writeFileSync(resultsFile("breakfast-results.json"), json, "utf8");
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path");

/** 仓库根：tools/lib/ → 上两级 */
const OUT = path.join(__dirname, "..", "..");

/** 产物目录（相对仓库根），便于日志里直接打印 */
const RESULTS_REL = "dist/test-results";

/** 确保 dist/test-results 存在，返回其绝对路径 */
function resultsDir() {
  const dir = path.join(OUT, "dist", "test-results");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 确保目录存在并返回其中某个产物文件的绝对路径 */
function resultsFile(name) {
  return path.join(resultsDir(), name);
}

module.exports = { OUT, RESULTS_REL, resultsDir, resultsFile };
