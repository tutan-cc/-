#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_mj_by_seat_tts.py — 用 TTS 重做麻将「按座位区分」的牌名播报

为什么改用 TTS（替代 gen_mj_by_seat.py 的 Gen 方案）：
  Gen 是「按角色描述演一遍」，**每张牌都是一次新的采样** ——
  同一个角色报 45 张牌可能会有音色漂移，牌桌上听起来像好几个人。
  TTS 指定固定 voice，同一个人全程一个音色，而且与主线台词配音**同一音色体系**。

实测过的参数结论（都验过，不是照文档猜的）：
  · pronunciation_map：**不用**。「筒/tong3」这种写法实测把「一筒」念成「一痛酸」，比不加更差。
    （好消息：「筒」本来就读对 —— ASR 写成「桶」是同音字，不是错误。）
  · text_normalization=enhanced：对「1978」这类仍会读错，**这两条改用汉字写法绕开**。
  · instruction 全局指令：能用，但控情绪不如文本内的 () 稳（实测「自摸」被读糊成「子摸」）。
  · 最稳的写法：`（情绪提示）词`，情绪词用简单常见的。

用法：
    set STEP_API_KEY=xxx
    python gen_mj_by_seat_tts.py --out "...\\audio\\mj" --seat 1
    python gen_mj_by_seat_tts.py --out DIR --dry-run
"""

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "step_gen_audio.py")

HONORS = ["东", "南", "西", "北", "中", "发", "白"]
TILES = [f"{n}{s}" for n in "123456789" for s in ["万", "条", "筒"]] + HONORS
CALLS = ["碰", "杠", "胡", "自摸", "抢杠", "杠开", "听", "过", "流局"]
SILENT = ["暗杠", "补杠"]      # 手上动作，用牌碰声，不喊（TTS 做不了音效，沿用 Gen 版）

# 座位 → 固定音色（与 index.html 的 cast 保持一致）
#
# speed 的由来（实测，不是猜的）：
#   四个音色用默认 speed=1.0 合成同一张牌，加工后时长差异极大 ——
#   座位1「金老板」shuangkuainansheng 明显偏慢，同一张牌要 2.0~2.6 倍时长
#   （7条 1.29s vs 其他座位 0.63s）。牌桌上他报牌会明显拖拍。
#   拿「7条」扫 speed：1.0->1.07s, 1.2->1.79s, 1.4->0.57s, 1.6->0.63s, 1.8->0.57s，
#   1.4 以上进入平台期，取中间的 1.6（离平台边缘远，抗随机波动）。
#   ⚠ speed=1.2 那次合成出 3.24s 的异常件 —— TTS 有随机性，别用平台边缘的值。
#   其余三个音色默认 speed 就与其他座位一致，无需调整。
SEATS = {
    1: {"name": "金老板", "voice": "shuangkuainansheng", "speed": 1.6},
    2: {"name": "红姐",   "voice": "lengyanyujie",       "speed": 1.0},
    3: {"name": "顾曼",   "voice": "zhixingjiejie",      "speed": 1.0},
}

# 情绪提示：只用简单常见的词（复杂的如「兴奋而克制」实测会触发内容审核）
MOODS = {
    "碰": "短促有力地", "杠": "得意地", "胡": "高兴地",
    "自摸": "高兴地", "抢杠": "急促地", "杠开": "兴奋地",
    "听": "平静地", "过": "平淡地", "流局": "放松地",
}


def job(word: str, seat: int, is_call: bool) -> dict:
    v = SEATS[seat]["voice"]
    if is_call:
        text = f"（{MOODS.get(word, '自然地')}）{word}"
    else:
        text = f"（利落报牌，语速偏快）{word}"
    return {
        "file": word + ".mp3",
        "voice": v,
        "reading": text,
        "speed": SEATS[seat].get("speed", 1.0),
        "response_format": "mp3",
        "sample_rate": 48000,
        "_seat": seat,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="audio/mj 目录")
    ap.add_argument("--seat", type=int, choices=[1, 2, 3])
    ap.add_argument("--sleep", type=float, default=9.0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="覆盖已有（默认跳过）")
    ap.add_argument("--only", help="只重做指定牌名（逗号分隔），用于修单条坏件")
    args = ap.parse_args()

    seats = [args.seat] if args.seat else sorted(SEATS)
    only = {x.strip() for x in args.only.split(",") if x.strip()} if args.only else None
    by_seat = {}
    for s in seats:
        items = [job(w, s, False) for w in TILES] + [job(w, s, True) for w in CALLS]
        if only:
            items = [j for j in items if j["file"][:-4] in only]
        by_seat[s] = items

    total = sum(len(v) for v in by_seat.values())
    print(f"座位 {seats} · 共 {total} 条（TTS 固定音色）")
    for s in seats:
        print(f"  座位 {s} {SEATS[s]['name']:<8} voice={SEATS[s]['voice']:<20} "
              f"speed={SEATS[s].get('speed', 1.0):<4} {len(by_seat[s])} 条")
    if args.dry_run:
        return 0

    if not os.environ.get("STEP_API_KEY", "").strip():
        print("请先设置 STEP_API_KEY", file=sys.stderr)
        return 2

    rc = 0
    for s in seats:
        sub = os.path.join(args.out, f"seat{s}")
        os.makedirs(sub, exist_ok=True)
        # 清掉不该存在的旧件：SILENT 里的牌（暗杠/补杠）早期用 Gen 试做过，
        # 那批文件不会被 TTS 覆盖（TTS 根本不生成它们），会一直混在座位目录里，
        # 造成「同一个座位既有 TTS 音色又有 Gen 音色」。--force 不删多余文件，必须显式清。
        for w in SILENT:
            stale = os.path.join(sub, w + ".mp3")
            if os.path.exists(stale):
                os.remove(stale)
                print(f"  清理旧版遗留 {stale}")
        if not by_seat[s]:
            print(f"\n=== 座位 {s}：--only 未匹配到条目，跳过 ===")
            continue
        js = [{k: v for k, v in j.items() if not k.startswith("_")} for j in by_seat[s]]
        jf = os.path.join(args.out, f"_jobs_tts_seat{s}.json")
        with open(jf, "w", encoding="utf-8") as f:
            json.dump({"jobs": js}, f, ensure_ascii=False, indent=1)
        print(f"\n=== 座位 {s} · {SEATS[s]['name']} · {len(js)} 条 ===")
        cmd = [sys.executable, GEN, "--jobs", jf, "--out", sub,
               "--sleep", str(args.sleep), "--retry", "3"]
        if args.force:
            cmd.append("--force")
        r = subprocess.run(cmd)
        rc = rc or r.returncode
        os.remove(jf)
    return rc


if __name__ == "__main__":
    sys.exit(main())
