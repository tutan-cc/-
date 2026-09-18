// 定位配音接入后的运行时报错
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9225;
const BASE = "file:///C:/Users/chris/Desktop/" + encodeURIComponent("重生2-原型");
const sleep = ms => new Promise(r => setTimeout(r, ms));
function req(method, path){ return new Promise((res,rej)=>{ const r=http.request({host:"127.0.0.1",port:PORT,path,method},resp=>{let d="";resp.on("data",c=>d+=c);resp.on("end",()=>{try{res(JSON.parse(d))}catch(e){res(d)}});}); r.on("error",rej); r.end(); }); }
let id=0, ws, pend={};
function send(m,p){ return new Promise((res,rej)=>{ const i=++id; pend[i]=res; ws.send(JSON.stringify({id:i,method:m,params:p||{}})); setTimeout(()=>{ if(pend[i]){delete pend[i];rej(new Error("timeout "+m));} },20000); }); }
async function ev(e){ const r=await send("Runtime.evaluate",{expression:e,returnByValue:true});
  if(r.result && r.result.exceptionDetails) return "EXC: "+(r.result.exceptionDetails.exception&&r.result.exceptionDetails.exception.description||r.result.exceptionDetails.text);
  return r.result&&r.result.result?r.result.result.value:undefined; }
(async()=>{
  const chrome=spawn(CHROME,["--headless=new",`--remote-debugging-port=${PORT}`,"--window-size=1440,860",
    "--user-data-dir=C:\\Users\\chris\\Desktop\\重生2-原型\\_prof2","about:blank"],{stdio:"ignore"});
  for(let i=0;i<60;i++){ try{ await req("GET","/json/version"); break; }catch(e){ await sleep(400); } }
  const tab=await req("PUT","/json/new?"+encodeURIComponent(BASE+"/index.html"));
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  ws.onmessage=e=>{ const m=JSON.parse(e.data);
    if(m.method==="Runtime.exceptionThrown"){ const d=m.params.exceptionDetails;
      console.log("[异常]", (d.exception&&d.exception.description)||d.text, "@line", d.lineNumber); }
    if(m.method==="Runtime.consoleAPICalled" && ["error","warning"].includes(m.params.type)){
      console.log("[console."+m.params.type+"]", (m.params.args||[]).map(a=>a.value||a.description).join(" ")); }
    if(m.id&&pend[m.id]){ pend[m.id](m); delete pend[m.id]; } };
  await send("Page.enable"); await send("Runtime.enable");
  await sleep(2500);
  console.log("[点击开始]", await ev('document.getElementById("startBtn").click(), "clicked"'));
  await sleep(9000);
  console.log("[状态]", await ev(`(()=>{const $=id=>document.getElementById(id);return JSON.stringify({
    titleHidden:$("title").classList.contains("hide"), gameOn:$("game").classList.contains("on"),
    cineOn:$("cine").classList.contains("on"), contOn:$("cont").classList.contains("on"),
    sub:$("sub").textContent.slice(0,16), voSrc:(typeof VO!=="undefined"?VO.src:"").split("/").pop(),
    voDur: (typeof VO!=="undefined")? (VO.duration||0):-1,
    voT: (typeof VO!=="undefined")? (VO.currentTime||0):-1,
    voErr: (typeof VO!=="undefined" && VO.error)? VO.error.code : 0,
    voOn: (typeof S!=="undefined")? S.voOn : null })})()`));
  chrome.kill(); process.exit(0);
})().catch(e=>{ console.error("FATAL",e); process.exit(1); });
