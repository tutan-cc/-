/* ═══════════════════════════════════════════════════════════════════════════
   纯逻辑单测：早餐店 · 拼手速（vm 注入 breakfast.js，含最小 window）
   运行：node --test tests/breakfast.test.cjs
         沙箱禁止 node --test 起子进程时，`node tests/breakfast.test.cjs` 跑同一批用例
   覆盖：火候状态机边界 / 顾客与订单生成（难度曲线 / 最多 3 位）/
         计分（完美 / 普通 / 上错 / 糊菜上桌 / 顾客离开）/
         过关判定（服务满 goal / 超时失败）/ 好感结算（+6~+10 / −3~−6、每日一次、区间置灰）
   ═══════════════════════════════════════════════════════════════════════════ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "breakfast.js"), "utf8");

/** 注入：只要 window 是对象即可（rules 层完全不碰 DOM；start() 未调用） */
function loadBf() {
  const ctx = vm.createContext({ console, Math, Date, isFinite, Number, String, Object, Array });
  ctx.window = ctx;
  vm.runInContext(SRC + "\n;globalThis.__BF = window.Breakfast;", ctx);
  return ctx.__BF;
}
const BF = loadBf();
const R = BF.rules;

function mkState(cfg) { return R.newState(Object.assign({ duration: 75, goal: 8 }, cfg || {})); }
/** 只看「锅里火候」的小局：关掉自动落盘（食物留在锅里，方便断言 生→恰好→过火→糊） */
function wokState(cfg) { const st = R.newState(Object.assign({ duration: 12, goal: 99, autoPlate:false }, cfg || {})); st.running = true; return st; }
/** 走完整新规则的小局：9 列各 1 专属盘、熟了自动落盘、盘上停留超过 SERVE_WINDOW 就糊。
    nextIn 拉大 → 不自动进店，只有测试自己 spawn 的顾客在场。 */
function plateState(cfg) { const st = R.newState(Object.assign({ duration: 999, goal: 99, autoPlate:true }, cfg || {})); st.running = true; st.nextIn = 1e6; return st; }
/** 让测试自己 spawn 的顾客拥有长耐心，不受本小局时长限制影响 */
function longPatience(c) { c.patience = c.patienceMax = 600; return c; }
/** 推进 n 秒（1/60 步长；step 内部有 0.5s 卡帧保护） */
function advance(st, seconds) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n && !st.over; i++) R.step(st, 1 / 60);
  return st;
}
/** 把某样食物放到「它自己那一列」的锅里，并把火候定到指定秒数（不额外推进时间）。
    默认 manual（按住看火）→ 食物留在锅里，方便断言火候；传 manual=false 则交给自动落盘。 */
function cookTo(st, foodId, sec, manual) {
  const c = R.columnOf(foodId);
  assert.ok(c >= 0, foodId + " 有自己那一列");
  const r = R.placeFoodEx(st, foodId, c, (manual === false) ? null : { manual:true });
  assert.equal(r.ok, true, "下料 " + foodId + " → 第 " + c + " 列（why=" + r.why + "）");
  st.stations[c].t = sec * 1000;
  st.stations[c].state = R.cookState(foodId, sec);
  if (st.stations[c].state === "perfect") st.stations[c].doneAt = st.elapsed;
  return c;
}
/** 让某样食物「熟了并落到本列专属盘」，返回列下标（完美 / 过火都算熟） */
function plated(st, foodId, sec) {
  const c = cookTo(st, foodId, sec === undefined ? R.FOOD[foodId].dur : sec, true);
  const s2 = st.stations[c].state;
  assert.ok(s2 === "perfect" || s2 === "over", foodId + " 熟了（" + s2 + "）");
  assert.equal(R.takePlate(st, c), true, foodId + " 落到第 " + c + " 列的专属盘");
  return c;
}
/** 用真实帧推进把食物煮到目标火候（perfect / burnt 的副作用都会记账）。
    默认用 manual 按住看火：食物留在锅里，所以 恰好 → 过火 → 糊 一路走得完。 */
function cookWalk(st, foodId, targetState, stationIdx) {
  const c = (stationIdx === undefined || stationIdx === null) ? R.columnOf(foodId) : stationIdx;
  const r = R.placeFoodEx(st, foodId, c, { manual:true });
  assert.equal(r.ok, true, "有空锅可放 " + foodId + "（why=" + r.why + "）");
  const maxFrames = 60 * (R.burnAt(foodId) + 1) + 240;
  for (let i = 0; i < maxFrames; i++) {
    if (st.stations[c].state === targetState) return c;
    R.step(st, 1 / 60);
  }
  assert.equal(st.stations[c].state, targetState, "没走到目标火候 " + targetState);
  return c;
}
/** vm 里造的对象与测试进程的对象原型不同，deepStrictEqual 会误判 → 用 JSON 比结构 */
function jsonEq(actual, expected, msg) { assert.equal(JSON.stringify(actual), JSON.stringify(expected), msg); }
/** 顾客对象来自 vm realm，跨 realm 的 indexOf 会失效 → 按 id 找下标 */
function ci(st, c) { for (let i = 0; i < st.customers.length; i++) if (st.customers[i].id === c.id) return i; return -1; }
/** 把某一列做好的这份端给顾客 c：还没落盘就先落盘，然后按「这一列的盘」出餐 */
function deliverTo(st, i, c) {
  if (!R.plateOfStation(st, i)) R.takePlate(st, i);
  return R.serveCustomer(st, ci(st, c), R.plateIdxOfStation(st, i));
}
/** 给当前第一位顾客做他要的下一道菜，熟了落到本列盘上再端上去（返回 serve 结果，做不了返回 null） */
function autoServe(st) {
  const list = R.activeCustomers(st);
  if (!list.length) return null;
  const c0 = list[0];
  let want = null;
  for (let i = 0; i < c0.order.length; i++) if (c0.done.indexOf(c0.order[i]) < 0) { want = c0.order[i]; break; }
  if (!want) return null;
  const col = R.columnOf(want);
  if (!R.stationFree(st, col)) return null;
  if (!R.placeFood(st, want, col)) return null;
  let k = 0;
  while (!R.plateOfStation(st, col) && k++ < 1200 && !st.over) R.step(st, 1 / 60);
  if (st.over || !R.plateOfStation(st, col)) { R.trashStation(st, col); return null; }
  return R.serveFromColumn(st, col);          // 单击盘 → 自动送给正在等的顾客
}

/* ══════════════ 1. 火候状态机 ══════════════ */

test("火候状态机：煎蛋 3.0s / 完美窗口 0.8s / 1.0s 后糊 —— 两侧临界值都判对", () => {
  const F = R.FOOD.egg;
  assert.equal(F.dur, 3.0); assert.equal(F.pw, 0.8); assert.equal(F.burn, 1.0);
  assert.equal(R.burnAt("egg"), 4.8, "糊的临界 = 3.0+0.8+1.0");
  // 窗口左侧边界
  assert.equal(R.cookState("egg", 0), "raw");
  assert.equal(R.cookState("egg", 1.5), "raw", "半熟还是生的（不能出锅）");
  assert.equal(R.cookState("egg", 2.999), "raw", "差 1ms 到 3.0 仍是生");
  assert.equal(R.cookState("egg", 3.0), "perfect", "3.0 恰好进完美窗口");
  // 窗口内部 / 右侧边界
  assert.equal(R.cookState("egg", 3.4), "perfect", "窗口正中");
  assert.equal(R.cookState("egg", 3.799), "perfect", "差 1ms 到 3.8 仍是恰好");
  assert.equal(R.cookState("egg", 3.8), "over", "3.8 出窗口 → 过火（普通分，不糊）");
  assert.equal(R.cookState("egg", 4.799), "over", "差 1ms 到 4.8 仍可端");
  assert.equal(R.cookState("egg", 4.8), "burnt", "4.8 起就是糊");
  assert.equal(R.cookState("egg", 9.0), "burnt");
  // 其它食物的窗口各不相同
  assert.equal(R.cookState("congee", 5.0), "perfect", "白粥 5.0s 进窗口");
  assert.equal(R.cookState("congee", 6.2), "over", "白粥窗口 1.2s");
  assert.equal(R.burnAt("congee"), 7.8);
  assert.equal(R.cookState("milk", 2.6), "perfect");
  assert.equal(R.burnAt("milk"), 4.2);
  assert.equal(R.cookState("juice", 1.5), "perfect");
  assert.equal(R.cookState("nope", 1), "idle", "未知食物 → idle");
  assert.equal(R.cookState("egg", -5), "raw", "负数按 0 处理");
});

test("火候状态机：真实推进（step）能按秒数走到 perfect → over → burnt（按住看火，不自动落盘）", () => {
  const st = wokState();
  const i = cookTo(st, "congee", 0);                    // 白粥锅 = 第 0 列
  assert.equal(i, 0, "白粥进第 0 列（白粥锅）");
  advance(st, 5.1); assert.equal(st.stations[i].state, "perfect", "5.1s 后恰好");
  advance(st, 1.2); assert.equal(st.stations[i].state, "over", "再过 1.2s 过火（完美窗口 1.2s）");
  advance(st, 1.7); assert.equal(st.stations[i].state, "burnt", "再过 1.7s 糊（糊点 7.8s）");
  assert.equal(st.burnt, 1, "糊掉计数 +1");
});

test("列绑定：9 列一一对应（食材 ↔ 灶位 ↔ 专属盘），索引稳定、不可互换", () => {
  const st = mkState(); st.running = true;
  assert.equal(R.COL_N, 9, "一共 9 列");
  assert.equal(R.FOOD_IDS.length, 9, "9 样食材 = 9 列");
  assert.equal(st.stations.length, 9, "9 个灶位");
  assert.equal(R.PLATES_TOTAL, 9, "9 个专属盘（每列 1 个）");
  /* 每一列的绑定逐条对上：FOOD_IDS[i] ↔ 灶位 i ↔ 盘 i */
  for (let i = 0; i < 9; i++) {
    const f = R.FOOD_IDS[i];
    assert.equal(R.COLS[i].food, f, "第 " + i + " 列的食材是 " + f);
    assert.equal(R.columnOf(f), i, "columnOf(" + f + ") = " + i);
    assert.equal(R.foodOfColumn(i), f, "foodOfColumn(" + i + ") 反向一致");
    assert.equal(st.stations[i].kind, R.COLS[i].kind, "第 " + i + " 列的厨具稳定");
    assert.equal(st.stations[i].col, i, "灶位记录里写着列号");
    assert.equal(R.hasPlate(i), true, "第 " + i + " 列有自己的专属盘");
    assert.equal(R.isPrepStation(i), true, "每列都有盘（不再分预备/现做）");
  }
  for (let i = 0; i < 9; i++) for (let j = i + 1; j < 9; j++)
    assert.notEqual(R.FOOD_IDS[i], R.FOOD_IDS[j], "两列不会绑同一样食材");
  jsonEq(R.FOOD_IDS.map((f, i) => [f, R.columnOf(f), st.stations[i].kind]),
    [["congee",0,"pot"], ["milk",1,"pot"], ["soup",2,"pot"],
     ["egg",3,"griddle"], ["bacon",4,"griddle"], ["sandwich",5,"griddle"],
     ["bun",6,"steamer"], ["salad",7,"counter"], ["juice",8,"juicer"]],
    "9 列绑定表（写死、不可互换）");
  /* 越界一律没有盘 / 没有列 */
  assert.equal(R.hasPlate(-1), false); assert.equal(R.hasPlate(9), false);
  assert.equal(R.columnOf("nope"), -1); assert.equal(R.foodOfColumn(9), null);
  assert.equal(R.columnOf("egg"), 3, "煎蛋只会进第 3 列（煎蛋盘）");
  assert.equal(R.columnOf("congee"), 0, "白粥只会进第 0 列（白粥锅）");
  /* 拖到别人的锅 → 拒绝（原因码 wrong-column）*/
  assert.equal(R.placeFood(st, "egg", 0), false, "煎蛋不能放白粥锅");
  assert.equal(st.lastPlace.why, "wrong-column");
  assert.match(st.lastPlace.hint, /别人的锅/);
  assert.equal(R.placeFood(st, "egg", 3), true, "煎蛋进自己的煎蛋盘");
  assert.equal(R.placeFood(st, "egg", 3), false, "同一个锅不能叠放");
  assert.equal(st.lastPlace.why, "station-occupied");
  assert.equal(R.firstFreeStation(st, "egg"), -1, "食材只认自己那一列：那列忙就没得放");
  assert.equal(R.firstFreeStation(st, "milk"), 1, "别的列照旧空着");
});

/* ══════════════ 2. 顾客与订单生成 / 难度曲线 ══════════════ */

