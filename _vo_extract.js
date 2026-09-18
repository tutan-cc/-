// 从 index.html 抽取所有台词，输出配音工单 JSON
const fs = require("fs");
const html = fs.readFileSync("C:/Users/chris/Desktop/重生2-原型/index.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const data = script.slice(script.indexOf("const PLACES"), script.indexOf("/* ═══════════════ 音频层"));
const lines = [];
const body = `
for (const id in NODES) {
  const n = NODES[id];
  const push = (arr, tag) => (arr||[]).forEach((s, i) => {
    if (!s.t) return;
    lines.push({ key: id + "_" + tag + i, node: id, who: s.who || "", text: s.t });
  });
  push(n.shots, "s");
  push(n.after, "a");
}
`;
eval(data + body);
fs.writeFileSync("C:/Users/chris/Desktop/重生2-原型/_vo_lines.json", JSON.stringify(lines, null, 1), "utf8");
console.log("台词条数:", lines.length);
const byWho = {};
lines.forEach(l => { byWho[l.who || "(旁白)"] = (byWho[l.who || "(旁白)"] || 0) + 1; });
console.log(byWho);
