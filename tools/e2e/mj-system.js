/* ═══════════════════════════════════════════════════════════════════════════
   tools/e2e/mj-system.js — 麻将系统（赌注 / 自由局 / 打法 / 邀约 / 剧情后果 / 口碑 / 情报）浏览器实测
   运行：node tools/e2e/mj-system.js

   模式说明（本机沙箱事实）：
     · Chrome(headless CDP) 与 Edge 都起不来：沙箱禁止命名管道
       （mojo/public/cpp/platform/platform_channel.cc:108 Check failed: 拒绝访问 0x5），
       已实测 --single-process / --no-sandbox / --headless=old 三种组合全部失败。
     · 所以沿用项目已有的降级路径：mshta（Trident / IE11 引擎）真实渲染**同一份 mahjong.js**，
       跑的是生产代码（不是复刻）：openLobby / start(放水锁智脑) / 结算亮牌板（含「本局影响」行）
       / rules.applyOutcome（财富·羁绊·口碑·情报·成就·剧情后果 flag）/ showInvite（含新角色可能获得）。
     · 出图不在本脚本里做：沙箱里 mshta 的屏幕拷贝同一个进程超过 ~3 次就挂，
       四张验收图由 `node tools/mj/shots.js` 用独立进程 + System.Drawing 单独产出。

   产物：dist/test-results/mj-system-results.json
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require("fs");
const path = require("path");
const L = require("../mjsys/probe-lib.js");

const OUT = "C:\\Users\\chris\\Desktop\\重生2-原型";
const HTA_PATH = OUT + "\\_mj_sys_probe.hta";
const CAP_PS1 = OUT + "\\_mj_sys_cap.ps1";
const OUT_TXT = OUT + "\\_mj_sys_out.txt";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 中文 → JS \uXXXX 转义：直接用公共底座 tools/mjsys/probe-lib.js 的实现（HTA 文件保持纯 ASCII） */
const U = L.U;

