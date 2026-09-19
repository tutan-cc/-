# tools/audio/ —— 音频素材工具链

> 从「一句描述」到「入库可玩的音效/配音/BGM」的完整流水线。
> **生成用 StepAudio，加工用本目录脚本，验收入库用 `link-media.ps1` + 测试套件。**
>
> 这套工具原先散在仓库外，2026-09-19 归位到这里：
> 「`tools/` 是源码」这个约定不该有例外，否则协作者 clone 下来无法复现素材。

## 三条主线

| 想做 | 用什么 | 产物落到 |
|---|---|---|
| 音效 / 环境音 | `gen_sfx.py` | `audio/sfx/`、`audio/amb/` |
| 麻将牌名（按座位分音色） | `gen_mj_by_seat_tts.py` | `audio/mj/`、`audio/mj/seat1-3/` |
| BGM（5 种情绪） | `gen_bgm.py` | `audio/bgm/` |
| 台词配音 | `step_gen_audio.py --jobs vo_jobs.json` | `audio/vo_real/` |

四条都走同一条后处理：`process_sfx.py --preset <类型>`。

## 路径与密钥（跨机器可跑）

所有路径由 `paths.py` 统一解析，规则是 **环境变量优先，否则按仓库位置推导**：

```
<仓库根>/tools/audio/paths.py
   REPO_ROOT   = <仓库根>
   MEDIA_ROOT  = <仓库根>上级/Tianshu-Prototype-媒体素材
   WORK_ROOT   = <仓库根>上级/audio-工作区     ← 原始件与中间产物都在这里（不入库、不分发）
   MODEL_ROOT  = <仓库根>上级/models           ← 本地 ASR 模型
```

想放到别处就设环境变量，**不必改代码**：

```powershell
$env:DSH_MEDIA_ROOT = "D:\媒体素材"
$env:DSH_WORK_ROOT  = "D:\音频工作区"
$env:DSH_MODEL_ROOT = "D:\models"
python tools\audio\paths.py        # 打印当前解析结果（排查路径问题先看这个）
```

密钥**只从环境变量取，绝不写进代码**：

```powershell
$env:STEP_API_KEY = "<你的 key>"
```

## 后处理预设：必须用 preset，别手写参数

`process_sfx.py` 的四个预设把踩过的坑固化成了参数组。**同一组 `rel_db` 对 60 秒环境音
和 0.3 秒单字的意义完全不同** —— 手写参数必然配错（实测曾把牌名平均时长削掉 24%）。

| 预设 | 用途 | 关键差异 |
|---|---|---|
| `sfx` | 游戏音效 | 内部无长停顿，`gap_tol=0.06` 精确掐头去尾 |
| `word` | 麻将牌名等短词 | `rel_db=42` 更保守 + 尾部余量按内容长度自适应 |
| `voice` | 台词配音 | `keep_all=True` —— **不丢句**（见下） |
| `amb` | 环境音 | 不裁内容，只统一响度 |
| `bgm` | BGM | −22 LUFS + 循环交叉淡化 1s |

```powershell
python tools\audio\process_sfx.py --src RAW --out FINAL --preset voice --force
python tools\audio\process_sfx.py --src RAW --out FINAL --preset word --only 西 --force  # 单条重做
```

### ⚠ `voice` 的 `keep_all=True` 不能去掉

原来的边界检测是「**保留最长连续有声段**」。多句台词在句间停顿超过 `gap_tol` 时，
**其余的句子会被整段丢掉，而且不报任何错**。实测：

- 顾曼 `investor_s0`：三句产出为三段、句间停顿 0.8s，恰好越过 `gap_tol=0.8` → 首句消失（5.10s → 2.79s）
- 复查全部 54 条台词，`rent_s1.mp3` **真的少了后半句**「可你总得给我个准话。」（1.72s → 4.03s）

`keep_all=True` 改为取「**首尾有声帧**」而不是长度择优。代价是可能多留一点段间房间声，
但「多留一点静音」远好于「少说一句话」。

## 目录里各脚本干什么

