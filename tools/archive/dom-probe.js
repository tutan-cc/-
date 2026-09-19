/* 临时探针：打印智脑面板头部 DOM（确认 🔊 语音开关真的在面板里且可见） */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const PROJ = path.join(__dirname, "..", "..");
const MSHTA = "C:\\Windows\\System32\\mshta.exe";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HTA = [
  '<!DOCTYPE html><html><head><meta http-equiv="X-UA-Compatible" content="IE=edge">',
  '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
  '<title>domprobe</title><style>html,body{margin:0;background:#07070c}</style>',
  '<script language="JScript" src="mahjong.js"></script>',
  '<script language="JScript">',
  'var DIR = __DIR__;',
  'function wf(name, text) { var fso = new ActiveXObject("Scripting.FileSystemObject"); var ts = fso.CreateTextFile(DIR + name, true, false); ts.Write(text); ts.Close(); }',
  'function esc(s) { var o = "", i, c, h; s = String(s); for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); if (c < 128) { o += s.charAt(i); } else { h = c.toString(16); while (h.length < 4) h = "0" + h; o += "\\\\u" + h; } } return o; }',
  'window.onload = function () {',
  '  try { window.resizeTo(1300, 940); } catch (e) {}',
  '  Mahjong.start(document.getElementById("mj"), {});',
  '  var h = document.getElementById("mjmBrainH");',
  '  var v = document.getElementById("mjmVoiceToggle");',
  '  var g = document.getElementById("mjmHintToggle");',
  '  var vb = v ? v.getBoundingClientRect() : null;',
  '  var out = {',
  '    hasH: !!h, hHtml: h ? esc(h.innerHTML) : "",',
  '    hasV: !!v, vText: v ? esc(v.innerText || v.textContent) : "",',
  '    vClass: v ? v.className : "", vRect: vb ? (Math.round(vb.left) + "," + Math.round(vb.top) + "," + Math.round(vb.width) + "x" + Math.round(vb.height)) : "none",',
  '    vDisplay: v ? v.currentStyle.display : "n/a", vVis: v ? v.currentStyle.visibility : "n/a",',
  '    hasG: !!g, gText: g ? esc(g.innerText || g.textContent) : "", gClass: g ? g.className : "",',
  '    brainW: (function () { var b = document.getElementById("mjmBrain"); return b ? Math.round(b.getBoundingClientRect().width) : -1; })()',
  '  };',
  '  wf("_mj_dom.txt", esc(JSON.stringify(out)));',
  '  try { window.close(); } catch (e) {}',
  '};',
  '</script></head><body><div id="mj"></div></body></html>'
].join("\n");

(async () => {
  const hta = PROJ + "\\_mj_dom.hta";
  const out = PROJ + "\\_mj_dom.txt";
  fs.writeFileSync(hta, HTA.replace("__DIR__", JSON.stringify(PROJ + "\\")), "utf8");
  try { fs.rmSync(out, { force: true }); } catch (e) {}
  const p = spawn(MSHTA, [hta], { stdio: "ignore", cwd: PROJ });
  for (let i = 0; i < 30; i++) { await sleep(500); if (fs.existsSync(out)) break; }
  try { p.kill(); } catch (e) {}
  await sleep(200);
  if (!fs.existsSync(out)) { console.error("no dom output"); process.exit(1); }
  const raw = fs.readFileSync(out, "utf8");
  console.log(raw);
  try { console.log(JSON.stringify(JSON.parse(raw), null, 1)); } catch (e) {}
  try { fs.rmSync(hta, { force: true }); fs.rmSync(out, { force: true }); } catch (e) {}
})();