/* ── HTA 探针（纯 ASCII：中文字面量一律 U() 转义） ── */
function buildHta() {
  const L = [];
  const J = (s) => L.push(s);
  J('<!DOCTYPE html><html><head><meta http-equiv="X-UA-Compatible" content="IE=edge">');
  J('<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>mjsys</title>');  J('<style>html,body{margin:0;padding:0;background:#07070c;color:#cbd6e6;font-family:"Microsoft YaHei",sans-serif;overflow:hidden}');
  J('#lobbyPad,#tablePad,#invitePad{position:absolute;left:8px;top:8px}');
  J('#lobbyPad{width:660px}#invitePad{width:420px}#tablePad{width:1250px}');
  J('#mj{position:relative;width:1240px}');
  J('.hidden{display:none}</style>');
  J('<script language="JScript" src="mahjong.js"></script>');
  J('<script language="JScript">');
  J('var DIR = __DIR__;');
  J('var SHOTDIR = "' + U("测试截图") + '\\\\";');
  J('var JSERR = [];');
  J('window.onerror = function (m, u, l) { try { JSERR.push(String(m) + "@" + l); } catch (e) {} return true; };');
  J('var checks = {}, errors = [], info = {}, FIN = null, FIN3 = null, STARTED = null, ACCEPTED = null, DECLINED = null;');
  J('/* 早期诊断：任何一步崩了也能看出卡在哪（LIBOK 表示 mahjong.js 已加载） */');
  J('function A(k, ok, extra) { if (ok) { checks[k] = (extra === undefined ? 1 : extra); } else { errors.push(k + (extra === undefined ? "" : (":" + extra))); }');
  J('  info[k] = (extra === undefined ? ok : extra); }');
  J('function ck(o) { var n = 0; for (var k in o) if (o.hasOwnProperty(k)) n++; return n; }');
  J('function esc(s) { var o = "", i, c, h; s = String(s); for (i = 0; i < s.length; i++) { c = s.charCodeAt(i);');
  J('  if (c < 128) { o += s.charAt(i); } else { h = c.toString(16); while (h.length < 4) h = "0" + h; o += "\\\\u" + h; } } return o; }');
  J('function wf(name, text) { var fso = new ActiveXObject("Scripting.FileSystemObject"); var ts = fso.CreateTextFile(DIR + name, true, false); ts.Write(text); ts.Close(); }');
  J('function fsize(p) { try { var fso = new ActiveXObject("Scripting.FileSystemObject"); return fso.GetFile(p).Size; } catch (e) { return -1; } }');
  J('function byId(id) { return document.getElementById(id); }');
  J('function dirtxt(id) { var e = byId(id); return e ? String(e.innerHTML || "") : ""; }');
  J('function show(which) {');
  J('  byId("lobbyPad").className = (which === "lobby" ? "" : "hidden");');
  J('  byId("tablePad").className = (which === "table" ? "" : "hidden");');
  J('  byId("invitePad").className = (which === "invite" ? "" : "hidden");');
  J('}');
  /* 「本局影响」行截图需要：牌桌结算板 + 邀约条同屏（两个 pad 都显示） */
  J('function showBoth() { byId("tablePad").className = ""; byId("invitePad").className = ""; byId("lobbyPad").className = "hidden"; }');
  J('function pix() {');
  J('  var c = document.querySelector(".mjm-cv"); if (!c) return { err: "no-canvas" };');
  J('  var g = c.getContext("2d"), W = c.width, H = c.height, d = g.getImageData(0, 0, W, H).data;');
  J('  var u = {}, hu = {}, op = 0, tot = 0, y0 = Math.floor(H * 0.78), y1 = Math.floor(H * 0.96);');
  J('  for (var y = 0; y < H; y += 2) for (var x = 0; x < W; x += 2) {');
  J('    var i = (y * W + x) * 4; tot++; if (d[i + 3] > 10) op++;');
  J('    u[(d[i] >> 4) + "-" + (d[i + 1] >> 4) + "-" + (d[i + 2] >> 4)] = 1;');
  J('    if (y >= y0 && y < y1) hu[(d[i] >> 4) + "-" + (d[i + 1] >> 4) + "-" + (d[i + 2] >> 4)] = 1;');
  J('  }');
  J('  return { w: W, h: H, ratio: Math.round(op / tot * 1000) / 1000, colors: ck(u), handColors: ck(hu) };');
  J('}');
  J('function done() {');
  J('  info.jsErrTail = JSERR.slice(-4).join(" | ");');
  J('  info.jsErrors = JSERR.join(" | "); info.fin = FIN ? { stake: FIN.stake, pay: FIN.payPerHouse, total: FIN.totalWin, net: FIN.netCash, style: FIN.style, tier: FIN.tierName, win: FIN.win } : null;');
  J('  wf("_mj_sys_out.txt", esc(JSON.stringify({ checks: checks, errors: errors, info: info })));');
  J('  try { window.close(); } catch (e) {}');
  J('}');
  J('/* INVITES 全表羁绊键（本局用的假 S 形状） */');
  J('var ALL8 = { hong: 20, man: 20, guo: 20, lin: 20, su: 20, wen: 20, lei: 20, lu: 20 };');
  J('/* 构造带完整羁绊表的假 S：o 里可覆盖任意字段 */');
  J('function mkB(o) { var b = { stats: { cash: 5000 }, bonds: {}, per: 2, mjInvites: {} }, k; for (k in ALL8) b.bonds[k] = ALL8[k]; for (k in (o || {})) b[k] = o[k]; return b; }');
  J('/* 假的 S 形状存档（与 index.html 的 newState 字段一致） */');
  J('function mkS() { return { stats: { cash: 100 }, bonds: { hong: 20, man: 20, guo: 20 }, flags: [], achv: [],');
  J('  mjRep: 50, mjStreak: 0, mjWins: 0, mjLosses: 0, mjNet: 0, mjInvites: {} }; }');
  J('var FAKE = mkS();');
  J('var INV = { id: "hong", name: "' + U("红姐") + '", bond: "hong", seat: 2, stake: 50, pureBond: false };');
  J('window.onload = function () {');
  J('  try { window.resizeTo(1340, 1000); window.moveTo(0, 0); } catch (e) {}');
  J('  setTimeout(step1, 700);');
  J('};');
  /* ── ① 开局面板：三档注码（财富不足置灰）/ 打法 / 战绩 ── */
  J('function step1() {');
  J('  try {');
  J('    show("lobby");');
  J('    var lob = byId("mjLobbyHost");');
  J('    var okL = Mahjong.openLobby(lob, { cash: 60, stake: 50, style: "serious",');
  J('      record: { wins: 3, losses: 2, net: 420, rep: 56 },');
  J('      onStart: function (o) { STARTED = o; }, onCancel: function () {} });');
  J('    A("lobby_api", okL === true, okL);');
  J('    A("lobby_dom", !!byId("mjmLobbyCard") && !!byId("mjmLobbyGo") && !!byId("mjmLobbyCancel"));');
  J('    A("lobby_tiers_dom", !!byId("mjmStake50") && !!byId("mjmStake200") && !!byId("mjmStake1000"));');
  J('    var L = Mahjong.debug.lobbyState();');
  J('    info.lobbyTiers = L.tiers.map(function (t) { return t.stake + (t.ok ? "+" : "-"); }).join("/");');
  J('    var c50 = byId("mjmStake50").className, c200 = byId("mjmStake200").className, c1000 = byId("mjmStake1000").className;');
  J('    A("lobby_tiers_all", L.tiers.length === 3 && L.tiers[0].stake === 50 && L.tiers[2].stake === 1000, info.lobbyTiers);');
  J('    A("lobby_pick_default", L.stake === 50, L.stake);');
  J('    A("lobby_grey", c50.indexOf("off") < 0 && c200.indexOf("off") >= 0 && c1000.indexOf("off") >= 0, c50 + "/" + c200 + "/" + c1000);');
  J('    A("lobby_grey_reason", dirtxt("mjmStake200").indexOf("' + U("财富不足") + '") >= 0, dirtxt("mjmStake200"));');
  J('    A("lobby_pick_ok", byId("mjmStake50").onclick() === true);');
  J('    A("lobby_pick_grey_blocked", byId("mjmStake200").onclick() === false && Mahjong.debug.lobbyState().stake === 50);');
  J('    byId("mjmStyleGentle").onclick();');
  J('    A("lobby_style_gentle", Mahjong.debug.lobbyState().style === "gentle", Mahjong.debug.lobbyState().style);');
  J('    A("lobby_record", dirtxt("mjmLobbyRec").indexOf("' + U("战绩") + '") >= 0 && dirtxt("mjmLobbyRec").indexOf("' + U("牌友口碑") + '") >= 0, dirtxt("mjmLobbyRec"));');  J('    byId("mjmLobbyGo").onclick();');
  J('    A("lobby_start_cb", !!STARTED && STARTED.stake === 50 && STARTED.style === "gentle", STARTED && (STARTED.stake + "/" + STARTED.style));');
  J('  } catch (e) { A("step1_throw", false, String(e.message || e)); }');
  J('  setTimeout(step2, 300);');
  J('}');
  /* ── ② 放水局开桌：牌桌出现 + 智脑锁死 + 提示面板写明 ── */
  J('function step2() {');
  J('  try {');
  J('    show("table");');
  J('    var host = byId("mj");');
  J('    var okS = Mahjong.start(host, { stake: (STARTED ? STARTED.stake : 50), style: (STARTED ? STARTED.style : "gentle"),');
  J('      state: FAKE, invite: INV, onFinish: function (r) { FIN = r; } });');
  J('    A("table_start", okS === true, okS);');
  J('    A("table_dom", !!document.querySelector(".mjm-cv") && !!byId("mjmBrain") && !!byId("mjmHintToggle"));');
  J('    var st = Mahjong.debug.style();');
  J('    A("gentle_style", st.style === "gentle" && st.name === "' + U("放水") + '", st.style + "/" + st.name);');
  J('    A("gentle_hint_off", st.hintOn === false && st.hintLocked === true, st.hintOn + "/" + st.hintLocked);');
  J('    A("gentle_toggle_blocked", Mahjong.debug.hintToggle(true) === false && Mahjong.debug.hintStats().on === false);');
  J('    A("gentle_hint_null", Mahjong.debug.hint() === null);');
  J('    var bt = Mahjong.debug.brainText();');
  J('    A("gentle_brain_locked", bt.locked === true && bt.toggle === "' + U("锁") + '" && bt.toggleDom === "' + U("锁") + '", bt.toggle + "/" + bt.toggleDom);');
  J('    A("gentle_brain_text", bt.panel.indexOf("' + U("放水") + '") >= 0 && bt.panel.indexOf("' + U("已关闭") + '") >= 0, bt.panel.replace(/<[^>]*>/g, ""));');
  J('    A("gentle_no_mark", bt.markDisplay === "none", bt.markDisplay);');
  J('    A("rule_text", dirtxt("mjmRule").indexOf("50") >= 0 && dirtxt("mjmRule").indexOf("' + U("放水") + '") >= 0, dirtxt("mjmRule").replace(/<[^>]*>/g, " "));');
  J('    var p = pix(); info.px = p;');
  J('    A("table_px", p.ratio > 0.85 && p.colors >= 140 && p.handColors > 200, p.ratio + "/" + p.colors + "/" + p.handColors);');
  J('    A("table_hint_gap", Mahjong.debug.renderStats().hintIdx === -1, Mahjong.debug.renderStats().hintIdx);');
  J('    A("table_force_win", Mahjong.debug.forceWin(0) === true);');
  J('    A("table_settle", Mahjong.debug.act("settle") === true);');
  J('  } catch (e) { A("step2_throw", false, String(e.message || e)); }');
  J('  setTimeout(step3, 700);');
  J('}');
  /* ── ③ 结算亮牌板：注码 / 净收支 / 打法 / 羁绊 / 口碑 / 情报 ── */
  J('function step3() {');
  J('  try {');
  J('    A("res_shown", byId("mjmRes") && byId("mjmRes").style.display === "flex", byId("mjmRes") && byId("mjmRes").style.display);');
  J('    var v = Mahjong.debug.resultView(); info.resultView = v ? { stake: v.stake, style: v.style, net: v.netCash, per: v.per, total: v.total, tiers: v.tiers.map(function (t) { return t.total; }).join("/") } : null;');
  J('    A("res_view_stake", !!v && v.stake === 50 && v.style === "gentle" && v.netCash === 300, v && (v.stake + "/" + v.style + "/" + v.netCash));');
  J('    A("res_tiers_scaled", !!v && v.tiers.map(function (t) { return t.total; }).join("/") === "300/1200/1800/3600", v && v.tiers.map(function (t) { return t.total; }).join("/"));');
  J('    var cashTxt = dirtxt("mjmResCash"), styleTxt = dirtxt("mjmResStyle");');
  J('    info.payText = cashTxt;');
  J('    A("res_cash_stake", cashTxt.indexOf("' + U("注码 ¥50") + '") >= 0, cashTxt);');
  J('    A("res_cash_per", cashTxt.indexOf("' + U("小胡 2 张") + '") >= 0 && cashTxt.indexOf("' + U("每家 ¥100") + '") >= 0 && cashTxt.indexOf("' + U("共收 ¥300") + '") >= 0, cashTxt);');
  J('    A("res_cash_net", cashTxt.indexOf("' + U("你的净收支 +¥300") + '") >= 0, cashTxt);');
  J('    A("res_style_text", styleTxt.indexOf("' + U("放水") + '") >= 0 && styleTxt.indexOf("' + U("智脑提示关闭") + '") >= 0, styleTxt);');
  J('    A("res_pay_detail", dirtxt("mjmResPay").indexOf("' + U("赔付明细") + '") >= 0);');
  J('    var bondTxt = dirtxt("mjmResBond"); info.bondText = bondTxt;');
  J('    A("res_bond_text", bondTxt.indexOf("' + U("红姐") + '") >= 0 && bondTxt.indexOf("+3") >= 0, bondTxt);');
  J('    var repTxt = dirtxt("mjmResRep"); info.repText = repTxt;');
  J('    A("res_rep_text", repTxt.indexOf("' + U("牌友口碑") + '") >= 0 && repTxt.indexOf("+1") >= 0, repTxt);');
  J('    var intelTxt = dirtxt("mjmResIntel"); info.intelText = intelTxt;');
  J('    A("res_intel_text", intelTxt.indexOf("' + U("牌桌情报") + '") >= 0 && intelTxt.indexOf("' + U("金老板的软肋") + '") >= 0 && intelTxt.indexOf("' + U("红姐的铺面情报") + '") >= 0 && intelTxt.indexOf("' + U("顾曼的底线") + '") >= 0, intelTxt);');
  J('    A("res_achv_text", dirtxt("mjmResAchv").indexOf("' + U("牌桌老千") + '") >= 0, dirtxt("mjmResAchv"));');
  J('    A("res_card_dom", !!byId("mjmResCard") && byId("mjmRes").style.display === "flex");');
  J('    var go = byId("mjmGo"); A("res_go_btn", !!go); if (go) { go.onclick(); }');
  J('    A("fin_called", !!FIN);');
  J('  } catch (e) { A("step3_throw", false, String(e.message || e)); }');
  J('  setTimeout(step4, 400);');
  J('}');
  /* ── ④ 落地（财富 / 羁绊 / 口碑 / 情报 / 成就）+ 邀约条 ── */
  J('function step4() {');
  J('  try {');
  J('    A("fin_stake", !!FIN && FIN.stake === 50, FIN && FIN.stake);');
  J('    A("fin_pay_per_house", !!FIN && FIN.payPerHouse === 100, FIN && FIN.payPerHouse);');
  J('    A("fin_total_win", !!FIN && FIN.totalWin === 300, FIN && FIN.totalWin);');
  J('    A("fin_net_cash", !!FIN && FIN.netCash === 300, FIN && FIN.netCash);');
  J('    A("fin_style", !!FIN && FIN.style === "gentle", FIN && FIN.style);');
  J('    A("fin_report", !!FIN && !!FIN.report && FIN.report.cashText.indexOf("' + U("注码 ¥50") + '") >= 0);');
  J('    var rep = Mahjong.rules.applyOutcome(FAKE, FIN, { style: "gentle", invite: INV, applyCash: true });');
  J('    info.landing = { cash: FAKE.stats.cash, hong: FAKE.bonds.hong, rep: FAKE.mjRep, streak: FAKE.mjStreak, wins: FAKE.mjWins, net: FAKE.mjNet, flags: FAKE.flags.join("/"), achv: FAKE.achv.join("/") };');
  J('    A("land_cash", FAKE.stats.cash === 400, FAKE.stats.cash);');
  J('    A("land_bond", FAKE.bonds.hong === 23, FAKE.bonds.hong);');
  J('    A("land_rep", FAKE.mjRep === 51, FAKE.mjRep);');
  J('    A("land_streak", FAKE.mjStreak === 1 && FAKE.mjWins === 1 && FAKE.mjNet === 300, FAKE.mjStreak + "/" + FAKE.mjWins + "/" + FAKE.mjNet);');
  J('    A("land_flags", FAKE.flags.length === 3 && FAKE.flags.join("/") === "' + U("红姐的铺面情报") + '/' + U("金老板的软肋") + '/' + U("顾曼的底线") + '", FAKE.flags.join("/"));');
  J('    /* 故意赢太狠（放水局也照赢）不会结梁子——梁子只在「认真」打法下产生（规则层 consequenceFlags 判定） */');
  J('    A("land_no_rival_when_gentle", FAKE.flags.join("/").indexOf("' + U("牌桌结梁子") + '") < 0, FAKE.flags.join("/"));');
  J('    A("land_achv", FAKE.achv.join("/").indexOf("mjWin") >= 0, FAKE.achv.join("/"));');
  J('    A("land_report", rep.bond.delta === 3 && rep.rep.delta === 1 && rep.flags.length === 3, rep.bond.delta + "/" + rep.rep.delta + "/" + rep.flags.length);');
  /* 破产保底：财富 40 输 100 → 最低保留 0 */
  J('    var poor = mkS(); poor.stats.cash = 40;');
  J('    var poorRes = { win: false, seat: 1, draw: false, tier: "small", tierName: "' + U("小胡") + '", stake: 50, payPerHouse: 100, totalWin: 300, netCash: -100, payerOnly: false, from: -1, style: "serious" };');
  J('    Mahjong.rules.applyOutcome(poor, poorRes, { style: "serious" });');
  J('    A("land_no_bankrupt", poor.stats.cash === 0, poor.stats.cash);');
  /* 邀约条 */
  J('    show("invite");');
  J('    var s2 = { stats: { cash: 2000 }, bonds: { hong: 20, man: 19, guo: 20 }, per: 2, flags: [], achv: [], mjRep: 50, mjStreak: 0, mjInvites: {} };');
  J('    var list = Mahjong.rules.inviteList(s2);');
  J('    info.invites = list.map(function (x) { return x.id + ":" + x.stake; }).join("/");');
  J('    A("invite_rules", list.length === 2 && list[0].id === "hong" && list[0].stake === 200 && list[1].id === "guo" && list[1].stake === 50, info.invites);');
  J('    A("invite_msg", list[0].msg.length > 0 && list[0].where.length > 0, list[0].msg);');
  J('    var okI = Mahjong.showInvite(byId("mjInviteWrap"), list[0], { onAccept: function (o) { ACCEPTED = o; }, onDecline: function (o) { DECLINED = o; } });');
  J('    A("invite_dom", okI === true && !!byId("mjmInviteCard") && !!byId("mjmInviteYes") && !!byId("mjmInviteNo"));');
  J('    A("invite_meta", dirtxt("mjmInviteMeta").indexOf("' + U("注码 ¥200") + '") >= 0 && dirtxt("mjmInviteMeta").indexOf("' + U("金色年华") + '") >= 0, dirtxt("mjmInviteMeta"));');
  J('    A("invite_msg_dom", dirtxt("mjmInviteMsg") === "' + U("三缺一，来不来？") + '", dirtxt("mjmInviteMsg"));');  J('    A("invite_accept_btn", byId("mjmInviteYes").onclick() === true && !!ACCEPTED && ACCEPTED.id === "hong", ACCEPTED && ACCEPTED.id);');
  J('    A("invite_accepted_flag", Mahjong.debug.inviteState().accepted === true);');
  J('    var s3c = { stats: { cash: 2000 }, bonds: { hong: 20, man: 20, guo: 20 }, per: 2, ch: 2, flags: [], achv: [], mjRep: 50, mjInvites: { hong: { t: 1000, mode: "accepted" } } };');
  J('    A("invite_once", Mahjong.rules.inviteList(s3c, 2000).map(function (x) { return x.id; }).join("/") === "man/guo", Mahjong.rules.inviteList(s3c, 2000).map(function (x) { return x.id; }).join("/"));');
  J('    var s3b = { stats: { cash: 2000 }, bonds: { hong: 20, man: 20, guo: 20 }, per: 2, ch: 2, flags: [], achv: [], mjRep: 50, mjInvites: { man: { t: 1000, mode: "declined" } } };');
  J('    A("invite_cooldown", Mahjong.rules.inviteList(s3b, 2000).map(function (x) { return x.id; }).join("/") === "hong/guo", Mahjong.rules.inviteList(s3b, 2000).map(function (x) { return x.id; }).join("/"));');
  J('    A("invite_cooldown_over", Mahjong.rules.inviteList(s3b, 1000 + Mahjong.rules.INVITE_COOLDOWN_MS).map(function (x) { return x.id; }).join("/") === "man/hong/guo", Mahjong.rules.inviteList(s3b, 1000 + Mahjong.rules.INVITE_COOLDOWN_MS).map(function (x) { return x.id; }).join("/"));');
  J('    A("invite_per_night", Mahjong.rules.inviteList({ stats: { cash: 2000 }, bonds: { hong: 30 }, per: 0 }, 2000).length === 0);');
  J('    A("invite_poor_grey", Mahjong.rules.inviteList({ stats: { cash: 100 }, bonds: { hong: 30 }, per: 2 }, 2000)[0].ok === false);');
  /* ── INVITES 表完整性（8 条 / 字段齐全 / 注码三档）── */
  J('    var INV8 = Mahjong.rules.INVITES;');
  J('    info.invTable = INV8.map(function (d) { return d.id + ":" + d.stake + ":ch" + d.ch + ":per" + d.per; }).join(" | ");');
  J('    A("invites_count", INV8.length === 8, INV8.length);');
  J('    A("invites_ids", INV8.map(function (d) { return d.id; }).join("/") === "hong/man/guo/lin/su/wen/lei/lu", INV8.map(function (d) { return d.id; }).join("/"));');
  J('    A("invites_stake_tiers", INV8.map(function (d) { return d.stake; }).filter(function (v) { return [50, 200, 1000].indexOf(v) < 0; }).length === 0, INV8.map(function (d) { return d.stake; }).join("/"));');
  J('    A("invites_fields", INV8.every(function (d) { return d.id && d.name && d.cname && d.bonds && d.bonds.length && d.where && d.msg && d.openLine && d.settle && d.note !== undefined && (d.per === null || [0, 1, 2].indexOf(d.per) >= 0) && (d.ch === null || (d.ch >= 1 && d.ch <= 3)); }));');
  J('    var NEW5 = ["lin", "su", "wen", "lei", "lu"];');
  J('    A("invites_intel5", NEW5.map(function (id) { return Mahjong.rules.inviteDef(id).intel; }).join("/") === "' + U("公司的人事风声/她的旧伤/她错的那道题/馆里的旧账/急诊室的秘密") + '", NEW5.map(function (id) { return Mahjong.rules.inviteDef(id).intel; }).join("/"));');
  /* ── 邀约优先级：章节 > 通用兜底 > 羁绊 > 时段 ── */
  J('    var prio3 = Mahjong.rules.inviteList(mkB({ ch: 3 }), 1000).map(function (x) { return x.id; }).join("/");');
  J('    info.prio = prio3;');
  J('    A("prio_ch3", prio3 === "hong/guo/lin/lei/wen/man", prio3);');
  J('    A("prio_ch2_man_first", Mahjong.rules.inviteList(mkB({ ch: 2, bonds: { hong: 20, man: 20, guo: 20, lin: 0, su: 0, wen: 0, lei: 0, lu: 0 } }), 1000).map(function (x) { return x.id; }).join("/") === "man/hong/guo", Mahjong.rules.inviteList(mkB({ ch: 2, bonds: { hong: 20, man: 20, guo: 20, lin: 0, su: 0, wen: 0, lei: 0, lu: 0 } }), 1000).map(function (x) { return x.id; }).join("/"));');
  J('    A("prio_ch2_new_first", Mahjong.rules.inviteList(mkB({ ch: 2 }), 1000).map(function (x) { return x.id; }).join("/") === "lin/lei/wen/man/hong/guo", Mahjong.rules.inviteList(mkB({ ch: 2 }), 1000).map(function (x) { return x.id; }).join("/"));');
  J('    A("prio_slot_one", Mahjong.rules.inviteList(mkB({ ch: 2, per: 2 }), 1000).map(function (x) { return x.id; }).indexOf("lu") < 0 && Mahjong.rules.inviteList(mkB({ ch: 2, per: 2, bonds: { hong: 0, man: 0, guo: 0, lin: 0, su: 0, wen: 0, lei: 0, lu: 20 } }), 1000).map(function (x) { return x.id; }).join("/") === "lu", Mahjong.rules.inviteList(mkB({ ch: 2, per: 2 }), 1000).map(function (x) { return x.id; }).join("/"));');
  J('    A("prio_bond_higher", Mahjong.rules.inviteList(mkB({ ch: 2, per: 2, bonds: { hong: 20, man: 20, guo: 20, lin: 0, su: 0, wen: 0, lei: 44, lu: 26 } }), 1000)[0].id === "lei", Mahjong.rules.inviteList(mkB({ ch: 2, per: 2, bonds: { hong: 20, man: 20, guo: 20, lin: 0, su: 0, wen: 0, lei: 44, lu: 26 } }), 1000)[0].id);');
  J('    A("prio_pick_one", !!Mahjong.rules.pickInvite(mkB({ ch: 2 }), 1000) && Mahjong.rules.pickInvite(mkB({ ch: 2 }), 1000).id === "lin");');
  /* ── 剧情后果：放水 / 认真 → flag 映射 ── */
  J('    var evG = Mahjong.rules.eventsOf({ win: false, seat: 3, draw: false, tier: "small", tierName: "' + U("小胡") + '", stake: 1000, netCash: -2000, payPerHouse: 2000, totalWin: 6000, payerOnly: false, from: -1, style: "gentle" }, "gentle");');
  J('    A("conseq_gu", Mahjong.rules.consequenceFlags(evG, Mahjong.rules.inviteDef("man")).join("/") === "' + U("顾曼的赏识") + '", Mahjong.rules.consequenceFlags(evG, Mahjong.rules.inviteDef("man")).join("/"));');
  J('    A("conseq_jin", Mahjong.rules.consequenceFlags(evG, { id: "jin", name: "' + U("金老板") + '", cname: "' + U("金老板") + '" }).join("/") === "' + U("金老板的信任") + '");');
  J('    var evH = Mahjong.rules.eventsOf({ win: true, seat: 0, draw: false, tier: "small", tierName: "' + U("小胡") + '", stake: 200, netCash: 1200, payPerHouse: 400, totalWin: 1200, payerOnly: false, from: -1, style: "serious" }, "serious");');
  J('    A("conseq_rival", Mahjong.rules.consequenceFlags(evH, Mahjong.rules.inviteDef("hong")).join("/") === "' + U("牌桌结梁子：红姐") + '", Mahjong.rules.consequenceFlags(evH, Mahjong.rules.inviteDef("hong")).join("/"));');
  J('    var sRival = mkS(); sRival.stats.cash = 5000;');
  J('    var repRival = Mahjong.rules.applyOutcome(sRival, { win: true, seat: 0, draw: false, tier: "small", tierName: "' + U("小胡") + '", stake: 200, payPerHouse: 400, totalWin: 1200, netCash: 1200, payerOnly: false, from: -1, style: "serious" }, { style: "serious", invite: Mahjong.rules.inviteDef("hong") });');
  J('    info.rivalLanding = sRival.flags.join("/");');
  J('    A("rival_landed", sRival.flags.indexOf("' + U("牌桌结梁子：红姐") + '") >= 0, info.rivalLanding);');
  J('    A("rival_impact", repRival.impactText.indexOf("' + U("认真打满") + '") === 0 && repRival.impactText.indexOf("' + U("牌桌结梁子：红姐") + '") >= 0, repRival.impactText);');
  J('    A("rival_bond_minus", repRival.bond.delta <= -2, repRival.bond.delta);');
  J('    A("rival_no_bond_small", (function () { var s = mkS(); s.stats.cash = 5000; var r = Mahjong.rules.applyOutcome(s, { win: true, seat: 0, draw: false, tier: "small", tierName: "' + U("小胡") + '", stake: 200, payPerHouse: 400, totalWin: 400, netCash: 400, payerOnly: false, from: -1, style: "serious" }, { style: "serious", invite: Mahjong.rules.inviteDef("hong") }); return s.flags.indexOf("' + U("牌桌结梁子") + '") < 0 && r.bond.delta === 1; })(), "认真小赢不结梁子");');
  J('    var sFlag = mkS(); sFlag.stats.cash = 5000;');
  J('    var repFlag = Mahjong.rules.applyOutcome(sFlag, evG.win === undefined ? {} : { win: false, seat: 3, draw: false, tier: "small", tierName: "' + U("小胡") + '", stake: 1000, payPerHouse: 2000, totalWin: 6000, netCash: -2000, payerOnly: false, from: -1, style: "gentle" }, { style: "gentle", invite: Mahjong.rules.inviteDef("man") });');
  J('    info.conseqLanding = sFlag.flags.join("/");');
  J('    A("conseq_landed", sFlag.flags.indexOf("' + U("顾曼的赏识") + '") >= 0, info.conseqLanding);');
  J('    A("impact_same_source", repFlag.impactText.indexOf("' + U("放水陪玩") + '") === 0 && repFlag.impactText.indexOf("' + U("顾曼好感 +6") + '") >= 0 && repFlag.impact.flag === "' + U("顾曼的赏识") + '", repFlag.impactText);');
  J('    A("impact_lines", repFlag.lines.join("|").indexOf("' + U("本局影响") + '") >= 0, repFlag.lines.join(" | "));');
  J('    var pvSame = Mahjong.rules.previewOutcome(mkS(), { win: false, seat: 3, draw: false, tier: "small", tierName: "' + U("小胡") + '", stake: 1000, payPerHouse: 2000, totalWin: 6000, netCash: -2000, payerOnly: false, from: -1, style: "gentle" }, { style: "gentle", invite: Mahjong.rules.inviteDef("man") });');
  J('    A("impact_preview_equals_apply", pvSame.impactText === repFlag.impactText, pvSame.impactText + " vs " + repFlag.impactText);');
  /* ── 5 条新情报解锁映射 ── */
  J('    var intelOK = true, intelLog = [];');
  J('    for (var q = 0; q < NEW5.length; q++) {');
  J('      var did = NEW5[q], dd = Mahjong.rules.inviteDef(did), ss = mkS(); ss.stats.cash = 5000;');
  J('      Mahjong.rules.applyOutcome(ss, { win: true, seat: 0, draw: false, tier: "small", tierName: "' + U("小胡") + '", stake: dd.stake, payPerHouse: dd.stake * 2, totalWin: dd.stake * 6, netCash: dd.stake * 2, payerOnly: false, from: -1, style: "serious" }, { style: "serious", invite: { id: dd.id, name: dd.name, cname: dd.cname, bond: dd.bond, seat: -1, stake: dd.stake, pureBond: false } });');
  J('      if (ss.flags.indexOf(dd.intel) < 0) { intelOK = false; }');
  J('      intelLog.push(did + "->" + dd.intel);');
  J('    }');
  J('    info.intel5 = intelLog.join(" | ");');
  J('    A("intel5_unlocked", intelOK, info.intel5);');
  J('    A("intel5_reverse", NEW5.every(function (id) { return Mahjong.rules.inviteIdByIntel(Mahjong.rules.inviteDef(id).intel) === id; }));');
  J('    var s4 = mkS();');
  J('    var invRes = { win: false, seat: 2, draw: false, tier: "small", tierName: "' + U("小胡") + '", stake: 200, payPerHouse: 400, totalWin: 1200, netCash: -400, payerOnly: false, from: -1, style: "gentle" };');
  J('    var inv2 = { id: "hong", name: "' + U("红姐") + '", bond: "hong", seat: 2, stake: 200, pureBond: false };');
  J('    var r2 = Mahjong.rules.applyOutcome(s4, invRes, { style: "gentle", invite: inv2, applyCash: true });');
  J('    A("invite_bond_win", s4.bonds.hong === 26 && r2.bond.delta === 6, s4.bonds.hong + "/" + r2.bond.delta);');
  J('    A("invite_intel", s4.flags.join("/") === "' + U("红姐的铺面情报") + '", s4.flags.join("/"));');
  J('    A("invite_cash", s4.stats.cash === 0 && s4.mjNet === -400, s4.stats.cash + "/" + s4.mjNet);');
  J('    A("invite_pure_bond", Mahjong.rules.bondDeltaOf(Mahjong.rules.eventsOf({ win: true, seat: 0, stake: 50, netCash: 300, style: "serious" }, "serious"),');
  J('      { id: "guo", name: "' + U("陈果") + '", bond: "guo", seat: -1, pureBond: true }) === 4);');
  J('  } catch (e) { A("step4_throw", false, String(e.message || e)); }');
  J('  setTimeout(step5, 260);');
  J('}');
  /* ── ⑤ 结局面板含「本局影响」行（放水把牌留给她）+ 新角色（雷姐）邀约条 ── */
  J('function step5() {');
  J('  try {');
  J('    showBoth();');
  J('    /* 用调试接口喂一个「顾曼放水胡牌」的确定结果 → 结算亮牌板直出「本局影响」行 */');
  J('    var host3 = byId("mj");');
  J('    if (Mahjong.isBusy()) { Mahjong.dispose(); }');
  J('    var sOut = mkS(); sOut.stats.cash = 5000;');
  J('    var okS3 = Mahjong.start(host3, { stake: 1000, style: "gentle", state: sOut,');
  J('      invite: { id: "man", name: "' + U("顾曼") + '", cname: "' + U("顾曼") + '", bond: "man", seat: 3, stake: 1000, pureBond: false },');
  J('      onFinish: function (r) { FIN3 = r; } });');
  J('    A("outcome_table", okS3 === true, okS3);');
  J('    A("outcome_settle_ok", Mahjong.debug.showResult({ win: false, seat: 3, draw: false, tier: "small", tierName: "' + U("小胡") + '",');
  J('      stake: 1000, payPerHouse: 2000, totalWin: 6000, netCash: -2000, payerOnly: false, from: -1, style: "gentle" }) === true);');
  J('    var v3 = Mahjong.debug.resultView();');
  J('    info.impactText = v3 ? v3.impactText : null;');
  J('    A("outcome_view_impact", !!v3 && !!v3.impactText && v3.impactText.indexOf("' + U("放水陪玩") + '") === 0, v3 && v3.impactText);');
  J('    A("outcome_view_flag", !!v3 && v3.impactFlag === "' + U("顾曼的赏识") + '", v3 && v3.impactFlag);');
  J('    var impEl = byId("mjmResImpact");');
  J('    A("outcome_note_dom", !!impEl && String(impEl.innerHTML).indexOf("' + U("本局影响") + '") >= 0, impEl && impEl.innerHTML);');
  J('    A("outcome_note_style", !!impEl && String(impEl.innerHTML).indexOf("' + U("放水陪玩") + '") >= 0, impEl && impEl.innerHTML);');
  J('    A("outcome_note_gain", !!impEl && String(impEl.innerHTML).indexOf("' + U("顾曼好感 +6") + '") >= 0, impEl && impEl.innerHTML);');
  J('    A("outcome_note_flagword", !!impEl && String(impEl.innerHTML).indexOf("' + U("已获得可用的把柄") + '") >= 0, impEl && impEl.innerHTML);');
  J('    /* 必出图：结算板 + 邀约条同屏（本沙箱每个 HTA 只稳定允许 ~4 次子进程，所以只拍这 3 张） */');  J('    /* 新角色邀约条：章节 2 + 全羁绊达标 -> 林溪最高优先，再强制弹雷姐那一条 */');
  J('    var sInv2 = mkB({ ch: 2, per: 2, stats: { cash: 5000 } });');
  J('    var listN = Mahjong.rules.inviteList(sInv2, 2000);');
  J('    info.invitePrio = listN.map(function (x) { return x.id; }).join("/");');
  J('    A("invite_new_list", listN.length >= 5 && listN[0].id === "lin", info.invitePrio);');
  J('    var lei = null, q;');
  J('    for (q = 0; q < listN.length; q++) { if (listN[q].id === "lei") { lei = listN[q]; } }');
  J('    A("invite_new_found", !!lei && lei.stake === 200 && lei.intel === "' + U("馆里的旧账") + '", lei && (lei.stake + "/" + lei.intel));');
  J('    var okN = Mahjong.showInvite(byId("mjInviteWrap"), lei, { onAccept: function (o) { ACCEPTED = o; }, onDecline: function (o) { DECLINED = o; } });');
  J('    A("invite_new_dom", okN === true && !!byId("mjmInviteCard"), okN);');
  J('    info.inviteNewMsg = dirtxt("mjmInviteMsg");');
  J('    A("invite_new_msg", dirtxt("mjmInviteMsg") === "' + U("输的人请一周的饭，敢不敢？") + '", info.inviteNewMsg);');
  J('    A("invite_new_meta", dirtxt("mjmInviteMeta").indexOf("' + U("注码 ¥200") + '") >= 0 && dirtxt("mjmInviteMeta").indexOf("' + U("拳击馆") + '") >= 0, dirtxt("mjmInviteMeta"));');
  J('    info.inviteNewGain = dirtxt("mjmInviteGain");');
  J('    A("invite_new_gain", dirtxt("mjmInviteGain").indexOf("' + U("本局可能获得") + '") >= 0 && dirtxt("mjmInviteGain").indexOf("' + U("体魄 +6") + '") >= 0, info.inviteNewGain);');
  J('    A("invite_new_gain_hidden", dirtxt("mjmInviteGain").indexOf("' + U("馆里的旧账") + '") < 0, info.inviteNewGain);');
  J('    /* 第 2 张必出图：新角色邀约条 */');  J('    /* 被拒的邀约不重复骚扰：改天 → 冷却内不再出现在候选里；且同一次只弹一条 */');
  J('    A("invite_new_decline_btn", byId("mjmInviteNo").onclick() === true && !!DECLINED && DECLINED.id === "lei", DECLINED && DECLINED.id);');
  J('    var sAfter = mkB({ ch: 2, per: 2, stats: { cash: 5000 }, mjInvites: { lei: { t: 2000, mode: "declined" } } });');
  J('    var listAfter = Mahjong.rules.inviteList(sAfter, 2000).map(function (x) { return x.id; }).join("/");');
  J('    info.inviteAfterDecline = listAfter;');
  J('    A("invite_no_repeat", listAfter.indexOf("lei") < 0, listAfter);');
  J('    var listLate = Mahjong.rules.inviteList(sAfter, 2000 + Mahjong.rules.INVITE_COOLDOWN_MS).map(function (x) { return x.id; }).join("/");');
  J('    A("invite_repeat_after_cd", listLate.indexOf("lei") >= 0, listLate);');
  J('    A("invite_one_at_a_time", Mahjong.rules.pickInvite(sAfter, 2000).id !== null && typeof Mahjong.rules.pickInvite(sAfter, 2000).id === "string", Mahjong.rules.pickInvite(sAfter, 2000).id);');
  J('    A("invite_new_finish", (function () { var ok = Mahjong.debug.continueGame(); return ok === true && !!FIN3 && FIN3.style === "gentle"; })(), FIN3 && FIN3.style);');
  J('  } catch (e) { A("step5_throw", false, String(e.message || e)); }');
  J('  setTimeout(done, 250);');
  J('}');
  J('</script></head><body>');
  J('<div id="lobbyPad"><div id="mjLobbyHost"></div></div>');
  J('<div id="tablePad" class="hidden"><div id="mj"></div></div>');
  J('<div id="invitePad" class="hidden"><div id="mjInviteWrap"></div></div>');
  J('</body></html>');
  return L.join("\n");
}

