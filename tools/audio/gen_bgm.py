#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_bgm.py — 生成 5 种情绪的 BGM（StepAudio 3 Gen）

为什么是这 5 种：**不是凭空定的**，是从游戏数据里反查出来的 ——
  1. index.html 的 NODES 里所有 `mood:"xxx"` 取值只有 5 个：
     night×4 · calm×6 · city×4 · tense×4 · dark×2
  2. AudioSys.bgm(mood) 优先播 `audio/bgm/<mood>.mp3`，缺失回落 bgmSynth()
  3. bgmSynth() 里每种情绪有明确的和弦/波形/增益/间隔定义，本脚本的提示词
     就是照着那份定义写的（增益低 = 情绪轻，间隔短 = 情绪紧）

| mood  | 合成器和弦（根音走向）        | 波形     | g     | iv(ms) |
|-------|------------------------------|----------|-------|--------|
| calm  | C-E-G → A-C-E → F-A-C → G-B-D | triangle | 0.045 | 900    |
| city  | A-C#-E → B-D#-F# …            | sine     | 0.040 | 820    |
| tense | A-E-A → G-D-G …（低八度）     | sawtooth | 0.035 | 520    |
| night | D-F-A → C-E-G …               | sine     | 0.045 | 1100   |
| dark  | G-Bb-D → F-A-C …（最低）      | sawtooth | 0.032 | 640    |

循环要求（与音效/环境音不同，BGM 是 loop 播放）：
  · 目标响度 **−22 LUFS**（低于音效 −16，避免盖住配音；对应 BGM_VOL=0.42）
  · **首尾同电平** —— 引擎的 loopCrossfade() 能掩盖小接缝，但首尾差 >6dB 仍会听出来
  · 因此生成时明确要求「结尾自然收在同一起点、可无缝循环」，后处理再做一次交叉淡化

用法：
  set STEP_API_KEY=xxx
  python gen_bgm.py --out "...\\audio"            # 生成到 audio/bgm/
  python gen_bgm.py --out DIR --dry-run
  python gen_bgm.py --out DIR --only calm,night
