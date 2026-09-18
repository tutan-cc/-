/* 临时：检查「内容包围盒」在白底素材上是否可靠（把检测到的框画成绿色矩形贴回原图） */
"use strict";
const fs = require("fs"), path = require("path");
const G = require("./_bf_assets2_gen.cjs");
const src = process.argv[2], cols = +process.argv[3] || 3, rows = +process.argv[4] || 2;
const img = G.decodePNG(fs.readFileSync(src));
const MIN3 = (x, y) => { const i = (y * img.w + x) * img.ch; return Math.min(img.data[i], img.data[i + 1], img.data[i + 2]); };
const cw = img.w / cols, chh = img.h / rows;
const TH = 236;
console.log("源 " + path.basename(src) + " " + img.w + "×" + img.h + "  格 " + cw.toFixed(1) + "×" + chh.toFixed(1));
for (let ry = 0; ry < rows; ry++) for (let rx = 0; rx < cols; rx++) {
  const ox = Math.round(rx * cw), ex = Math.round((rx + 1) * cw);
  const oy = Math.round(ry * chh), ey = Math.round((ry + 1) * chh);
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = oy; y < ey; y++) for (let x = ox; x < ex; x++) {
    if (MIN3(x, y) < TH) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  console.log("  r" + (ry + 1) + "c" + (rx + 1) + "  盒 x" + x0 + ".." + x1 + " y" + y0 + ".." + y1 +
    "  = " + (x1 - x0 + 1) + "×" + (y1 - y0 + 1) + "  内容像素 " + n +
    "  贴边(格内 " + (ex - ox) + "×" + (ey - oy) + ")" +
    ((x0 === ox || x1 === ex - 1 || y0 === oy || y1 === ey - 1) ? "  ⚠贴到格边" : ""));
  /* 画绿框 */
  for (let x = x0; x <= x1; x++) { for (const y of [y0, y1]) { const i = (y * img.w + x) * img.ch; img.data[i] = 0; img.data[i + 1] = 255; img.data[i + 2] = 0; } }
  for (let y = y0; y <= y1; y++) { for (const x of [x0, x1]) { const i = (y * img.w + x) * img.ch; img.data[i] = 0; img.data[i + 1] = 255; img.data[i + 2] = 0; } }
}
const outDir = path.join(__dirname, "_probe_out");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const dw = 720, dh = Math.round(dw * img.h / img.w);
const rgba = Buffer.alloc(dw * dh * 4);
for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
  const sx = Math.min(img.w - 1, Math.round(x * img.w / dw)), sy = Math.min(img.h - 1, Math.round(y * img.h / dh));
  const s = (sy * img.w + sx) * img.ch, d = (y * dw + x) * 4;
  rgba[d] = img.data[s]; rgba[d + 1] = img.data[s + 1]; rgba[d + 2] = img.data[s + 2]; rgba[d + 3] = 255;
}
const out = path.join(outDir, "boxes_" + path.basename(src));
fs.writeFileSync(out, G.encodePNG(dw, dh, rgba, 6));
console.log("→ " + out);
