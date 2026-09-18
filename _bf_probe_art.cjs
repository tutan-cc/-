/* 临时探针：读出 PNG 的 IHDR / 角像素 / 采样（判断是否有 alpha、盘子是不是白底白盘）*/
"use strict";
const fs = require("fs"), zlib = require("zlib"), path = require("path");
function decodePNG(buf) {
  let p = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0; const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data); else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace) return { w, h, depth, color, interlace, err: "unsupported" };
  const ch = color === 0 ? 1 : color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : -1;
  if (ch < 0) return { w, h, depth, color, interlace, err: "color" + color };
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(w * h * ch);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0, v = line[x];
      let r;
      if (ft === 0) r = v; else if (ft === 1) r = v + a; else if (ft === 2) r = v + b;
      else if (ft === 3) r = v + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[x] = r & 255;
    }
    cur.copy(out, y * stride); prev = cur;
  }
  return { w, h, depth, color, interlace, ch, data: out };
}
const files = process.argv.slice(2);
for (const f of files) {
  if (!fs.existsSync(f)) { console.log("MISSING " + f); continue; }
  const img = decodePNG(fs.readFileSync(f));
  const PX = (x, y) => { const i = (y * img.w + x) * img.ch; return img.ch === 1 ? [img.data[i], img.data[i], img.data[i], 255] : img.ch === 2 ? [img.data[i], img.data[i], img.data[i], img.data[i + 1]] : img.ch === 3 ? [img.data[i], img.data[i + 1], img.data[i + 2], 255] : [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]; };
  const corners = [PX(0, 0), PX(img.w - 1, 0), PX(0, img.h - 1), PX(img.w - 1, img.h - 1), PX(img.w >> 1, img.h >> 1)];
  let nTrans = 0, nWhite = 0, nOpaque = 0;
  for (let y = 0; y < img.h; y += 2) for (let x = 0; x < img.w; x += 2) {
    const c = PX(x, y);
    if (c[3] < 16) nTrans++; else { nOpaque++; if (c[0] > 245 && c[1] > 245 && c[2] > 245) nWhite++; }
  }
  console.log(path.basename(f) + "  " + img.w + "x" + img.h + " color=" + img.color + " ch=" + img.ch);
  console.log("   角/中心: " + corners.map(c => "[" + c.join(",") + "]").join(" "));
  console.log("   采样: 透明=" + nTrans + " 不透明=" + nOpaque + " 其中近白=" + nWhite);
}
