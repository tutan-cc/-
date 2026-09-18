/* 一次性集成脚本：把早餐店小游戏接进 index.html（失败即回滚，不留半成品）
   用法：node _bf_integrate.cjs
   纪律：改前已备份 index.html.bfbak；所有替换都是「精确锚点」，任何一处不匹配就整体放弃。 */
const fs = require("fs"), vm = require("vm");
const P = "index.html";
const src = fs.readFileSync(P, "utf8");
let s = src;
const applied = [];
function rep(name, a, b) {
  if (s.indexOf(a) < 0) { console.error("ANCHOR MISS: " + name); process.exit(1); }
  if (s.split(a).length - 1 !== 1) { console.error("ANCHOR NOT UNIQUE: " + name); process.exit(1); }
  s = s.replace(a, b);
  applied.push(name);
}

/* ── 1. script 标签 ── */
rep("script-tag",
  '<script src="map3d.js"></script>',
  '<script src="map3d.js"></script>\n<script src="breakfast.js"></script>');

/* ── 2. 侧栏常驻入口 ── */
rep("sidebar-button",
  '      <button class="btn-m" id="mjFreeBtn">🀄 找人打两圈</button>\n',
  '      <button class="btn-m" id="mjFreeBtn">🀄 找人打两圈</button>\n      <button class="btn-m" id="bfBtn" style="border-color:#ff9ec7;color:#ffd76e">🍳 做份早餐</button>\n      <div id="bfNote" style="font-size:10px;color:var(--dim);line-height:1.7;margin-top:4px;padding:6px 8px;border:1px dashed var(--line);background:#0b0a13"></div>\n');

/* ── 3. 覆盖层 DOM（选对象面板 + 游戏宿主） ── */
rep("overlay-dom",
  '    <!-- 自由局开局（三档注码 + 打法；面板本身由 mahjong.js 渲染） -->',
  '    <!-- 早餐店 · 选对象面板（面板本身由 breakfast.js 渲染） -->\n' +
  '    <div class="overlay bf-overlay" id="bfPick"><div class="panel bf-panel" id="bfPickHost"></div></div>\n\n' +
  '    <!-- 早餐店 · 拼手速（Canvas 由 breakfast.js 渲染） -->\n' +
  '    <div class="overlay bf-overlay" id="bfGame"><div class="panel bf-panel bf-game-panel" id="bfGameHost"></div></div>\n\n' +
  '    <!-- 自由局开局（三档注码 + 打法；面板本身由 mahjong.js 渲染） -->');

/* ── 4. 新状态字段（S.breakfastDay 等；旧档缺字段自动补默认） ── */
rep("newState-fields",
  '  mjWins:0, mjLosses:0, mjNet:0, mjRep:50, mjStreak:0, mjInvites:{},',
  '  mjWins:0, mjLosses:0, mjNet:0, mjRep:50, mjStreak:0, mjInvites:{},\n' +
  '  /* ── 早餐店 · 拼手速：每日一次 / 战绩 / 结果 ── */\n' +
  '  breakfastDay:{day:0, sent:[]}, bfWin:false, bfLast:null,');

/* ── 5. 存档校验：早餐店字段迁移（缺字段一律补默认值，绝不判坏档） ── */
rep("restore-fields",
  '    return out;\n  }catch(e){ return null; }',
  '    // ── 早餐店字段：旧档缺 breakfastDay / bfWin / bfLast 一律补默认值（绝不因此判坏档）──\n' +
  '    var bfd = s.breakfastDay;\n' +
  '    if (bfd && typeof bfd === "object" && !Array.isArray(bfd)) {\n' +
  '      var bsent = [];\n' +
  '      if (Object.prototype.toString.call(bfd.sent) === "[object Array]")\n' +
  '        for(var bi=0; bi<bfd.sent.length && bi<9; bi++)\n' +
  '          if(typeof bfd.sent[bi] === "string" && BF_TARGET_IDS.indexOf(bfd.sent[bi])>=0 && bsent.indexOf(bfd.sent[bi])<0) bsent.push(bfd.sent[bi]);\n' +
  '      out.breakfastDay = { day: num0(bfd.day,0,0,999), sent:bsent };\n' +
  '    } else out.breakfastDay = { day:0, sent:[] };\n' +
  '    out.bfWin = s.bfWin === true;\n' +
  '    var bl = s.bfLast;\n' +
  '    if(bl && typeof bl === "object" && BF_TARGET_IDS.indexOf(bl.target)>=0){\n' +
  '      out.bfLast = { target:bl.target, win:bl.win===true,\n' +
  '        served:num0(bl.served,0,0,999), goal:num0(bl.goal,8,1,999),\n' +
  '        perfect:num0(bl.perfect,0,0,9999), burnt:num0(bl.burnt,0,0,9999),\n' +
  '        score:num0(bl.score,0,-99999,999999), delta:num0(bl.delta,0,-10,10),\n' +
  '        day:num0(bl.day,S.day,0,999), t:Number.isFinite(Number(bl.t))? Number(bl.t):0 };\n' +
  '    } else out.bfLast = null;\n' +
  '    return out;\n  }catch(e){ return null; }');