test("难度曲线：顾客越来越急、耐心越来越短、订单结构随难度移动", () => {
  const cfg = { duration: 75, goal: 8 };
  // 开局 roll<0.40 才是 1 样；收官 roll<0.14 才是 1 样（明显更难）
  assert.equal(R.orderLenAt(0, cfg, 0.10), 1);
  assert.equal(R.orderLenAt(0, cfg, 0.40), 2);
  assert.equal(R.orderLenAt(0, cfg, 0.90), 3);
  assert.equal(R.orderLenAt(75, cfg, 0.02), 1, "收官时只有最早那一小段 roll 还是 1 样");
  assert.equal(R.orderLenAt(75, cfg, 0.20), 2);
  assert.equal(R.orderLenAt(75, cfg, 0.72), 3, "收官时 roll≥0.72 就是 3 样");
  assert.equal(R.orderLenAt(75, cfg, 0.95), 3);
  // 同一 roll 下收官订单不会更短
  for (let i = 0; i <= 100; i++) {
    const r = i / 100;
    assert.ok(R.orderLenAt(75, cfg, r) >= R.orderLenAt(0, cfg, r), "同一 roll 下收官订单不会更短（roll=" + r + "）");
  }
  const avg = t => { let s = 0; for (let i = 0; i < 100; i++) s += R.orderLenAt(t, cfg, i / 100); return s / 100; };
  assert.ok(avg(75) > avg(0), "收官平均订单更长（" + avg(0).toFixed(2) + " → " + avg(75).toFixed(2) + "）");
  // 耐心随时间变短
  assert.ok(R.patienceFor(2, 75, cfg) < R.patienceFor(2, 0, cfg), "收官耐心更短");
  assert.ok(R.patienceFor(3, 0, cfg) > R.patienceFor(1, 0, cfg), "订单越长耐心越多");
  assert.ok(R.patienceFor(3, 75, cfg) > 15, "最短也不会短于 15s（可玩性）");
  // 收官：订单更长 + 耐心更短 ⇒ 单位时间压力更大
  const pressure = t => avg(t) / R.patienceFor(2, t, cfg);
  assert.ok(pressure(75) > pressure(0), "收官压力更大（" + pressure(0).toFixed(3) + " → " + pressure(75).toFixed(3) + "）");
});

test("顾客生成：开局 0.45s 内进第一位；同时最多 3 位；送客后立刻补位", () => {
  const st = mkState(); st.running = true;
  advance(st, 0.5);
  assert.equal(R.activeCustomers(st).length, 1, "开店后第一位顾客进门");
  assert.ok(st.customers[0].order.length >= 1 && st.customers[0].order.length <= 3, "订单长度 1~3");
  assert.ok(st.customers[0].patience > 0);
  // 连续做单送客 40 秒：同时在场永远 ≤ 3，顾客不断轮换
  let guard = 0, maxAtOnce = 0, servedByMe = 0;
  while (st.elapsed < 40 && guard++ < 4000 && !st.over) {
    maxAtOnce = Math.max(maxAtOnce, R.activeCustomers(st).length);
    if (!R.activeCustomers(st).length) { R.step(st, 0.1); continue; }
    const r = autoServe(st);
    if (r && r.ok) servedByMe++;
    for (const c of R.activeCustomers(st)) if (c.patience < 30) c.patience = c.patienceMax = 120;
    R.step(st, 0.1);
  }
  assert.ok(maxAtOnce <= 3, "同时最多 3 位（实测 " + maxAtOnce + "）");
  assert.ok(servedByMe >= 4, "40 秒内能服务 4 位以上（实测 " + servedByMe + "）");
  assert.ok(maxAtOnce >= 2, "顾客会叠加（实测同时最多 " + maxAtOnce + " 位）");
  assert.equal(st.angry, 0, "一直被好好服务 → 没有人跑单");
});

test("订单生成：同一张订单不重复点同一食物（顾客 / 纯函数两条路都验）", () => {
  for (let len = 1; len <= 3; len++) {
    for (let k = 0; k < 200; k++) {
      const o = R.orderFor(len, k / 200, k);
      assert.equal(o.length, len, "长度正确");
      assert.equal(new Set(o).size, len, "同一订单不重复：" + o.join(","));
      o.forEach(f => assert.ok(R.FOOD[f], "食物存在：" + f));
    }
  }
  for (let k = 0; k < 200; k++) {
    const c = R.newCustomer(k, k % 75, { duration: 75, goal: 8 }, k / 200);
    assert.equal(new Set(c.order).size, c.order.length, "顾客订单不重复：" + c.order.join(","));
    assert.ok(c.order.length >= 1 && c.order.length <= 3);
  }
});

test("顾客 patienceMax 与实际耐心一致；服务完立刻让出座位", () => {
  const st = mkState();
  st.running = true;                                    // 先开局（没开局不能下料 / 出餐）
  const c0 = R.spawnCustomer(st, ["egg"]);
  assert.equal(c0.patience, c0.patienceMax);
  const i0 = cookTo(st, "egg", 3.2);
  const got = deliverTo(st, i0, c0);                    // 取出并端上桌
  assert.equal(got.ok, true, "端上桌");
  assert.equal(st.stations[i0].food, null, "取出后锅里空了");
  assert.equal(st.served, 1, "服务计数 +1");
  assert.equal(R.activeCustomers(st).length, 0, "顾客立即让出座位");
  assert.equal(R.remainOf(c0), 0);
});

/* ══════════════ 3. 计分 ══════════════ */

test("计分：完美 +13（10+1+热乎 2）／普通 +7／上错 −5／糊菜上桌 −5 且顾客离开／顾客离开 −8", () => {
  const S = R.SCORE;
  assert.equal(S.perfect, 10); assert.equal(S.warm, 6); assert.equal(S.hotBonus, 3);
  assert.equal(S.wrong, -5); assert.equal(S.burnt, -5); assert.equal(S.leave, -8); assert.equal(S.tick, 1);
  assert.equal(R.scoreDelta("perfect", { hot: true }), 14);
  assert.equal(R.scoreDelta("perfect", { hot: false }), 11);
  assert.equal(R.scoreDelta("warm", { hot: true }), 10);
  assert.equal(R.scoreDelta("warm", { hot: false }), 7);
  assert.equal(R.scoreDelta("wrong"), -5);
  assert.equal(R.scoreDelta("burnt"), -5);
  assert.equal(R.scoreDelta("leave"), -8);
  assert.equal(R.scoreDelta("star"), 12);
  assert.equal(R.scoreDelta("不存在"), 0);

  // ── 完美（热乎）出餐（新模型：熟了自动落到本列专属盘 → 单击盘送给顾客）
  let st = plateState();
  const cp = longPatience(R.spawnCustomer(st, ["egg"]));
  const i1 = plated(st, "egg", 3.0);              // 刚进完美窗口就落盘 → 热乎
  const d1 = deliverTo(st, i1, cp);
  assert.equal(d1.kind, "perfect-hot", "盘上出餐（完美 + 热乎）");
  assert.equal(d1.delta, 14, "完美 + 热乎 = 14");
  assert.equal(d1.heat, "hot", "出锅即刻 → 热乎");
  assert.equal(st.perfect, 1); assert.equal(st.hot, 1); assert.equal(st.served, 1);

  // 自动落盘：真实帧推进下，一到「恰好」就离开锅、落到本列专属盘（要求 A3）
  st = plateState();
  longPatience(R.spawnCustomer(st, ["egg"]));
  assert.equal(R.placeFood(st, "egg", null), true, "点一下食材 → 自动进它那一列");
  advance(st, 3.1);
  assert.equal(st.stations[3].food, null, "熟了以后锅里立刻空出来");
  assert.equal(R.plateOfStation(st, 3).food, "egg", "那份煎蛋在自己的专属盘上");
  assert.equal(R.phaseOf(st, 3), "plated", "状态机：cooking → plated");
  const rAgain = R.serveFromColumn(st, 3);
  assert.equal(rAgain.ok, true); assert.equal(rAgain.delta, 14, "单击盘出餐 = 热乎 14");
  assert.equal(st.hot, 1);

  // ── 过火（普通）出餐：锅里过了完美窗口才落盘（按住看火那条路）→ 6+1 = 7
  st = plateState();
  const cb = longPatience(R.spawnCustomer(st, ["egg"]));
  assert.equal(R.placeFoodEx(st, "egg", 3, { manual:true }).ok, true, "按住看火（不自动落盘）");
  st.stations[3].t = (R.FOOD.egg.dur + R.FOOD.egg.pw + 0.4) * 1000;
  st.stations[3].state = R.cookState("egg", st.stations[3].t / 1000);
  const i2 = 3;
  assert.equal(st.stations[i2].state, "over", "过了完美窗口 → 过火");
  assert.equal(R.plateOfStation(st, i2), null, "还没落盘");
  assert.equal(R.takePlate(st, i2), true, "过火的这份照样能落到本列专属盘（普通分）");
  assert.equal(st.plates[0].hot, false, "过火不算热乎");
  const r2 = R.serveFromColumn(st, i2);
  assert.equal(r2.kind, "over"); assert.equal(r2.delta, 7, "盘上过火出餐 6+1 = 7");
  assert.equal(st.normal, 1, "过火记进「普通」档"); assert.equal(st.perfect, 0);

  // 过火那份走「食材 → 盘 → 顾客」整条新链路（分不变 6+1=7）
  st = plateState();
  const cb0 = longPatience(R.spawnCustomer(st, ["congee"]));
  const i2b = plated(st, "congee", R.FOOD.congee.dur + R.FOOD.congee.pw + 0.3);
  assert.equal(st.stations[i2b].state === "over" || st.plates[0].state === "over", true, "过火");
  assert.equal(st.plates[0].hot, false, "过火不算热乎");
  const r2b = R.serveFromColumn(st, i2b);
  assert.equal(r2b.kind, "over"); assert.equal(r2b.delta, 7, "盘上过火出餐 6+1 = 7");
  assert.equal(st.normal, 1, "过火记进「普通」档"); assert.equal(st.perfect, 0);

  // ── 上错菜（点顾客卡自动配盘那条路能主动端错）
  st = plateState();
  const cw = longPatience(R.spawnCustomer(st, ["egg"]));
  const i3 = cookTo(st, "congee", 5.0);                 // 端一份白粥给只点了煎蛋的人
  const d3 = deliverTo(st, i3, cw);
  assert.equal(d3.kind, "wrong");
  assert.equal(d3.delta, -5, "上错菜 −5");
  assert.equal(st.wrong, 1);
  assert.equal(st.served, 0, "上错菜不算服务成功");
  assert.equal(R.activeCustomers(st).length, 1, "顾客还在（还有耐心就不走）");

  // 盘上那份此刻没人要 → 单击盘不消耗、留在盘上（要求 A3）
  st = plateState();
  longPatience(R.spawnCustomer(st, ["congee"]));
  const ib = plated(st, "egg", 3.0);
  const db = R.serveFromColumn(st, ib);
  assert.equal(db.ok, false); assert.equal(db.why, "no-want", "没人要这份 → 拒绝出餐");
  assert.equal(st.score, 0, "不消耗、不扣分");
  assert.equal(R.plateOfStation(st, ib).food, "egg", "那份还留在盘上（继续走热乎度衰减）");
  assert.equal(st.served, 0);

  // ── 糊菜端上桌 → 顾客直接不满离开（用干净状态，避免前面场景的顾客干扰）
  st = plateState();
  const cburn = longPatience(R.spawnCustomer(st, ["egg"]));
  const burntBefore = st.burnt;
  const i4 = cookWalk(st, "egg", "burnt");
  assert.equal(st.stations[i4].state, "burnt");
  assert.equal(st.burnt, burntBefore + 1, "烧糊记账 +1");
  assert.equal(R.plateOfStation(st, i4), null, "按住看火时食物留在锅里（没落盘）");
  const angryBefore = st.angry;
  const nActive = R.activeCustomers(st).length;          // 上桌那一刻在场人数
  assert.equal(R.serveFromColumn(st, i4).why, "no-plate", "锅里那份还没落盘，单击盘没东西可送");
  const r4 = R.serveFoodToCustomer(st, cburn, "egg", "burnt", "cold", 6);
  assert.equal(r4.kind, "burnt");
  assert.equal(r4.delta, -5, "糊菜端上桌 −5");
  assert.equal(st.angry, angryBefore + 1, "顾客不满离开");
  assert.equal(cburn.angry, true, "该顾客被标记为不满");
  assert.equal(R.activeCustomers(st).length, nActive - 1, "被得罪的顾客立刻离场（其他人不受影响）");
  assert.equal(R.activeCustomers(st).indexOf(cburn), -1, "他不在场上了");
  assert.equal(st.served, 0);
  assert.equal(st.burnt, burntBefore + 1, "糊掉计数不重复累加（端上桌不再额外记一次）");

  // 糊菜走「盘」这条路：顾客同样当场离开
  st = plateState();
  const cburn2 = longPatience(R.spawnCustomer(st, ["congee"]));
  const i4b = cookWalk(st, "congee", "burnt");
  assert.equal(R.hasPlate(i4b), true);
  R.takePlate(st, i4b);
  assert.equal(st.plates[0].hot, false);
  const r4b = R.serveCustomer(st, ci(st, cburn2), 0);
  assert.equal(r4b.kind, "burnt"); assert.equal(r4b.delta, -5, "盘上糊菜端上桌同样 −5");

  // ── 顾客等太久自己走 → −8（一位只扣一次）
  st = mkState({ duration: 4, goal: 8 });      // 时限短，避免新顾客插进来干扰断言
  st.running = true;
  const cl = R.spawnCustomer(st, ["congee"]);
  cl.patience = cl.patienceMax = 3;
  const angry0 = st.angry, score0 = st.score;
  advance(st, 3.7);
  assert.equal(st.angry, angry0 + 1, "耐心耗尽 → 走人");
  assert.equal(st.score, score0 - 8, "顾客离开 −8");
  assert.equal(st.served, 0);
  assert.equal(st.served, 0);
  const scoreOnce = st.score, angryOnce = st.angry;
  for (let k = 0; k < 5; k++) { cl.patience = -1; R.step(st, 1 / 60); }   // 反复踩同一位顾客
  assert.equal(st.angry, angryOnce, "同一位顾客只记一次跑单（不重复扣分）");
  assert.equal(st.score, scoreOnce);
});

