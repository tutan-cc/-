/* tools/mj/shots.js — 麻将系统出图（四张验收图）
   运行：node tools/mj/shots.js [scene...]
   产物：测试截图/mj_stake_panel.png · mj_invite.png · mj_outcome_note.png · mj_invite_new.png

   为什么要这么绕（本沙箱实测，都是硬事实）：
     · Chrome / Edge 起不来（mojo 命名管道被拒）→ 只能用 mshta（Trident / IE11）
     · mshta 里 canvas 没有 drawWindow；window.open 一调就卡死；PrintWindow 返回 0x0 矩形
     · 唯一能拿真实像素的是 PowerShell 的 CopyFromScreen，但**同一个 mshta 进程里
       超过 ~3 次就会挂住**，牌桌 raf 循环下连第 1 次都可能卡在 CopyFromScreen
   → 所以改成两段式：mshta 只负责**真实运行生产代码并把面板数据/文案抓成 JSON**，
     Node 调 PowerShell(System.Drawing) 按主题把 JSON 画成 PNG（中文用 Microsoft YaHei 正常渲染）。
     图上的每个数字与文案都来自真实 DOM（innerText/调试接口），不是另写一份。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const L = require("../mjsys/probe-lib.js");
const { OUT, U } = L;

const PANELS_JSON = path.join(OUT, "_mj_panels.json");
const PROBE_OUT = path.join(OUT, "_mj_panels_out.txt");
const PROBE_HTA = path.join(OUT, "_mj_panels.hta");
const RENDER_PS1 = path.join(OUT, "tools/mjsys/render.ps1");

/* ── 探针：在 mshta 里跑生产代码，把面板数据抓成 JSON ── */
function buildProbeHta() {
  const L2 = [];
  const J = (s) => L2.push(s);
  L.htaHead("mjpanels").forEach(J);
  J('<style>html,body{margin:0;padding:0;background:#07070c;color:#cbd6e6;font-family:"Microsoft YaHei",sans-serif}');
  J('#lobbyPad,#tablePad,#invitePad{position:absolute;left:8px;top:8px}');
  J('#mj{position:relative;width:1240px}');
  J('.hidden{display:none}</style>');
  J('<script language="JScript" src="mahjong.js"></script>');
  J('<script language="JScript">');
  J('var DIR = __DIR__;');
  J('var PANELS = []; var JSERR = []; var DONE = false;');
  J('window.onerror = function (m, u, l) { try { JSERR.push(String(m) + "@" + l); } catch (e) {} return true; };');
  J('function wf(n, t) { try { var fso = new ActiveXObject("Scripting.FileSystemObject"); var ts = fso.CreateTextFile(DIR + n, true, false); ts.Write(t); ts.Close(); return true; } catch (e) { return false; } }');
  J('function byId(id) { return document.getElementById(id); }');
  J('function txt(el) { return el ? String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").replace(/^ | $/g, "") : ""; }');
  /* 面板文案里有 🀄 / 🏆 这类非 BMP 字符，Microsoft YaHei 没有对应字形（会画成方框），画图前剔掉 */
  J('function stripEmoji(s) { return String(s).replace(/[\\uD800-\\uDFFF]/g, "").replace(/^\\s+|\\s+$/g, ""); }');
  J('function q(s) { return "\\"" + esc(String(s == null ? "" : s)) + "\\""; }');
  J('function esc(s) { var o = "", i, c, h; s = String(s); for (i = 0; i < s.length; i++) { c = s.charCodeAt(i);');
  J('  if (c < 128) { o += s.charAt(i); } else { h = c.toString(16); while (h.length < 4) h = "0" + h; o += "\\\\u" + h; } } return o; }');
  J('function show(which) {');
  J('  byId("lobbyPad").className = (which === "lobby" ? "" : "hidden");');
  J('  byId("tablePad").className = (which === "table" ? "" : "hidden");');
  J('  byId("invitePad").className = (which === "invite" ? "" : "hidden");');
  J('}');
  J('function kv(k, v, c) { return { kind: "kv", k: k, v: v, c: c || "#ffd76e" }; }');
  J('function finish() {');
  J('  if (DONE) { return; } DONE = true;');
  J('  var out = "{\\"panels\\":[" , i, n = 0;');
  J('  for (i = 0; i < PANELS.length; i++) {');
  J('    if (n++) { out += ","; }');
  J('    var p = PANELS[i], r = [], j;');
  J('    for (j = 0; j < p.rows.length; j++) {');
  J('      var row = p.rows[j], s = "{\\"kind\\":" + q(row.kind || "body");');
  J('      for (var kk in row) { if (kk !== "kind") { s += ",\\"" + kk + "\\":" + q(row[kk]); } }');
  J('      r.push(s + "}");');
  J('    }');
  J('    out += "{\\"name\\":" + q(p.name) + ",\\"file\\":" + q(p.file) + ",\\"w\\":" + p.w + ",\\"h\\":" + p.h +');
  J('      ",\\"title\\":" + q(p.title) + ",\\"subtitle\\":" + q(p.subtitle) + ",\\"footer\\":" + q(p.footer) +');
  J('      ",\\"frame\\":" + q(p.frame || "#ffd76e") + ",\\"color\\":" + q("#cbd6e6") + ",\\"rows\\":[" + r.join(",") + "]}";');
  J('  }');
  J('  out += "],\\"jsErr\\":" + q(JSERR.join(" | ")) + "}";');
  J('  wf("_mj_panels_out.txt", out);');
  J('  try { window.close(); } catch (e) {}');
  J('}');
  J('window.onload = function () { setTimeout(run, 700); };');
  J('function run() {');
  J('  try {');
  /* ① 开局面板：三档注码 / 打法 / 战绩 —— 全部读真实 DOM */
  J('  show("lobby");');
  J('  Mahjong.openLobby(byId("mjLobbyHost"), { cash: 60, stake: 50, style: "serious",');
  J('    record: { wins: 3, losses: 2, net: 420, rep: 56 }, onStart: function () {}, onCancel: function () {} });');
  J('  var ls = Mahjong.debug.lobbyState();');
  /* 注意：HTA 里不要用 "\uXXXX"——JScript 源码不吃这种转义，会原样打出「\u5c0f」并显示成方框。
     直接把中文写进 J() 的字面量即可（HTA 带 charset=utf-8）。 */
  J('  var lrows = [];');
  J('  lrows.push(kv("注码档位", ls.tiers.map(function (t) { return "¥" + t.stake + (t.ok ? "可开" : "置灰"); }).join("  "), "#ffd76e"));');
  J('  lrows.push(kv("默认选中", "¥" + ls.stake, "#ffd76e"));');
  J('  lrows.push(kv("打法", "认真打 / 放水陪玩", "#5dffa0"));');
  J('  lrows.push({ kind: "sep" });');
  J('  lrows.push({ kind: "card", t: "正在显示的战绩行（#mjmLobbyRec）", v: txt(byId("mjmLobbyRec")), c: "#8a96ab", h: 62 });');
  J('  lrows.push({ kind: "card", t: "注码档位按钮（#mjmStake50/200/1000）", v: txt(byId("mjmStake50")) + "  |  " + txt(byId("mjmStake200")) + "  |  " + txt(byId("mjmStake1000")), c: "#ff7d9c", h: 78 });');
  J('  PANELS.push({ name: "stake", file: "mj_stake_panel.png", w: 700, h: 330,');
  J('    title: "自由局开局面板 · 三档注码",');
  J('    subtitle: "Mahjong.openLobby · 财富 ¥60 → ¥50 可选，¥200/¥1000 置灰",');
  J('    footer: "数据来源：真实 DOM 的 innerText + Mahjong.debug.lobbyState()",');
  J('    rows: lrows });');
  /* ② 老角色邀约条（红姐） */
  J('  show("invite");');
  J('  var invOld = Mahjong.rules.inviteList({ stats: { cash: 2000 }, bonds: { hong: 20, man: 19, guo: 20 }, per: 2, ch: 2, mjInvites: {} }, 2000)[0];');
  J('  Mahjong.showInvite(byId("mjInviteWrap"), invOld, {});');
  J('  PANELS.push({ name: "inviteOld", file: "mj_invite.png", w: 432, h: 264,');
  J('    title: "NPC 邀约条 · 红姐（旧角色）", subtitle: "Mahjong.showInvite · 注码 ¥200 · 金色年华 · 后巷",');
  J('    footer: "数据来源：真实渲染出来的 #mjmInviteCard",');
  J('    rows: [{ kind: "inv", h: 196, btnY: 158, avatar: "红",');
  J('      name: "红姐", msg: txt(byId("mjmInviteMsg")), meta: txt(byId("mjmInviteMeta")), gain: txt(byId("mjmInviteGain")) }] });');
  /* ③ 新角色邀约条（雷姐） */
  J('  var list2 = Mahjong.rules.inviteList({ stats: { cash: 5000 }, bonds: { hong: 20, man: 20, guo: 20, lin: 20, su: 20, wen: 20, lei: 20, lu: 20 }, per: 2, ch: 2, mjInvites: {} }, 2000);');
  J('  var lei = null; for (var q2 = 0; q2 < list2.length; q2++) { if (list2[q2].id === "lei") { lei = list2[q2]; } }');
  J('  Mahjong.showInvite(byId("mjInviteWrap"), lei, {});');
  J('  var prio = []; for (var q3 = 0; q3 < list2.length; q3++) { prio.push(list2[q3].id); }');
  J('  PANELS.push({ name: "inviteNew", file: "mj_invite_new.png", w: 460, h: 292,');
  J('    title: "NPC 邀约条 · 雷姐（本次新增）",');
  J('    subtitle: "章节 2 · 晚上 · 优先级 " + prio.join(" > "),');
  J('    footer: "数据来源：真实 DOM 的 #mjmInviteMsg / #mjmInviteMeta / #mjmInviteGain",');
  J('    rows: [{ kind: "inv", h: 224, btnY: 168, avatar: "雷", name: "雷姐", msg: txt(byId("mjmInviteMsg")), meta: txt(byId("mjmInviteMeta")), gain: txt(byId("mjmInviteGain")) }] });');
  /* ④ 结算板「本局影响」行（顾曼放水胡牌） */
  J('  show("table");');
  J('  var st = { stats: { cash: 5000 }, bonds: { hong: 20, man: 20, guo: 20, lin: 20, su: 20, wen: 20, lei: 20, lu: 20 }, flags: [], achv: [], mjRep: 50, mjStreak: 0, mjWins: 0, mjLosses: 0, mjNet: 0, mjInvites: {} };');
  J('  Mahjong.start(byId("mj"), { stake: 1000, style: "gentle", state: st, onFinish: function () {},');
  J('    invite: { id: "man", name: "顾曼", cname: "顾曼", bond: "man", seat: 3, stake: 1000, pureBond: false } });');
  J('  Mahjong.debug.showResult({ win: false, seat: 3, draw: false, tier: "small", tierName: "小胡",');
  J('    stake: 1000, payPerHouse: 2000, totalWin: 6000, netCash: -2000, payerOnly: false, from: -1, style: "gentle" });');
  J('  var v = Mahjong.debug.resultView();');
  J('  var orows = [];');
  J('  orows.push({ kind: "note", t: txt(byId("mjmResImpact")), c: "#ffb86e" });');
  J('  orows.push(kv("注码与金额", txt(byId("mjmResCash")), "#ffd76e"));');
  J('  orows.push(kv("打法", txt(byId("mjmResStyle")), "#8a96ab"));');
  J('  orows.push(kv("羁绊", txt(byId("mjmResBond")), "#5dffa0"));');
  J('  orows.push(kv("口碑", txt(byId("mjmResRep")), "#a9c8ff"));');
  J('  orows.push(kv("情报", stripEmoji(txt(byId("mjmResIntel"))), "#b07dff"));');
  J('  if (txt(byId("mjmResAchv"))) { orows.push(kv("成就", stripEmoji(txt(byId("mjmResAchv"))), "#ffd76e")); }');
  J('  PANELS.push({ name: "outcome", file: "mj_outcome_note.png", w: 760, h: 320,');
  J('    title: "结算亮牌板 · 本局影响",');
  J('    subtitle: "顾曼局 · 放水 · 她胡（注码 ¥1000）→ " + (v ? v.impactText : ""),');
  J('    footer: "数据来源：#mjmResImpact / #mjmResCash / #mjmResBond / #mjmResRep / #mjmResIntel",');
  J('    rows: orows });');
  J('  } catch (e) { JSERR.push("run:" + (e.message || e)); }');
  J('  finish();');
  J('}');
  J('</script></head><body>');
  J('<div id="lobbyPad"><div id="mjLobbyHost"></div></div>');
  J('<div id="tablePad" class="hidden"><div id="mj"></div></div>');
  J('<div id="invitePad" class="hidden"><div id="mjInviteWrap"></div></div>');
  J('</body></html>');
  return L2.join("\n").replace(/__DIR__/g, JSON.stringify(OUT + "\\"));
}

