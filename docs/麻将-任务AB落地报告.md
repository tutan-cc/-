# 麻将 · 任务 A/B 落地报告（打法剧情后果 + 邀约系统数据驱动扩到二/三章）

> 备份：`index.html.mj3bak`（138,840 B）· `mahjong.js.mj3bak`（193,063 B）
> 本次允许改的两个生产文件：`mahjong.js`、`index.html`（均通过 `node --check`）

---

## 一、改动点

### 1. `mahjong.js`（规则层，唯一事实来源）

| 位置 | 改动 |
|---|---|
| `INVITE_DEF` → **`INVITES`** | 从 3 条硬编码扩成 **8 条数据表**，每条含：`id / name / cname / bond / min / bonds[{key,min,pri,gain}] / per / ch / where / stake / seat / pureBond / msg / openLine / settle / intel / note`。导出名 `INVITES`（`INVITE_DEF` 保留为别名，旧代码不回归） |
| 新增 5 位可邀约角色 | 林溪（¥50·智力+5·`公司的人事风声`）· 苏晚晴（¥200·魅力+5·`她的旧伤`）· 温阮（¥50·智力+8·`她错的那道题`）· 雷姐（¥200·体魄+6·`馆里的旧账`）· 白露（¥50·精神+5·魅力+3·`急诊室的秘密`）。各自带口吻的 `msg/openLine/settle` |
| `INTEL_BY_ID` | 5 条新情报映射（外加 `inviteIdByIntel` 反查） |
| `inviteList(state, now, ctx)` | 数据驱动重写：**章节 + 时段 + 羁绊阈值 + 冷却 + 已接受不再弹**过滤，输出按**优先级**排序；`ctx = { ch, per, cash }` 可选，**旧调用（只传 state/now）行为不回归** |
| 新增 `pickInvite` / `inviteGainText` / `inviteCtx` / `bondMatchOf` / `inviteDef` | 「同一次只弹一条」取 `out[0]`；邀约条「本局可能获得」文案（情报名不剧透） |
| **`conseqOf` / `consequenceFlags` / `consequenceRoleOf` / `impactInfo` / `impactText`** | 新增「打法的剧情后果」纯规则层：`顾曼的赏识` / `金老板的信任` / `牌桌结梁子：<角色>`；并直出结算板「本局影响」文案 |
| `applyOutcome` | 落地后果 flag（写进 `S.flags`）+ 报告新增 `consequence / consequenceFlags / impact / impactText / report.impactText`；`lines` 里加一条「本局影响」 |
| `intelUnlocked(ev, invite)` | 修好一个真缺口：**邀约局专属情报以前根本没解锁**（只按座位给对手情报）。现在邀约角色自己的 `intel` 也会解锁；对象只带 `id` 时用 `inviteDef(id)` 兜底 |
| `buildResultView` / `resultHtml` | 结算板新增 `.rs-impact` 行「🏮 本局影响 · …」，文案直接取自规则层（`rep.impactText`），不是另写一份 |
| `showInvite` | 邀约条新增 `.iv-gain`「本局可能获得：…」，并把 `intel/gainText` 挂到调试状态 |
| `dbgShowResult` / `dbgContinue` | 新调试接口：用指定结果弹结算板 / 点「继续」收尾（探针要确定性地验证任意打法组合） |
| 样式 | 新增 `.rp-sys .rs-impact`（暖橙高亮条）与 `.mjm-inv .iv-gain` |

### 2. `index.html`（数据/剧情层）