/* ── 6. 成就 ── */
rep("achv-table",
  '  mjRival:{n:"冤家", d:"单局输光所选注码"},',
  '  mjRival:{n:"冤家", d:"单局输光所选注码"},\n' +
  '  bfWin:{n:"早餐店老板", d:"在早餐店拼手速过关"},');
rep("checkAchv",
  '  if(S.mjWin) got("mjWin");',
  '  if(S.mjWin) got("mjWin");\n  if(S.bfWin) got("bfWin");');

/* ── 7. 互动分发：inter.type === "cook" ── */
rep("openInter-dispatch",
  '  else if(it.type==="mahjong") startMahjong(it);\n}',
  '  else if(it.type==="mahjong") startMahjong(it);\n  else if(it.type==="cook") startCook(it);\n}');

/* ── 8. 早餐店模块（放在麻将系统之后，逻辑同构：模块只负责玩法，这里只负责接 S / toast） ── */
const BF_MODULE = String.raw`
/* ═══════════════ 早餐店 · 拼手速（玩法与绘制都在 breakfast.js，这里只负责接 S / toast） ═══════════════
   入口 A · 剧情：节点里的 inter.type==="cook" → startCook(it)
   入口 B · 侧栏：「🍳 做份早餐」→ openBreakfast() 选对象面板
   通过 → 该角色好感 +6~+10（热乎 / 完美越多加得越多）；失败 → −3~−6（不虐主，给台阶）
   每日一次：S.breakfastDay 记录 {day, sent[]}，同一天同一角色只能送一次 */
const BF_TARGET_IDS = ["fang","su","lin","wen","lei","hong","guo","lu","man"];
const BF_PERFECT = { win:{cha:3, phy:1}, lose:{} };
let bfRunning = false, bfNode = false;                 // bfNode：本局是从剧情节点进来的
let lastBfPick = 0, bfLastResult = null;               // bfLastResult：面板关掉后仍可读的最近结果

/** 可攻略角色面板数据（好感 20~79 才可选；越界或今天已送 → 置灰并给原因） */
function bfTargets(){
  const sent = (window.Breakfast && Breakfast.rules) ? Breakfast.rules.sentToday(S.breakfastDay, S.day) : {};
  if(!window.Breakfast || !Breakfast.rules) return [];
  return Breakfast.rules.eligibleTargets(S.bonds, BF_TARGET_IDS, sent).map(function(t){
    const b = BONDS[t.id] || {n:t.id, f:"🙂"};
    return { id:t.id, name:b.n, f:b.f, bond:t.bond, ok:t.ok, why:t.why, sent:t.sent };
  });
}
function bfNoteHtml(){
  const list = bfTargets();
  if(!list.length) return "早餐店模块未加载";
  const okList = list.filter(function(t){ return t.ok; });
  if(!okList.length) return "🍳 今天没人可送了<br><span style=\"color:#6f6c85\">好感 20~79 之间、且今天还没送过的角色才收得下这份早餐</span>";
  return "🍳 今天还能送：<b style=\"color:var(--gold)\">" + okList.map(function(t){ return t.name + "（好感 " + t.bond + "）"; }).join(" · ") + "</b>";
}
function bfCanSend(id){
  if(!window.Breakfast || !Breakfast.rules) return {ok:false, why:"早餐店模块未加载"};
  return Breakfast.rules.canSend(S.bonds, id, S.day, S.breakfastDay);
}
/** 完成一局 → 落地好感 / 每日一次 / 成就，再决定回剧情还是回沙盘 */
function bfApplyResult(res, opts){
  opts = opts || {};
  if(!res) return;
  bfLastResult = res;
  const id = res.target && res.target.id;
  const before = id ? (S.bonds[id]||0) : 0;
  if(id && res.bondDelta){
    S.bonds[id] = Math.max(0, Math.min(100, before + res.bondDelta));
    S.breakfastDay = Breakfast.rules.markSent(S.breakfastDay, id, S.day);
  }
  const after = id ? (S.bonds[id]||0) : 0;
  if(res.win){ S.bfWin = true; AudioSys.good(); } else AudioSys.bad();
  S.bfLast = { target:id||null, win:!!res.win, served:res.served, goal:res.goal,
    perfect:res.perfect, burnt:res.burnt, score:res.score, delta:res.bondDelta||0, day:S.day, t:Date.now() };
  save();
  if(res.target) toast((res.win?"🍳 送出热乎早餐":"…早餐烧坏了") + " · <b>" + res.target.name + "</b> 好感 <b>" + (res.bondDelta>0?"+":"") + res.bondDelta + "</b>（" + before + " → " + after + "）<br><span style=\"color:#8a87a3\">" + (res.quote||"") + "</span>");
  checkAchv(); render();
  if(opts.story && typeof curNode!=="undefined" && curNode){
    afterInter(res.win ? BF_PERFECT.win : BF_PERFECT.lose, res.win ? ("早餐送到了 —— " + res.impact) : res.impact);
  } else {
    toast("📌 " + res.impact);
    render();
  }
}
/** 入口 A · 剧情：节点里的可选分支 → 开局前先让他选送给谁 */
function startCook(it){
  it = it || {};
  return openBreakfast({
    story:true,
    title: it.title || "想拉近跟某人的关系 → 给他送一份早餐？",
    onCancel: function(){                                     // 转身就走：这条线照常往下走
      AudioSys.click();
      afterInter(it.skip || {}, "这次没做早餐");
    }
  });
}
function startBreakfastGame(id, opts){
  opts = opts || {};
  if(bfRunning){ AudioSys.bad(); toast("早餐店还在营业中"); return false; }
  if(!window.Breakfast || !Breakfast.start || !Breakfast.rules){
    AudioSys.bad(); toast("早餐店模块未加载，已跳过本局");
    return false;
  }
  const chk = bfCanSend(id);
  if(!chk.ok){ AudioSys.bad(); toast("🍳 " + chk.why); return false; }
  const bond = BONDS[id] || {n:id, f:"🙂"};
  const host = $("bfGameHost");
  if(!host) return false;
  AudioSys.init(); AudioSys.click();
  bfRunning = true; bfNode = !!opts.story;
  $("bfGame").classList.add("on");
  const target = { id:id, name:bond.n, bond:S.bonds[id]||0 };
  const ok = Breakfast.start(host, {
    target: target, duration: 75, goal: 8,
    onFinish: function(res){ bfFinish(res); }
  });
  if(ok !== true){ bfRunning = false; $("bfGame").classList.remove("on"); toast("早餐店开局失败"); return false; }
  window.__cs2.bf = Breakfast.debug || null;
  try{ window.__cs2.bfTarget = target; }catch(e){}
  return true;
}
function bfFinish(res){
  if(!bfRunning) return;
  bfRunning = false;
  const story = bfNode; bfNode = false;
  $("bfGame").classList.remove("on");
  try{ if(window.Breakfast && Breakfast.dispose) Breakfast.dispose(); }catch(e){}
  bfApplyResult(res, { story:story });
}
/** 入口 B · 侧栏：选对象面板 */
function openBreakfast(opts){
  opts = opts || {};
  if(bfRunning){ AudioSys.bad(); toast("早餐店还在营业中"); return false; }
  const host = $("bfPickHost");
  if(!host) return false;
  if(!window.Breakfast || !Breakfast.ui || !Breakfast.ui.openTargetPanel){
    toast("早餐店模块未加载（缺 breakfast.js）"); return false;
  }
  const list = bfTargets();
  if(!list.length){ toast("早餐店模块未加载"); return false; }
  const ok = Breakfast.ui.openTargetPanel(host, list, {
    day: S.day,
    onPick: function(t){
      if(t.id === lastBfPick) return;                          // 防抖：手快双击不会开两局
      lastBfPick = t.id; setTimeout(function(){ lastBfPick = 0; }, 600);
      $("bfPick").classList.remove("on");
      startBreakfastGame(t.id, { story: !!opts.story });
    },
    onCancel: function(){
      AudioSys.click();
      $("bfPick").classList.remove("on");
      if(opts.onCancel) opts.onCancel();
      else render();
    }
  });
  if(ok !== true){ toast("选对象面板渲染失败"); return false; }
  $("bfPick").classList.add("on");
  return true;
}
function bfSinceLast(){
  const l = S.bfLast;
  if(!l || !l.target) return "";
  const b = BONDS[l.target] || {n:l.target};
  return "<br>上次：<b style=\"color:" + (l.win?"var(--green)":"var(--red)") + "\">" + (l.win?"通过":"失败") + "</b> → " + b.n + " 好感 " + (l.delta>0?"+":"") + l.delta + (l.win?(" · 完美 " + l.perfect):(" · 糊 " + l.burnt));
}
$("bfBtn").addEventListener("click", function(){ openBreakfast(); });

`;

