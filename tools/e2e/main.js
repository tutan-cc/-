// CDP 驱动：完整跑通 重生2 原型 demo 全流程 + 视频状态验证
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9223;
const BASE = "file:///C:/Users/chris/Desktop/" + encodeURIComponent("重生2-原型");
const OUT = "C:\\Users\\chris\\Desktop\\重生2-原型";

const sleep = ms => new Promise(r => setTimeout(r, ms));

function req(method, path) {
  return new Promise((res, rej) => {
    const r = http.request({ host: "127.0.0.1", port: PORT, path, method }, resp => {
      let d = ""; resp.on("data", c => d += c); resp.on("end", () => { try { res(JSON.parse(d)); } catch (e) { res(d); } });
    });
    r.on("error", rej); r.end();
  });
}

let msgId = 0, ws, pending = {};
function send(method, params) {
  return new Promise((res, rej) => {
    const id = ++msgId; pending[id] = res;
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending[id]) { delete pending[id]; rej(new Error("timeout " + method)); } }, 60000);
  });
}
async function evaljs(expr) { // 不 awaitPromise，立即返回
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${OUT}\\${name}.png`, Buffer.from(r.result.data, "base64"));
  console.log("[shot]", name);
}

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
    "--window-size=1440,860", "--autoplay-policy=no-user-gesture-required",
    `--user-data-dir=${OUT}\\_chromeprofile`, "about:blank"], { stdio: "ignore" });

  for (let i = 0; i < 60; i++) { try { await req("GET", "/json/version"); break; } catch (e) { await sleep(400); if (i === 59) throw new Error("CDP 不可达"); } }

  const tab = await req("PUT", "/json/new?" + encodeURIComponent(BASE + "/index.html"));
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };

  await send("Page.enable"); await send("Runtime.enable");

  /* ── 测试A：视频解码状态 ── */
  await send("Page.navigate", { url: BASE + "/_vtest.html" });
  await sleep(12000);
  const pix = await evaljs(`(()=>{const v=document.getElementById("v");
    return document.getElementById("st").textContent + " | rs=" + v.readyState + " net=" + v.networkState +
    " size=" + v.videoWidth + "x" + v.videoHeight + " t=" + v.currentTime.toFixed(1);})()`);
  console.log("[视频状态]", pix);

  /* ── 测试B：全流程 E2E ── */
  await send("Page.navigate", { url: BASE + "/index.html" });
  await sleep(3000);
  await shot("e2e_0_title");

  // 配音自检：进入序章后读取 VO 状态
  await evaljs(`document.getElementById("startBtn").click()`);
  await sleep(9000);
  const voState = await evaljs(`(()=>{ try{ return JSON.stringify({ src: (window.VO?VO.src:"").split("/").pop(),
    dur: (window.VO?VO.duration:0)||0, t: (window.VO?VO.currentTime:0)||0,
    err: (window.VO&&VO.error)? VO.error.code : 0, btn: document.getElementById("vobtn").textContent }); }
    catch(e){ return "EXC:"+e.message; } })()`);
  console.log("[配音自检]", voState);
  // 重新加载页面，确保驾驶从干净状态开始
  await send("Page.navigate", { url: BASE + "/index.html" });
  await sleep(2600);

  await evaljs(`
window.__driveLog = "running";
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const log = [];
  let endcards = 0;
  try {
    $("startBtn").click(); await sleep(1500);
    for (let step = 0; step < 1400; step++) {
      if ($("endcard").classList.contains("on")) { endcards++; log.push("ENDCARD_" + endcards);
        await sleep(1500); $("endBtn").click(); await sleep(1200); continue; }
      if ($("choice").classList.contains("on")) { log.push("CHOICE:" + curNode.id);
        document.querySelector("#choiceOpts .opt").click(); await sleep(900); continue; }
      if ($("quiz").classList.contains("on")) { const o = document.querySelectorAll("#quizOpts .opt");
        if (o.length && !window.__qz) { log.push("QUIZ"); window.__qz = 1; o[1].click();
          setTimeout(() => window.__qz = 0, 1500); } await sleep(900); continue; }
      if ($("qte").classList.contains("on")) { log.push("QTE:" + (curNode.inter.mode || "timing"));
        for (let k = 0; k < 4; k++) { window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
          await sleep(120); } await sleep(700); continue; }
      if ($("dodge").classList.contains("on")) { log.push("DODGE");
        const dir = Math.random() < 0.5 ? "ArrowLeft" : "ArrowRight";
        window.dispatchEvent(new KeyboardEvent("keydown", { code: dir, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keyup", { code: dir, bubbles: true }));
        await sleep(260); continue; }
      if ($("stock").classList.contains("on")) { log.push("STOCK");
        const b = document.querySelector('#stockBtns .mbtn[data-act="buy"]') || document.querySelector("#stockBtns .mbtn");
        if (b) b.click(); await sleep(900); continue; }
      if ($("dcard").classList.contains("on")) { await sleep(600); continue; }
      if ($("circuit").classList.contains("on")) { log.push("CIRCUIT");
        const ang = (window.__cs2 && __cs2.cirAngles) || [0,0,0];
        const btns = document.querySelectorAll("#cirRow button");
        for (let i=0;i<btns.length;i++){ const need=(4-ang[i])%4;
          for (let k=0;k<need;k++){ btns[i].click(); await sleep(140); } }
        await sleep(500); continue; }
      if ($("talk").classList.contains("on")) { log.push("TALK");
        const T = (window.__cs2 && __cs2.talk) || null;
        if (T) { if (T.ap >= 2) T.act("press"); else T.act("give"); }
        await sleep(450); continue; }
      if ($("memory").classList.contains("on")) { log.push("MEMORY");
        const seq = (window.__cs2 && __cs2.memSeq) || [];
        await sleep(1600 + seq.length*700);
        const pads = document.querySelectorAll("#memPad button");
        for (const idx of seq){ if (pads[idx]) pads[idx].click(); await sleep(300); }
        await sleep(1000); continue; }
      if ($("cine").classList.contains("on")) { const c = $("cont");
        if (c.classList.contains("on")) c.click(); await sleep(650); continue; }
      const hot = document.querySelector(".hotspot.avail");
      if (hot) { log.push("MAP->" + hot.dataset.node);
        hot.dispatchEvent(new MouseEvent("click", { bubbles: true })); await sleep(1800); continue; }
      if (S.done.length >= Object.keys(NODES).length) { log.push("ALL_DONE"); break; }
      await sleep(600);
    }
  } catch (e) { log.push("ERR:" + e.message); }
  window.__driveLog = log.join(" > ");
})(); "driver started"`);

  const taken = new Set();
  const t0 = Date.now();
  let endSeen = 0;
  while (Date.now() - t0 < 900000) {
    await sleep(2500);
    let st;
    try {
      st = await evaljs(`(()=>{
        const $ = id => document.getElementById(id);
        if ($("endcard").classList.contains("on")) return "ENDCARD";
        if ($("quiz").classList.contains("on")) return "QUIZ";
        if ($("qte").classList.contains("on")) return "QTE";
        if ($("dodge").classList.contains("on")) return "DODGE";
        if ($("stock").classList.contains("on")) return "STOCK";
        if ($("circuit").classList.contains("on")) return "CIRCUIT";
        if ($("memory").classList.contains("on")) return "MEMORY";
        if ($("talk").classList.contains("on")) return "TALK";
        if ($("dcard").classList.contains("on")) return "CARD";
        if ($("choice").classList.contains("on")) return "CHOICE_" + (window.curNode ? curNode.id : "");
        if ($("cine").classList.contains("on")) return "CINE_" + (window.curNode ? curNode.id : "");
        return "MAP";
      })()`);
    } catch (e) { continue; }
    if (st && !taken.has(st) && (["QUIZ", "QTE", "DODGE", "STOCK", "CIRCUIT", "MEMORY", "TALK", "CARD"].includes(st) || /^(CHOICE|CINE)_/.test(st))) {
      taken.add(st); try { await shot("e2e_" + st); } catch (e) {}
    }
    if (st === "ENDCARD") { endSeen++; if (!taken.has("ENDCARD" + endSeen)) { taken.add("ENDCARD" + endSeen); try { await shot("e2e_ENDCARD" + endSeen); } catch (e) {} } }
    const dl = await evaljs("window.__driveLog");
    if (dl && dl !== "running") break;
  }
  const result = (await evaljs("window.__driveLog")) || "";
  console.log("[E2E 路径]", result);
  const fin = JSON.parse(await evaljs(`JSON.stringify({ done: S.done, stats: S.stats, bonds: S.bonds, achv: S.achv, day: S.day, flags: S.flags, rpg: S.rpg })`));
  console.log("[最终状态]", JSON.stringify(fin));
  try { await shot("e2e_final"); } catch (e) {}

  /* ── 验收契约：断言即记录 → dist/test-results/e2e-results.json ── */
  const checks = [], errors = [];
  const assert = (ok, name) => { if (ok) checks.push(name); else errors.push(name); };
  const nodeTotal = await evaljs("Object.keys(NODES).length");
  assert(fin.done.length === nodeTotal, `全部 ${nodeTotal} 个节点通关（实际 ${fin.done.length}）`);
  assert(/ENDCARD_2/.test(result), "两张章末结算卡均已出现");
  assert(/QUIZ/.test(result) && /QTE:/.test(result), "答题与 QTE 均已执行");
  assert(/DODGE/.test(result) && /STOCK/.test(result), "躲避与股市小游戏均已执行");
  assert(/CIRCUIT/.test(result) && /MEMORY/.test(result) && /TALK/.test(result), "线路取证、信号复原、谈判博弈均已执行");
  assert(fin.rpg && Array.isArray(fin.rpg.owned) && fin.rpg.owned.length > 0, `装备系统生效（获得 ${fin.rpg ? fin.rpg.owned.length : 0} 件）`);
  assert(fin.achv.length >= 3, `成就解锁 ${fin.achv.length} 枚`);
  const results = { success: errors.length === 0, testedAt: new Date().toISOString(),
    checks, errors, error: null, path: result, state: fin };
  fs.mkdirSync(OUT + "\\tests", { recursive: true });
  fs.writeFileSync(OUT + "\\dist\\test-results\\e2e-results.json", JSON.stringify(results, null, 1), "utf8");
  console.log(`[验收] 通过 ${checks.length} 项，失败 ${errors.length} 项 → dist/test-results/e2e-results.json`);

  chrome.kill();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });

