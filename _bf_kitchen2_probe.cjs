/* 临时：kitchen2 方案对比（含「顶对齐 + 底补木纹」）
   A = v1 公式：台面精确 318（裁左右最多） / B = 顶对齐 + 底部木纹补带
   C = scale 0.95（左右少裁 61px） / D = 全宽（scale 0.576，底部缺口 448px，不补）
   用法：node _bf_kitchen2_probe.cjs <src.png> [counterTopY] */
"use strict";
const path = require("path"), fs = require("fs");
const G = require("./_bf_assets2_gen.cjs");
const src = process.argv[2];
const img = G.decodePNG(fs.readFileSync(src));
const VIEW = { w: 1180, h: 790 }, TARGET = 318;
const OUT = path.join(__dirname, "_probe_out");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const PX = (x, y) => { const s = (Math.min(img.h - 1, Math.max(0, y)) * img.w + Math.min(img.w - 1, Math.max(0, x))) * img.ch; return [img.data[s], img.data[s + 1], img.data[s + 2]]; };
let counterTop = process.argv[3] ? +process.argv[3] : 704;
console.log("源图 " + img.w + "×" + img.h + "  木台面上沿 源 y=" + counterTop);

/** 采样源图某行、整幅宽的平均色 */
function rowMean(y) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let x = 0; x < img.w; x += 4) { const c = PX(x, y); r += c[0]; g += c[1]; b += c[2]; n++; }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
/** 按 scale 绘制（源矩形 srcRect → 画布整幅），底部缺口用「镜像木纹带 + 渐变压暗」补齐 */
function render(name, scale, srcX, srcY, fillMode) {
  const dw = VIEW.w / 2, dh = VIEW.h / 2;
  const rgba = Buffer.alloc(dw * dh * 4);
  const rect = { x: srcX, y: srcY, w: VIEW.w / scale, h: VIEW.h / scale };
  /* 底部补带：取源图最底 1 行的上方一段做镜像，颜色按行平均渐变压暗 */
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const cx = x * 2, cy = y * 2;
    let c;
    const u = (cx) / VIEW.w, v = (cy) / VIEW.h;
    const sy = rect.y + v * rect.h, sx = rect.x + u * rect.w;
    if (sy <= img.h - 1) c = PX(Math.round(sx), Math.round(sy));
    else if (fillMode === "wood") {
      /* 镜像：以源底边为镜面 */
      const m = Math.round(img.h - 1 - (sy - (img.h - 1)));
      c = PX(Math.round(sx), m);
      const k = Math.min(1, (sy - (img.h - 1)) / 60);            // 越往下越暗
      c = [Math.round(c[0] * (1 - 0.55 * k)), Math.round(c[1] * (1 - 0.55 * k)), Math.round(c[2] * (1 - 0.55 * k))];
    } else {
      const last = rowMean(img.h - 2);
      const k = Math.min(1, (sy - (img.h - 1)) / 40);
      c = [Math.round(last[0] * (1 - 0.6 * k)), Math.round(last[1] * (1 - 0.6 * k)), Math.round(last[2] * (1 - 0.6 * k))];
    }
    const d = (y * dw + x) * 4;
    rgba[d] = c[0]; rgba[d + 1] = c[1]; rgba[d + 2] = c[2]; rgba[d + 3] = 255;
  }
  const lineY = Math.round(TARGET / 2);
  for (let x = 0; x < dw; x++) { const d = (lineY * dw + x) * 4; rgba[d] = 255; rgba[d + 1] = 40; rgba[d + 2] = 40; }
  fs.writeFileSync(path.join(OUT, name), G.encodePNG(dw, dh, rgba, 6));
  const counterCanvas = (counterTop - srcY) / rect.h * VIEW.h;
  console.log("→ " + name + "  scale=" + scale.toFixed(4) + "  源窗口 x" + srcX + " y" + srcY + " w" + Math.round(rect.w) + " h" + Math.round(rect.h) +
    "  → 画布 y=" + counterCanvas.toFixed(1) + "  底补 " + Math.max(0, (rect.y + rect.h - img.h) * scale).toFixed(0) + "px  左右各裁 " + srcX + "px");
  return counterCanvas;
}
const sV1 = (VIEW.h - TARGET) / (img.h - counterTop);
const cwV1 = Math.round(VIEW.w / sV1);
render("k2_A.png", sV1, Math.round((img.w - cwV1) / 2), Math.round(counterTop - TARGET / sV1), "flat");
/* B：同样的 scale，但源图顶边贴画布顶边，底部缺口用镜像木纹补 */
render("k2_B.png", sV1, Math.round((img.w - cwV1) / 2), 0, "wood");
/* B2：scale = 0.82（更接近「全宽」），顶对齐，底部补木纹 */
render("k2_B2.png", 0.82, Math.round((img.w - VIEW.w / 0.82) / 2), 0, "wood");
/* C：scale 0.95 台面精确 318 */
render("k2_C.png", 0.95, Math.round((img.w - VIEW.w / 0.95) / 2), Math.round(counterTop - TARGET / 0.95), "flat");
/* D：全宽（scale = VIEW.w / img.w，源图整幅宽进画面），顶对齐，底部缺口大 */
const sD = VIEW.w / img.w;
render("k2_D.png", sD, 0, 0, "wood");
/* E：scale 0.85 折中（台面 358，左右各裁 340） */
render("k2_E.png", 0.85, Math.round((img.w - VIEW.w / 0.85) / 2), Math.round(counterTop - TARGET / 0.85), "flat");
/* F：scale 0.72（台面 383，左右各裁 147） */
render("k2_F.png", 0.72, Math.round((img.w - VIEW.w / 0.72) / 2), Math.max(0, Math.round(counterTop - TARGET / 0.72)), "flat");