rep("bf-module",
  '$("mjFreeBtn").addEventListener("click",()=>{ AudioSys.init(); AudioSys.click(); openMjLobby(); });',
  '$("mjFreeBtn").addEventListener("click",()=>{ AudioSys.init(); AudioSys.click(); openMjLobby(); });\n' + BF_MODULE);

/* ── 9. 侧栏说明：render() 里刷新「今天还能送谁」 + 上次战绩 ── */
rep("render-bfNote",
  '  const recEl=$("mjRec"); if(recEl) recEl.innerHTML=mjRecordHtml();',
  '  const recEl=$("mjRec"); if(recEl) recEl.innerHTML=mjRecordHtml();\n  const bfEl=$("bfNote"); if(bfEl){ try{ bfEl.innerHTML=bfNoteHtml()+bfSinceLast(); }catch(e){ bfEl.textContent="🍳 做份早餐"; } }');

/* ── 10. 剧情节点：第二章「出租屋 · 妹妹来了」可选分支 + 新节点 sister_bf ── */
/* 10a. 选择面板支持「选了就去做早餐」：opts[].toast + opts[].cook */
rep("showChoice-cook",
  '      afterInter(o.r, "选择已生效");\n    });',
  '      if(o.cook){ toast(o.toast || "想做份早餐 —— 先想好送给谁"); startCook(o.cook); return; }\n' +
  '      if(o.toast) toast(o.toast);\n' +
  '      afterInter(o.r, "选择已生效");\n    });');