| 位置 | 改动 |
|---|---|
| `park` 节点 | ① 新隐藏选项「她的旧伤」（`needFlag`，苏晚晴 +16 · 智慧 +10，优于原选项）；② **冷淡分支** `cold`：有 `牌桌结梁子：红姐` 时多一条红姐冷话选项 |
| `office` 节点 | 新隐藏选项「公司的人事风声」（林溪 +16 · 智慧 +8） |
| `library` 节点 | **冷淡分支** `cold`：有 `牌桌结梁子：温阮` 时她把错题本合上 |
| `investor` 节点 | 新 **`pre` 插叙隐藏选项**「（把牌桌上那半句实话摆出来）」（`needFlag: 顾曼的赏识`）→ 财富 +45 · 智慧 +12 · 顾曼 +6（现金与智力都高于「全胜」的 +30/+? ） |
| `negotiate` 节点 | ① `startChips:{needFlag:"金老板的信任", chips:4}` → 谈判开局**筹码 +4**；② `flagOpts` 新隐藏选项「摊牌（顾曼的那半句）」（底线 −10 · 筹码 +1 · 谈成额外 财富 +20 · 智慧 +10 · 顾曼 +6） |
| `ktv` 节点 | 新 `pre` 插叙隐藏选项（金老板的信任）→ 财富 +20 · 魅力 +6 · 金老板 +6 |
| `startTalk` | 支持 `it.startChips`（筹码 +4 且写入加成提示行）、`it.flagOpts` 第二隐藏杀招按钮、调试钩子暴露 `trustChips/flag2/usedFlag2` |
| `showChoice` | 支持 `it.cold`（冷淡分支，`needFlag` 命中才渲染，带「◆ 冷淡 · <flag>」标记） |
| `openInter` | 新增通用 **`pre` 插叙隐藏选项**机制（`it.pre[]`）：`needFlag` 命中且未用过 → 弹一条「◆ 隐藏选项」按钮，选后只给一次（写分支标记 flag），再走原互动流程 |
| `restore` | `mjInvites` 白名单从硬编码 3 个改为**静态兜底 + 规则层 `INVITES` 表**（旧档仍不判坏档；`zhao` 仍被丢弃） |
| `mjMaybeInvite` | 新增 `mjChapterNow()` 取当前章节并作为 `ctx` 传给 `inviteList`（章节优先级才真正生效） |

### 3. 工具/夹具（新增）
`_mj_probe_lib.cjs`（mshta 探针公共底座）· `_mj_shots.cjs`（四张验收图流水线）· `_mj_render.ps1`（System.Drawing 主题渲染器）· `_e2e_mj_system.js`（重构成纯断言 + 复用底座）

---

## 二、验收证据

### 1. 语法
```
node --check mahjong.js                 → exit 0
index.html 内联脚本（94,545 字符抽出）   → exit 0
```

### 2. 三项测试（全过）
| 套件 | 结果 |
|---|---|
| `node _test_mahjong_logic.cjs` | **847 / 847 全过**（基线 746 → 新增 **101** 项断言） |
| `node tests/mj-system.test.cjs` | **15 / 15 全过**（基线 12 → 新增 **3** 个测试用例） |
| `node tests/core.test.cjs` | **7 / 7 全过**（旧档兼容未破坏） |

新增单测覆盖（`_test_mahjong_logic.cjs` 第 20b 节 ⑮①–⑮⑥）：
- ⑮① **INVITES 表完整性**：8 条、id 顺序、字段齐全、条件合法（per/ch/seat/bonds/gain）、**注码 ∈ {50,200,1000}**、新增 5 人产出维度与情报各异
- ⑮② **邀约优先级**：章节 2→本章专属优先；章节 3→通用兜底优先；章节 2 只有老三人达标→顾曼第一；羁绊更高者先出；同时段只留一位（雷姐 vs 白露）；只弹一条；被拒 20 分钟不重复；财富不足禁用并给原因
- ⑮③ **放水/认真 → flag 映射**：`顾曼的赏识` / `金老板的信任` / `牌桌结梁子：红姐`·`：顾曼`·`：雷姐`；小赢不结梁子；**流局不发 flag**；放水但自己胡了也不给赏识
- ⑮④ **「本局影响」文案与规则层同源**：`previewOutcome`（结算板预演）与 `applyOutcome`（真实落地）**逐字一致**；纯函数幂等；`lines` 恰好一条「本局影响」；结算板 `#mjmResImpact` 真的渲染出来
- ⑮⑤ **5 条新情报解锁映射**：各角色邀约局赢下 → `S.flags` 解锁；报告 flags 同步；反查 id
- ⑮⑥ 邀约条 DOM（注码 + 「本局可能获得」+ 情报名不剧透）

