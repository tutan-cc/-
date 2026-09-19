// 诊断测试：index.html 单独放在没有 video/ 的目录里（模拟"直接在压缩包里打开"）
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9224;
const OUT = path.join(__dirname, "..", "..");
const DIR = path.join(OUT, "dist", "_solo_test");
const BASE = "file:///" + OUT.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
const sleep = ms => new Promise(r => setTimeout(r, ms));
function req(method, path){ return new Promise((res,rej)=>{ const r=http.request({host:"127.0.0.1",port:PORT,path,method},resp=>{let d="";resp.on("data",c=>d+=c);resp.on("end",()=>{try{res(JSON.parse(d))}catch(e){res(d)}});}); r.on("error",rej); r.end(); }); }
let id=0, ws, pend={};
function send(m,p){ return new Promise((res,rej)=>{ const i=++id; pend[i]=res; ws.send(JSON.stringify({id:i,method:m,params:p||{}})); setTimeout(()=>{ if(pend[i]){delete pend[i];rej(new Error("timeout "+m));} },20000); }); }
async function ev(e){ const r=await send("Runtime.evaluate",{expression:e,returnByValue:true}); return r.result&&r.result.result?r.result.result.value:undefined; }
(async()=>{
  fs.mkdirSync(DIR,{recursive:true});
  fs.copyFileSync(path.join(OUT, "index.html"), path.join(DIR, "index.html"));
  const chrome=spawn(CHROME,["--headless=new",`--remote-debugging-port=${PORT}`,"--window-size=1440,860",
    `--user-data-dir=${DIR}\\_prof`,"about:blank"],{stdio:"ignore"});
  for(let i=0;i<60;i++){ try{ await req("GET","/json/version"); break; }catch(e){ await sleep(400); } }
  const tab=await req("PUT","/json/new?"+encodeURIComponent(BASE+"/index.html"));
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  ws.onmessage=e=>{ const m=JSON.parse(e.data); if(m.id&&pend[m.id]){ pend[m.id](m); delete pend[m.id]; } };
  await send("Page.enable"); await send("Runtime.enable");
  await sleep(2000);
  await ev('document.getElementById("startBtn").click()');
  await sleep(9000);
  const st=await ev(`(()=>{const $=id=>document.getElementById(id);return JSON.stringify({
    warn:$("mediawarn").classList.contains("on"),
    warnCode:$("mwCode").textContent,
    posterOn:$("poster").classList.contains("on"),
    shotbgOn:$("shotbg").classList.contains("on"),
    fxOn:$("fx").classList.contains("on"),
    contOn:$("cont").classList.contains("on"),
    sub:$("sub").textContent.slice(0,20)
  })})()`);
  console.log("[无 video 目录诊断]", st);
  const shot=await send("Page.captureScreenshot",{format:"png"});
  fs.writeFileSync(DIR+"\\solo_fallback.png", Buffer.from(shot.result.data,"base64"));
  console.log("[截图]", DIR+"\\solo_fallback.png");
  chrome.kill(); process.exit(0);
})().catch(e=>{ console.error("FATAL",e); process.exit(1); });
