# tools/ —— 开发与验收工具

> **这些 `.cjs` 不是缓存文件，是源码。** 它们是本项目的无头验收、出图与素材流水线，
> 加起来约 500 KB 的 Node 脚本，跑的是真断言（麻将 847 项、早餐店 350 项）。
> 之前散在仓库根目录，2026-09-19 统一归位到 `tools/`。

## 为什么是 `.cjs`

仓库**没有 `package.json`**，所以 Node 对 `.js` 默认就是 CommonJS，`.cjs` 并非必需。
保留 `.cjs` 是保守选择：即使以后加了 `package.json: {"type":"module"}` 也不会破坏这些脚本。

## 命名前缀

| 前缀 | 含义 |
|---|---|
| `_bf_` | **b**reakfast（早餐店小游戏） |
| `_mj_` | **m**a**j**iang（麻将小游戏） |
| `_e2e_` | 端到端 / 无头验收 |
| `_test_` | 单元测试 |
| `_verify_` | 一次性验证脚本（已 gitignore，不入库） |

---

## 脚本清单

### 共用底座（被其它脚本 require，不要单独跑）

| 文件 | 作用 |
|---|---|
| `_bf_raster.cjs` | **自写的软件光栅化器**：解 PNG（zlib + 反过滤）、按变换 + `globalAlpha` 做 source-over 合成，模拟 canvas。被 5 个出图脚本依赖 |
| `_mj_probe_lib.cjs` | 麻将浏览器实测的公共底座（mshta / System.Drawing 探针），供 `_mj_shots.cjs` 复用 |

```
依赖关系：
  _bf_assets_shots.cjs  ┐
  _bf_assets2_shots.cjs ┤
  _bf_icons_shots.cjs   ├──→ _bf_raster.cjs
  _bf_shots.cjs         ┤
  _bf_shots2.cjs        ┘
  _mj_shots.cjs         ────→ _mj_probe_lib.cjs
```

### 验收与测试（常用，值得定期跑）

| 文件 | 作用 | 运行 |
|---|---|---|
| `_test_mahjong_logic.cjs` | 麻将**纯逻辑单测，847 项**（造牌、牌型、赔付、杠开、抢杠、向听、DP 交叉验证、语音映射、结算结构） | `node tools/_test_mahjong_logic.cjs` |
| `_e2e_bf_headless.cjs` | 早餐店**无头验收，350 项**（在 vm 里跑真 index.html 胶水层 × 真 breakfast.js） | `node tools/_e2e_bf_headless.cjs` |
| `_bf_check_inline.cjs` | 校验 `index.html` 内联 `<script>` 语法（`node --check` 同套解析）。改内联胶水层后必跑 | `node tools/_bf_check_inline.cjs` |
| `_verify_bf_btn.cjs` | headless Chrome + CDP 验证标题屏「⚑ 跳到早餐店」入口（含 JS 异常捕获）。**本地用，不入库** | 见文件头注释 |

### 出图流水线（生成 `测试截图/` 里的验收图）

| 文件 | 作用 |
|---|---|
| `_bf_shots.cjs` / `_bf_shots2.cjs` | 早餐店面板 / 结算 / 出口按钮出图 |
| `_mj_shots.cjs` | 麻将系统出图（四张验收图） |
| `_bf_assets_shots.cjs` / `_bf_assets2_shots.cjs` / `_bf_icons_shots.cjs` | 素材与图标批次出图 |
| `_mj_render.ps1`（在仓库根） | 麻将出图用的 System.Drawing 主题渲染器 |

> ⚠ 出图依赖 `powershell` + `System.Drawing` + `Microsoft YaHei` 字体。
> 缺字体时中文会退化成方框，脚本会因颜色数偏低而报失败 —— 不是代码 bug。

### 素材生成 / 切片

| 文件 | 作用 |
|---|---|
| `_bf_assets_gen.cjs` / `_bf_assets2_gen.cjs` | 早餐店素材切片（零依赖，纯 Node + 内置 zlib） |
| `_bf_icons_gen.cjs` | 游戏玩法图标生成 |

### 改动工具

| 文件 | 作用 |
|---|---|
| `_bf_patch.cjs` | **逐字字面替换工具**：唯一性校验 + 幂等校验 + 备份 + 内联脚本语法闸 + 失败整文件回滚。改大文件时用它，别手改。<br>用法：`node tools/_bf_patch.cjs _bf_jobs_xxx.json --fresh-bak` |

### 一次性探针 / 集成脚本（历史上只用过一次，保留供追溯）

| 文件 | 说明 |
|---|---|
| `_bf_integrate.cjs` | 把早餐店小游戏接进 `index.html` 的一次性集成脚本（已完成使命） |
| `_bf_jobs_probe.cjs` | 逐个 job 在内存里试跑，定位哪条 job 把语法带崩（不落盘） |
| `_dom_probe.cjs` / `_dom_probe2.cjs` | 量智脑面板里 🔊 语音开关 / 🎯 提示开关的位置尺寸 |

---

## ⚠️ 两个必须知道的约定

### 1. 脚本用 `__dirname` 的**父目录**当项目根

归位到 `tools/` 时，所有脚本里的根路径都已改成：

```js
const OUT = path.join(__dirname, "..");   // ← 仓库根，不是 tools/
```

**你新写脚本时也要这样**，否则会去 `tools/` 里找 `index.html` 而失败。

例外：`_bf_integrate.cjs` 用相对路径 `"index.html"`，**必须在仓库根目录下运行**。

### 2. `_bf_patch.cjs` 的备份后缀是**设计**，不是垃圾

它支持用环境变量 `BF_BAK` 指定备份后缀（`.bf7bak` / `.bf8bak` …），
仓库根目录那些 `breakfast.js.bf7bak` 之类是**每轮迭代留的回滚点**，故意保留。
已被 `.gitignore` 排除，不会进版本库。

---

## 历史文档的路径说明

`早餐店-*.md`、`麻将-*.md`、`工程架构总览.md` 等 12 份报告写于脚本还在仓库根目录的时期，
其中 `node _bf_xxx.cjs` 这类命令**原文保留未改**（避免大范围改动历史报告）。

**按新旧规则换算即可：**

```bash
node _bf_patch.cjs  ...     →  node tools/_bf_patch.cjs  ...
node _e2e_bf_headless.cjs   →  node tools/_e2e_bf_headless.cjs
node _test_mahjong_logic.cjs → node tools/_test_mahjong_logic.cjs
```

## 归位后的验证基线（2026-09-19 实测）

| 项目 | 结果 |
|---|---|
| `node --check` 全部 20 个脚本 | 20/20 通过 |
| `node tools/_test_mahjong_logic.cjs` | **847 / 847 全部通过** |
| `node tools/_e2e_bf_headless.cjs` | **通过 350，失败 0** |
| `node tools/_bf_check_inline.cjs` | 内联脚本 1 段，语法失败 0 |