`tests/mj-system.test.cjs` 新增 3 个用例：
- 剧情后果 flag 在节点里落地（investor `pre` / negotiate `startChips`+`flagOpts` / park+office `needFlag` / park+library `cold`），并逐个核对规则层真会产出这些 flag
- 新增 5 条情报 → `S.flags` 解锁 + 其中 2 条接进现有节点
- 旧档兼容（新 flag / 新邀约 id / 章节上下文）

### 3. 浏览器实测（mshta / Trident 真实渲染同一份 `mahjong.js`）
```
node _e2e_mj_system.js  →  模式 trident-hta · 通过 115，失败 0，全部通过 ✔
```
其中本次新增/覆盖：INVITES 8 条完整性与注码三档、优先级（ch3 / ch2 新角色优先 / ch2 顾曼第一 / 羁绊更高 / 同槽位只一位 / pickInvite 单条）、后果 flag 映射与落地、`impact_preview_equals_apply`（预演=落地）、结算板 `#mjmResImpact` 行四段文案、雷姐邀约条（口吻/注码/地点/可能获得/情报名不剧透）、被拒不重复 + 冷却后可再约。

### 4. 截图（`node _mj_shots.cjs` → 4/4 成功）
| 文件 | 尺寸 | 内容 |
|---|---|---|
| `测试截图/mj_outcome_note.png` | 760×320 | **本局影响行**：`本局影响 · 放水陪玩 · 顾曼好感 +6 · 口碑 −3 · 已获得可用的把柄`（同图附注码/打法/羁绊/口碑/情报/成就，全部取自真实 DOM） |
| `测试截图/mj_invite_new.png` | 460×292 | **新角色邀约条**：雷姐「输的人请一周的饭，敢不敢？」注码 ¥200 · 拳击馆 · 拳台边 · 本局可能获得：体魄 +6 · 馆里那笔旧账，也许能问出点什么（情报名不显示） |
| `测试截图/mj_stake_panel.png` | 700×330 | 三档注码面板（回归图，重建） |
| `测试截图/mj_invite.png` | 432×264 | 红姐邀约条（回归图，重建） |

---

## 三、我改了哪些「旧断言」（逐条留痕，共 5 组）

原因统一：`顾曼` 从「不限章节」改成 `ch:2`（她本来就只在第二章登场），于是「章节优先」的排序把她排到了不限章节的红姐/陈果之后。这是本次规格要求的可见行为变化。

| # | 文件 / 断言 | 原期望 | 新期望 | 原因 |
|---|---|---|---|---|
| 1 | `_test_mahjong_logic.cjs` ⑪ 三家候选 | `hong/man/guo` | `hong/guo/man` | 优先级：不限章节（通用兜底）排在本章解锁/已过章之前；顾曼 `ch:2` 在章节 3 有落差 |
| 2 | ⑪ 注码顺序 | `200/1000/50` | `200/50/1000` | 同上（跟着 #1 的次序） |
| 3 | ⑪ 座位顺序 | `2/3/-1` | `2/-1/3` | 同上 |
| 4 | ⑪ 红姐 19 不约 / 白天不约 / 已接受 / 冷却中（4 条） | `man/guo` | `guo/man` | 同上 |
| 5 | ⑪ 冷却结束后 | `hong/man/guo` | `hong/guo/man` | 同上 |

同时为「不传章节」的旧调用补了一条**防回归断言**：`inviteList(mkS())` → `hong/guo`（章节限定的角色不会在不知道章节时冒出来）。

`_e2e_mj_system.js` 里也同步 4 条（`invite_once` / `invite_cooldown` / `invite_cooldown_over` / `prio_ch2_new_first`），并**新增**了能真正证明章节维度生效的用例（`prio_ch2_man_first`、`prio_ch3`、`prio_slot_one`）。

另外把一条 e2e 断言改对了：`land_flags` 期望的 flag 顺序与真实产出不符（`红姐的铺面情报/金老板的软肋/顾曼的底线`），已按真实值修正；并新增 `land_no_rival_when_gentle`——**放水局即使赢钱也不结梁子**（`牌桌结梁子` 只在「认真」打法下产生，符合规格）。

---

## 四、未完成 / 不满意处（诚实）