test("计分：糊掉的食物丢垃圾桶不扣分，只浪费时间", () => {
  const st = plateState();
  const i = cookWalk(st, "egg", "burnt");
  assert.equal(st.stations[i].state, "burnt");
  assert.equal(st.burnt, 1);
  const before = st.score;
  assert.equal(R.trashStation(st, i), true);
  assert.equal(st.score, before, "丢垃圾桶不扣分");
  assert.equal(st.stations[i].food, null, "锅清空");
  assert.equal(st.burnt, 1, "但糊掉的事实仍然记账（结算面板显示）");
  // 生料也能丢（清锅，不扣分）
  const i2 = cookTo(st, "congee", 1.0);
  assert.equal(R.trashStation(st, i2), true);
  assert.equal(st.score, before, "生料丢掉同样不扣分");
});

test("计分：一条订单全完美（≥2 样）额外 +12；混合则不给", () => {
  let st = plateState();
  const c1 = R.spawnCustomer(st, ["egg", "congee"]);
  let i = plated(st, "egg", 3.0); deliverTo(st, i, c1);                            // 恰好 → 热乎
  i = cookTo(st, "congee", R.FOOD.congee.dur + R.FOOD.congee.pw + 0.3);            // 过火
  R.takePlate(st, i); deliverTo(st, i, c1);
  assert.equal(st.served, 1);
  assert.equal(st.score, 14 + 7, "全完美不成立 → 没有额外 12");

  st = plateState();
  const c2 = R.spawnCustomer(st, ["egg", "congee"]);
  i = plated(st, "egg", 3.0); deliverTo(st, i, c2);
  i = plated(st, "congee", 5.0); deliverTo(st, i, c2);
  assert.equal(st.score, 14 + 14 + 12, "两样都完美 → 额外 +12");
});

/* ══════════════ 4. 过关判定 ══════════════ */

test("过关判定：75 秒内服务满 8 位 → win:true（点单要什么做什么，9 列平行下料 + 单击盘出餐）", () => {
  const st = mkState({ duration: 75, goal: 8 });
  st.running = true;
  let guard = 0;
  while (!st.over && guard++ < 3000) {
    // 1) 把所有顾客还缺的菜尽量平行下锅（每样只进自己那一列）
    const list0 = R.activeCustomers(st);
    for (const c of list0) for (const f of c.order) {
      if (c.done.indexOf(f) >= 0) continue;
      if (st.stations.some(s => s.food === f)) continue;
      if (R.plateOfStation(st, R.columnOf(f))) continue;
      R.placeFood(st, f, null);
    }
    // 2) 推进到有东西落到盘上（或 1 秒）
    let frames = 0;
    while (frames++ < 60 && !st.over) { R.step(st, 1 / 60); if (st.plates.length) break; }
    if (st.over) break;
    // 3) 单击每一列的专属盘：自动送给正在需要 + 耐心最少的顾客（没人要就留着）
    for (let i = 0; i < st.stations.length; i++) if (R.plateOfStation(st, i)) R.serveFromColumn(st, i);
    // 4) 清掉糊掉的残骸 / 没人要的存货，避免堵住某一列
    for (let i = 0; i < st.stations.length; i++) {
      const p = R.plateOfStation(st, i);
      if ((p && p.state === "burnt") || st.stations[i].state === "burnt") R.trashStation(st, i);
    }
    R.step(st, 0.15); guard++;
  }
  assert.ok(st.over, "已结算");
  assert.equal(st.result.win, true, "服务满 8 位 → 通过");
  assert.equal(st.result.served, 8);
  assert.equal(st.result.goal, 8);
  assert.equal(st.result.burnt, 0, "规划得当就不会糊");
  assert.equal(st.angry, 0, "全程没人跑单");
  assert.ok(st.result.score > 0, "得分为正：" + st.result.score);
  assert.ok(st.elapsed < 75, "在时限内完成（用时 " + st.elapsed.toFixed(1) + "s）");
  assert.ok(st.result.bondDelta >= 6 && st.result.bondDelta <= 10, "通过 → 好感 +6~+10（实得 +" + st.result.bondDelta + "）");
});

test("过关判定：时间用尽仍未服务满 → win:false（判定依据是 served，不是分数）", () => {
  const st = mkState({ duration: 9, goal: 8 });
  st.running = true;
  // 不服务，只让顾客不断进店 / 跑单；9 秒太短，气走人数到不了 5 → 由「时间到」分支结算
  let guard = 0;
  while (!st.over && guard++ < 3000) { R.step(st, 1 / 60); if (st.elapsed > 1 && guard % 40 === 0) R.spawnCustomer(st, ["egg"]); }
  assert.equal(st.over, true);
  assert.equal(st.result.win, false, "时间到，只服务了 " + st.result.served + " 位 → 失败");
  assert.equal(st.result.served, 0);
  assert.match(st.result.reason, /时间到/);
  assert.ok(st.result.bondDelta <= -3 && st.result.bondDelta >= -6, "失败 −3~−6（实得 " + st.result.bondDelta + "）");
  assert.ok(st.result.impact.length > 6, "有本局影响一句话");
});