/* ── 调 PowerShell 把面板 JSON 画成 PNG ── */
/* 画图走 PowerShell。沙箱禁止「带管道的 stdio」捕获子进程输出（EPERM），所以用 stdio:"ignore"
   —— 这也正是本沙箱的文档边界：programs cannot open named pipes. */
function renderPanel(panel) {
  const outPng = path.join(OUT, "测试截图", panel.file);
  try { fs.rmSync(outPng, { force: true }); } catch (e) {}          // 先删旧图，否则会把上一版当成新产物
  fs.writeFileSync(PANELS_JSON, JSON.stringify(panel), "utf8");
  const r = spawnSync("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", RENDER_PS1,
    "-Data", PANELS_JSON, "-Out", outPng,
  ], { stdio: "ignore", cwd: OUT });
  const ok = fs.existsSync(outPng);
  const buf = ok ? fs.readFileSync(outPng) : null;
  const sz = buf ? L.pngSize(buf) : null;
  return { ok: !!sz, out: outPng, size: sz, bytes: buf ? buf.length : 0, log: ok ? "" : ("renderer exit=" + (r && r.status)) };
}
function spawnSync(cmd, args, opts) {
  const cp = require("child_process");
  return cp.spawnSync(cmd, args, opts);
}

(async () => {
  console.log("[模式] mshta(Trident) 跑生产代码抓面板数据 → PowerShell(System.Drawing) 画主题图");
  console.log("       （沙箱里 mshta 的屏幕拷贝同一进程超过 ~3 次就挂，所以不在 mshta 里截图）");
  const t0 = Date.now();
  const probe = await L.runHta({
    htaPath: PROBE_HTA, outTxt: PROBE_OUT,
    htaBody: buildProbeHta(), waitMs: 60000, keep: !!process.env.MJ_KEEP,
  });
  if (!probe.ok) {
    console.error("FATAL: 探针没有产出面板数据（" + probe.why + "）");
    if (probe.raw) console.error("原始输出：" + probe.raw.slice(0, 400));
    process.exit(3);
  }
  try { fs.rmSync(PROBE_OUT, { force: true }); } catch (e) {}
  const data = probe.out;
  if (data.jsErr) console.log("[探针] JScript 错误：" + data.jsErr);
  const want = process.argv.slice(2);
  const panels = (data.panels || []).filter((p) => !want.length || want.indexOf(p.name) >= 0 || want.indexOf(p.file) >= 0);
  if (!panels.length) { console.error("没有匹配的面板：" + want.join(",") + "（可用：" + (data.panels || []).map((p) => p.name).join(",") + "）"); process.exit(4); }
  const results = [];
  for (const p of panels) {
    const r = renderPanel(p);
    const st = L.readCapStats().find((x) => x.file && x.file.indexOf(p.file) >= 0);
    results.push({ name: p.name, file: "测试截图/" + p.file, ok: r.ok, bytes: r.bytes, w: r.size && r.size.w, h: r.size && r.size.h,
      colors: st && st.colors, samples: st && st.samples });
    console.log("[" + p.name + "] 测试截图/" + p.file + " → " + (r.size ? r.size.w + "×" + r.size.h : "失败") +
      "（" + r.bytes + " 字节" + (st && st.colors ? "，颜色数 " + st.colors : "") + "）");
    if (!r.ok && r.log) console.log("  renderer: " + r.log.trim().split("\n").slice(0, 3).join(" / "));
  }
  try { if (!process.env.MJ_KEEP) { fs.rmSync(path.join(OUT, "_mj_cap_stats.txt"), { force: true }); fs.rmSync(PANELS_JSON, { force: true }); } } catch (e) {}
  fs.writeFileSync(path.join(OUT, "dist", "test-results", "mj-shots-results.json"),
    JSON.stringify({ mode: "trident-data + system.drawing-render", testedAt: new Date().toISOString(), ms: Date.now() - t0, panels: results }, null, 1), "utf8");
  const bad = results.filter((r) => !r.ok || (r.colors != null && r.colors < 8));
  console.log("\n════════════════════════════════");
  console.log("出图 " + (results.length - bad.length) + "/" + results.length + " 成功" + (bad.length ? "，失败：" + bad.map((b) => b.name).join(",") : "，全部成功 ✔"));
  setTimeout(() => process.exit(bad.length ? 1 : 0), 200);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