/* HTA 内联脚本里的 __DIR__（HTA 运行目录）→ 实际目录（JSON 字符串形式，含结尾反斜杠） */
function htaSrc() {
  return buildHta()
    .replace(/__DIR__/g, JSON.stringify(OUT + "\\"))
    .replace(/__NOCAP__/g, process.env.MJ_NOCAP === "1" ? "1" : "0")
    .replace(/__SHOTONLY__/g, process.env.MJ_SHOTONLY === "1" ? "1" : "0");
}

/* 检查项 → 中文说明（报告可读） */
const CHECK_ZH = {
  lobby_api: "开局面板 API 可用（openLobby 返回 true）",
  lobby_dom: "面板 DOM 齐全（#mjmLobbyCard / #mjmLobbyGo / #mjmLobbyCancel）",
  lobby_tiers_dom: "三档注码按钮都在 DOM 里（¥50/¥200/¥1000）",
  lobby_tiers_all: "面板正好三档，最小 ¥50、最大 ¥1000",
  lobby_pick_default: "默认选中第一个买得起的档位（¥50）",
  lobby_grey: "财富 60：¥50 可选，¥200 / ¥1000 置灰",
  lobby_grey_reason: "置灰档位写明「财富不足」原因",
  lobby_pick_ok: "点可选档位 → 选中成功",
  lobby_pick_grey_blocked: "点置灰档位 → 点不动且不改变选择",
  lobby_style_gentle: "可切换打法为「放水」",
  lobby_record: "面板显示战绩与牌友口碑",
  lobby_start_cb: "点「开局」→ 回调带回 {注码, 打法}",
  table_start: "按所选注码/打法开局成功",
  table_dom: "牌桌 DOM 出现（canvas + 智脑面板 + 开关）",
  gentle_style: "本局打法 = 放水",
  gentle_hint_off: "放水局智脑提示默认关闭且被锁",
  gentle_toggle_blocked: "放水局点开关也无法打开",
  gentle_hint_null: "放水局不产出提示",
  gentle_brain_locked: "开关显示「锁」，面板文案已锁",
  gentle_brain_text: "智脑面板写明「放水…已关闭」",
  gentle_no_mark: "放水局不画建议金框",
  rule_text: "牌桌规则面板写明注码与打法",
  table_px: "牌桌真的画出来了（像素/颜色数达标）",
  table_hint_gap: "放水局画布上没有金框标记",
  table_force_win: "调试造胡（小胡自摸）",
  table_settle: "触发结算面板",
  res_shown: "结算亮牌板已弹出",
  res_view_stake: "结算数据：注码 50 / 打法 放水 / 净收支 +300",
  res_tiers_scaled: "四档赔付按注码 50 换算（300/1200/1800/3600）",
  res_cash_stake: "结算板写明注码 ¥50",
  res_cash_per: "结算板写明「小胡 2 张 → 每家 ¥100 · 共收 ¥300」（张数 × 注码）",
  res_cash_net: "结算板写明你的净收支 +¥300",
  res_style_text: "结算板写明打法（放水 · 智脑提示关闭）",
  res_pay_detail: "保留原有「赔付明细」行",
  res_bond_text: "结算板写明羁绊变化（红姐 好感 +3）",
  res_rep_text: "结算板写明口碑变化（+1）",
  res_intel_text: "结算板写明解锁的三条牌桌情报",
  res_achv_text: "结算板写明本局成就（牌桌老千）",
  res_go_btn: "结算板「继续」按钮可点",
  fin_called: "点继续 → onFinish 被调用",
  fin_stake: "onFinish.stake = 50",
  fin_pay_per_house: "onFinish.payPerHouse = 100（2 张 × 50）",
  fin_total_win: "onFinish.totalWin = 300（三家之和）",
  fin_net_cash: "onFinish.netCash = +300",
  fin_style: "onFinish.style = gentle",
  fin_report: "onFinish.report 带结算面板文案",
  land_cash: "落地：财富 100 → 400（按张数 × 注码）",
  land_bond: "落地：红姐羁绊 20 → 23（放水 +3）",
  land_rep: "落地：牌友口碑 50 → 51（胡 +3 / 放水 −2）",
  land_streak: "落地：战绩 1 胜 / 连胡 1 / 净收支 +300",
  land_flags: "落地：赢下这一桌 → S.flags 解锁三条情报",
  land_no_rival_when_gentle: "放水局即使赢钱也不结梁子（牌桌结梁子只在「认真」打法下产生）",
  land_achv: "落地：成就「牌桌老千」写入",
  land_report: "落地报告与面板文案一致（+3 羁绊 / +1 口碑 / 3 条情报）",
  land_no_bankrupt: "输光不破产（财富保底 0）",
  invite_rules: "邀约规则：红姐（夜/¥200）+ 妹妹（¥50），顾曼羁绊不足不约",
  invite_msg: "邀约带消息文案与地点",
  invite_dom: "邀约条 DOM 齐全（含「接受」「改天」）",
  invite_meta: "邀约条写明注码与地点",
  invite_msg_dom: "邀约条正文 = 「三缺一，来不来？」",
  invite_accept_btn: "点「接受」→ 回调带回该条邀约",
  invite_accepted_flag: "接受后状态标记 accepted",
  invite_once: "接受过的邀约本轮不再弹（红姐消失，只剩顾曼/妹妹）",
  invite_cooldown: "「改天」后 20 分钟内冷却不重复骚扰",
  invite_cooldown_over: "冷却结束后可以再约（20 分钟）",
  invite_per_night: "红姐只在晚上（per=2）约局",
  invite_poor_grey: "财富不足的邀约置灰（不可接受）",
  invite_bond_win: "邀约局放水让对方胡 → 该角色羁绊 +6",
  invite_intel: "放水到对家胡 → 解锁对方情报",
  invite_cash: "邀约局照样按注码结算财富（保底 0）",
  invite_pure_bond: "妹妹局纯涨羁绊（恒定 +4）",
  /* ── 邀约表（8 条 · 数据驱动）── */
  invites_count: "INVITES 表共 8 条可邀约角色",
  invites_ids: "8 条 id 顺序 = 红姐/顾曼/陈果/林溪/苏晚晴/温阮/雷姐/白露",
  invites_stake_tiers: "8 条注码都落在 ¥50 / ¥200 / ¥1000 三档内",
  invites_fields: "8 条字段齐全（含 bonds/where/msg/openLine/settle/note，per 与 ch 合法）",
  invites_intel5: "新增 5 条情报映射正确（人事风声/旧伤/错题/旧账/急诊室）",
  /* ── 邀约优先级 ── */
  prio_ch3: "优先级：章节 3 → 通用兜底角色（红姐/陈果）先于已过章的顾曼等",
  prio_ch2_new_first: "优先级：章节 2 → 本章专属 5 人优先于通用角色（林溪最前；苏晚晴下午局不在此刻）",
  prio_slot_one: "同一时段只弹一位（晚上雷姐压过白露；只有白露达标时才约白露）",
  prio_ch2_man_first: "优先级：章节 2 且只有老三人达标 → 章节匹配的顾曼第一",
  prio_bond_higher: "优先级：同章节同时段 → 羁绊更高者（雷姐 44）先出",
  prio_pick_one: "pickInvite：同一次只选出一条（本章最高优先 = 林溪）",
  /* ── 剧情后果 ── */
  conseq_gu: "放水给顾曼且她胡 → flag 顾曼的赏识",
  conseq_jin: "放水给金老板且他胡 → flag 金老板的信任",
  conseq_rival: "认真赢太狠 → flag 牌桌结梁子：红姐",
  rival_landed: "落地：认真赢太狠 → S.flags 写入「牌桌结梁子：红姐」",
  rival_impact: "影响行：认真打满 · … · 牌桌结梁子：红姐",
  rival_bond_minus: "认真赢太狠 → 该角色羁绊 −2~−4（已有规则）",
  rival_no_bond_small: "认真小赢（刚好 2×注码）→ 不结梁子、羁绊 +1",
  conseq_landed: "落地：S.flags 真的写入「顾曼的赏识」",
  impact_same_source: "「本局影响」文案与规则层同源（打法 + 羁绊数字 + flag 元数据）",
  impact_lines: "报告 lines 里带「本局影响」行",
  impact_preview_equals_apply: "预演（结算板）与真实落地的「本局影响」逐字一致",
  intel5_unlocked: "新增 5 条情报：赢下对应邀约局 → S.flags 解锁",
  intel5_reverse: "新增 5 条情报可反查角色 id",
  /* ── 结局面板「本局影响」行 + 新角色邀约条 ── */
  outcome_table: "顾曼局（放水 · ¥1000）开桌成功",
  outcome_settle_ok: "调试接口用「顾曼胡牌」结果弹结算板",
  outcome_view_impact: "结算数据带 impactText（以「放水陪玩」开头）",
  outcome_view_flag: "结算数据 impactFlag = 顾曼的赏识",
  outcome_note_dom: "结算亮牌板出现「本局影响」行（#mjmResImpact）",
  outcome_note_style: "「本局影响」行写明打法（放水陪玩）",
  outcome_note_gain: "「本局影响」行写明羁绊数字（顾曼好感 +6，与落地同源）",
  outcome_note_flagword: "「本局影响」行说明「已获得可用的把柄」",
  invite_new_list: "章节 2 全羁绊达标 → 新角色进入候选（林溪最高优先）",
  invite_new_found: "候选里有雷姐（¥200 · 情报「馆里的旧账」）",
  invite_new_dom: "新角色邀约条 DOM 渲染成功",
  invite_new_msg: "雷姐开场白 = 「输的人请一周的饭，敢不敢？」",
  invite_new_meta: "邀约条写明注码 ¥200 与地点「拳击馆」",
  invite_new_gain: "邀约条写明「本局可能获得：体魄 +6 …」",
  invite_new_gain_hidden: "情报名不剧透（面板不出现「馆里的旧账」）",
  invite_new_decline_btn: "点「改天」→ 回调带回雷姐那条邀约",
  invite_no_repeat: "被拒的邀约在 20 分钟冷却内不再出现在候选里（不重复骚扰）",
  invite_repeat_after_cd: "冷却结束后可以再约",
  invite_one_at_a_time: "同一次只弹一条（pickInvite 单条）",
  invite_new_finish: "新角色邀约局结算回调正常（style=gentle）",
};

