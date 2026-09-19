// 实测：打斗 / 麻将 / 刮彩票
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const { resultsFile } = require("../lib/dist.js");
const path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9228;
const OUT = path.join(__dirname, "..", "..");
const BASE = "file:///" + OUT.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
const sleep = ms => new Promise(r => setTimeout(r, ms));
function req(method, path){ return new Promise((res,rej)=>{ const r=http.request({host:"127.0.0.1",port:PORT,path,method},resp=>{let d="";resp.on("data",c=>d+=c);resp.on("end",()=>{try{res(JSON.parse(d))}catch(e){res(d)}});}); r.on("error",rej); r.end(); }); }
let id=0, ws, pend={};
function send(m,p){ return new Promise((res,rej)=>{ const i=++id; pend[i]=res; ws.send(JSON.stringify({id:i,method:m,params:p||{}})); setTimeout(()=>{ if(pend[i]){delete pend[i];rej(new Error("timeout "+m));} },60000); }); }
async function ev(e){ const r=await send("Runtime.evaluate",{expression:e,returnByValue:true});
  if(r.result&&r.result.exceptionDetails) return "EXC:"+((r.result.exceptionDetails.exception||{}).description||"");
  return r.result&&r.result.result?r.result.result.value:undefined; }
async function shot(n){ const r=await send("Page.captureScreenshot",{format:"png"});
  fs.mkdirSync(path.join(OUT,"测试截图"),{recursive:true});   // 干净 clone 上目录不存在，不自建会 ENOENT 崩掉
  fs.writeFileSync(OUT+"\\测试截图\\"+n+".png", Buffer.from(r.result.data,"base64")); }
