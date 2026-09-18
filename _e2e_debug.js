// 验证调试跳转：点「跳到谈判」→ 应直接进入谈判玩法
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9227;
const OUT = "C:\\Users\\chris\\Desktop\\重生2-原型";
const BASE = "file:///C:/Users/chris/Desktop/" + encodeURIComponent("重生2-原型");
const sleep = ms => new Promise(r => setTimeout(r, ms));
function req(method, path){ return new Promise((res,rej)=>{ const r=http.request({host:"127.0.0.1",port:PORT,path,method},resp=>{let d="";resp.on("data",c=>d+=c);resp.on("end",()=>{try{res(JSON.parse(d))}catch(e){res(d)}});}); r.on("error",rej); r.end(); }); }
let id=0, ws, pend={};
function send(m,p){ return new Promise((res,rej)=>{ const i=++id; pend[i]=res; ws.send(JSON.stringify({id:i,method:m,params:p||{}})); setTimeout(()=>{ if(pend[i]){delete pend[i];rej(new Error("timeout "+m));} },60000); }); }
async function ev(e){ const r=await send("Runtime.evaluate",{expression:e,returnByValue:true});
  if(r.result&&r.result.exceptionDetails) return "EXC:"+((r.result.exceptionDetails.exception||{}).description||"");
  return r.result&&r.result.result?r.result.result.value:undefined; }
(async()=>{
  const chrome=spawn(CHROME,["--headless=new",`--remote-debugging-port=${PORT}`,"--window-size=1440,900",
    "--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader",
    `--user-data-dir=${OUT}\\_prof4`,"about:blank"],{stdio:"ignore"});
  for(let i=0;i<60;i++){ try{ await req("GET","/json/version"); break; }catch(e){ await sleep(400); } }
  const tab=await req("PUT","/json/new?"+encodeURIComponent(BASE+"/index.html"));
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  ws.onmessage=e=>{ const m=JSON.parse(e.data); if(m.id&&pend[m.id]){ pend[m.id](m); delete pend[m.id]; } };
  await send("Page.enable"); await send("Runtime.enable");
  await sleep(2500);
  await ev('localStorage.removeItem("cs2_save")'); await send("Page.navigate",{url:BASE+"/index.html"}); await sleep(2500);
  const checks=[], errors=[];
  const assert=(ok,n)=>{ ok?checks.push(n):errors.push(n); };
  assert(await ev('!!document.getElementById("dbgJump")')===true, "标题屏存在「跳到谈判」按钮");
  await ev('document.getElementById("dbgJump").click()');
  await sleep(5000);
  await ev('document.getElementById("skipnode").click()'); await sleep(2500);   // 跳过该节点镜头，直达谈判
  const st=JSON.parse(await ev(`JSON.stringify({ cine:document.getElementById("cine").classList.contains("on"),
    node:(typeof curNode!=="undefined"&&curNode)?curNode.id:null,
    talk:document.getElementById("talk").classList.contains("on"),
    over:document.getElementById("talkNum")?document.getElementById("talkNum").textContent.slice(0,60):"",
    done:(typeof S!=="undefined")?S.done.length:-1, hong:S?S.bonds.hong:-1, man:S?S.bonds.man:-1 })`));
  console.log("[调试跳转]", JSON.stringify(st));
  assert(st.node==="negotiate", "已直接进入 negotiate 节点");
  assert(st.talk===true, "谈判玩法面板已打开");
  assert(st.done===15, `前置已解锁 ${st.done} 个节点`);
  assert(st.hong>=20 && st.man>=20, "羁绊加成条件满足（红姐/顾曼 ≥20）");
  const r=await send("Page.captureScreenshot",{format:"png"});
  fs.writeFileSync(OUT+"\\测试截图\\debug_jump_talk.png", Buffer.from(r.result.data,"base64"));
  console.log(`[结果] 通过 ${checks.length}，失败 ${errors.length}` + (errors.length?(" | "+errors.join(" | ")):""));
  chrome.kill(); process.exit(errors.length?1:0);
})().catch(e=>{ console.error("FATAL",e); process.exit(1); });
