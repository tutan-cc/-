/* 临时探针：量 🔊 语音开关 与 🎯 提示开关 的位置/尺寸（证明两个开关在面板里并列可见） */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const PROJ = path.join(__dirname);
const MSHTA = "C:\\Windows\\System32\\mshta.exe";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HTA = [
  '<!DOCTYPE html><html><head><meta http-equiv="X-UA-Compatible" content="IE=edge">',
  '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
  '<title>domprobe2</title><style>html,body{margin:0;background:#07070c}</style>',
  '<script language="JScript" src="mahjong.js"></script>',
  '<script language="JScript">',
  'var DIR = __DIR__;',
  'function wf(name, text) { var fso = new ActiveXObject("Scripting.FileSystemObject"); var ts = fso.CreateTextFile(DIR + name, true, false); ts.Write(text); ts.Close(); }',
  'function esc(s) { var o = "", i, c, h; s = String(s); for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); if (c < 128) { o += s.charAt(i); } else { h = c.toString(16); while (h.length < 4) h = "0" + h; o += "\\\\u" + h; } } return o; }',
  'function rect(el) { if (!el) return null; var r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }',
  'window.onload = function () {',
  '  try { window.moveTo(0, 0); window.resizeTo(1300, 940); } catch (e) {}',
  '  Mahjong.start(document.getElementById("mj"), {});',
  '  var b = Mahjong.debug.brainText();',
  '  var out = {',
  '    voice: rect(document.getElementById("mjmVoiceToggle")),',
  '    hint: rect(document.getElementById("mjmHintToggle")),',
  '    brain: rect(document.getElementById("mjmBrain")),',
  '    voiceText: esc(document.getElementById("mjmVoiceToggle").innerText || ""),',
  '    voiceClass: document.getElementById("mjmVoiceToggle").className,',
  '    hintText: esc(document.getElementById("mjmHintToggle").innerText || ""),',
  '    brainToggle: b.toggle, brainOn: b.on,',
  '    tingEl: rect(document.getElementById("mjmTing")),',
  '    tingClass: document.getElementById("mjmTing").className',
  '  };',
  '  wf("_mj_dom2.txt", esc(JSON.stringify(out)));',
  '  try { window.close(); } catch (e) {}',
  '};',
  '</script></head><body><div id="mj"></div></body></html>'
].join("\n");

(async () => {
  const hta = PROJ + "\\_mj_dom2.hta";
  const out = PROJ + "\\_mj_dom2.txt";
  fs.writeFileSync(hta, HTA.replace("__DIR__", JSON.stringify(PROJ + "\\")), "utf8");
  try { fs.rmSync(out, { force: true }); } catch (e) {}
  const p = spawn(MSHTA, [hta], { stdio: "ignore", cwd: PROJ });
  for (let i = 0; i < 30; i++) { await sleep(500); if (fs.existsSync(out)) break; }
  try { p.kill(); } catch (e) {}
  await sleep(200);
  if (!fs.existsSync(out)) { console.error("no dom output"); process.exit(1); }
  const raw = fs.readFileSync(out, "utf8");
  try { console.log(JSON.stringify(JSON.parse(raw), null, 1)); } catch (e) { console.log(raw); }
  try { fs.rmSync(hta, { force: true }); fs.rmSync(out, { force: true }); } catch (e) {}
})();
