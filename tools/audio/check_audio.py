#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_audio.py — 批量体检音频素材，自动揪出「生成失败但文件存在」的坑

为什么需要：生成 API 返回 200 且落盘成功，不等于音频是对的。
常见静默失败：全是静音、时长异常（吞字/截断）、音量过低、严重削波。
本脚本用 ffmpeg 解码成 PCM，再用 numpy 算客观指标，把这些情况标出来。

用法：
  python check_audio.py "H:\\...\\audio\\mj"
  python check_audio.py <dir> --min-dur 0.5 --max-dur 4 --min-peak -20
"""

import argparse
import json
import os
import subprocess
import sys

import numpy as np

FFMPEG = "ffmpeg"
SR = 16000


def decode(path: str):
    """用 ffmpeg 解码成 float32 单声道 PCM。返回 (样本数组, 采样率)。"""
    cmd = [FFMPEG, "-v", "error", "-i", path,
           "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", str(SR), "-"]
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        return None, (p.stderr.decode("utf-8", "replace")[:200] or "ffmpeg 解码失败")
    if not p.stdout:
        return None, "解码后无数据"
    return np.frombuffer(p.stdout, dtype=np.float32), SR


def analyze(path: str) -> dict:
    x, sr = decode(path)
    if x is None:
        return {"ok": False, "error": sr}
    if x.size == 0:
        return {"ok": False, "error": "空音频"}

    dur = x.size / sr
    peak = float(np.max(np.abs(x)))
    rms = float(np.sqrt(np.mean(x.astype(np.float64) ** 2)))
    peak_db = 20 * np.log10(peak) if peak > 1e-9 else -120.0
    rms_db = 20 * np.log10(rms) if rms > 1e-9 else -120.0

    # 削波比例：贴近满刻度的样本占比
    clip_ratio = float(np.mean(np.abs(x) > 0.999))
    # 静音比例：|x| < -60dBFS
    silence_ratio = float(np.mean(np.abs(x) < 1e-3))
    # 有声区间（用于判断是否被截断 / 前面是否有长静音）
    loud = np.abs(x) > max(peak * 0.05, 1e-4)
    if loud.any():
        first = int(np.argmax(loud))
        last = int(x.size - np.argmax(loud[::-1]))
        lead_silence = first / sr
        voiced = (last - first) / sr
    else:
        lead_silence, voiced = dur, 0.0

    return {
        "ok": True, "duration": dur, "peak_db": peak_db, "rms_db": rms_db,
        "clip_ratio": clip_ratio, "silence_ratio": silence_ratio,
        "lead_silence": lead_silence, "voiced": voiced,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--min-dur", type=float, default=0.4, help="最短时长（秒）")
    ap.add_argument("--max-dur", type=float, default=6.0, help="最长时长（秒）")
    ap.add_argument("--min-peak", type=float, default=-24.0, help="最低峰值 dBFS")
    ap.add_argument("--max-lead", type=float, default=0.8, help="允许的前导静音上限（秒）")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    args = ap.parse_args()

    files = sorted(f for f in os.listdir(args.dir)
                   if f.lower().endswith((".mp3", ".wav", ".flac", ".opus")))
    if not files:
        print("目录里没有音频文件")
        return 1

    rows, problems = [], []
    for name in files:
        r = analyze(os.path.join(args.dir, name))
        r["file"] = name
        rows.append(r)
        if not r["ok"]:
            problems.append((name, "解码失败: " + r["error"]))
            continue
        if r["duration"] < args.min_dur:
            problems.append((name, f"过短 {r['duration']:.2f}s"))
        if r["duration"] > args.max_dur:
            problems.append((name, f"过长 {r['duration']:.2f}s"))
        if r["peak_db"] < args.min_peak:
            problems.append((name, f"音量过低 峰值 {r['peak_db']:.1f}dBFS"))
        if r["silence_ratio"] > 0.97:
            problems.append((name, f"几乎全静音 {r['silence_ratio']*100:.0f}%"))
        if r["lead_silence"] > args.max_lead:
            problems.append((name, f"前导静音 {r['lead_silence']:.2f}s"))
        if r["clip_ratio"] > 0.02:
            problems.append((name, f"削波 {r['clip_ratio']*100:.1f}%"))

    if args.json:
        print(json.dumps({"rows": rows, "problems": problems}, ensure_ascii=False, indent=1))
        return 1 if problems else 0

    print(f"{'文件':<12}{'时长':>7}{'峰值dB':>9}{'RMSdB':>8}{'有声':>7}{'前导静':>8}{'静音%':>7}")
    print("-" * 62)
    for r in rows:
        if not r["ok"]:
            print(f"{r['file']:<12}  {r['error']}")
            continue
        print(f"{r['file']:<12}{r['duration']:>6.2f}s{r['peak_db']:>9.1f}{r['rms_db']:>8.1f}"
              f"{r['voiced']:>6.2f}s{r['lead_silence']:>7.2f}s{r['silence_ratio']*100:>6.1f}%")

    print("\n" + "=" * 62)
    if problems:
        print(f"发现 {len(problems)} 处可疑：")
        for n, why in problems:
            print(f"  ! {n:<12} {why}")
    else:
        print(f"全部 {len(rows)} 条通过体检，未发现静音/截断/削波")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