"""

import argparse
import json
import os
import subprocess
import sys
import paths as PA  # noqa: E402  (同目录模块)

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "step_gen_audio.py")
PROC = os.path.join(HERE, "process_sfx.py")

# 原始件目录：**必须放在媒体库之外**。
# 媒体库（Tianshu-Prototype-媒体素材）是「只放成品」的分发源，
# pack-media.ps1 会递归打包它 —— 原始件混进去会白白撑大分发包、污染清单。
# 第一版用 os.path.dirname(audio 目录) 推导，结果算到了媒体库内部（audio/ 的同级），是错的。
RAW_DEFAULT = PA.SRC_BGM

# 目标时长。太短会很快听出重复，太长则体积大、生成慢。
# 30s：循环周期足够长，mp3 约 200~400KB，5 条合计不到 2MB。
DUR_S = 30


def bgm(name, mood_cn, scene, instruments, tempo, extra=""):
    """一条 BGM 任务。[] 里是音乐描述（StepAudio 用 [] 识别非人声内容）。

    ⚠ 「不要渐弱收尾」这句是必须的，别删：
      第一版写的是「结尾自然收回到开头、可无缝循环」，模型理解成了
      **作曲家式的音乐性淡出** —— `dark` 末尾 2.5s 从 −16dB 一路降到 −41dB。
      对一次性聆听那是正确的收尾，但对 `a.loop=true` 的循环播放，
      等于每次绕回开头都「掉下去再跳回来」（实测接缝差 21.1dB）。
      工具侧的 loop_crossfade 只能叠 1s，覆盖不了 2.5s 的渐弱（仍剩 14.1dB）。
      所以必须从**生成阶段**就禁止淡出：明确说「音量保持平稳、不要渐弱、不要淡出收尾」。
      同时「约 30 秒」也只能是愿望 —— API 没有 duration 参数（见 stepaudio-gen skill），
      实测 5 条出来 17.6~184s，长度不可控，别指望它。
    """
    desc = (
        f"{mood_cn}氛围的纯器乐循环背景音乐，{scene}，"
        f"{instruments}，{tempo}，"
        f"没有人声、没有歌词、没有鼓点冲击，音量克制不抢戏，"
        f"全曲音量保持平稳，**不要渐弱，不要淡出收尾，结尾不要留空白**，"
        f"像可以无限循环的电子游戏背景音乐那样首尾音量一致，"
        f"**只演奏一段约 {DUR_S} 秒的完整段落，不要把它重复铺满更长时间**"
    )
    if extra:
        desc += "，" + extra
    return {
        "file": f"{name}.mp3",
        "scripts": [{"text": f"[{desc}]"}],
        "instruction": "纯器乐背景音乐，无人声无歌词，织体干净，动态平稳，音量自始至终一致，不要渐弱收尾",
        "response_format": "mp3", "sample_rate": 48000,
    }


# ── 5 种情绪（提示词照 bgmSynth 的定义写）──────────────────────────
BGM = [
    bgm("calm", "平静舒缓", "白天办公室与日常过场",
        "柔和的电钢琴铺底，加一层温暖的弦乐pad",
        "缓慢的四四拍，速度约 70 BPM"),
    bgm("city", "都市轻快", "城市街景与商业日常",
        "清亮的电钢琴与拨弦音色交替，轻快的贝斯线",
        "中速四四拍，速度约 96 BPM"),
    bgm("tense", "紧张压抑", "牌桌对峙与谈判施压",
        "低音弦乐持续音，加轻微的心跳般脉冲",
        "偏快的六八拍，速度约 112 BPM，和声不解决、始终悬着"),
    bgm("night", "夜色深沉思绪", "深夜独处与回忆闪回",
        "稀疏的钢琴单音，远处一层长混响pad",
        "极慢，速度约 60 BPM，留白多"),
    bgm("dark", "阴暗沉重", "危机降临与谷底",
        "低音提琴与暗色合成器铺底，偶尔一声钝响",
        "慢速，速度约 64 BPM，音区低沉、不出现明亮音色"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="audio 目录（脚本会写入 <out>/bgm/）")
    ap.add_argument("--raw-dir", default=RAW_DEFAULT,
                    help="原始件目录（默认 audio-工作区\\_bgm_src，必须在媒体库之外）")
    ap.add_argument("--only", help="只做指定 mood（逗号分隔）")
    ap.add_argument("--sleep", type=float, default=1.5)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-proc", action="store_true", help="只生成，不做后处理")
    args = ap.parse_args()

    items = BGM
    if args.only:
        want = {x.strip() for x in args.only.split(",") if x.strip()}
        items = [b for b in items if b["file"][:-4] in want]
        if not items:
            print(f"--only 未匹配：{args.only}")
            return 1

    bgm_dir = os.path.join(args.out, "bgm")
    raw_dir = args.raw_dir

    print(f"BGM：{len(items)} 条 · 每条目标 {DUR_S}s")
    for b in items:
        print(f"  {b['file'][:-4]:<8} {b['scripts'][0]['text'][:64]}…")
    if args.dry_run:
        return 0

    if not os.environ.get("STEP_API_KEY", "").strip():
        print("请先设置 STEP_API_KEY", file=sys.stderr)
        return 2

    os.makedirs(raw_dir, exist_ok=True)
    jf = os.path.join(raw_dir, "_jobs_bgm.json")
    with open(jf, "w", encoding="utf-8") as f:
        json.dump({"jobs": items}, f, ensure_ascii=False, indent=1)

    # 原始件直接落到 _bgm_src（保留可回溯），加工后写进 audio/bgm/
    print(f"\n=== 生成到原始件目录 {raw_dir} ===")
    r = subprocess.run([sys.executable, GEN, "--jobs", jf, "--out", raw_dir,
                        "--sleep", str(args.sleep), "--retry", "3", "--force"])
    if r.returncode != 0:
        print(f"[gen 失败 exit={r.returncode}]", file=sys.stderr)
        return r.returncode

    rc = 0
    if args.skip_proc:
        # 跳过「生成+后处理」，但**仍然做验收** —— 验收只读成品目录，
        # 与本次有没有生成无关，跳过它就没有意义了（第一版直接 return 0，是错的）。
        print("\n[--skip-proc] 跳过生成与后处理，直接对现有成品做验收")
    else:
        # ── 后处理：−22 LUFS + 循环交叉淡化（bgm 预设内含这两项）────────
        # ⚠ 必须用 `bgm` 预设，不能用 `amb`：
        #   amb 只做响度归一与去首尾静音，**没有循环交叉淡化**；
        #   BGM 是 `a.loop=true` 循环播放的，不做交叉淡化就会在循环处「咔」一下
        #   （实测 dark 的末尾渐弱造成 21.1dB 接缝差）。
        #   第一版这里写的是 amb，与实际手工跑的流程不一致 —— 脚本必须和真实流程同源。
        print("\n=== 后处理（−22 LUFS · 首尾同电平 · 循环交叉淡化 1s）===")
        os.makedirs(bgm_dir, exist_ok=True)
        for b in items:
            name = b["file"][:-4]
            src = os.path.join(raw_dir, b["file"])
            dst = os.path.join(bgm_dir, b["file"])
            if not os.path.exists(src):
                print(f"  ! {name} 原始件缺失，跳过")
                rc = 1
                continue
            p = subprocess.run([sys.executable, PROC, "--src", raw_dir, "--out", bgm_dir,
                                "--preset", "bgm", "--only", name, "--force"],
                               capture_output=True, text=True, encoding="utf-8", errors="replace")
            if os.path.exists(dst):
                print(f"  {name}.mp3  OK")
            else:
                print(f"  ! {name} 加工失败：{(p.stdout or '')[-300:]}{(p.stderr or '')[-200:]}")
                rc = 1

    # ── 自动验收：循环接缝是 BGM 唯一的硬指标 ────────────────────────
    # ⚠ 为什么必须自动量一次：**音乐的生成不确定性远大于音效/人声**。
    #   实测同一份提示词重跑 5 条，接缝差从「0.7~4.4dB 全部达标」
    #   变成「night 12.4dB / dark 6.5dB + 强周期 0.69（同一段重复铺满）」。
    #   也就是说 **重跑不等于更好**，不量就会把坏件当成品发出去。
    #   所以生成后立刻跑 check_bgm.py，只对成品判定，超阈值明确报出。
    print("\n=== 自动验收：循环质量 ===")
    chk = os.path.join(HERE, "check_bgm.py")
    if os.path.exists(chk):
        q = subprocess.run([sys.executable, chk], capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        for line in (q.stdout or "").split("\n"):
            if line.strip() and ("成品" in line or "结论" in line):
                print("  " + line.strip())
        if "全部达标" not in (q.stdout or ""):
            print("\n  ⚠ 有 BGM 未达标。**不要直接发布**：")
            print("     · 接缝偏大 → 多半又是「淡出收尾」，检查提示词是否含「不要渐弱」")
            print("     · 强周期/偏长 → 模型把一段重复铺满了，提示词加「不要重复铺满」")
            print("     · 重跑前先备份当前达标件：**生成不确定，旧件可能比新件好**")
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
