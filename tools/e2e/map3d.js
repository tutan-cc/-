// 3D 地图验收：Map3D 是否就绪、截图、与游戏联动
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const { resultsFile } = require("../lib/dist.js");
const path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9226;
const OUT = path.join(__dirname, "..", "..");
const BASE = "file:///" + OUT.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
const sleep = ms => new Promise(r => setTimeout(r, ms));
function req(method, path){ return new Promise((res,rej)=>{ const r=http.request({host:"127.0.0.1",port:PORT,path,method},resp=>{let d="";resp.on("data",c=>d+=c);resp.on("end",()=>{try{res(JSON.parse(d))}catch(e){res(d)}});}); r.on("error",rej); r.end(); }); }
let id=0, ws, pend={};
function send(m,p){ return new Promise((res,rej)=>{ const i=++id; pend[i]=res; ws.send(JSON.stringify({id:i,method:m,params:p||{}})); setTimeout(()=>{ if(pend[i]){delete pend[i];rej(new Error("timeout "+m));} },25000); }); }
async function ev(e){ const r=await send("Runtime.evaluate",{expression:e,returnByValue:true});
  if(r.result && r.result.exceptionDetails) return "EXC:"+((r.result.exceptionDetails.exception||{}).description||r.result.exceptionDetails.text);
  return r.result&&r.result.result?r.result.result.value:undefined; }
async function shot(n){ const r=await send("Page.captureScreenshot",{format:"png"});
  fs.mkdirSync(path.join(OUT,"测试截图"),{recursive:true});   // 干净 clone 上目录不存在，不自建会 ENOENT 崩掉
  fs.writeFileSync(path.join(OUT,"测试截图",n+".png"), Buffer.from(r.result.data,"base64")); }
(async()=>{
  const chrome=spawn(CHROME,["--headless=new",`--remote-debugging-port=${PORT}`,"--window-size=1440,900", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--disable-gpu-sandbox",
    `--user-data-dir=${OUT}\\_prof3`,"about:blank"],{stdio:"ignore"});
  for(let i=0;i<60;i++){ try{ await req("GET","/json/version"); break; }catch(e){ await sleep(400); } }
  const tab=await req("PUT","/json/new?"+encodeURIComponent(BASE+"/index.html"));
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  ws.onmessage=e=>{ const m=JSON.parse(e.data); if(m.id&&pend[m.id]){ pend[m.id](m); delete pend[m.id]; } };
  await send("Page.enable"); await send("Runtime.enable");
  await sleep(2500);
  const checks=[], errors=[];
  const assert=(ok,name)=>{ ok?checks.push(name):errors.push(name); };

  // WebGL 能力探测 + 失败原因
  const gl = await ev(`(()=>{try{
    const c=document.createElement("canvas"); c.width=c.height=64;
    const g=c.getContext("webgl")||c.getContext("experimental-webgl");
    if(!g) return "no-webgl-context";
    const dbg=g.getExtension("WEBGL_debug_renderer_info");
    return "webgl:"+(dbg?g.getParameter(dbg.UNMASKED_RENDERER_WEBGL):"unknown");
  }catch(e){ return "exc:"+e.message }})()`);
  console.log("[WebGL 探测]", gl);
  const lastErr = await ev(`(window.Map3D && Map3D.__lastError) ? Map3D.__lastError : "(无)"`);
  console.log("[Map3D 上次错误]", lastErr);
  // 模块是否加载
  assert(await ev("typeof window.Map3D==='object'")===true, "map3d.js 已加载并暴露 window.Map3D");
  assert(await ev("typeof THREE!=='undefined'")===true, "three.min.js 已加载");

  // 进入游戏 → 初始化 3D
  await ev('document.getElementById("startBtn").click()');
  await sleep(4000);
  const st=JSON.parse(await ev(`JSON.stringify({ ready:(typeof map3dReady!=="undefined")?map3dReady:null,
     on:(document.getElementById("map3d")||{}).className||"", svg:(document.getElementById("map")||{}).style?document.getElementById("map").style.display:"",
     btn:(document.getElementById("mapbtn")||{}).textContent||"", places:Object.keys(PLACES).length })`));
  console.log("[3D 状态]", JSON.stringify(st));
  assert(st.ready===true, "Map3D.mount 返回 true（WebGL 可用）");
  assert(/on/.test(st.on), "3D 容器已显示");
  assert(st.svg==="none", "3D 模式下 2D SVG 已隐藏");
// 跳过序章回到沙盘，才能看到 3D 地图
  await ev('document.getElementById("skipnode").click()'); await sleep(1200);
  await ev('(()=>{ const c=document.querySelector("#choiceOpts .opt"); if(c) c.click(); return true })()'); await sleep(3500);
  await ev('(()=>{ const $=id=>document.getElementById(id); if($("cine").classList.contains("on")) $("skipnode").click(); return true })()'); await sleep(2500);
  const st2=JSON.parse(await ev(`JSON.stringify({ cine:document.getElementById("cine").classList.contains("on"),
    ready:(typeof map3dReady!=="undefined")?map3dReady:null, on:document.getElementById("map3d").className })`));
  console.log("[回到沙盘]", JSON.stringify(st2));
  assert(st2.cine===false, "已回到沙盘（电影层关闭）");
  assert(st2.ready===true && /on/.test(st2.on), "沙盘处于 3D 模式");
  await sleep(1200); await shot("map3d_game");

  // 建筑数量 & 拾取回调可用
  const cnt=await ev(`(()=>{try{ const s=(window.__map3dScene&&__map3dScene.children)||null; return s? s.length : -1 }catch(e){ return -2 }})()`);
  console.log("[场景节点数]", cnt);

  // 切到 2D 再切回 3D
  await ev('document.getElementById("mapbtn").click()'); await sleep(800);
  const svg2=await ev('document.getElementById("map").style.display');
  assert(svg2!=="none", "可切回 2D 沙盘");
  await ev('document.getElementById("mapbtn").click()'); await sleep(800);
  await shot("map3d_toggle");

  // 面板：等级/商店
  await ev('document.getElementById("equipBtn").click()'); await sleep(600);
  const panel=JSON.parse(await ev(`JSON.stringify({ on:document.getElementById("equip").classList.contains("on"),
    title:document.getElementById("chTitle").textContent, tabs:document.querySelectorAll("#chTabs .ctab").length })`));
  console.log("[角色面板]", JSON.stringify(panel));
  assert(panel.on===true && panel.tabs===3, "角色面板含 装备/背包/商店 三个标签");
  await shot("panel_gear");
  await ev('document.querySelectorAll("#chTabs .ctab")[2].click()'); await sleep(500);
  const shop=await ev('document.getElementById("shopList").children.length');
  assert(shop>=4, `商店商品数 ${shop} ≥ 4`);
  await shot("panel_shop");

  const results={ success:errors.length===0, testedAt:new Date().toISOString(), checks, errors, map3d:st, panel };
  fs.writeFileSync(resultsFile("map3d-results.json"), JSON.stringify(results,null,1),"utf8");
  console.log(`[3D验收] 通过 ${checks.length} 项，失败 ${errors.length} 项`);
  if(errors.length) console.log("失败项:", errors.join(" | "));
  chrome.kill(); process.exit(errors.length?1:0);
})().catch(e=>{ console.error("FATAL",e); process.exit(1); });
