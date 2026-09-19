/* ═══════════════════════════════════════════════════════════════════════════
   _bf_patch.cjs — 逐字字面替换器（严格校验 · 自动备份 · 语法检查 · 失败回滚）

   为什么要这个：本轮要改 breakfast.js / index.html 这种大文件，纪律要求
   「只许逐字字面替换，不许模糊正则、不许按锚点相对切片」。手工替换两次翻车，
   所以把纪律写成工具，每次改动都过一遍这四道闸：

     ① 唯一性：from（起始锚）与 to（结束锚）在全文中必须**恰好出现 1 次**
        —— 出现 0 次（写错字）或 ≥2 次（锚太短）都直接中止，绝不猜；
     ② 幂等：替换文本不得已经在文件里（防止同一份 job 跑两遍悄悄插两份）；
     ③ 备份：第一次写之前把原文件复制成 <file>.bf8bak（已存在则不动 → 永远是改前的那份）；
     ④ 语法闸：写完对 .js/.cjs 跑 node --check；对 .html 抽出每个内联 <script>
        块单独 node --check。任何一条不过 → 立刻用备份整文件回滚并报错退出。

   用法：
     node _bf_patch.cjs jobs.json
   jobs.json：
     { "jobs": [
         { "file":"breakfast.js", "from":"<起始锚>", "to":"<结束锚>", "textFile":"_new_a.txt" },
         { "file":"breakfast.js", "from":"<唯一片段>",                    "text":"<替换成>" }
     ] }
     · from+to  : 把 [from .. to]（含两端）整段换成 text/textFile 内容
     · 只有 from: 把 from 这一段（必须唯一）换成 text/textFile（等同精确 replace）
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), vm = require("vm");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "..");
const BAK = ".bf8bak";

function countOcc(hay, needle) {
  if (!needle) return 0;
  let n = 0, i = 0;
  for (;;) { const k = hay.indexOf(needle, i); if (k < 0) return n; n++; i = k + needle.length; }
}
/* 语法闸：用 vm.Script 在**本进程内**编译（等价 node --check，但不需要再起子进程 ——
   本沙箱里 node 子进程用管道捕获输出会 EPERM，所以不做 spawn）。 */
function checkJs(file) {
  try { new vm.Script(fs.readFileSync(file, "utf8"), { filename: file }); return ""; }
  catch (e) { return String(e.stack || e.message).split("\n").slice(0, 5).join(" ▸ "); }
}
/** 抽取 html 里的内联 <script> 块（不含 src= 的）逐个做语法检查 */
function checkHtml(file) {
  const html = fs.readFileSync(file, "utf8");
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, i = 0, bad = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bfpatch"));
  while ((m = re.exec(html))) {
    i++;
    const f = path.join(tmpDir, "inline" + i + ".js");
    fs.writeFileSync(f, m[1]);
    const err = checkJs(f);
    if (err) bad.push("内联脚本#" + i + "（" + m[1].length + " 字符）：" + err);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return { n: i, err: bad.join(" ;; ") };
}

const jobFile = process.argv[2];
if (!jobFile) { console.error("用法：node _bf_patch.cjs jobs.json [--fresh-bak]"); process.exit(2); }
const FRESH = process.argv.indexOf("--fresh-bak") >= 0;
const spec = JSON.parse(fs.readFileSync(path.resolve(OUT, jobFile), "utf8"));

/* 先把所有 job 在内存里跑一遍（全部通过才落盘 —— 避免"改了一半"的中间态）*/
const plan = new Map();                       // file → {orig, next, touched}
let step = 0;
for (const job of spec.jobs) {
  step++;
  const file = path.resolve(OUT, job.file);
  if (!plan.has(file)) plan.set(file, { orig: fs.readFileSync(file, "utf8"), next: null, file: file });
  const e = plan.get(file);
  const cur = e.next === null ? e.orig : e.next;
  const text = job.textFile ? fs.readFileSync(path.resolve(OUT, job.textFile), "utf8") : (job.text || "");
  const fromN = countOcc(cur, job.from);
  if (fromN !== 1) {
    console.error("✗ job#" + step + "（" + job.file + "）：起始锚出现 " + fromN + " 次（必须恰好 1 次）");
    console.error("  锚首 60 字：" + JSON.stringify(String(job.from).slice(0, 60)));
    process.exit(1);
  }
  const a = cur.indexOf(job.from);
  let end = a + job.from.length;
  if (job.to) {
    const toN = countOcc(cur, job.to);
    if (toN !== 1) {
      console.error("✗ job#" + step + "（" + job.file + "）：结束锚出现 " + toN + " 次（必须恰好 1 次）");
      console.error("  锚首 60 字：" + JSON.stringify(String(job.to).slice(0, 60)));
      process.exit(1);
    }
    const b = cur.indexOf(job.to);
    if (b < a) { console.error("✗ job#" + step + "（" + job.file + "）：结束锚在起始锚之前"); process.exit(1); }
    end = b + job.to.length;
  }
  if (countOcc(cur, text) > 0 && text.length > 40) {
    console.error("✗ job#" + step + "（" + job.file + "）：替换文本已经在文件里了（幂等保护，拒绝重复插入）");
    process.exit(1);
  }
  const next = cur.slice(0, a) + text + cur.slice(end);
  if (next === cur) { console.error("✗ job#" + step + "（" + job.file + "）：替换前后完全一样"); process.exit(1); }
  e.next = next;
  const removed = cur.slice(a, end);
  console.log("· job#" + step + " " + job.file + "：删 " + removed.split("\n").length + " 行 / " + removed.length +
    " 字符 → 插 " + text.split("\n").length + " 行 / " + text.length + " 字符");
}

/* 落盘（先备份；--fresh-bak 时把旧备份删掉，让备份 = 上一版好状态）*/
const written = [];
for (const [file, e] of plan) {
  const bak = file + BAK;
  if (FRESH && fs.existsSync(bak)) fs.rmSync(bak);
  if (!fs.existsSync(bak)) { fs.copyFileSync(file, bak); console.log("· 备份 → " + path.basename(bak)); }
  fs.writeFileSync(file, e.next);
  written.push(file);
}

/* 语法闸：不过就整文件回滚 */
let failed = false;
for (const file of written) {
  if (/\.(js|cjs)$/i.test(file)) {
    const err = checkJs(file);
    if (err) { console.error("✗ 语法检查失败：" + path.basename(file) + " → " + err); failed = true; }
    else console.log("· node --check " + path.basename(file) + " ✓");
  } else if (/\.html?$/i.test(file)) {
    const r = checkHtml(file);
    if (r.err) { console.error("✗ 内联脚本语法失败：" + path.basename(file) + " → " + r.err); failed = true; }
    else console.log("· index.html 内联脚本 " + r.n + " 块 node --check ✓");
  }
}
if (failed) {
  for (const file of written) {
    fs.copyFileSync(file, file + ".bfbroken");
    fs.copyFileSync(file + BAK, file);
    console.error("↩ 已回滚：" + path.basename(file) + "（坏版本留在 " + path.basename(file) + ".bfbroken 供定位）");
  }
  process.exit(1);
}
console.log("✔ " + spec.jobs.length + " 个 job 全部落盘并通过语法闸");