rep("sister-node",
  '      {t:"「来，哥看看你这次的卷子。」", fx:"智慧 +5 · 陈果 +8", r:{int:5, bond:{guo:8}}},\n' +
  '    ]},\n' +
  '  after:[{v:"video/sis_eat.mp4", who:"陈果", t:"她吸溜着面，含混不清地说：「哥，你变了。以前……你不这样的。」", bg:"radial-gradient(ellipse at 50% 50%,#241c14,#0a0805 80%)"}],\n' +
  '  next:["flashback"]},',
  '      {t:"「来，哥看看你这次的卷子。」", fx:"智慧 +5 · 陈果 +8", r:{int:5, bond:{guo:8}}},\n' +
  '      {t:"「明天想吃啥？哥早点起，去巷口那家早餐店给你做一份。」", fx:"→ 早餐店 · 拼手速（自己下厨送一份热乎的）", r:{}, cook:{}, toast:"想做份早餐 —— 先想好送给谁"},\n' +
  '    ]},\n' +
  '  after:[{v:"video/sis_eat.mp4", who:"陈果", t:"她吸溜着面，含混不清地说：「哥，你变了。以前……你不这样的。」", bg:"radial-gradient(ellipse at 50% 50%,#241c14,#0a0805 80%)"}],\n' +
  '  next:["sister_bf"]},\n' +
  '/* 早餐店入口 A · 剧情可选分支：想拉近跟某人的关系 → 给他送一份早餐 */\n' +
  'sister_bf:{loc:"rent", name:"出租屋 · 早餐店开张", day:7, per:0, ch:2, mood:"calm",\n' +
  '  shots:[\n' +
  '    {v:"video/sis_noodle.mp4#t=18", t:"凌晨五点半，巷口那家早餐店刚开火。老板把围裙往你手里一塞：「锅就三口，煎盘四格——你想送给谁，就看这一早上。」", bg:"radial-gradient(ellipse at 50% 50%,#2c1a10,#0a0605 80%)"},\n' +
  '    {v:"video/sis_eat.mp4#t=12", who:"陈果", t:"（她蹲在门口等你）「哥，我昨天随口说的……你真来做啊？」——这一次，你不想再让她等三年。", bg:"radial-gradient(ellipse at 50% 50%,#2c1a10,#0a0605 80%)"},\n' +
  '  ],\n' +
  '  inter:{type:"cook", title:"想拉近跟某人的关系 → 给他送一份早餐",\n' +
  '    perfect:{cha:3, phy:1}, miss:{}, skip:{}},\n' +
  '  after:[{v:"video/sis_noodle.mp4#t=40", who:"陈果", t:"她捧着那碗还冒热气的东西，小口小口地吹：「……比我自己煮的，好吃。」", bg:"radial-gradient(ellipse at 50% 50%,#2c1a14,#0a0806 80%)"}],\n' +
  '  next:["flashback"]},');