(async()=>{
  const checks=[], errors=[]; const assert=(ok,n)=>{ ok?checks.push(n):errors.push(n); };
  const chrome=spawn(CHROME,["--headless=new",`--remote-debugging-port=${PORT}`,"--window-size=1440,900",
    "--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader",
    `--user-data-dir=${OUT}\\_prof5`,"about:blank"],{stdio:"ignore"});
  for(let i=0;i<60;i++){ try{ await req("GET","/json/version"); break; }catch(e){ await sleep(400); } }
  const tab=await req("PUT","/json/new?"+encodeURIComponent(BASE+"/index.html"));
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  ws.onmessage=e=>{ const m=JSON.parse(e.data); if(m.id&&pend[m.id]){ pend[m.id](m); delete pend[m.id]; } };
  await send("Page.enable"); await send("Runtime.enable");
  await sleep(2500);
  await ev('localStorage.clear()'); await send("Page.navigate",{url:BASE+"/index.html"}); await sleep(2500);

  /* 打斗 */
  await ev('document.getElementById("dbgFight").click()'); await sleep(5000);
  await ev('document.getElementById("skipnode").click()'); await sleep(2500);
  let st=JSON.parse(await ev(`JSON.stringify({ on:document.getElementById("fight").classList.contains("on"),
    hp:(window.__cs2&&__cs2.fight)?__cs2.fight.hp:-1, foe:(window.__cs2&&__cs2.fight)?__cs2.fight.foeHp:-1 })`));
  console.log("[打斗] 面板:", st.on, "生命:", st.hp, "对手:", st.foe);
  assert(st.on===true, "打斗面板已打开");
  assert(st.hp>0 && st.foe>0, "双方生命初始化正常");
  // 驱动：一直直拳（含精准判定），直到结束
  let guard=0;
  while(guard++<40){
    const s=JSON.parse(await ev(`JSON.stringify({ on:document.getElementById("fight").classList.contains("on"),
      bar:document.getElementById("fightBar").style.display, ap:(window.__cs2&&__cs2.fight)?__cs2.fight.ap:0 })`));
    if(!s.on) break;
    if(s.bar && s.bar!=="none"){ await ev('document.getElementById("fightBar").click()'); }
    else if(s.ap>=1){ await ev('(window.__cs2&&__cs2.fight)?__cs2.fight.act("jab"):null'); }
    await sleep(420);
  }
  await sleep(2500);
  const fightDone=JSON.parse(await ev(`JSON.stringify({ on:document.getElementById("fight").classList.contains("on"),
    cine:document.getElementById("cine").classList.contains("on"), won:S.fightWon===true })`));
  console.log("[打斗] 结束:", JSON.stringify(fightDone));
  assert(fightDone.on===false, "打斗已结算（面板关闭）");
  await shot("lud_fight");

  /* 麻将 */
  await ev('localStorage.clear()'); await send("Page.navigate",{url:BASE+"/index.html"}); await sleep(2500);
  await ev('document.getElementById("dbgMj").click()');
  /* ⚠ 这里必须「等条件」而不是「等固定时间」：
     麻将节点带 2 段剧情视频（NODES.mahjong.shots 有 2 条），
     点 dbgMj 后要先看完两段才进牌局。原先 sleep(5000) 后直接断言手牌张数，
     实测视频还没放完 => 拿到 hand=0 => 误报「手牌 13 张」失败 + 「麻将已结算」失败。
     实测牌局真的发牌了：等够时间后 hand=14、wall=83。这是测试的时序竞态，不是游戏 bug。 */
  for(let i=0;i<40;i++){
    const on=await ev('document.getElementById("mj").classList.contains("on")');
    if(on===true) break;
    await ev('document.getElementById("skipnode").click()');
    await sleep(600);
  }
  // 再等到真发牌（手牌 13 张 = 已摸牌前的常态；庄家摸牌后 14 张也接受）
  let mjSt={on:false,hand:-1};
  for(let i=0;i<40;i++){
    mjSt=JSON.parse(await ev(`JSON.stringify({ on:document.getElementById("mj").classList.contains("on"),
      hand:(window.__cs2&&__cs2.mj)?__cs2.mj.hand().length:-1 })`));
    if(mjSt.on===true && mjSt.hand>=13) break;
    await sleep(400);
  }
  console.log("[麻将] 面板:", mjSt.on, "手牌:", mjSt.hand);
  assert(mjSt.on===true && mjSt.hand>=13, "麻将面板打开且手牌 13 张");
  // 用内置调试口直接判胡结算（比逐张 discard 驱动稳定：后者依赖随机牌型，常常等不到可胡）
  const mjWin = await ev('(window.__cs2&&__cs2.mj&&__cs2.mj.forceWin)?(__cs2.mj.forceWin(),true):false');
  await sleep(1200);
  // 结算后要点结算板的「继 续」(#mjmGo) 才走 onFinish 关面板 ——
  // 只调 forceWin 不点按钮，面板会一直停在结算页。
  const goClicked = await ev('(function(){var b=document.getElementById("mjmGo"); if(!b) return false; b.click(); return true;})()');
  await sleep(2500);
  const mjDone=JSON.parse(await ev(`JSON.stringify({ on:document.getElementById("mj").classList.contains("on"), win:S.mjWin===true })`));
  console.log("[麻将] 结束:", JSON.stringify(mjDone), "驱动胡牌:", mjWin, "点继续:", goClicked);
  assert(mjDone.on===false, "麻将已结算");
  await shot("lud_mahjong");

  /* 刮彩票 */
  await ev('localStorage.clear()'); await send("Page.navigate",{url:BASE+"/index.html"}); await sleep(2500);
  await ev('document.getElementById("startBtn").click()'); await sleep(2000);
  await ev('document.getElementById("skipnode").click()'); await sleep(1500);
  await ev('document.querySelectorAll("#choiceOpts .opt")[0].click()'); await sleep(3000);
  await ev('document.getElementById("lotteryBtn").click()'); await sleep(1200);
  const lot=JSON.parse(await ev(`JSON.stringify({ on:document.getElementById("lottery").classList.contains("on"),
    prize:(window.__cs2&&__cs2.lottery)?__cs2.lottery.prize:-1, cash:S.stats.cash })`));
  console.log("[刮彩票]", JSON.stringify(lot));
  assert(lot.on===true, "刮彩票面板打开");
  assert(lot.prize>=0, "已生成奖面（奖额 " + lot.prize + "）");
  await shot("lud_lottery");
  await ev('(window.__cs2&&__cs2.lottery)?__cs2.lottery.finish():null'); await sleep(1200);
  const after=JSON.parse(await ev(`JSON.stringify({ cash:S.stats.cash, revealed:(window.__cs2.lottery||{}).revealed })`));
  console.log("[刮彩票] 揭晓后:", JSON.stringify(after));
  assert(after.revealed===true, "刮开后可揭晓并结算");
  await shot("lud_lottery_open");

  const res={ success:errors.length===0, testedAt:new Date().toISOString(), checks, errors };
  fs.writeFileSync(resultsFile("leisure-results.json"), JSON.stringify(res,null,1),"utf8");
  console.log(`[结果] 通过 ${checks.length}，失败 ${errors.length}` + (errors.length?(" | "+errors.join(" | ")):""));
  chrome.kill(); process.exit(errors.length?1:0);
})().catch(e=>{ console.error("FATAL",e); process.exit(1); });