function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  const sig = buf.slice(0, 8).toString("hex");
  if (sig !== "89504e470d0a1a0a") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length, sig };
}

async function runTrident() {
  const r = await L.runHta({
    htaPath: HTA_PATH, outTxt: OUT_TXT,
    htaBody: htaSrc(), waitMs: 60000, keep: !!process.env.MJ_KEEP,
  });
  try { fs.rmSync(OUT_TXT, { force: true }); } catch (e) {}
  try { fs.rmSync(HTA_PATH, { force: true }); } catch (e) {}
  return r;
}

(async () => {
  const t0 = Date.now();
  if (process.env.MJ_DRY === "1") {     // 只生成探针文件（排查 JScript 语法用）
    fs.writeFileSync(HTA_PATH, htaSrc(), "utf8");
    console.log("[dry] 已生成 " + HTA_PATH);
    process.exit(0);
  }
  console.log("[模式] mshta / Trident(IE11 引擎) — 沙箱内 Chrome/Edge 均无法启动（命名管道被拒）");
  const tri = await runTrident();
  console.log("[出图] 四张验收图由 `node tools/mj/shots.js` 单独产出（本沙箱 mshta 同一进程屏幕拷贝超过 ~3 次会挂）");
  const checks = [], errors = [], info = {};
  let note = "Chrome(headless CDP)/Edge 在本沙箱均无法启动（mojo 命名管道被拒），降级用 mshta(Trident) 真实渲染同一份 mahjong.js（生产代码，非复刻）；出图由 `node tools/mj/shots.js` 用独立进程 + System.Drawing 单独产出（沙箱里同一 mshta 进程屏幕拷贝超过 ~3 次会挂）。";
  if (!tri.ok) {
    errors.push(note, tri.why);
    if (tri.raw) console.error("[探针原始输出] " + tri.raw.slice(0, 500));
    fs.writeFileSync(OUT + "\\dist\\test-results\\mj-system-results.json", JSON.stringify({ success: false, testedAt: new Date().toISOString(), mode: "trident-hta", checks, errors, info }, null, 1), "utf8");
    console.error("FATAL: " + tri.why);
    process.exit(3);
  }
  const o = tri.out;
  Object.assign(info, o.info || {});
  Object.keys(CHECK_ZH).forEach((k) => {
    const val = o.info ? o.info[k] : undefined;
    const shown = (val === undefined || val === true || val === 1) ? "" : "：" + val;
    if (o.checks && o.checks[k] !== undefined) checks.push(CHECK_ZH[k] + shown);
    else errors.push(CHECK_ZH[k] + shown);
  });
  if (o.errors && o.errors.length) errors.push("探针内部错误：" + o.errors.join(" | "));
  console.log("[探针] 通过 " + checks.length + "，失败 " + (o.errors || []).length);
  if (o.info) console.log("[关键信息] " + JSON.stringify({
    lobbyTiers: o.info.lobbyTiers, payText: o.info.payText, bondText: o.info.bondText, repText: o.info.repText,
    intelText: o.info.intelText, landing: o.info.landing, invites: o.info.invites, fins: o.info.fin
  }));
  /* 出图由 `node tools/mj/shots.js` 负责（每个 mshta 进程只允许约 3 次屏幕拷贝，故与断言分开跑） */
  const res = { success: errors.length === 0, mode: "trident-hta", testedAt: new Date().toISOString(), ms: Date.now() - t0, note, checks, errors, info };
  fs.writeFileSync(OUT + "\\dist\\test-results\\mj-system-results.json", JSON.stringify(res, null, 1), "utf8");
  console.log("\n════════════════════════════════");
  console.log("模式 trident-hta · 通过 " + checks.length + "，失败 " + errors.length + (errors.length ? " | " + errors.join(" | ") : "，全部通过 ✔"));
  setTimeout(() => process.exit(errors.length ? 1 : 0), 300);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