/* ── 11. 调试跳转：早餐店调试入口 ── */
rep("debug-jump",
  '  mjSet: (o)=>{ Object.assign(S, o||{}); save(); render(); return mjRecord(); },',
  '  mjSet: (o)=>{ Object.assign(S, o||{}); save(); render(); return mjRecord(); },\n' +
  '  /* ── 早餐店调试 ── */\n' +
  '  bfPick: ()=>{ $("title").classList.add("hide"); $("game").classList.add("on"); render(); return openBreakfast(); },\n' +
  '  bfStart: (id, o)=>{ $("title").classList.add("hide"); $("game").classList.add("on"); render(); return startBreakfastGame(id||"su", o||{}); },\n' +
  '  bfDebug: ()=> (window.Breakfast && Breakfast.debug) ? Breakfast.debug : null,\n' +
  '  bfState: ()=> (window.Breakfast && Breakfast.debug && Breakfast.debug.state) ? Breakfast.debug.state() : null,');

/* ── 12. 测试钩子 ── */
rep("test-hooks",
  '  startFree: startFreeMahjong,',
  '  startFree: startFreeMahjong,\n' +
  '  /* 早餐店钩子（浏览器验收脚本用） */\n' +
  '  get bfState(){ return (window.Breakfast && Breakfast.debug && Breakfast.debug.state) ? Breakfast.debug.state() : null; },\n' +
  '  get bfOrders(){ return (window.Breakfast && Breakfast.debug && Breakfast.debug.orders) ? Breakfast.debug.orders() : null; },\n' +
  '  get bfStations(){ return (window.Breakfast && Breakfast.debug && Breakfast.debug.stations) ? Breakfast.debug.stations() : null; },\n' +
  '  get bfTarget(){ return (window.Breakfast && Breakfast.debug && Breakfast.debug.state) ? (Breakfast.debug.state()||{}).target : null; },\n' +
  '  get bfResult(){ return bfLastResult; },\n' +
  '  bfPick: ()=> openBreakfast(),\n' +
  '  bfStart: (id, o)=> startBreakfastGame(id, o),\n' +
  '  bfDom: ()=>({ pick: !!document.querySelector("#bfPick.on"), pickCards: document.querySelectorAll("#bfPickHost .bf-card").length,\n' +
  '    pickOff: document.querySelectorAll("#bfPickHost .bf-card.off").length,\n' +
  '    game: !!document.querySelector("#bfGame.on"), canvas: document.querySelectorAll("#bfGameHost canvas.bf-cv").length,\n' +
  '    result: !!document.querySelector("#bfGameHost .bf-result[style*=\\"block\\"]") }),');

/* ── 13. 启动：把 __cs2.bf 指过去 ── */
rep("boot-hook",
  '  if(!S.done.includes("intro")) setTimeout(()=>playNode("intro"), 700);',
  '  if(window.Breakfast && Breakfast.debug) window.__cs2.bf = Breakfast.debug;\n' +
  '  if(!S.done.includes("intro")) setTimeout(()=>playNode("intro"), 700);');

/* ── 校验：内联脚本语法 ── */
const scripts = s.match(/<script>([\s\S]*?)<\/script>/g) || [];
if (scripts.length !== 1) { console.error("script 块数量异常: " + scripts.length); process.exit(1); }
const code = scripts[0].replace(/^<script>/, "").replace(/<\/script>$/, "");
try { new vm.Script(code, { filename: "index.html#inline" }); }
catch (e) { console.error("内联脚本语法失败，未写入：" + e.message); process.exit(1); }

fs.writeFileSync(P, s, "utf8");
console.log("integrate OK, applied " + applied.length + " patches:");
applied.forEach(function(n){ console.log("  - " + n); });
console.log("index.html " + src.length + " -> " + s.length + " bytes");
