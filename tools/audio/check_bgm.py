# -*- coding: utf-8 -*-
"""BGM 循环质量检查：时长 / 响度 / 音高稳定性 / 循环接缝。

为什么循环接缝要专门量：
  BGM 在游戏里是 `a.loop = true` 播放的，接缝处若电平跳变大就会每次循环「咔」一下。
  引擎有 loopCrossfade()（XF=1.6s）能掩盖小接缝，但首尾差 >6dB 仍会听出来。
  判据：比较「末尾 150ms 的 RMS」与「开头 150ms 的 RMS」，差值就是接缝跳变量。

音高稳定性（自相关基频）用来判断 calm 那条 184s 是不是「同一段重复拼接」——
  若整条基频几乎不变且能量包络周期性重复，说明是一段旋律反复了很多遍。
"""
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import process_sfx as P

import paths as PA

BGM = PA.DIR_BGM
RAW = PA.SRC_BGM


def loudness(p):
    o = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", p,
                        "-af", "ebur128=framelog=quiet", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    for line in (o.stderr or "").split("\n"):
        if line.strip().startswith("I:"):
            try:
                return float(line.split()[1])
            except Exception:
                pass
    return None


def seam(x, ms=150):
    """返回 (开头RMS_dB, 末尾RMS_dB, 差值dB)。差值越小接缝越不易听出。"""
    n = int(P.SR * ms / 1000)
    h, t = x[:n], x[-n:]

    def rms_db(seg):
        if seg.size == 0:
            return -120.0
        r = float(np.sqrt(np.mean(seg.astype(np.float64) ** 2)))
        return 20 * np.log10(max(r, 1e-12))

    a, b = rms_db(h), rms_db(t)
    return a, b, abs(a - b)


def periodicity(x):
    """能量包络的自相关峰：>0.6 说明有强周期性（疑似重复拼接）。"""
    win = int(P.SR * 0.1)
    n = x.size // win
    if n < 20:
        return 0.0
    e = np.sqrt(np.mean(x[:n * win].reshape(n, win).astype(np.float64) ** 2, axis=1))
    e = e - e.mean()
    if not np.any(e):
        return 0.0
    r = np.correlate(e, e, mode="full")[n - 1:]
    if r[0] <= 0:
        return 0.0
    r = r / r[0]
    # 看 3~60s 范围内的最强自相关（0.1s/格 → 30~600 格）
    lo, hi = 30, min(600, r.size - 1)
    return float(np.max(r[lo:hi])) if hi > lo else 0.0


def main():
    rows = []
    for d, label in [(BGM, "成品"), (RAW, "原始")]:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".mp3"):
                continue
            p = os.path.join(d, f)
            x, err = P.decode(p)
            if x is None:
                print(f"  {label}/{f}: 解码失败 {err}")
                continue
            rows.append((f[:-4], label, x.size / P.SR, loudness(p), x))

    print("=" * 88)
    print(f"{'mood':<8}{'来源':<6}{'时长':>9}{'LUFS':>9}{'开头dB':>9}{'末尾dB':>9}{'接缝差':>9}{'周期性':>8}  判定")
    print("=" * 88)
    bad = 0
    for name, label, dur, lufs, x in rows:
        a, b, diff = seam(x)
        per = periodicity(x)
        notes = []
        # 判定只针对成品：原始件是「生成直出」，本来就带前后静音/淡出
        # （实测原始件接缝差 36~47dB 很正常），拿成品的标准去判它必然满屏红。
        if label == "成品":
            if diff > 6:
                notes.append(f"接缝{diff:.1f}dB偏大")
                bad += 1
            if lufs is not None and abs(lufs + 22) > 2.5:
                notes.append(f"响度偏离−22({lufs:.1f})")
                bad += 1
            if per > 0.6:
                notes.append(f"强周期{per:.2f}(疑重复)")
                bad += 1
            if dur > 120:
                notes.append(f"偏长{dur:.0f}s")
                bad += 1
        print(f"{name:<8}{label:<6}{dur:>8.1f}s{lufs if lufs is not None else 0:>9.1f}"
              f"{a:>9.1f}{b:>9.1f}{diff:>9.1f}{per:>8.2f}  {' / '.join(notes) or 'OK'}")
    print("=" * 88)
    print(f"结论：{'循环质量全部达标 ✓' if bad == 0 else f'{bad} 项需处理'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
