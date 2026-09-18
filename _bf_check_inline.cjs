/* 临时：校验 index.html 内联 <script> 语法（用 node --check 的同一套解析） */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const p = path.join(__dirname, "index.html");
const html = fs.readFileSync(p, "utf8");
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, n = 0, bad = 0;
while ((m = re.exec(html))) {
  if (/\bsrc\s*=/i.test(m[1])) continue;
  n++;
  const code = m[2];
  const line = html.slice(0, m.index).split("\n").length;
  try {
    new vm.Script(code, { filename: "index.html:inline#" + n + "@line" + line });
    console.log("  ✔ 内联脚本 #" + n + "（起始行 " + line + "，" + code.length + " 字符）语法 OK");
  } catch (e) {
    bad++;
    console.log("  ✖ 内联脚本 #" + n + "（起始行 " + line + "）语法错误: " + e.message);
  }
}
console.log("内联脚本 " + n + " 段，语法失败 " + bad);
process.exit(bad ? 1 : 0);
