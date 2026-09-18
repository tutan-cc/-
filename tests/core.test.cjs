// 单元测试：从 index.html 抽出纯数据/纯逻辑内核，用 vm 注入后断言
// 运行：node --test tests/core.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const SCRIPT = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];

// 抽出「数据段」：PLACES … 到音频层之前（纯数据，无 DOM 依赖）
function loadData() {
  const src = SCRIPT.slice(SCRIPT.indexOf("const PLACES"), SCRIPT.indexOf("/* ═══════════════ 音频层"));
  const ctx = vm.createContext({ console });
  vm.runInContext(src + "\n;globalThis.__D={PLACES,BONDS,STATS,NODES,QUIZSETS,ACHV};", ctx);
  return ctx.__D;
}
// 抽出「装备/状态内核」：ITEMS + bonus/restore（依赖 NODES/ACHV，故一并注入数据段）
function loadCore() {
  const data = SCRIPT.slice(SCRIPT.indexOf("const PLACES"), SCRIPT.indexOf("/* ═══════════════ 音频层"));
  const core = SCRIPT.slice(SCRIPT.indexOf("const ITEMS = {"), SCRIPT.indexOf("/* ═══════════════ UI 工具"));
  const ctx = vm.createContext({ console, localStorage: { getItem: () => null, setItem: () => {} }, toast: () => {}, AudioSys: { good(){} } });
  vm.runInContext(data + "\n" + core + "\n;globalThis.__C={ITEMS,bonus,restore,newState,SLOTS,LEVELS,level,setState:function(v){S=v;},getState:function(){return S;}};", ctx);
  return ctx.__C;
}

test("所有节点的视频素材均存在于磁盘", () => {
  const D = loadData();
  const missing = [];
  for (const id in D.NODES) {
    const n = D.NODES[id];
    for (const s of (n.shots || []).concat(n.after || [])) {
      if (!s.v) continue;
      const f = path.join(ROOT, s.v.split("#t=")[0]);
      if (!fs.existsSync(f)) missing.push(`${id}: ${s.v}`);
    }
  }
  assert.deepEqual(missing, [], "缺少素材：" + missing.join(", "));
});

test("剧情图连通、无孤儿节点、可抵达全部章末卡", () => {
  const D = loadData();
  const seen = new Set();
  const walk = id => { if (seen.has(id)) return; seen.add(id); (D.NODES[id].next || []).forEach(walk); };
  walk("intro");
  const orphans = Object.keys(D.NODES).filter(id => !seen.has(id));
  assert.deepEqual(orphans, [], "孤儿节点：" + orphans.join(", "));
  const ends = Object.values(D.NODES).filter(n => n.end);
  assert.ok(ends.length >= 2, "至少两张章末卡");
  assert.ok(ends.every(n => seen.has(Object.keys(D.NODES).find(k => D.NODES[k] === n))), "章末卡均可抵达");
});

test("所有效果键、羁绊键、题库引用合法（引用白名单）", () => {
  const D = loadData();
  const bad = [];
  const chk = (r, tag) => {
    if (!r) return;
    for (const k in r) {
      if (["cash", "cha", "phy", "int", "item", "xp"].includes(k)) continue;
      if (k === "bondAll") continue;
      if (k === "flags") continue;
      if (k === "bond") { for (const b in r.bond) if (!D.BONDS[b]) bad.push(`${tag}: 未知羁绊 ${b}`); continue; }
      if (k === "bonus") { chk(r.bonus, tag + ".bonus"); continue; }
      if (k === "need") continue;
      bad.push(`${tag}: 未知效果键 ${k}`);
    }
  };
  for (const id in D.NODES) {
    const n = D.NODES[id];
    if (n.inter && n.inter.opts) n.inter.opts.forEach((o, i) => chk(o.r, `${id}.opt${i}`));
    if (n.inter) ["win", "part", "lose", "perfect", "ok", "miss"].forEach(k => chk(n.inter[k], `${id}.${k}`));
    if (n.inter && n.inter.type === "quiz") {
      const set = n.inter.quiz || "lib";
      assert.ok(D.QUIZSETS[set], `${id}: 题库 ${set} 不存在`);
    }
  }
  assert.deepEqual(bad, [], bad.join(" | "));
});

test("时间线单调递增，不会死锁", () => {
  const D = loadData();
  let prev = -1;
  for (const id of Object.keys(D.NODES)) {
    const n = D.NODES[id];
    const key = n.day * 3 + n.per;
    assert.ok(key >= prev, `${id} 时间回退：${key} < ${prev}`);
    prev = key;
  }
});

test("装备加成只作用于玩法参数，不改四维", () => {
  const C = loadCore();
  const s = C.newState();
  s.rpg.owned = ["wrist", "sneakers", "notes"];
  s.rpg.equipped = { hand: "wrist", outfit: "sneakers", accessory: "notes" };
  const snapshot = JSON.stringify(s.stats);
  C.setState(s); const b = C.bonus();
  assert.equal(b.window, 0.06, "缠手带 → 判定窗口 +6%");
  assert.equal(b.hp, 1, "跑鞋 → 生命 +1");
  assert.equal(b.capital, 600, "内幕笔记 → 本金 +600");
  assert.equal(JSON.stringify(s.stats), snapshot, "四维未被装备改动");
});