| 脚本 | 作用 |
|---|---|
| `paths.py` | 路径解析（唯一来源）。`python paths.py` 可自检 |
| `step_gen_audio.py` | **核心**：读 JSON 任务表调 StepAudio。Gen 与 TTS 两种任务（按有无 `voice` 字段区分） |
| `gen_sfx.py` | 生成 65 个音效 + 9 个环境音（清单从玩法调用点反推） |
| `gen_mj_by_seat_tts.py` | 麻将牌名，按座位固定音色。含 `speed` 校正与 `--only` 单条重做 |
| `gen_bgm.py` | 5 种情绪 BGM。**生成后自动验收循环质量**（音乐生成不确定性大，见下） |
| `process_sfx.py` | 切静音 + 响度归一 + 防硬切 + 循环交叉淡化。预设见上 |
| `check_audio.py` | 声学体检（时长/峰值/RMS/有声占比/前导静音/削波） |
| `check_bgm.py` | BGM 专项：时长/响度/**循环接缝差**/周期性 |
| `verify_audio_content.py` | 长台词内容核对（ASR 全文比对） |
| `verify_mj_asr.py` | 牌名内容核对（拼音同音匹配 + **跨座位共识**） |
| `asr_local.py` | 本地 SenseVoice 转录（离线，免 API 费用） |

## 依赖

```powershell
pip install numpy sherpa-onnx pypinyin
# ffmpeg / ffprobe 需在 PATH 上（解码、响度归一、出图都靠它）
```

本地 ASR 模型（约 229 MB，不入库）：

```
<仓库根>上级/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/
```

## 验收：改完素材必须跑这三步

```powershell
# 1. 声学体检
python tools\audio\check_audio.py <目录> --min-dur 0.15 --max-dur 3.0 --min-peak -24
python tools\audio\check_bgm.py                      # BGM 专测

# 2. 内容核对
python tools\audio\verify_audio_content.py <目录>     # 台词
python tools\audio\verify_mj_asr.py                   # 牌名

# 3. 接线 + 入库（最关键，能抓到「断言全绿但没声音」）
powershell -File .\pack-media.ps1      # 更新 媒体清单.json 与分发包
powershell -File .\link-media.ps1      # 按清单逐文件校验 SHA256
node tools\e2e\audio-wiring.js         # 需要 python -m http.server 8000
powershell -File .\run-all-tests.ps1
```

---

## ⚠️ 五个必须知道的坑（都实测过）

### 1. 「素材缺失」与「素材接错」在断言层面无法区分

`AudioSys` 全层是「有文件用文件，缺失回落合成」。设计本身是对的，
但它让 1542 项断言全绿的情况下，牌桌上「暗杠」「补杠」**完全没有声音**
（四个座位全 404 → `Audio` 无 error 兜底 → 静默丢弃）。
**所以 `tools/e2e/audio-wiring.js` 是必需的一层**，它主动发 `HEAD` 探存在性。

### 2. ASR 对短促喊牌识别率低 —— 单条判错不可信

「杠」被听成「告/干/大」、「碰」被听成「哼」是常态。
唯一可信的判据是**跨座位共识**：同一个词 4 个座位全判错才可能是真坏件。
`verify_mj_asr.py` 因此把「疑似错」当诊断信息输出，**只有空白/废件才让它退出 1**。

顺带：ASR 会把口语「七」写成 `7`，比对前必须做汉字数字归一，否则正确件会被误报。

### 3. 音乐的生成不确定性远大于音效/人声 —— 「重跑」不是免费的

同一份提示词重跑 5 条 BGM，接缝差从「0.7~4.4dB 全部达标」变成
「night 12.4dB / dark 6.5dB + 强周期 0.69」。**动它之前先备份当前达标件，跑完必须重新验收。**
`gen_bgm.py` 已内置自动验收，不达标会报错。

### 4. 别让 ASR 缓存落进仓库

`tools/` 只放源码。缓存一律落 `WORK_ROOT`，否则跑一次工具就污染 `git status`。

### 5. PowerShell 写出的 `.ps1`/`.json` 常带 BOM

`step_gen_audio.py` 读任务表用 `utf-8-sig` 就是为了容忍 BOM，
否则 `json.load` 会报 `Unexpected UTF-8 BOM`。**别改成 `utf-8`。**
