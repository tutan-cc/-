# 素材来源与授权清单（SOURCES）

> 借鉴自参考项目 `tutan123/tianshu` 的 `assets/SOURCES.md` 纪律：**每一项素材都要写清来源与授权状态**。
> 本文件随项目更新；⚠ 标记项在公开发布前必须处理。

## 一、视频 / 图片

| 素材 | 来源 | 授权状态 |
|---|---|---|
| `video/*.mp4`（33 段实拍） | `D:\重生2视频提取`（第三方素材库，按人物/场景分类） | ⚠ **未核实**。发布前必须替换为自有素材或取得授权 |
| `video/poster/*.jpg`（35 张剧照） | 由上表视频用 ffmpeg 抽帧生成 | ⚠ 随源视频，同上 |
| `video/fx_market.mp4`、`video/fx_flood.mp4` | 本项目 `_genanim2.ps1` 生成（PowerShell + System.Drawing 逐帧绘图 → ffmpeg 合成） | ✅ 原创，可自由使用 |

## 二、音频

| 素材 | 来源 | 授权状态 |
|---|---|---|
| `audio/vo_real/*.mp3`（23 条角色原声） | 本项目 `_vo_real.ps1`：从上述实拍视频中**自动定位说话片段**（`silencedetect`）截取 | ⚠ 随实拍素材，授权同上；内容为素材原台词 |
| `audio/vo/*.mp3`（44 条：21 旁白 + 23 角色兜底） | 本项目 `_vo_gen.ps1` / `_vo_gen_narr.ps1`，调用 Windows 内置 SAPI 语音（Microsoft Huihui zh-CN）合成，旁白为分句合成 | ⚠ 依微软语音引擎使用条款；商用发布前建议改为自有配音或商用 TTS |
| BGM / 音效 | 运行时由 WebAudio 实时合成（`AudioSys`），**无音频文件** | ✅ 原创 |

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