test("存档校验：坏档一律拒绝，旧档自动迁移", () => {
  const C = loadCore();
  assert.equal(C.restore("not json"), null, "非 JSON 拒绝");
  assert.equal(C.restore(JSON.stringify({ stats: {}, bonds: {} })), null, "缺字段拒绝");
  const badNode = C.newState(); badNode.done = ["不存在的节点"];
  assert.equal(C.restore(JSON.stringify(badNode)), null, "未知节点 id 拒绝（引用白名单）");
  const badStat = C.newState(); badStat.stats.cash = -5;
  assert.equal(C.restore(JSON.stringify(badStat)), null, "负数值拒绝");
  const legacy = C.newState(); delete legacy.rpg; delete legacy.flags;
  const ok = C.restore(JSON.stringify(legacy));
  assert.ok(ok && ok.rpg && Array.isArray(ok.flags), "旧档缺 rpg/flags 时自动补齐（缺省即重建）");
});

test("中途续播快照：合法快照保留，非法快照丢弃", () => {
  const C = loadCore();
  const good = C.newState(); good.active = { node: "rent", phase: "shots", shot: 1 };
  assert.equal(JSON.stringify(C.restore(JSON.stringify(good)).active), JSON.stringify(good.active));
  const bad = C.newState(); bad.active = { node: "rent", phase: "shots", shot: 999 };
  assert.equal(C.restore(JSON.stringify(bad)).active, null, "越界镜头下标丢弃");
  const done = C.newState(); done.done = ["rent"]; done.active = { node: "rent", phase: "shots", shot: 0 };
  assert.equal(C.restore(JSON.stringify(done)).active, null, "已完成节点不再续播");
});

/* ── 早餐店（S.breakfastDay / bfWin / bfLast）：旧档必须照样是合法档，新字段缺省即补 ── */
test("早餐店存档字段：旧档缺 breakfastDay 不判坏档，脏数据被清洗", () => {
  const C = loadCore();
  // 1) 老版本存档（完全没有早餐店字段）→ 仍须通过校验，并补出干净默认值
  const old = C.newState();
  delete old.breakfastDay; delete old.bfWin; delete old.bfLast;
  const o = C.restore(JSON.stringify(old));
  assert.ok(o, "缺早餐店字段的旧档不应判坏档");
  assert.equal(JSON.stringify(o.breakfastDay), JSON.stringify({ day:0, sent:[] }), "缺省 → 补空记录");
  assert.equal(o.bfWin, false);
  assert.equal(o.bfLast, null);
  // 2) 正常记录原样保留
  const s = C.newState();
  s.breakfastDay = { day:7, sent:["su","guo"] };
  s.bfWin = true;
  s.bfLast = { target:"su", win:true, served:8, goal:8, perfect:6, burnt:1, score:120, delta:8, day:7, t:123 };
  const r = C.restore(JSON.stringify(s));
  assert.ok(r, "带早餐店字段的档合法");
  assert.equal(JSON.stringify(r.breakfastDay), JSON.stringify({ day:7, sent:["su","guo"] }));
  assert.equal(r.bfWin, true);
  assert.equal(r.bfLast.target, "su");
  assert.equal(r.bfLast.delta, 8);
  // 3) 脏数据：只保留白名单内的角色 id、去重、限制长度；越界数值夹回区间
  const d = C.newState();
  d.breakfastDay = { day: "x", sent:["su","su","不存在","guo", 123, null] };
  d.bfWin = "yes";
  d.bfLast = { target:"不存在的人", win:"maybe", delta:999, goal:-5 };
  const rd = C.restore(JSON.stringify(d));
  assert.ok(rd, "字段脏也不该把整档判坏");
  assert.equal(JSON.stringify(rd.breakfastDay), JSON.stringify({ day:0, sent:["su","guo"] }), "白名单 + 去重 + day 夹回");
  assert.equal(rd.bfWin, false, "非布尔 true 一律视为 false");
  assert.equal(rd.bfLast, null, "未知目标 id 的 bfLast 丢弃");
  // 4) 数值越界夹紧
  const c2 = C.newState();
  c2.breakfastDay = { day: 99999, sent: [] };
  c2.bfLast = { target:"man", win:true, served: -3, goal: 0, perfect: 1e9, burnt: -1, score: 1e12, delta: -99, day: -9, t: "x" };
  const r2 = C.restore(JSON.stringify(c2));
  assert.ok(r2.bfLast, "已知目标保留");
  assert.equal(r2.breakfastDay.day, 99, "day 上限 99");
  assert.equal(r2.bfLast.served, 0); assert.equal(r2.bfLast.goal, 1, "目标数夹到下限 1（不合法即夹紧，非数字才回落默认 8）");
  assert.equal(r2.bfLast.delta, -10, "好感变化夹到 -10");
  assert.equal(r2.bfLast.day, 0, "负天数夹回 0");
  assert.equal(r2.bfLast.t, 0, "非数字时间戳归零");
});
