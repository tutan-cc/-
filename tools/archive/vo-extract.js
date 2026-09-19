// 从 index.html 抽取所有台词，输出配音工单 JSON
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");   // tools/archive/ → 仓库根（自定位）
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
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
fs.writeFileSync(path.join(ROOT, "tools", "voice", "lines.json"), JSON.stringify(lines, null, 1), "utf8");
console.log("台词条数:", lines.length);
const byWho = {};
lines.forEach(l => { byWho[l.who || "(旁白)"] = (byWho[l.who || "(旁白)"] || 0) + 1; });
console.log(byWho);