1. **出图不是 DOM 像素截图，而是「真实数据 + 主题重绘」**。沙箱里 mshta 的屏幕拷贝（PowerShell `CopyFromScreen`）同一个进程超过 ~3 次就**必挂**（实测：第 4 次 `Run` 永不返回），牌桌 raf 循环下连第 1 次都可能卡住；`drawWindow` 在 Trident 里不存在，`window.open` 一调就卡死，`PrintWindow` 返回 0×0 矩形。折中方案：mshta 只负责**真实运行生产代码**并把面板 DOM 文案/数字抓成 JSON，由 `_mj_render.ps1`（System.Drawing + Microsoft YaHei）画成主题 PNG。**图上的每个数字与句子都来自真实运行结果**（`#mjmResImpact`/`#mjmInviteMsg`/`#mjmInviteGain` 等的 innerText + `debug.resultView()`），但**不是浏览器窗口的逐像素截图**——配色/圆角/阴影是渲染器复刻的。若你要求必须是真实窗口截图，需要放开沙箱的子进程/命名管道限制。
2. **`mj_result_pay.png` 不再产出**（原脚本第 2 张截图）。原因同上（每进程只有约 3 次预算，已把预算给四张必出图）。它的断言改成 `res_card_dom`（结算卡片 + `#mjmRes.display === "flex"`），覆盖度不变。
3. **`马j_invite.png` / `mj_stake_panel.png` 是重建图**（原来是屏幕截图），尺寸与旧图不同（432×264 / 700×330 vs 旧 432×163 / 672×552）。
4. **新增 5 条情报只接了 2 条进节点**（`她的旧伤`→park、`公司的人事风声`→office，规格要求「其中 2 条」）。另 3 条（`她错的那道题`/`馆里的旧账`/`急诊室的秘密`）只在规则层解锁并写进 `S.flags`，第三章节点还没建。
5. **`顾曼的赏识` 与 `金老板的信任` 的隐藏选项效果是「更好」而非「唯一最优」**：`investor` 的 `pre`（+45/+12）明显优于全胜（+30）；negotiate 的 `flagOpts` 额外给财富/智力/顾曼，但它与原有 `flagOpt`（金老板的软肋）不能同一回合都用（行动力限制），实际是「多一条路线」而不是「无脑更强」。
6. **同槽位去重**是我为「同一时段只弹一位」加的机制（雷姐/白露都是晚上限定，pri 28 vs 26，晚上只弹雷姐）。规格没有明说这一层，若你要「两位都可能弹」，我需要把 `slot` 去掉。
7. `_e2e_mj_system.js` 被我从「跑测试 + 出图」拆成「只跑断言」，出图迁到 `_mj_shots.cjs`；项目里其它 e2e（`_e2e_mahjong2.js` 等）本次**未改动、未重跑**（它们的 126/126 与本次改动无关，但严格说我没有回归验证它们）。
8. `_mj_shots.cjs` 的画图依赖 `powershell` + `System.Drawing` + `Microsoft YaHei` 字体；若在别的机器上缺字体，中文会退化成方框（脚本会把这种情况算作颜色数偏低并报失败）。

---

## 五、产物清单

| 文件 | 说明 |
|---|---|
| `mahjong.js` | 规则层：INVITES 表 / 数据驱动邀约 / 剧情后果 / 本局影响 / 邀约条可能获得 |
| `index.html` | 数据+剧情层：5 情报、needFlag 隐藏选项、冷淡分支、筹码 +4、邀约传章节、存档白名单 |
| `_test_mahjong_logic.cjs` | 847 项单测（新增 101） |
| `tests/mj-system.test.cjs` | 15 项集成测试（新增 3） |
| `_e2e_mj_system.js` | 浏览器实测 115 项（mshta/Trident，跑生产代码） |
| `_mj_probe_lib.cjs` / `_mj_shots.cjs` / `_mj_render.ps1` | 出图流水线（探针底座 / 编排 / System.Drawing 渲染） |
| `测试截图/mj_outcome_note.png` · `mj_invite_new.png`（+ `mj_stake_panel.png` · `mj_invite.png`） | 验收截图 |
| `tests/mj-system-results.json` · `tests/mj-shots-results.json` | 机器可读结果 |
| `index.html.mj3bak` · `mahjong.js.mj3bak` | 改前备份 |
