#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
regen_sfx_noise.py — 重做「本该是物理音、实测却是纯音」的音效

═══ 为什么要专门写这个 ═══
用 mel 频带平坦度筛出 3 条：提示词明明描述的是**物理撞击/摩擦声**
（「两张麻将牌互相碰撞的清脆卡嗒声」），实测却是**纯音**：

    sfx-mj-clack   flat_db = -35.3   基频自相关 0.96
    sfx-bf-plate   flat_db = -42.2   基频自相关 0.75
    ui-type        flat_db = -39.4   基频自相关 0.93

对照（写对了的长这样）：sfx-mj-shuffle −5.9 · sfx-mj-buildwall −3.6 · sfx-mj-deal −7.5

**根因是提示词写法**：原提示词偏「干净/轻响/清脆」，模型理解成"做一个干净的音"，
就给了电子提示音。物理音的提示词要强调：
  · **材质**（竹/瓷/金属/木头）+ **接触方式**（碰撞/刮擦/摩擦）
  · **干燥、无音调、不要音乐感**（明确否定最关键 —— 自然语言的否定必须写出来）
  · **一次性的瞬态**（不要持续音）

本脚本用**加强版提示词**重生成，并当场用平坦度验收 —— 不达标就不算完成。
"""

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
GEN = os.path.join(HERE, "step_gen_audio.py")
PROC = os.path.join(HERE, "process_sfx.py")
import paths as PA  # noqa: E402
import audio_eval as E  # noqa: E402

# 目标：flat_db 至少要到「混合」区间以上（>-25），最好进噪声型（>-12）
TARGET_DB = -25.0

# 加强版提示词：材质 + 接触方式 + 明确否定音调
#   ⚠ 否定必须写出来。原版写「清脆卡嗒声」，模型给了个清脆的**单音**。
JOBS = [
    {
        "file": "sfx-mj-clack.mp3",
        "text": "[两块竹制麻将牌硬碰硬的撞击声，干燥短促的一下咔嗒，"
                "带木头与竹子的实心撞击质感，有细微的碎裂高频成分，"
                "不要音调、不要音乐感、不要电子提示音、不要铃声，只一下不留尾音]",
        "instruction": "录音棚近距离拾取的真实物体撞击声，干燥无混响，"
                       "宽频噪声质感，绝对不要任何音调或旋律成分",
    },
    {
        "file": "sfx-bf-plate.mp3",
        "text": "[瓷盘轻轻放到桌面上的碰触声，瓷器与木桌接触的一声闷响，"
                "带陶瓷特有的干脆高频、以及盘子微微晃动的细碎磕碰，"
                "不要音调、不要音乐感、不要电子提示音，不要持续音]",
        "instruction": "录音棚近距离拾取的瓷器碰触实音，干燥无混响，"
                       "宽频噪声质感，绝对不要任何音调或旋律成分",
    },
    {
        "file": "ui-type.mp3",
        "text": "[机械键盘快速敲击的连续咔嗒声，塑料键帽与轴体碰撞的干脆声响，"
                "七八下连续敲击，节奏均匀，"
                "不要音调、不要音乐感、不要电子提示音、不要打字机的铃声，纯机械噪声]",
        "instruction": "录音棚近距离拾取的机械键盘敲击实音，干燥无混响，"
                       "宽频噪声质感，绝对不要任何音调或旋律成分",
    },
]


def flat_of(p):
    x, err = E.P.decode(p) if hasattr(E, "decode") else (None, None)
    import process_sfx as P
    x, err = P.decode(p)
    if x is None or x.size == 0:
        return None
    a, b = P.content_bounds(x, rel_db=42.0, gap_tol_s=0.15)
    seg = x[a:b] if b > a else x
    return E.timbre_flatness_db(seg, P.SR)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sleep", type=float, default=1.5)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    raw = os.path.join(PA.WORK_ROOT, "_sfx_noise_fix")
    os.makedirs(raw, exist_ok=True)
    print(f"重做 {len(JOBS)} 条物理音效（目标 flat_db > {TARGET_DB}）")
    for j in JOBS:
        print(f"  {j['file']}")
    if args.dry_run:
        return 0
    if not os.environ.get("STEP_API_KEY", "").strip():
        print("请先设置 STEP_API_KEY", file=sys.stderr)
        return 2

    # 先生成
    jf = os.path.join(raw, "_jobs.json")
    with open(jf, "w", encoding="utf-8") as f:
        json.dump({"jobs": [dict(j, response_format="mp3", sample_rate=48000) for j in JOBS]},
                  f, ensure_ascii=False, indent=1)
    print(f"\n=== 生成到 {raw} ===")
    r = subprocess.run([sys.executable, GEN, "--jobs", jf, "--out", raw,
                        "--sleep", str(args.sleep), "--retry", "3", "--force"])
    if r.returncode != 0:
        print(f"[生成失败 exit={r.returncode}]", file=sys.stderr)
        return r.returncode

    # 后处理（sfx 预设）
    print("\n=== 后处理 ===")
    subprocess.run([sys.executable, PROC, "--src", raw, "--out", raw,
                    "--preset", "sfx", "--force"],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")

    # 验收：平坦度必须达标，不达标就不入库
    print("\n=== 验收（平坦度）===")
    ok, bad = [], []
    for j in JOBS:
        p = os.path.join(raw, j["file"])
        fd = flat_of(p) if os.path.exists(p) else None
        if fd is None:
            print(f"  ! {j['file']} 缺文件")
            bad.append(j["file"])
            continue
        flag = "✔" if fd > TARGET_DB else "✘ 仍偏音调"
        print(f"  {j['file']:<24} flat_db = {fd:7.2f}   {flag}")
        (ok if fd > TARGET_DB else bad).append(j["file"])

    if bad:
        print(f"\n⚠ {len(bad)} 条未达标：{bad}")
        print("  这些**不写入媒体库**（避免把不达标的东西当成品）。")
        print("  可尝试：换更强的否定词、或换音效描述角度（如「摔落」「刮擦」）。")
    if ok:
        print(f"\n=== 达标的 {len(ok)} 条写入媒体库（旧件备份）===")
        import shutil
        bak = os.path.join(PA.WORK_ROOT, "_原始件备份", "_sfx_pure_tone_旧版")
        os.makedirs(bak, exist_ok=True)
        for name in ok:
            dst = os.path.join(PA.DIR_SFX, name)
            if os.path.exists(dst):
                shutil.copy2(dst, os.path.join(bak, name))
            shutil.copy2(os.path.join(raw, name), dst)
            print(f"  {name:<24} 旧件已备份 -> {os.path.basename(bak)}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