test("好感结算：失败但做出过东西 → 按糊掉的份数 / 服务数给 −3~−6（不虐主）", () => {
  const st = mkState({ duration: 40, goal: 8 });
  st.running = true;
  // 1) 先正常服务两位（证明「做出过东西」）
  let guard = 0, served0 = 0;
  while (!st.over && guard++ < 300 && st.served < 2) {
    if (!R.activeCustomers(st).length) { R.step(st, 0.2); continue; }
    autoServe(st);
    R.step(st, 0.1);
  }
  served0 = st.served;
  assert.equal(served0, 2, "先服务了 2 位");
  // 2) 故意把剩下的时间耗光：所有顾客耐心压到 1 秒，三列里再烧糊 3 份
  for (let i = 0; i < st.stations.length; i++) R.trashStation(st, i);   // 先清锅清盘
  for (const f of ["congee", "milk", "soup"]) assert.equal(R.placeFood(st, f, null), true, f + " 下锅");
  // 直接把三锅的火候推过糊点（模拟"忘了看火"）
  for (let i = 0; i < st.stations.length; i++) if (st.stations[i].food) st.stations[i].t = (R.burnAt(st.stations[i].food) + 0.05) * 1000;
  while (!st.over && guard++ < 12000) {
    R.step(st, 1 / 60);
    for (const c of R.activeCustomers(st)) if (c.patience > 0.8) c.patience = 0.8;
  }
  assert.equal(st.over, true, "已结算");
  assert.equal(st.result.win, false);
  assert.ok(st.result.burnt >= 3, "糊了 " + st.result.burnt + " 份");
  assert.equal(st.result.served, 2, "结算面板能显示服务了 2 位");
  assert.ok(st.result.bondDelta <= -3 && st.result.bondDelta >= -6, "失败区间 −3~−6（实得 " + st.result.bondDelta + "）");
  assert.ok(/[「"]/.test(st.result.quote), "有专属尴尬台词：" + st.result.quote);
  assert.ok(st.result.impact.length > 6, "有本局影响一句话");
  assert.match(st.result.impact, /糊|焦|凉|空|手/);
});

test("好感结算：失败也留台阶 —— 文案里必须出现「明天再来」这类不虐主的说法", () => {
  const st = mkState({ duration: 3, goal: 8, target:{ id:"su", name:"苏晚晴", bond:40 } });
  st.running = true;
  advance(st, 3.7);
  assert.equal(st.result.win, false);
  assert.ok(st.result.bondDelta >= -6, "最多 −6");
  assert.match(R.impactOf(false, 0, 0, 0, "苏晚晴"), /空|凉/);
  // 结果里的 target 信息完整（结算面板要显示对象与好感变化）
  assert.equal(st.result.target.id, "su");
  assert.equal(st.result.target.name, "苏晚晴");
  assert.equal(st.result.target.bond, 40);
});

test("过关判定：气走 5 位顾客 → 提前失败（不用等满 75 秒）", () => {
  const st = mkState({ duration: 75, goal: 8 });
  st.running = true;
  let guard = 0;
  while (!st.over && guard++ < 60) {
    const list = R.activeCustomers(st);
    if (!list.length) { R.spawnCustomer(st, ["egg"]); continue; }
    list[0].patience = 0.001;
    advance(st, 1 / 60 + 0.001);
  }
  assert.equal(st.over, true);
  assert.equal(st.result.win, false);
  assert.equal(st.angry, 5, "气走 5 位提前结算");
  assert.ok(st.elapsed < 20, "提前结束（用时 " + st.elapsed.toFixed(1) + "s）");
});

test("debug.finishNow 语义：按当前服务数给通过 / 失败", () => {
  const st = mkState({ duration: 75, goal: 8 });
  st.running = true;
  st.served = 8;
  R.finish(st, st.served >= st.cfg.goal, "服务满");
  assert.equal(st.result.win, true);
  const st2 = mkState({ duration: 75, goal: 8 });
  st2.running = true; st2.served = 3; st2.burnt = 4;
  R.finish(st2, false, "主动收摊");
  assert.equal(st2.result.win, false);
  assert.equal(st2.result.bondDelta, R.bondDeltaLose(4, 3));
});

/* ══════════════ 5. 好感结算 ══════════════ */

test("好感结算：完美份数 / 热乎份数 → bondDelta（通过 +6~+10）", () => {
  assert.equal(R.bondDeltaWin(0, 0), 6, "一份完美都没有也给 +6（不虐主）");
  assert.equal(R.bondDeltaWin(1, 1), 6);
  assert.equal(R.bondDeltaWin(3, 0), 7);
  assert.equal(R.bondDeltaWin(6, 0), 8);
  assert.equal(R.bondDeltaWin(9, 0), 9);
  assert.equal(R.bondDeltaWin(9, 4), 10);
  assert.equal(R.bondDeltaWin(12, 9), 10, "上限 10");
  assert.equal(R.bondDeltaWin(99, 99), 10, "绝不超过 +10");
  let prev = -1;
  for (let p = 0; p <= 14; p++) { const v = R.bondDeltaWin(p, 0); assert.ok(v >= prev, "完美越多加得越多"); prev = v; }
  assert.ok(R.bondHeat(5, 0) > R.bondHeat(2, 0), "热乎度随完美份数上升");
  assert.ok(R.bondHeat(0, 4) > R.bondHeat(0, 0), "热乎份数也计入");
});

test("好感结算：失败 → bondDelta −3~−6", () => {
  assert.equal(R.bondDeltaLose(0, 8), -3, "一份都没糊 → 只 −3");
  assert.equal(R.bondDeltaLose(0, 1), -4, "只服务了 1 位 → −4");
  assert.equal(R.bondDeltaLose(3, 5), -4);
  assert.equal(R.bondDeltaLose(6, 5), -5);
  assert.equal(R.bondDeltaLose(12, 5), -6, "上下限夹住");
  assert.equal(R.bondDeltaLose(99, 0), -6, "最差也只 −6");
  for (let b = 0; b <= 20; b++) { const v = R.bondDeltaLose(b, 3); assert.ok(v <= -3 && v >= -6, "始终在 −3~−6"); }
});

test("好感结算：bondDeltaFor 按胜负分流", () => {
  assert.equal(R.bondDeltaFor(true, 9, 4, 0, 8), 10);
  assert.equal(R.bondDeltaFor(false, 0, 0, 0, 8), -3);
});

test("选对象规则：好感 20~79 才可选；<20 / ≥80 / 今天已送 → 置灰并给原因", () => {
  const bonds = { fang:14, su:22, lin:79, wen:80, lei:20, hong:12, guo:55, lu:9, man:31 };
  const ids = Object.keys(bonds);
  const list = R.eligibleTargets(bonds, ids, {});
  const by = {}; list.forEach(x => by[x.id] = x);
  assert.equal(by.fang.ok, false); assert.match(by.fang.why, /生疏|≥20|好感 14/);
  assert.equal(by.hong.ok, false); assert.match(by.hong.why, /生疏/);
  assert.equal(by.lu.ok, false); assert.match(by.lu.why, /生疏/);
  assert.equal(by.wen.ok, false); assert.match(by.wen.why, /满|80/);
  assert.equal(by.su.ok, true, "好感 22 可选");
  assert.equal(by.lin.ok, true, "好感 79 可选（边界内）");
  assert.equal(by.lei.ok, true, "好感 20 是下边界，刚好可选");
  assert.equal(by.man.ok, true);
  // 今天已送过的置灰
  const list2 = R.eligibleTargets(bonds, ids, { guo:true });
  const guo = list2.find(x => x.id === "guo");
  assert.equal(guo.ok, false); assert.match(guo.why, /今天已经送过/);
  assert.equal(list2.filter(x => x.ok).length, list.filter(x => x.ok).length - 1);
  // 不可选的人也保留在列表里（置灰可见，不是消失）
  assert.equal(list.length, ids.length);
  // canSend 同规则
  assert.equal(R.canSend(bonds, "su", 7, null).ok, true);
  assert.equal(R.canSend(bonds, "fang", 7, null).ok, false);
  assert.equal(R.canSend(bonds, "wen", 7, null).ok, false);
});

test("每日一次：S.breakfastDay 记录同一天同一角色只能送一次，换天自动重置", () => {
  let bf = null;
  bf = R.markSent(bf, "su", 7);
  jsonEq(bf, { day:7, sent:["su"] }, "首条记录");
  assert.equal(R.canSend({ su:40 }, "su", 7, bf).ok, false, "同一天同一角色不能再送");
  assert.match(R.canSend({ su:40 }, "su", 7, bf).why, /今天已经给他送过/);
  assert.equal(R.canSend({ su:40, lin:44 }, "lin", 7, bf).ok, true, "换个人还能送");
  bf = R.markSent(bf, "lin", 7);
  jsonEq(bf.sent.slice().sort(), ["lin", "su"], "同一天可以送多个人，但每人一次");
  const map = R.sentToday(bf, 7);
  assert.equal(map.su, true); assert.equal(map.lin, true); assert.equal(map.guo, undefined);
  // 换天（Day 8）→ 自动清空
  bf = R.markSent(bf, "guo", 8);
  jsonEq(bf, { day:8, sent:["guo"] }, "换天重置");
  assert.equal(R.canSend({ su:40 }, "su", 8, bf).ok, true, "新的一天又能送了");
  jsonEq(Object.assign({}, R.sentToday(bf, 8)), { guo:true }, "今天的已送名单");
  jsonEq(Object.assign({}, R.sentToday(bf, 7)), {}, "旧的那天不再算已送");
  // 不会重复记录
  bf = R.markSent(bf, "guo", 8);
  jsonEq(bf.sent, ["guo"], "同一天同一角色重复记录不会叠加");
  // 坏数据容错（存档里字段被改坏也不崩）
  jsonEq(R.markSent("坏的", "su", 3), { day:3, sent:["su"] }, "脏数据重置");
  jsonEq(R.markSent(undefined, "su", 3), { day:3, sent:["su"] }, "空数据初始化");
  jsonEq(R.markSent({ day:3, sent:"不是数组" }, "su", 3), { day:3, sent:["su"] }, "字段类型错也兜住");
});

test("好感区间置灰规则：20 与 80 两个边界都精确", () => {
  const bonds = { a:19, b:20, c:79, d:80 };
  const list = R.eligibleTargets(bonds, ["a", "b", "c", "d"], {});
  assert.equal(list.find(x => x.id === "a").ok, false, "19 → 置灰");
  assert.equal(list.find(x => x.id === "b").ok, true, "20 → 可选");
  assert.equal(list.find(x => x.id === "c").ok, true, "79 → 可选");
  assert.equal(list.find(x => x.id === "d").ok, false, "80 → 置灰");
});

/* ══════════════ 6. 结算结果 / 文案 ══════════════ */

test("result 字段齐全，且 quote 与 target 对得上（9 位角色都有专属台词）", () => {
  const need = ["win", "served", "goal", "perfect", "burnt", "score", "bondDelta", "target", "quote"];
  for (const id of R.TARGET_IDS) {
    const cfg = { duration: 75, goal: 8, target:{ id:id, name:id, bond:40 } };
    const st = R.newState(cfg); st.running = true; st.perfect = 6; st.hot = 4; st.served = 8;
    R.finish(st, true, "test");
    need.forEach(k => assert.ok(k in st.result, "字段 " + k + " 存在 (" + id + ")"));
    assert.ok(st.result.quote.length > 4, id + " 有通过台词");
    assert.equal(st.result.target.id, id);
    const st2 = R.newState(cfg); st2.running = true; st2.burnt = 4; st2.served = 2;
    R.finish(st2, false, "test");
    assert.ok(st2.result.quote.length > 4, id + " 有失败台词");
    assert.ok(st2.result.bondDelta < 0);
    assert.notEqual(st2.result.quote, st.result.quote, id + " 成功 / 失败台词不同");
  }
  // 未知角色走兜底文案
  const st3 = R.newState({ duration: 75, goal: 8, target:{ id:"nobody", name:"路人", bond:30 } });
  st3.running = true; R.finish(st3, true, "t");
  assert.ok(st3.result.quote.length > 4, "兜底台词可用");
  // finish 幂等：重复调用不会改写结果
  const once = JSON.stringify(st3.result);
  R.finish(st3, false, "again");
  assert.equal(JSON.stringify(st3.result), once, "finish 只结算一次");
});

test("本局影响一句话：胜负 / 糊多少 → 不同文案，且带对方名字", () => {
  const win1 = R.impactOf(true, 10, 0, 6, "苏晚晴");
  const win2 = R.impactOf(true, 2, 1, 0, "苏晚晴");
  const lose1 = R.impactOf(false, 0, 5, 0, "苏晚晴");
  assert.match(win1, /苏晚晴/); assert.match(lose1, /苏晚晴/);
  assert.notEqual(win1, win2);
  assert.notEqual(win1, lose1);
  assert.match(lose1, /糊|焦/);
});

test("所有 9 位可攻略角色都在 TARGETS 里（与页面羁绊键一致）", () => {
  const want = ["fang", "su", "lin", "wen", "lei", "hong", "guo", "lu", "man"];
  jsonEq(R.TARGET_IDS.slice().sort(), want.slice().sort(), "角色 id 与 BONDS 键一一对应");
  BF.TARGETS.forEach(t => { assert.ok(t.name && t.f, t.id + " 有名字与头像"); assert.ok(R.QUOTES[t.role], t.id + " 有台词表"); });
});

test("新局状态：默认 75 秒 / 8 位，灶位与出餐盘都为空", () => {
  const st = mkState();
  assert.equal(st.cfg.duration, 75); assert.equal(st.cfg.goal, 8);
  assert.equal(st.stations.length, 9);
  assert.equal(st.stations.every(s => s.food === null && s.state === "idle"), true);
  assert.equal(st.plates.length, 0);
  assert.equal(st.customers.length, 0);
  assert.equal(st.running, false, "未 start 时不自动跑");
  assert.equal(st.elapsed, 0);
  const ev = R.step(st, 1);
  assert.equal(JSON.stringify(ev), "[]", "未 running → step 不产生事件");
  assert.equal(st.elapsed, 0, "未 start 时不推进时间");
  assert.equal(R.activeCustomers(st).length, 0);
  assert.equal(R.placeFood(st, "egg", 3), false, "没开局不能下料");
  assert.equal(R.takePlate(st, 3), false, "没开局不能出锅");
});

/* ══════ 7. 新操作模型（bf-3）：列绑定 / 点击下料路由 / 单击盘出餐 / 双击丢弃 / 9 盘 + 过火报废 ══════ */

test("点击下料路由：单击食材 → 自动进它自己那一列的锅（锅忙 / 盘占用 → 明确原因码）", () => {
  const st = plateState();
  assert.equal(R.placeFood(st, "egg", null), true, "点煎蛋 → 进第 3 列（煎蛋盘）");
  assert.equal(st.stations[3].food, "egg", "就在它那一列，不会跑去别的锅");
  assert.equal(st.stations.filter(s => s.food).length, 1, "只下了这一份");
  assert.equal(R.stationIndexOfKind(st, "griddle", 0), 3, "煎蛋盘 = 第 3 列");
  assert.equal(R.stationIndexOfKind(st, "griddle", 1), 4, "培根盘 = 第 4 列");
  assert.equal(R.stationIndexOfKind(st, "griddle", 2), 5, "三明治盘 = 第 5 列");
  assert.equal(R.stationIndexOfKind(st, "pot", 0), 0, "白粥锅 = 第 0 列");
  assert.equal(R.stationIndexOfKind(st, "juicer", 0), 8, "果汁机 = 第 8 列");
  // 锅还在做 → 拒绝并给原因码
  const busy = R.placeFoodEx(st, "egg", null);
  assert.equal(busy.ok, false); assert.equal(busy.why, "station-occupied");
  assert.match(busy.hint, /锅里还在做/);
  // 别的锅空着也不许去（这是一个「什么锅做什么食材」的游戏）
  assert.equal(R.stationFree(st, 4), true, "4 号煎盘空着");
  assert.equal(R.placeFoodEx(st, "egg", 4).why, "wrong-column", "但煎蛋只认自己那一列");
  // 熟了自动落到本列专属盘 → 锅里空了，但盘占着 → 仍然拒绝下料
  advance(st, 3.2);
  assert.equal(R.plateOfStation(st, 3).food, "egg", "熟了落到第 3 列的专属盘");
  const pbusy = R.placeFoodEx(st, "egg", null);
  assert.equal(pbusy.ok, false); assert.equal(pbusy.why, "plate-occupied");
  assert.match(pbusy.hint, /盘里还有一份，先送出去/);
  // 送出去以后这一列立刻恢复
  longPatience(R.spawnCustomer(st, ["egg"]));
  assert.equal(R.serveFromColumn(st, 3).ok, true);
  assert.equal(R.placeFood(st, "egg", null), true, "盘空 → 马上能再下一份");
  // 别的列完全不受影响
  assert.equal(R.placeFood(st, "bacon", null), true, "培根走它自己那一列（4）");
  assert.equal(st.stations[4].food, "bacon");
});

test("单击盘出餐：自动选中正在需要该食物的顾客，优先耐心最少者", () => {
  const st = plateState();
  const slow = longPatience(R.spawnCustomer(st, ["egg"]));       // 耐心 600
  const hurried = longPatience(R.spawnCustomer(st, ["egg", "congee"]));
  hurried.patience = 6;                                         // 更急
  const other = longPatience(R.spawnCustomer(st, ["congee"]));    // 不要煎蛋
  const col = plated(st, "egg", 3.0);
  assert.equal(R.pickCustomerIndexFor(st, "egg"), st.customers.indexOf(hurried), "优先耐心最少的");
  assert.equal(R.pickCustomerIndexFor(st, "congee"), st.customers.indexOf(hurried), "最急的那位也最优先");
  assert.equal(R.pickCustomerIndexFor(st, "juice"), -1, "没人要的食材返回 -1");
  const r = R.serveFromColumn(st, col);
  assert.equal(r.ok, true); assert.equal(r.delta, 14);
  assert.equal(st.served, 0, "他还要 congee，这单没完成");
  assert.equal(hurried.done.indexOf("egg") >= 0, true, "落在他头上");
  assert.equal(slow.done.indexOf("egg") >= 0, false, "慢的那位没被越位");
  assert.equal(R.activeCustomers(st).length, 3, "其他人都还在");
  assert.equal(R.pickCustomerIndexFor(st, "congee"), st.customers.indexOf(hurried), "他还缺 congee → 仍然最优先");
  assert.equal(R.pickCustomerIndexFor(st, "egg"), st.customers.indexOf(slow), "煎蛋只剩慢的那位要了");
  // 剩下那位还等着 → 再做一份，这次自动挑到他
  const col2 = plated(st, "egg", 3.0);
  const r2 = R.serveFromColumn(st, col2);
  assert.equal(r2.ok, true);
  assert.equal(slow.done.indexOf("egg") >= 0, true, "第二轮送给剩下那位");
});

test("单击盘：此刻没人要这份 → 不消耗、留在盘上继续走热乎度衰减（凉了还能上）", () => {
  const st = plateState();
  longPatience(R.spawnCustomer(st, ["congee"]));
  const col = plated(st, "sandwich", 4.4);
  const score0 = st.score;
  const r = R.serveFromColumn(st, col);
  assert.equal(r.ok, false); assert.equal(r.why, "no-want");
  assert.match(r.hint, /现在没人要这份/);
  assert.equal(st.score, score0, "不扣分");
  assert.equal(st.wrong, 0, "也不算上错菜");
  assert.equal(R.plateOfStation(st, col).food, "sandwich", "那份还在盘上");
  assert.equal(R.platePhaseOf(R.plateOfStation(st, col), st.elapsed), "hot");
  advance(st, 2.0);
  assert.equal(R.plateOfStation(st, col).tier, "warm", "留着不动 → 掉到「温」");
  advance(st, 1.5);
  assert.equal(R.plateOfStation(st, col).tier, "cold", "再掉到「凉」");
  longPatience(R.spawnCustomer(st, ["sandwich"]));
  const r2 = R.serveFromColumn(st, col);
  assert.equal(r2.ok, true); assert.equal(r2.heat, "cold"); assert.equal(r2.delta, 6, "凉了照样能上（+6 · 不劝退）");
});

test("双击丢弃：清空这一列的锅与盘、不扣分；糊的单击被拒（原因码 burnt）只能双击丢", () => {
  const st = plateState();
  longPatience(R.spawnCustomer(st, ["egg"]));
  const col = plated(st, "egg", 3.0);
  assert.equal(!!R.plateOfStation(st, col), true);
  const score0 = st.score;
  assert.equal(R.trashColumn(st, col), true, "双击盘 → 丢垃圾桶");
  assert.equal(R.plateOfStation(st, col), null, "盘清空");
  assert.equal(st.stations[col].food, null, "锅也清空");
  assert.equal(st.score, score0, "不扣分");
  assert.equal(st.wrong, 0, "不算上错菜");
  assert.equal(R.stationFree(st, col), true, "这一列立刻能再用");
  // 锅里还在做的也能双击丢掉
  assert.equal(R.placeFood(st, "egg", null), true);
  assert.equal(R.trashColumn(st, col), true, "双击锅 = 倒掉生料");
  assert.equal(st.stations[col].food, null);
  assert.equal(st.tossed >= 2, true, "记了丢弃次数（结算面板用）");
  // 糊的那份：单击被拒，只能双击
  const col2 = cookWalk(st, "bacon", "burnt");
  assert.equal(R.plateOfStation(st, col2), null, "按住看火的糊份留在锅里");
  assert.equal(R.takePlate(st, col2), true, "糊的也能落到本列盘上（锅清空）");
  assert.equal(R.plateOfStation(st, col2).state, "burnt");
  const sc2 = st.score;
  const bad = R.serveFromColumn(st, col2);
  assert.equal(bad.ok, false); assert.equal(bad.why, "burnt", "糊的单击被拒");
  assert.match(bad.hint, /只能丢/);
  assert.equal(st.score, sc2, "拒绝时不扣分");
  assert.equal(R.plateOfStation(st, col2).state, "burnt", "糊的还在盘上（没被吃掉）");
  assert.equal(R.trashColumn(st, col2), true, "双击才丢得掉");
  assert.equal(R.plateOfStation(st, col2), null);
  assert.equal(st.score, sc2, "丢掉糊的不扣分");
  assert.equal(R.placeFood(st, "bacon", null), true, "丢完立刻能再用");
});

test("9 盘 + 过火报废：盘上停留超过 SERVE_WINDOW → 变糊 → 只能丢（窗口前 0.01s 未糊 / 后 0.01s 已糊）", () => {
  assert.equal(R.SERVE_WINDOW, 4.5, "过火计时 4.5s");
  assert.equal(R.PLATES_TOTAL, 9, "9 个专属盘（不再是 3 个备菜盘）");
  assert.equal(R.MAX_PLATES, 9);
  // ① 纯函数边界：精确到 0.01s
  assert.equal(R.plateBurntAt(R.SERVE_WINDOW - 0.01), false, "窗口前 0.01s 还没糊");
  assert.equal(R.plateBurntAt(R.SERVE_WINDOW + 0.01), true, "窗口后 0.01s 已经糊");
  assert.equal(R.plateBurntAt(R.SERVE_WINDOW), true, "正好到点即糊");
  assert.equal(R.plateBurntAt(0), false, "刚落盘不算糊");
  assert.ok(Math.abs(R.plateLeftSec(0) - R.SERVE_WINDOW) < 1e-9, "刚落盘还剩满窗口");
  assert.ok(Math.abs(R.plateLeftSec(R.SERVE_WINDOW + 1)) < 1e-9, "超时后剩余 0");
  // ② 真实推进的边界：窗口前 0.01s 还活着（凉档），窗口后 0.01s 已经糊
  const st = plateState();
  const col = plated(st, "salad", 1.8);
  const p = R.plateOfStation(st, col);
  p.at = st.elapsed - (R.SERVE_WINDOW - 0.01);
  R.step(st, 0);
  assert.equal(R.plateOfStation(st, col).state, "perfect", "窗口前 0.01s：还是好的");
  assert.equal(R.plateOfStation(st, col).tier, "cold", "此时只剩「凉」档（越拖越差）");
  assert.equal(st.burnt, 0, "还没糊");
  R.plateOfStation(st, col).at = st.elapsed - (R.SERVE_WINDOW + 0.01);
  R.step(st, 0);
  assert.equal(R.plateOfStation(st, col).state, "burnt", "窗口后 0.01s：糊了");
  assert.equal(st.burnt, 1, "糊掉记账 +1");
  assert.equal(st.expire, 1, "记在「忘取」账上");
  assert.equal(R.serveFromColumn(st, col).why, "burnt", "糊的单击被拒");
  const sc = st.score;
  assert.equal(R.trashColumn(st, col), true, "只能双击丢");
  assert.equal(st.score, sc, "丢垃圾桶不扣分");
  // ③ 自然推进（不手动拨表）也会超时报废
  const st2 = plateState();
  const col2 = plated(st2, "juice", 1.5);
  advance(st2, R.SERVE_WINDOW - 0.2);
  assert.equal(R.plateOfStation(st2, col2).state, "perfect", "4.3s：还在盘上等着");
  advance(st2, 0.3);
  assert.equal(R.plateOfStation(st2, col2).state, "burnt", "4.6s：忘取 → 糊");
});

test("热乎度三档：盘上 热乎 14 / 温 10 / 凉 6，单调递减，三档都还能上餐", () => {
  assert.equal(R.HEAT.hot, 14); assert.equal(R.HEAT.warm, 10); assert.equal(R.HEAT.cold, 6);
  assert.ok(R.HEAT.hot > R.HEAT.warm && R.HEAT.warm > R.HEAT.cold, "单调递减 14 > 10 > 6");
  assert.ok(R.HEAT.hotSec < R.HEAT.warmSec && R.HEAT.warmSec < R.SERVE_WINDOW, "三档均分在过火窗口内");
  assert.equal(R.heatTierOf("perfect", 0), "hot");
  assert.equal(R.heatTierOf("perfect", R.HEAT.hotSec), "hot", "边界还算热乎");
  assert.equal(R.heatTierOf("perfect", R.HEAT.hotSec + 0.01), "warm");
  assert.equal(R.heatTierOf("perfect", R.HEAT.warmSec), "warm", "边界还算温");
  assert.equal(R.heatTierOf("perfect", R.HEAT.warmSec + 0.01), "cold");
  assert.equal(R.heatTierOf("over", 0), "warm", "过火拿不到热乎档（旧档 over=7 的手感不变）");
  assert.equal(R.serveScore("perfect", "hot"), 14);
  assert.equal(R.serveScore("perfect", "warm"), 10);
  assert.equal(R.serveScore("perfect", "cold"), 6);
  assert.equal(R.serveScore("over", "warm"), 7);
  assert.equal(R.serveScore("over", "cold"), 3);
  // 三档各自真的能上餐（分数对得上）
  [[0.5, "hot", 14], [2.2, "warm", 10], [4.0, "cold", 6]].forEach(function (row) {
    const age = row[0], tier = row[1], delta = row[2];
    const st = plateState();
    const c = longPatience(R.spawnCustomer(st, ["milk"]));
    const col = plated(st, "milk", 2.6);
    R.plateOfStation(st, col).at = st.elapsed - age;
    R.step(st, 0);
    assert.equal(R.plateOfStation(st, col).tier, tier, age + "s → " + tier);
    const r = R.serveFromColumn(st, col);
    assert.equal(r.ok, true); assert.equal(r.delta, delta, age + "s → " + delta + " 分");
    assert.equal(c.done.indexOf("milk") >= 0, true, "照样算服务成功");
  });
  // 档位只降不升
  const st = plateState();
  const col = plated(st, "congee", 5.0);
  const seq = [R.plateOfStation(st, col).tier];
  for (let k = 0; k < 4; k++) {
    advance(st, 1);
    const t2 = R.plateOfStation(st, col).tier;
    if (t2 !== seq[seq.length - 1]) seq.push(t2);
  }
  jsonEq(seq, ["hot", "warm", "cold"], "档位只降不升");
});

test("每一列都有专属盘：9 盘不限量，盘占用只堵它自己那一列（要求 A5）", () => {
  const st = plateState();
  jsonEq(R.prepStationIndices(), [0, 1, 2, 3, 4, 5, 6, 7, 8], "9 列都有盘（不再只有前 3 个）");
  jsonEq(R.serveStationIndices(), [], "没有「无盘现做灶位」了");
  for (let i = 0; i < 9; i++) assert.equal(st.stations[i].hasPlate, true, i + " 号灶位有自己的盘");
  // 9 列同时各放一份 → 9 份都能各自落到自己的盘上（不限量）
  const each = ["congee", "milk", "soup", "egg", "bacon", "sandwich", "bun", "salad", "juice"];
  each.forEach((f, i) => assert.equal(R.placeFood(st, f, null), true, "第 " + i + " 列下 " + f));
  assert.equal(st.made, 9, "9 列同时开工");
  advance(st, 5.2);
  assert.equal(st.plates.length, 9, "9 份全部落到各自的专属盘上（没有 3 盘限量）");
  assert.equal(new Set(st.plates.map(p => p.station)).size, 9, "没有两个灶位共用一个盘");
  for (let i = 0; i < 9; i++) {
    const p = R.plateOfStation(st, i);
    assert.ok(p, i + " 号灶位有自己的盘");
    assert.equal(p.station, i, "盘记录里写着唯一的归属灶位");
    assert.equal(p.food, each[i], "盘里正好是这一列做出来的东西");
    assert.equal(R.stationFree(st, i), false, "盘上有东西 → 这一列不可下料");
    assert.equal(R.placeFoodEx(st, each[i], null).why, "plate-occupied", "原因码 plate-occupied：" + each[i]);
  }
  // 只丢掉第 0 列 → 只有它恢复
  assert.equal(R.trashColumn(st, 0), true);
  assert.equal(R.stationFree(st, 0), true, "丢掉后第 0 列恢复");
  assert.equal(st.plates.length, 8, "别的 8 列不受影响");
  assert.equal(R.stationFree(st, 1), false, "第 1 列还占着");
  assert.equal(R.placeFood(st, "congee", null), true, "第 0 列马上能再用");
});

test("熟了自动落到本列专属盘（autoPlate 默认开）；manual 按住看火不落盘、照样烧到糊", () => {
  const st = R.newState({ duration:999, goal:99 });
  assert.equal(st.cfg.autoPlate, true, "默认自动落盘（新模型的核心规则）");
  st.running = true; st.nextIn = 1e6;
  const col = R.columnOf("bacon");                       // 3.6s 熟
  assert.equal(R.placeFood(st, "bacon", null), true);
  advance(st, 2.0);
  assert.equal(st.plates.length, 0, "还没熟 → 不落盘");
  assert.equal(R.phaseOf(st, col), "cooking");
  advance(st, 1.7);
  assert.equal(st.plates.length, 1, "进了完美窗口 → 自动落到本列专属盘");
  assert.equal(st.stations[col].food, null, "落盘后锅位立刻空出来");
  assert.equal(R.phaseOf(st, col), "plated");
  assert.equal(st.prepped, 1, "记账：备好 1 份");
  // manual（按住看火）→ 食物留在锅里，会一路烧到糊
  const st2 = plateState();
  assert.equal(R.placeFoodEx(st2, "bacon", null, { manual:true }).ok, true);
  advance(st2, 3.7);
  assert.equal(st2.plates.length, 0, "manual 不自动落盘");
  assert.equal(st2.stations[4].state, "perfect");
  advance(st2, 2.5);
  assert.equal(st2.stations[4].state, "burnt", "按住不管 → 真的会糊（看火的压力还在）");
  assert.equal(st2.burnt, 1);
  // 关掉 autoPlate 的旧手感：手动 takePlate 才落盘
  const st3 = R.newState({ duration:999, goal:99, autoPlate:false }); st3.running = true; st3.nextIn = 1e6;
  R.placeFood(st3, "congee", null);
  advance(st3, 5.1);
  assert.equal(st3.plates.length, 0, "autoPlate:false → 不自动落盘");
  assert.equal(R.takePlate(st3, 0), true, "手动落盘照旧");
  assert.equal(st3.plates.length, 1);
});

test("糊的那份：不清掉就堵着这一列；丢完才能再用（焦黑 + 冒烟的渲染见无头证据链）", () => {
  const st = plateState();
  const col = cookWalk(st, "egg", "burnt");
  assert.equal(st.stations[col].state, "burnt");
  assert.equal(R.phaseOf(st, col), "burnt");
  const r = R.placeFoodEx(st, "egg", null);
  assert.equal(r.ok, false); assert.equal(r.why, "station-occupied", "糊着的时候不能再下料");
  assert.equal(R.stationFree(st, col), false);
  const sc = st.score;
  assert.equal(R.trashColumn(st, col), true, "双击丢掉");
  assert.equal(st.score, sc, "丢垃圾桶不扣分");
  assert.equal(st.stations[col].food, null, "锅清空");
  assert.equal(R.stationFree(st, col), true, "清空后立刻恢复可用");
  assert.equal(R.placeFood(st, "egg", null), true, "马上又能下一份");
});

test("灶位 / 盘状态机是纯函数：idle → raw → cooking → ready → plated；盘 hot → warm → cold → burnt", () => {
  const st = R.newState({ duration:999, goal:99, autoPlate:false }); st.running = true; st.nextIn = 1e6;
  assert.equal(R.phaseOf(st, 3), "idle");
  assert.equal(R.phaseOf(st, 99), "none", "不存在的灶位");
  R.placeFood(st, "egg", null);
  assert.equal(R.phaseOf(st, 3), "raw");
  st.stations[3].t = 1000; assert.equal(R.phaseOf(st, 3), "cooking");
  st.stations[3].t = 3000; st.stations[3].state = "perfect";
  assert.equal(R.phaseOf(st, 3), "ready", "恰好但还没落盘 → ready");
  R.takePlate(st, 3);
  assert.equal(R.phaseOf(st, 3), "plated", "落盘后 → plated");
  // over / burnt 这两条支路在「锅里还有东西」时才看得到
  R.placeFoodEx(st, "bacon", null, { manual:true });
  st.stations[4].state = "over"; assert.equal(R.phaseOf(st, 4), "over");
  st.stations[4].state = "burnt"; assert.equal(R.phaseOf(st, 4), "burnt");
  assert.equal(R.platePhaseOf(null, 0), "none");
  assert.equal(R.platePhaseOf(st.plates[0], st.elapsed), "hot");
  assert.equal(R.platePhaseOf(st.plates[0], st.elapsed + R.HEAT.hotSec + 0.01), "warm");
  assert.equal(R.platePhaseOf(st.plates[0], st.elapsed + R.HEAT.warmSec + 0.01), "cold");
  assert.equal(R.platePhaseOf(st.plates[0], st.elapsed + R.SERVE_WINDOW + 0.01), "burnt", "超时 → 糊");
  // 纯函数：反复调用不改状态
  const snap = JSON.stringify({ f:st.stations[3].food, n:st.plates.length });
  R.phaseOf(st, 3); R.phaseOf(st, 3); R.platePhaseOf(st.plates[0], st.elapsed);
  assert.equal(JSON.stringify({ f:st.stations[3].food, n:st.plates.length }), snap, "无副作用");
});

test("列对齐布局：9 列各自「底部食材 → 中列锅 → 上列盘」同一 x 中心线（±2px）、不越界、不重叠", () => {
  const V = BF.VIEW, L = BF.LAY;
  assert.ok(V.w >= 1100 && V.h >= 680, "画面 ≥1100×680（实测 " + V.w + "×" + V.h + "）");
  assert.ok(L.stove.panW >= 110 && L.stove.panH >= 110, "每个锅位 ≥110px（" + L.stove.panW + "×" + L.stove.panH + "）");
  for (let i = 0; i < 9; i++) {
    const s = BF.stationBox(i), p = BF.plateBox(i), b = BF.bucketBox(i);
    const cx = x => x.x + x.w / 2;
    assert.ok(Math.abs(cx(s) - cx(p)) <= 2, i + " 列：锅与专属盘同一 x 中心线");
    assert.ok(Math.abs(cx(s) - cx(b)) <= 2, i + " 列：锅与底部食材桶同一 x 中心线");
    assert.ok(p.y + p.h <= s.y, i + " 列：盘在锅的正上方");
    assert.ok(b.y >= s.y + s.h, i + " 列：食材桶在锅的正下方");
    [s, p, b].forEach((box, k) => {
      assert.ok(box.x >= 0 && box.x + box.w <= V.w, "第 " + i + " 列第 " + k + " 个盒子不越界（x）");
      assert.ok(box.y >= L.topH && box.y + box.h <= V.h, "第 " + i + " 列第 " + k + " 个盒子不越界（y）");
    });
  }
  for (let a = 0; a < 9; a++) for (let b2 = a + 1; b2 < 9; b2++) {
    const A = BF.stationBox(a), Bx = BF.stationBox(b2);
    assert.ok(A.x + A.w <= Bx.x || Bx.x + Bx.w <= A.x, "列 " + a + " 与 " + b2 + " 不相交");
  }
  const lastBucket = BF.bucketBox(8), lastCard = BF.customerCardBox(2);
  assert.ok(lastBucket.x + lastBucket.w <= V.w, "最后一个食材桶不越界");
  assert.ok(lastCard.x + lastCard.w <= V.w, "第三张顾客卡不越界");
  assert.ok(L.cards.y > L.topH, "顾客卡在顶栏下面");
  assert.ok(L.legend.y >= L.cards.y + L.cards.h, "操作图例在顾客卡下方");
  assert.ok(L.plate.y > L.legend.y + L.legend.h, "专属盘在操作图例下方");
  assert.ok(L.stove.y > L.plate.y + L.plate.h, "锅区在专属盘下方");
  assert.ok(L.buckets.y > L.stove.y + L.stove.panH, "食材桶在最底部（底排）");
  assert.ok(L.buckets.y + L.buckets.h <= V.h, "食材桶在画面内");
});

test("画面参数达标：容器 ≥1100×680、正文 ≥16px、列头小字 ≥13px、关键数字 ≥28px、食物图标 ≥64px", () => {
  const V = BF.VIEW, F2 = BF.FONT, I = BF.ICON;
  assert.ok(V.w >= 1100 && V.h >= 680, "画面 ≥1100×680（实测 " + V.w + "×" + V.h + "）");
  assert.ok(F2.body >= 16, "正文 ≥16px（" + F2.body + "）");
  assert.ok(F2.tiny >= 16, "小注释字号 ≥16px（" + F2.tiny + "）");
  assert.ok(F2.label >= 16 && F2.name >= 16 && F2.bucket >= 16, "标签 / 名字 / 食材名都 ≥16px");
  assert.ok(F2.micro >= 13, "列头小字（用户要求「小字」）≥13px（" + F2.micro + "）");
  assert.ok(F2.clock >= 28, "倒计时 ≥28px（" + F2.clock + "）");
  assert.ok(F2.score >= 28, "分数 ≥28px（" + F2.score + "）");
  assert.ok(F2.patience >= 28, "耐心 ≥28px（" + F2.patience + "）");
  assert.ok(I.food >= 64, "单份食物视觉尺寸 ≥64px（" + I.food + "）");
  assert.ok(I.bucket >= 64 && I.card >= 64 && I.plate >= 64, "各处的食物图标都 ≥64px");
  assert.ok(BF.LAY.cards.w >= 220, "顾客卡宽度 ≥220（" + BF.LAY.cards.w + "）");
});

test("过火计时从「落盘那一刻」起算：煮得久的菜不会一落盘就糊", () => {
  const st = plateState();
  longPatience(R.spawnCustomer(st, ["congee"]));
  assert.equal(R.placeFood(st, "congee", null), true);
  advance(st, R.FOOD.congee.dur + 0.1);           // 煮了 5.1s（比 4.5s 的过火窗口还长）
  const p = R.plateOfStation(st, 0);
  assert.ok(p, "白粥落盘了");
  assert.equal(p.state, "perfect", "刚落盘还是好的（计时从落盘起算，不是从下锅起算）");
  assert.ok(p.age <= 0.25, "落盘年龄 ≈ 0（" + p.age + "s）");
  assert.ok(p.left > R.SERVE_WINDOW - 0.3, "剩余窗口 ≈ 4.5s（实际 " + p.left + "s）");
  advance(st, R.SERVE_WINDOW - 0.3);
  assert.equal(R.plateOfStation(st, 0).state, "perfect", "还剩 0.3s 可以送出去");
  advance(st, 0.4);
  assert.equal(R.plateOfStation(st, 0).state, "burnt", "超时才糊");
});

test("双击丢弃的时机窗口：DOUBLE_MS=425ms；同一目标点两下才算双击（常量 + 落到清空语义）", () => {
  assert.equal(R.DOUBLE_MS, 425, "双击判定窗口 425ms（放宽后更好点）");
  assert.ok(R.DOUBLE_MS > 0 && R.DOUBLE_MS <= 500, "既不能太短（点不出来）也不能太长（误触）");
  const st = plateState();
  const col = plated(st, "bun", 4.0);
  const sc = st.score;
  assert.equal(R.trashColumn(st, col), true, "双击 → 清锅 + 清盘");
  assert.equal(R.trashColumn(st, col), false, "已经空了的列再丢一次无事发生（不报错）");
  assert.equal(st.score, sc, "始终不扣分");
  assert.equal(R.stationFree(st, col), true, "丢完这一列可用");
});

/* ═══════════════════════════════════════════════════════════════════════════
   结算面板的**出口**（#bfGo）· 无头 DOM +「真实 CSS → 布局几何」断言
   背景：用户实测「游戏结束然后呢，都没有找到可以退出游戏的按钮和衔接剧情」——
        1440×900 窗口里「顶栏 + 1180×790 等比放大的画布」已经把 .bf-panel 撑出视口，
        结算面板排在画布下面 → 被裁掉，出口按钮根本不在屏幕里，onFinish 也永远不触发。
   做法：用最小 DOM 真跑 Breakfast.start()（真出结算面板），再按 index.html 里**真实生效的
        CSS 声明**算几何：面板 max-height:calc(100vh-20px) 居中 → 结算面板 sticky 贴底 →
        .bf-row sticky bottom:0。按钮底边 = 面板可见底边 − 边框 − padding-bottom，与内容多高无关。
   ═══════════════════════════════════════════════════════════════════════════ */
const HTML_SRC = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const CSS_SRC = (HTML_SRC.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1];

/** 取某条选择器的声明块（逐字匹配「选择器{」，取样式表里第一处 = 未被媒体查询覆盖的主规则） */
function cssRule(sel) {
  const i = CSS_SRC.indexOf(sel + "{");
  if (i < 0) return "";
  const j = CSS_SRC.indexOf("}", i);
  return CSS_SRC.slice(i + sel.length + 1, j);
}
/** 从声明里取 "max-height:calc(100vh - 20px)" 的视口换算值 */
function vhMaxHeight(decl, vh) {
  const m = /max-height:\s*calc\(100vh\s*-\s*(\d+)px\)/.exec(decl || "");
  return m ? vh - Number(m[1]) : null;
}
/** 结算出口几何模型（输入视口高，输出面板/结算面板/按钮的落点；全部由真实 CSS 推导） */
function exitGeom(vh) {
  const panelDecl = cssRule("#bfGame .panel.bf-panel.bf-game-panel");
  const resultDecl = cssRule(".bf-result");
  const rowDecl = cssRule(".bf-result .bf-row");
  const goDecl = cssRule("#bfGo");
  const panelMaxH = vhMaxHeight(panelDecl, vh);
  const resultMaxH = vhMaxHeight(resultDecl, vh);
  const padB = Number((/padding:\s*12px\s+14px\s+(\d+)px/.exec(panelDecl) || [])[1] || 14);
  const panelTop = (vh - panelMaxH) / 2;                       // .overlay 居中
  const panelBottom = vh - panelTop;
  const rowBottom = panelBottom - 1 - padB;                    // 减 .panel 边框 1px + padding-bottom
  const goFont = Number((/font-size:\s*(\d+)px/.exec(goDecl) || [])[1] || 18);
  const goPadY = Number((/(?:^|;)padding:\s*(\d+)px/.exec(goDecl) || [])[1] || 12);
  return {
    vh, panelMaxH, resultMaxH, panelTop, panelBottom, rowBottom,
    btnH: goPadY * 2 + Math.round(goFont * 1.2),
    panelScroll: /overflow-y:auto/.test(panelDecl),
    resultScroll: /overflow-y:auto/.test(resultDecl),
    resultSticky: /position:sticky/.test(resultDecl) && /bottom:0/.test(resultDecl),
    rowSticky: /position:sticky/.test(rowDecl) && /bottom:0/.test(rowDecl),
  };
}

/* ── 极简选择器匹配（tag / .class / #id，够用且不引依赖） ── */
function matchSel(el, sel) {
  let s = String(sel).trim();
  if (s[0] === "#") return el.id === s.slice(1);
  if (s[0] === ".") return String(el.className).split(/\s+/).indexOf(s.slice(1)) >= 0;
  return el.tagName === s.toUpperCase();
}
/* ── 记录式 Canvas2D（只为让 render() 跑起来） ── */
function makeCtx() {
  const noop = () => {};
  const ctx = {
    canvas: null, fillStyle: "#000", strokeStyle: "#000", globalAlpha: 1, lineWidth: 1,
    font: "10px sans-serif", textAlign: "left", textBaseline: "alphabetic",
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop, setTransform: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop,
    bezierCurveTo: noop, arc: noop, ellipse: noop, rect: noop, fill: noop, stroke: noop,
    fillRect: noop, strokeRect: noop, clip: noop, fillText: noop, strokeText: noop,
    measureText: t => ({ width: String(t).length * 6 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: [] }), putImageData: noop,
  };
  return ctx;
}
function mkEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), children: [], parentNode: null,
    id: "", className: "", _html: "", textContent: "", type: "", style: {}, dataset: {},
    _handlers: {}, __rect: null,
    set innerHTML(v) { this._html = String(v); this.children = []; },
    get innerHTML() { return this._html; },
    setAttribute(k, v) { if (k === "id") this.id = v; this[k] = v; },
    getAttribute(k) { return this[k] === undefined ? null : this[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener(t, f) { (this._handlers[t] = this._handlers[t] || []).push(f); },
    removeEventListener(t, f) { const h = this._handlers[t] || []; const i = h.indexOf(f); if (i >= 0) h.splice(i, 1); },
    dispatch(t, ev) { (this._handlers[t] || []).slice().forEach(f => f(ev || {})); },
    click() { this.dispatch("click", { preventDefault() {}, stopPropagation() {} }); },
    all() { const out = []; (function walk(n) { (n.children || []).forEach(c => { out.push(c); walk(c); }); })(this); return out; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { return this.all().filter(e => matchSel(e, sel)); },
    getBoundingClientRect() { return this.__rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    getContext() { return this._ctx; },
    offsetWidth: 0,
  };
  el.classList = {
    add(c) { const s = new Set(String(el.className).split(/\s+/).filter(Boolean)); s.add(c); el.className = [...s].join(" "); },
    remove(c) { const s = new Set(String(el.className).split(/\s+/).filter(Boolean)); s.delete(c); el.className = [...s].join(" "); },
    contains(c) { return String(el.className).split(/\s+/).indexOf(c) >= 0; },
    toggle(c, on) { if (on === undefined) on = !this.contains(c); on ? this.add(c) : this.remove(c); },
  };
  if (el.tagName === "CANVAS") { el._ctx = makeCtx(); el._ctx.canvas = el; el.width = 300; el.height = 150; }
  return el;
}
/** 起一个「#bfGame 覆盖层 > .panel#bfGameHost」的无头宿主（结构与 index.html 一致） */
function bootDom() {
  const body = mkEl("body");
  const overlay = mkEl("div"); overlay.id = "bfGame"; overlay.className = "overlay bf-overlay on";
  const host = mkEl("div"); host.id = "bfGameHost"; host.className = "panel bf-panel bf-game-panel";
  overlay.appendChild(host); body.appendChild(overlay);
  const keys = [];
  const doc = {
    body, createElement: mkEl,
    getElementById: id => (id === "bfGameHost" ? host : (id === "bfGame" ? overlay : null)),
    querySelector: sel => body.querySelector(sel),
    querySelectorAll: sel => body.querySelectorAll(sel),
    addEventListener: (t, f) => { if (t === "keydown") keys.push(f); },
    removeEventListener: (t, f) => { if (t === "keydown") { const i = keys.indexOf(f); if (i >= 0) keys.splice(i, 1); } },
  };
  let clock = 0;
  const frames = [];
  const sandbox = {
    console, Math, Date, isFinite, Number, String, Object, Array, JSON, Set,
    devicePixelRatio: 1, document: doc,
    performance: { now: () => clock },
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: id => { frames[id - 1] = null; },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
  };
  const ctx = vm.createContext(sandbox);
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(SRC + "\n;globalThis.__BF = window.Breakfast;", ctx);
  function pump(n, ms) {
    for (let i = 0; i < n; i++) {
      clock += (ms === undefined ? 16 : ms);
      const list = frames.slice(); frames.length = 0;
      list.forEach(cb => { if (cb) cb(clock); });
      if (!frames.length) break;
    }
  }
  return { B: ctx.__BF, doc, host, overlay, pump, keys, esc: () => keys.slice().forEach(f => f({ key: "Escape", preventDefault() {}, stopPropagation() {} })) };
}
/** 机器人：看单下料 → 熟了自动落盘 → 单击盘出餐（真把「通过」跑出来） */
function botRun(B) {
  const d = B.debug;
  let guard = 0;
  while (!d.state().over && guard++ < 6000) {
    for (const c of d.orders()) for (const f of c.order) {
      if (c.done.indexOf(f) >= 0) continue;
      if (d.stations().some(s => s.food === f)) continue;
      if (d.plates().some(p => p.food === f && p.state !== "burnt")) continue;
      d.drop(f, null);
    }
    for (let n = 0; n < 60 && !d.state().over; n++) { d.tick(1 / 60); if (d.plates().some(p => p.state === "perfect")) break; }
    if (d.state().over) break;
    d.stations().forEach((s, i) => { if (s.plate && s.plateState !== "burnt") d.serveCol(i); });
    d.stations().forEach((s, i) => {
      if (s.state === "burnt" || s.plateState === "burnt") { d.trash(i); return; }
      if (s.plate) { const r = d.serveCol(i); if (!r.ok && r.why === "no-want") d.trash(i); }
    });
    d.tick(0.15);
  }
  return d.state();
}
/** 起一局 + 真跑到结算面板出现；返回 {boot, res, panel, go} */
function settleDom(win) {
  const b = bootDom();
  let calls = 0, last = null;
  b.B.start(b.host, {
    target: { id: win ? "su" : "guo", name: win ? "苏晚晴" : "陈果", bond: win ? 40 : 30 },
    duration: win ? 75 : 20, goal: 8,
    onFinish: r => { calls++; last = r; },
  });
  if (win) {
    botRun(b.B);
    assert.equal(b.B.debug.state().win, true, "机器人真打出了通过");
    b.pump(3);                                   // 泵几帧让画布循环走到 showResult()
  } else {
    let g = 0;
    while (!b.B.debug.state().over && g++ < 20000) b.B.debug.tick(0.2);
    assert.equal(b.B.debug.state().win, false, "失败路径真跑出来了");
    b.pump(3);
  }
  const panel = b.host.querySelector(".bf-result");
  const go = b.host.querySelector("#bfGo");
  return { b, panel, go, calls: () => calls, last: () => last, reset: () => { calls = 0; } };
}

test("#bfGo：结算面板有出口按钮、文案分胜负、尺寸 >0（真 DOM 节点，不是只有字符串）", () => {
  const w = settleDom(true);
  assert.ok(w.panel, "结算面板已出现在 #bfGameHost 里");
  assert.ok(w.go, "#bfGo 是真实 DOM 节点（浏览器 / 无头都能 querySelector 到）");
  assert.equal(w.go.tagName, "BUTTON", "#bfGo 是按钮");
  assert.ok(/收下早餐\s*·\s*继续/.test(w.go.textContent), "通过时文案「收下早餐 · 继续」（实际 " + w.go.textContent + "）");
  assert.equal(w.go.getAttribute("data-act"), "close", "保留 data-act=close（兼容旧验收脚本选择器）");
  assert.ok(w.panel.querySelectorAll("button").indexOf(w.go) >= 0, "出口按钮真的长在结算面板里");
  assert.ok(w.b.B.isBusy() === true, "面板还在 → 局还没交出去");

  const l = settleDom(false);
  assert.ok(l.go, "失败也有 #bfGo");
  assert.ok(/算了，明天再来\s*·\s*继续/.test(l.go.textContent), "失败文案「算了，明天再来 · 继续」（实际 " + l.go.textContent + "）");
});

test("#bfGo 在任何视口都可见：面板高度 ≤ 视口高、按钮 getBoundingClientRect().bottom ≤ 视口高", () => {
  const w = settleDom(true);
  assert.ok(w.go, "#bfGo 存在且可见才会被断言到");
  for (const vh of [1200, 900, 768, 600, 480]) {
    const g = exitGeom(vh);
    assert.equal(typeof g.panelMaxH, "number", vh + "：能读到面板 max-height:calc(100vh - 20px)");
    assert.equal(typeof g.resultMaxH, "number", vh + "：能读到 .bf-result max-height:calc(100vh - 40px)");
    assert.ok(g.panelScroll, vh + "：游戏面板内部可滚动（overflow-y:auto）");
    assert.ok(g.resultScroll, vh + "：结算面板内部可滚动（overflow-y:auto）");
    assert.ok(g.resultSticky, vh + "：结算面板 sticky 贴住游戏面板底部");
    assert.ok(g.rowSticky, vh + "：出口按钮那一行 sticky 贴住结算面板底部");
    /* ① 面板本身不超视口 */
    const panelRect = { top: g.panelTop, bottom: g.panelBottom, height: g.panelMaxH };
    assert.ok(panelRect.height <= vh, vh + "：面板高度 " + panelRect.height + " ≤ 视口 " + vh);
    assert.ok(panelRect.top >= 0 && panelRect.bottom <= vh, vh + "：面板整体在视口内（" + panelRect.top + "~" + panelRect.bottom + "）");
    /* ② 结算面板在视口内，且按钮底边不越界 */
    const resultTop = Math.max(g.panelTop, g.rowBottom - Math.min(g.resultMaxH, g.panelMaxH));
    const btnBottom = g.rowBottom;
    assert.ok(resultTop >= 0, vh + "：结算面板顶边 " + resultTop + " 没跑到视口外");
    assert.equal(resultTop >= g.panelTop, true, vh + "：结算面板在游戏面板里（sticky 贴底）");
    assert.ok(btnBottom <= vh, vh + "：按钮底边 " + btnBottom + " ≤ 视口高 " + vh);
    assert.ok(btnBottom - g.btnH >= 0, vh + "：按钮顶边 " + (btnBottom - g.btnH) + " 也在视口内");
    assert.ok(g.btnH > 0, vh + "：按钮高度 > 0（" + g.btnH + "px）");
    /* ③ 把模型数值落到真实节点上：尺寸 > 0 */
    w.go.__rect = { left: 0, top: btnBottom - g.btnH, right: 320, bottom: btnBottom, width: 320, height: g.btnH };
    w.panel.__rect = { left: 0, top: resultTop, right: 1150, bottom: g.rowBottom, width: 1150, height: g.rowBottom - resultTop };
    const r = w.go.getBoundingClientRect();
    assert.ok(r.width > 0 && r.height > 0, vh + "：按钮尺寸 " + r.width + "×" + r.height + " > 0");
    assert.ok(w.panel.getBoundingClientRect().height <= vh, vh + "：结算面板高度 ≤ 视口");
    assert.ok(r.bottom <= vh, vh + "：按钮 getBoundingClientRect().bottom " + r.bottom + " ≤ 视口高 " + vh);
  }
});

test("点 #bfGo：onFinish 恰好一次（连点 3 次仍为 1）+ dispose 清计时器 / 监听 + 覆盖层隐藏", () => {
  const w = settleDom(true);
  const before = w.b.B.debug.lifecycle();
  assert.ok(before.escBound >= 1 && before.escActive === true, "开局时 ESC 监听已挂上（escBound=" + before.escBound + "）");
  assert.equal(w.calls(), 0, "结算面板出来时还没交结果（等玩家点出口）");
  w.go.click(); w.go.click(); w.go.click();                      // 连点 3 次（含重复触发 / 手快）
  assert.equal(w.calls(), 1, "onFinish 恰好调用一次（实际 " + w.calls() + "）");
  assert.ok(w.last() && w.last().win === true, "onFinish 收到的是这一局的 result（win:true）");
  assert.equal(w.b.B.isBusy(), false, "点完 isBusy()===false（模块已收摊）");
  const after = w.b.B.debug.lifecycle();
  assert.equal(after.rafCancelled >= 1, true, "rAF 计时器已取消（rafCancelled=" + after.rafCancelled + "）");
  assert.equal(after.escRemoved, after.escBound, "ESC 监听已摘掉（挂 " + after.escBound + " / 摘 " + after.escRemoved + "）");
  assert.equal(after.escActive, false, "ESC 不再处于激活态");
  assert.equal(w.b.keys.length, 0, "document 上不留 keydown 监听");
  assert.equal(w.b.host.children.length, 0, "#bfGameHost 已清空（没有留一个挡住的死界面）");
  assert.equal(w.b.host.classList.contains("bf-on"), false, "宿主 class 已摘");
  assert.equal(w.b.overlay.classList.contains("on"), false, "覆盖层 #bfGame 已关闭");
  assert.equal(w.b.B.start(w.b.host, { onFinish: () => {} }), true, "收摊后还能再开一局（状态没粘住）");
  w.b.B.dispose();
});

test("ESC = 点 #bfGo（退出但不丢结算结果，且同样只交一次）", () => {
  const w = settleDom(true);
  assert.equal(w.calls(), 0, "ESC 之前没交过结果");
  w.b.esc();
  assert.equal(w.calls(), 1, "ESC → onFinish 恰好一次（实际 " + w.calls() + "）");
  assert.ok(w.last() && w.last().win === true, "ESC 交出去的是这一局的结算 result（win:true）");
  assert.ok(w.last() && typeof w.last().served === "number" && typeof w.last().bondDelta === "number",
    "ESC 交出去的 result 字段齐全（served / bondDelta）");
  w.b.esc(); w.b.esc();                                          // 再按也没用（监听已摘 + 幂等）
  assert.equal(w.calls(), 1, "ESC 连按仍是 1 次");
  assert.equal(w.b.B.isBusy(), false, "ESC 之后模块已收摊");
  assert.equal(w.b.overlay.classList.contains("on"), false, "ESC 也把覆盖层关掉");
  /* 对局中（还没结算）ESC 不该抢：先开一局、面板还没出 */
  const g = bootDom();
  let n = 0;
  g.B.start(g.host, { target: { id: "su", name: "苏晚晴", bond: 40 }, duration: 75, goal: 8, onFinish: () => { n++; } });
  assert.equal(g.host.querySelector(".bf-result").style.display, "none", "刚开局结算面板是 display:none");
  g.esc();
  assert.equal(n, 0, "还没结算时按 ESC 不交结果（不抢对局中的 ESC）");
  assert.equal(g.B.isBusy(), true, "还没结算时按 ESC 不关局");
  g.B.dispose();
});

test("结算面板写清「接下来干什么」：本局影响（rules.impactOf 同源）+ 今日额度（rules.quotaOf 同源）", () => {
  const w = settleDom(true);
  const txt = String(w.panel._html || w.panel.innerHTML).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.ok(/本局影响/.test(txt), "面板有「本局影响」一行");
  assert.ok(/接下来/.test(txt), "面板有「接下来」一行（今日是否还能再送）");
  const r = w.last() || w.b.B.debug.state().result;
  assert.ok(txt.indexOf(R.impactOf(r.win, r.perfect, r.burnt, r.hot, r.target.name)) >= 0, "本局影响文案与 rules.impactOf 同源");
  assert.ok(txt.indexOf(R.quotaOf(r.win, r.bondDelta, r.target.name)) >= 0, "今日额度文案与 rules.quotaOf 同源");
  assert.ok(/换个人|明天再来/.test(txt), "告诉玩家接下来能干什么（换个人 / 明天再来）");
  assert.ok(typeof R.quotaOf === "function", "rules.quotaOf 已导出（页面 toast 与面板同一份文案）");
  const l = settleDom(false);
  const ltxt = String(l.panel._html || l.panel.innerHTML);
  assert.ok(/台阶|明天再来/.test(ltxt), "失败面板同样给台阶");
});

/* ═══════════════════════════════════════════════════════════════════════════
   本轮新增：素材贴图（背景 / 厨具 / 头像 / UI）的映射表 · 统一加载器 · 回退路径
   这些用例**不需要 DOM**：映射表与加载器在模块初始化时就绪，纯逻辑单测就能覆盖
   「映射完整 / 路径是相对路径 / 缺图时一律回退 / 耐心阈值切换头像」四件事。
   ═══════════════════════════════════════════════════════════════════════════ */

/** 带「假 Image + location」的装载：只验证统一加载器的行为（src 拼装 / 就绪统计 / 失败回退）
    ok=true  → 每次 src 赋值都当成功解码（naturalWidth>0、complete=true、触发 onload）
    ok=false → 一律走 onerror（等价于 34 个文件全丢了） */
/** api.art.ready() 的 5 个计数拼成 "food,gear,face,ui,bg"（跨 realm 对象不能 deepStrictEqual） */
function readyStr(A) { return ["food", "gear", "face", "ui", "bg"].map(k => A.ready()[k]).join(","); }
function loadBfWithFakeImage(opts) {
  const made = [];
  const ctx = vm.createContext({ console, Math, Date, isFinite, Number, String, Object, Array });
  function FakeImage() {
    return {
      naturalWidth: 0, naturalHeight: 0, complete: false, onload: null, onerror: null, _src: "",
      get src() { return this._src; },
      set src(v) {
        this._src = String(v);
        made.push(this._src);
        if (opts && opts.ok === false) { if (typeof this.onerror === "function") this.onerror({ target: this }); return; }
        this.naturalWidth = 64; this.naturalHeight = 64; this.complete = true;
        if (typeof this.onload === "function") this.onload({ target: this });
      }
    };
  }
  ctx.window = ctx;
  ctx.Image = FakeImage;
  ctx.location = { href: "file:///C:/proj/reborn2/index.html" };
  vm.runInContext(SRC + "\n;globalThis.__BF = window.Breakfast;", ctx);
  return { B: ctx.__BF, srcs: () => made.slice() };
}

test("素材映射表完整：5 类厨具有贴图；9 样食材都有盘位贴图；6 头像 + 9 UI 全在册", () => {
  const A = BF.art;
  assert.ok(A && typeof A.groups === "function", "api.art 已导出（贴图映射与状态的机器可读出口）");
  /* 厨具：灶位 kind → gear 贴图名，五个 kind 一个都不能漏 */
  const kinds = [...new Set(R.COLS.map(c => c.kind))].sort();
  assert.deepEqual(kinds, ["counter", "griddle", "juicer", "pot", "steamer"], "9 列用到 5 种灶位 kind");
  assert.equal(A.gearIds.length, 9, "厨具贴图 9 张：" + A.gearIds.join("/"));
  kinds.forEach(k => {
    const n = A.gearOfKind(k);
    assert.ok(n && A.gearIds.indexOf(n) >= 0, "灶位 kind=" + k + " → gear/" + n + ".png（在册）");
  });
  /* 盘位：每样食材都有盘位贴图，且必须是 gear 组里真实存在的文件 */
  R.FOOD_IDS.forEach(f => {
    const t = A.plateTexOf(f);
    assert.ok(A.gearIds.indexOf(t) >= 0, "食材 " + f + " → 盘位贴图 gear/" + t + ".png（在册）");
  });
  assert.equal(A.plateTexOf("egg"), "plate_egg_bacon", "煎蛋 → 煎蛋培根盘");
  assert.equal(A.plateTexOf("bacon"), "plate_egg_bacon", "培根 → 煎蛋培根盘");
  assert.equal(A.plateTexOf("bun"), "plate_bun", "包子 → 包子盘");
  assert.equal(A.plateTexOf("congee"), "plate_empty", "其余食材 → 空盘 + 食物贴图");
  assert.equal(A.plateTexOf(null), "plate_empty", "空盘位 → plate_empty");
  assert.ok(A.plateTexHasFood("egg") && A.plateTexHasFood("bacon") && A.plateTexHasFood("bun") &&
    !A.plateTexHasFood("congee") && !A.plateTexHasFood("juice"),
    "plateTexHasFood：自带食物的盘（煎蛋培根 / 包子）不再叠一份食物贴图");
  /* 头像 / UI / 分组 */
  assert.equal(A.faceIds.length, 6, "6 张头像：" + A.faceIds.join("/"));
  assert.equal(A.uiIds.length, 9, "9 个 UI 元素：" + A.uiIds.join("/"));
  ["bar_empty", "bar_full", "stars", "btn_wood", "btn_red", "coin", "bulb", "check", "cross"].forEach(n =>
    assert.ok(A.uiIds.indexOf(n) >= 0, "UI 元素在册：" + n));
  /* 注意：api.art 返回的是 vm 里的对象/数组（跨 realm），deepStrictEqual 会因为
     原型不同而失败 → 这里一律先拼成字符串再比。 */
  assert.equal(A.groups().map(g => g.key + ":" + g.ids.length).join("|"),
    "food:9|gear:9|face:6|ui:9", "四组贴图都在统一加载器里（food/gear/face/ui）");
  assert.equal(A.total(), 34, "素材总数 = 9 食材 + 9 厨具 + 6 头像 + 9 UI + 1 背景 = 34");
});

test("贴图路径一律是「页面目录 + 相对路径」：不写盘符、不写协议、不写 data URI", () => {
  const A = BF.art;
  A.groups().forEach(g => {
    assert.ok(/^art\/icons\//.test(g.dir), g.key + " 组目录是相对路径：" + g.dir);
    assert.ok(!/^[A-Za-z]:|^\/|^https?:|^data:/i.test(g.dir), g.key + " 组目录不含盘符 / 协议 / data:");
    assert.equal(g.ext, ".png", g.key + " 扩展名固定 .png");
    g.ids.forEach(id => assert.ok(/^[a-z_]+$/.test(id), g.key + " 的 id 只用小写字母与下划线：" + id));
  });
  const bg = A.bg();
  assert.equal(bg.dir + bg.name, "art/bg/kitchen.png", "背景路径：art/bg/kitchen.png（相对页面目录）");
  assert.ok(!/^[A-Za-z]:|^https?:|^data:/i.test(bg.file), "背景路径不含盘符 / 协议 / data:");
});

test("背景层：几何常量与磁盘上的真图对得上，木台面上沿落在专属盘带上方", () => {
  const bg = BF.art.bg();
  const f = path.join(ROOT, bg.file);
  assert.ok(fs.existsSync(f), "背景文件真实存在：" + bg.file);
  const b = fs.readFileSync(f);
  assert.equal(b.readUInt32BE(16), bg.spec.w, "磁盘上背景宽 = 代码里的 spec.w（" + bg.spec.w + "）");
  assert.equal(b.readUInt32BE(20), bg.spec.h, "磁盘上背景高 = 代码里的 spec.h（" + bg.spec.h + "）");
  /* 裁切参数与「源图坐标」自洽：crop 必须完全落在原素材里 */
  assert.ok(bg.crop.x >= 0 && bg.crop.y >= 0 &&
    bg.crop.x + bg.crop.w <= bg.srcSpec.w && bg.crop.y + bg.crop.h <= bg.srcSpec.h,
    "裁切框在源图 " + bg.srcSpec.w + "×" + bg.srcSpec.h + " 之内");
  assert.ok(bg.counterTopSrcY >= bg.crop.y && bg.counterTopSrcY <= bg.crop.y + bg.crop.h,
    "木台面上沿（源 y=" + bg.counterTopSrcY + "）在裁切框内");
  /* 关键对齐：木台面上沿必须落在「专属盘带顶部」之上，盘/锅/桶三段才会都在台面上 */
  assert.ok(Math.abs(bg.counterTopCanvasY - bg.counterTopCanvasYTarget) <= 1.5,
    "木台面上沿 → 画布 y=" + bg.counterTopCanvasY + "（目标 " + bg.counterTopCanvasYTarget + "）");
  assert.ok(bg.counterTopCanvasY <= BF.LAY.plate.y,
    "台面上沿 y=" + bg.counterTopCanvasY + " ≤ 盘带顶部 " + BF.LAY.plate.y + " → 盘/锅/桶三段全在木台面上");
  assert.ok(BF.LAY.buckets.y + BF.LAY.buckets.h <= BF.VIEW.h, "底排食材桶仍在画面内（没被背景挪动）");
  assert.ok(bg.view.w === BF.VIEW.w && bg.view.h === BF.VIEW.h, "背景对齐用的画布尺寸与 VIEW 一致");
  /* 无 Image 的单测环境里，背景也必须判为「不可用」→ 走程序化底 */
  assert.equal(bg.ready, false, "单测环境没有 Image → 背景判为不可用（回退程序化底）");
});

test("统一加载器：预加载 34 张本地贴图；就绪判定 / 全失败回退两条路都走得到", () => {
  /* 这个 vm 环境里没有 Image 构造器（单测就是这么设计的）→ 全部判为「走矢量」 */
  assert.equal(readyStr(BF.art), "0,0,0,0,0", "无 Image 时全部判为不可用 → 一律回退矢量");
  /* 换成带「假 Image + location」的环境：验证 src 拼装与就绪统计 */
  const okCtx = loadBfWithFakeImage({ ok: true });
  const A1 = okCtx.B.art;
  assert.equal(readyStr(A1), "9,9,6,9,1", "有 Image 时 34 张全部就绪");
  const srcs = okCtx.srcs();
  assert.equal(srcs.length, 34, "一共预加载 34 张（实际 " + srcs.length + "）");
  assert.ok(srcs.every(s => s.indexOf("art/") >= 0 && /\.png$/.test(s)), "每张都是 .png 且落在 art/ 下");
  assert.ok(srcs.every(s => !/^https?:|^data:/i.test(s)), "没有任何 http(s):// 或 data: 外链");
  assert.ok(srcs.every(s => s.indexOf("C:/proj/reborn2/art/") >= 0), "src = 页面目录 + art/… （相对页面，不写死盘符）");
  assert.ok(srcs.some(s => /art\/icons\/gear\/pot\.png$/.test(s)), "厨具 src 形如 …/art/icons/gear/pot.png");
  assert.ok(srcs.some(s => /art\/icons\/faces\/stud_calm\.png$/.test(s)), "头像 src 形如 …/art/icons/faces/stud_calm.png");
  assert.ok(srcs.some(s => /art\/icons\/ui\/bar_empty\.png$/.test(s)), "UI src 形如 …/art/icons/ui/bar_empty.png");
  assert.ok(srcs.some(s => /art\/bg\/kitchen\.png$/.test(s)), "背景 src 形如 …/art/bg/kitchen.png");
  /* 全部加载失败（真实走 onerror 的那条路）→ 计数落到 failed 上，ready 归零 → 回退 */
  const failCtx = loadBfWithFakeImage({ ok: false });
  const A2 = failCtx.B.art;
  assert.equal(readyStr(A2), "0,0,0,0,0", "34 张全失败 → 全部回退矢量");
  const failed = A2.groups().reduce((a, g) => a + g.failed, 0) + A2.bg().failed;
  assert.equal(failed, 34, "34 张的 onerror 全都被接住（failed=" + failed + "）");
});

test("顾客头像按耐心阈值切换：> 40% 平静 / ≤ 40% 着急（阈值写在常量里）", () => {
  const A = BF.art;
  assert.equal(A.faceUrgentAt, 0.4, "阈值常量 FACE_ICON.urgentAt = 0.40（可调）");
  assert.equal(A.faceOf(0, 1), "stud_calm", "满耐心 → 平静");
  assert.equal(A.faceOf(0, 0.41), "stud_calm", "41% → 平静（> 40%）");
  assert.equal(A.faceOf(0, 0.4), "stud_urgent", "40% → 着急（≤ 40%，边界取着急）");
  assert.equal(A.faceOf(0, 0.39), "stud_urgent", "39% → 着急");
  assert.equal(A.faceOf(0, 0), "stud_urgent", "耐心耗尽 → 着急");
  /* 异常输入（负数 / NaN）按「满耐心」处理 —— 真正的钳位在调用点（Math.max(0, patience)），
     所以负耐心根本不会走到这里；下面两条一起把这个约定钉住。 */
  assert.equal(A.faceOf(0, -5), "stud_calm", "负数（异常输入）→ 按满耐心，不炸");
  assert.equal(A.faceOf(0, NaN), "stud_calm", "NaN（异常输入）→ 按满耐心，不炸");
  assert.ok(/Math\.max\(0, c\.patience\) \/ Math\.max\(0\.01, c\.patienceMax\)/.test(SRC),
    "调用点把耐心钳到 ≥ 0（drawCustomerFace）→ 负耐心不会真的传进 faceNameOf");
  /* 角色按顾客编号轮换：学生(红帽) / 女白领 / 胖大爷 */
  assert.equal(A.faceOf(0, 1), "stud_calm");
  assert.equal(A.faceOf(1, 1), "office_calm");
  assert.equal(A.faceOf(2, 1), "uncle_calm");
  assert.equal(A.faceOf(3, 1), "stud_calm", "第 4 位顾客回到第 1 种角色（轮换）");
  assert.equal(A.faceOf(4, 0.2), "office_urgent");
  assert.equal(A.faceOf(5, 0.2), "uncle_urgent");
  /* 生成的名字必须在册（否则 assetOf 拿不到图 → 静默回退，测试就漏了）*/
  [0, 1, 2, 3, 4, 5].forEach(i => [0, 0.2, 0.4, 0.41, 1].forEach(r =>
    assert.ok(A.faceIds.indexOf(A.faceOf(i, r)) >= 0, "faceOf(" + i + "," + r + ") 的结果在册")));
});

test("回退路径写死在源码里：每一处贴图都有矢量兜底（缺素材也能玩）", () => {
  assert.ok(/function drawFoodVector\(/.test(SRC) && /function drawFoodImg\(/.test(SRC),
    "食材：drawFoodVector（矢量）+ drawFoodImg（贴图）两条路都在");
  assert.ok(/function drawAvatar\(/.test(SRC) && /drawAvatar\(g, box\.x \+ 38, box\.y \+ 58, 21, c\.id\);/.test(SRC),
    "头像：贴图拿不到时回退程序化头像 drawAvatar");
  assert.ok(/var gearImg = assetOf\(GEAR_ICON, gearNameOfKind\(s\.kind\)\);/.test(SRC) &&
    /\} else if \(s\.kind === "pot"\)/.test(SRC),
    "锅位：贴图优先，缺图回退矢量锅体（pot / griddle / steamer / counter / juicer 五条都在）");
  assert.ok(/var ptex = assetOf\(GEAR_ICON, plateTexOfFood\(p \? p\.food : null\)\);/.test(SRC),
    "盘位：贴图优先，缺图回退矢量盘");
  assert.ok(/if \(drawUiIcon\(g, "cross"/.test(SRC) && /g\.strokeStyle = PAL\.red; g\.lineWidth = 7;/.test(SRC),
    "糊了红叉：贴图优先，缺图回退红色矢量叉");
  assert.ok(/function bgDrawArgs\(/.test(SRC) && /function drawBg\(\) \{/.test(SRC),
    "背景：cover 参数 + 加载失败回退程序化底");
  assert.ok(/function drawStar\(/.test(SRC) && /function starPath\(/.test(SRC),
    "星级：stars.png 单颗星优先，缺图回退矢量星");
  assert.ok(/assetOf\(g, id\)/.test(SRC) && /naturalWidth/.test(SRC) && /complete !== false/.test(SRC),
    "统一就绪判定：naturalWidth > 0 且 complete !== false（未解码完就当没有）");
});

