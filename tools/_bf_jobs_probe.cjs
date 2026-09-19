/* 逐个 job 在内存里试跑 + 语法检查 → 精确定位是哪一条 job 把语法带崩了（不落盘） */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const OUT = path.join(__dirname, "..");
const jobs = JSON.parse(fs.readFileSync(path.join(OUT, process.argv[2]), "utf8")).jobs;
const file = path.join(OUT, process.argv[3] || "breakfast.js");
let cur = fs.readFileSync(file, "utf8");
const check = (src) => { try { new vm.Script(src, { filename: file }); return ""; } catch (e) { return String(e.message).split("\n")[0]; } };
console.log("起始：" + (check(cur) || "语法 OK"));
jobs.forEach((job, i) => {
  const n = (cur.match(new RegExp(job.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  if (n !== 1) { console.log("job#" + (i + 1) + " 锚出现 " + n + " 次 → 跳过"); return; }
  const text = job.textFile ? fs.readFileSync(path.join(OUT, job.textFile), "utf8") : (job.text || "");
  const a = cur.indexOf(job.from);
  let end = a + job.from.length;
  if (job.to) {
    const b = cur.indexOf(job.to);
    if (b < a) { console.log("job#" + (i + 1) + " 结束锚在前 → 跳过"); return; }
    end = b + job.to.length;
  }
  cur = cur.slice(0, a) + text + cur.slice(end);
  const err = check(cur);
  console.log("job#" + (i + 1) + " " + (err ? "✗ " + err : "✓"));
  if (err) { fs.writeFileSync(path.join(OUT, "_bf_probe_bad.js"), cur); process.exit(1); }
});
console.log("全部 job 逐个通过");
