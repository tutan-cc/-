# 素材来源与授权清单（SOURCES）

> 借鉴自参考项目 `tutan123/tianshu` 的 `assets/SOURCES.md` 纪律：**每一项素材都要写清来源与授权状态**。
> 本文件随项目更新；⚠ 标记项在公开发布前必须处理。

## 一、视频 / 图片

| 素材 | 来源 | 授权状态 |
|---|---|---|
| `video/*.mp4`（33 段实拍） | 第三方素材库，按人物/场景分类（原路径含项目旧名，改名后未追溯） | ⚠ **未核实**。发布前必须替换为自有素材或取得授权 |
| `video/poster/*.jpg`（35 张剧照） | 由上表视频用 ffmpeg 抽帧生成 | ⚠ 随源视频，同上 |
| `video/fx_market.mp4`、`video/fx_flood.mp4` | 本项目 `_genanim2.ps1` 生成（PowerShell + System.Drawing 逐帧绘图 → ffmpeg 合成） | ✅ 原创，**已入库**（其余实拍素材不入库） |

## 二、音频

**当前状态：项目不含任何配音文件**（2026-09-19 清理）。游戏音频分两层：

| 素材 | 来源 | 授权状态 |
|---|---|---|
| BGM / 音效 | 运行时由 WebAudio 实时合成（`AudioSys`），**无音频文件** | ✅ 原创 |
| 配音（台词 / 麻将牌名播报） | **已全部移除**，见下表 | — |

已移除的配音文件及其原因与去向：

| 原路径 | 内容 | 处置 | 依据 |
|---|---|---|---|
| `audio/vo_real/*.mp3`（24 条） | 从实拍视频用 `silencedetect` 自动截取的**演员原声**（工具：`tools/archive/vo-real.ps1`） | **移出仓库外** → `H:\GAMEDEV\Tianshu-第三方素材\audio\vo_actor\` | 内容是他人的声音与原台词，与实拍视频同性质（授权未核实） |
| `audio/vo/*.mp3`（45 条） | Windows SAPI 合成 TTS（`_vo_gen.ps1` / `_vo_gen_narr.ps1`） | **已删除** | 念稿感重、质量不达标 |
| `audio/mj/*.mp3`（45 条） | 同上，麻将牌名 / 动作播报 | **已删除** | 同上 |

**对游戏的影响**：`index.html` 启动时探测配音目录，都没有就把 🎙 按钮置灰并跳过语音，
不会留下失效按钮；麻将只是少了牌名播报，牌桌音效由 `AudioSys` 合成，不受影响。

**恢复方式**：把配音文件放回 `audio/vo/`（自产）或 `audio/vo_actor/`（真人原声）即可自动启用，
代码无需改动。若改用外部 TTS / 音效服务生成，请在下方追加来源与授权记录。详见
`dist/素材分发/README.md` 与素材库的 `README.md`。

## 三、代码与第三方库

| 项 | 说明 |
|---|---|
| `index.html` 全部代码 | 本项目自研；架构仿照《天枢 · 重启大一》v1.6 制作方案（数据驱动节点 / 视频优先 / 珍珠链叙事） |
| 参考项目 | `tutan123/tianshu`（GitHub）——本轮借鉴其存档校验、装备加成、circuit/memory 小游戏机制与测试契约，**均为思路借鉴，未复制其代码** |
| 第三方库 | **无**。项目零依赖：无 Three.js / Matter.js / 构建工具，双击即可运行 |

## 四、生成工具链（可复现）

| 脚本 | 作用 |
|---|---|
| `_genanim2.ps1` | 生成交易屏 K 线动画（.NET 逐帧 → ffmpeg）。**一次性脚本，未随包保留**；管线细节见《架构文档》4.11，如需重生成按该节复现 |
| `_vo_extract.js` | 从 `index.html` 抽取全部台词 → `_vo_lines.json` |
| `_vo_gen.ps1` | 批量 TTS 配音（按角色变调）→ `audio/vo/*.mp3` |
| `_vo_gen_narr.ps1` | 旁白分句合成（逐句合成 + 停顿 + 语速起伏 + 响度归一） |
| `_vo_real.ps1` | **真人原声抽取**：按角色分类扫描素材 → `silencedetect` 定位语音区间 → 裁剪/淡化/响度归一 → `audio/vo_real/*.mp3` |
| `_e2e.js` / `_e2e_solo.js` / `_e2e_vo.js` | CDP 全流程验收 / 缺素材降级 / 配音诊断 |
| `tests/core.test.cjs` | 单元测试（vm 注入内核，7 项） |

---

## 五、Lovart 生成素材（原创，已入库）

| 材料 | 内容 | 用途 |
|---|---|---|
| `art/lovart_63f2f17a1187.png` | 食材九宫格（9 种早餐） | 已切片 → `art/icons/*.png` |
| `art/lovart_41a8d9d144bc.png` | 早餐店场景背景 | 已裁切 → `art/bg/kitchen.png` |
| `art/lovart_7f81bea2418a.png` | 厨具九宫格 | 已切片 → `art/icons/gear/*.png` |
| `art/lovart_a5fddf40cc93.png` | 顾客头像六宫格（3 人 × 平静/着急） | 已切片 → `art/icons/faces/*.png` |
| `art/lovart_d72b7b15758c.png` | UI 元素九宫格 | 已切片 → `art/icons/ui/*.png` |
| `art/lovart_531fa9608451.png` | 玩法入口图标九宫格 | 已切片 → `art/icons/game/*.png` |

生成方式：Lovart AI（`lovart-api` skill，MCP/HTTP 均未使用），以用户提供的手游截图作风格参考图；提示词见 早餐店-素材全集接入报告.md。
版权：AI 生成原创素材，无第三方版权，随仓库分发。

### 五之二、Lovart 第二批（本轮新增，已入库）

| 材料（按生成顺序） | 内容 | 用途 |
|---|---|---|
| `art/lovart_d227a60381a7.png` | 盘面六宫格（空盘 / 只装煎蛋 / 只装培根 ｜ 只装三明治 / 只装包子 / 只装沙拉） | 已切片 → `art/icons/gear/plate_{empty,egg,bacon,sandwich,bun,salad}.png` |
| `art/lovart_83728cd45e62.png` | 早餐店背景 v2（完整樱花树冠 + 完整开放厨房货架） | 已裁切 → `art/bg/kitchen2.png`（首选，v1 兜底） |
| `art/lovart_65d159fe6de7.png` | 顾客头像六宫格：女房东 ×(平静/着急/满意) ｜ 女护士 ×(平静/着急/满意) | 已切片 → `art/icons/faces/{fang,lu}_{calm,urgent,happy}.png` |
| `art/lovart_1a973d87de0e.png` | 麻将/中式茶室包间背景（深绿绒布方桌留空 + 四把木椅 + 暖光吊灯） | 已裁切 → `art/bg/mahjong.png` |
| `art/lovart_cef6ccfa89a5.png` | 麻将道具九宫格（白板 / 發 / 两骰子 ｜ 蓝·红·金筹码 ｜ 深蓝斜纹牌背 / 木牌尺 / 烟灰缸） | 已切片 → `art/icons/mj/*.png` |

切片参数见 `art/_assets2_report.json`（脚本 `_bf_assets2_gen.cjs` 自动求出，未写死）。
接入过程与取舍见 早餐店-素材二批接入报告.md。


