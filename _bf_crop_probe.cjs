/* 临时探针：把 PNG 的矩形区域（或网格若干格）另存为小图，便于 read_image 目视确认。
   用法：node _bf_crop_probe.cjs <src.png> <out.png> <x> <y> <w> <h> [scale]
         node _bf_crop_probe.cjs <src.png> <outDir> --grid <cols> <rows> [scale]
*/
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
  if (depth !== 8 || interlace) throw new Error("只支持 8bit 非隔行");
  const ch = color === 0 ? 1 : color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : -1;
  if (ch < 0) throw new Error("颜色类型 " + color);
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
  return { w, h, depth, color, ch, data: out };
}
let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) { CRC_T = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
function toRGBA(img) {
  const n = img.w * img.h, out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const s = i * img.ch, d = i * 4;
    if (img.ch === 1) { out[d] = out[d + 1] = out[d + 2] = img.data[s]; out[d + 3] = 255; }
    else if (img.ch === 2) { out[d] = out[d + 1] = out[d + 2] = img.data[s]; out[d + 3] = img.data[s + 1]; }
    else if (img.ch === 3) { out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = 255; }
    else { out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = img.data[s + 3]; }
  }
  return out;
}
function cropScale(img, x, y, w, h, scale) {
  const sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale));
  const out = Buffer.alloc(sw * sh * 4);
  const rgba = toRGBA(img);
  for (let dy = 0; dy < sh; dy++) for (let dx = 0; dx < sw; dx++) {
    const sx = Math.min(img.w - 1, x + Math.floor(dx / scale)), sy = Math.min(img.h - 1, y + Math.floor(dy / scale));
    const s = (sy * img.w + sx) * 4, d = (dy * sw + dx) * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
  }
  return { w: sw, h: sh, rgba: out };
}
const a = process.argv.slice(2);
const src = a[0];
const img = decodePNG(fs.readFileSync(src));
console.log("src " + path.basename(src) + " " + img.w + "×" + img.h + " ch=" + img.ch);
if (a[2] === "--grid") {
  const cols = +a[3], rows = +a[4], scale = a[5] ? +a[5] : 1;
  const outDir = a[1];
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const cw = img.w / cols, chh = img.h / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const box = { x: Math.round(c * cw), y: Math.round(r * chh), w: Math.round(cw), h: Math.round(chh) };
    const o = cropScale(img, box.x, box.y, box.w, box.h, scale);
    const f = path.join(outDir, "r" + (r + 1) + "c" + (c + 1) + ".png");
    fs.writeFileSync(f, encodePNG(o.w, o.h, o.rgba));
    console.log("  " + f + "  " + o.w + "×" + o.h + "  源盒 " + box.x + "," + box.y + "," + box.w + "," + box.h);
  }
} else {
  const [out, x, y, w, h, scale] = [a[1], +a[2], +a[3], +a[4], +a[5], a[6] ? +a[6] : 1];
  const o = cropScale(img, x, y, w, h, scale);
  fs.writeFileSync(out, encodePNG(o.w, o.h, o.rgba));
  console.log("  → " + out + "  " + o.w + "×" + o.h);
}
