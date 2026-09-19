#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
process_sfx.py — 把生成出来的音效加工成「游戏里能直接用」的形态

为什么必须过这一步：
  StepAudio 生成的是「一段有房间感的录音」，不是游戏音效 —— 实测 45 条普遍存在
    · 前导静音 0.5~0.7 秒          → 播报延迟，手感拖沓
    · 尾部房间尾音，有声段只占 0.2~0.8s → 占时长、盖住后一声
    · RMS 偏低（-22 ~ -47 dBFS）   → 混在 BGM 里听不见
  游戏音效要的是：**起手就响、短促干净、响度一致**。

处理链（每条）：
  ① ffmpeg 解码成 PCM
  ② 内容边界检测：以「相对峰值 -26dB」为界，找到真正有声的首尾
     —— 不用 ffmpeg 的 silenceremove：它的绝对阈值会把音效的自然衰减
        误判成静音而切掉（实测把 1.2s 的碰击声切成了 0.00s）
  ③ 按边界裁切 + 前后各留 25ms 余量
  ④ EBU R128 响度归一（loudnorm I=-16 LUFS, TP=-1.5）
  ⑤ 首尾 8ms 淡入淡出，避免爆音
  ⑥ 统一 48kHz / 单声道 / mp3 128k

原始件保留在 --src，加工件输出到 --out。参数可随时重调重跑，不用重新生成。

用法：
  python process_sfx.py --src "...\\audio\\mj_raw" --out "...\\audio\\mj"
"""

import argparse
import os
import subprocess
import sys

import numpy as np

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"
SR = 48000


def decode(path: str):
    """解码成 float32 单声道。返回 (数组, 错误)。"""
    cmd = [FFMPEG, "-v", "error", "-i", path, "-f", "f32le",
           "-acodec", "pcm_f32le", "-ac", "1", "-ar", str(SR), "-"]
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0 or not p.stdout:
        return None, (p.stderr.decode("utf-8", "replace")[:160] or "解码失败")
    return np.frombuffer(p.stdout, dtype=np.float32), ""


def content_bounds(x: np.ndarray, rel_db: float = 30.0, win_ms: float = 20.0,
                   floor_guard: float = 10.0, gap_tol_s: float = 0.06,
                   keep_all: bool = False):
    """找有声区间。返回 (start_sample, end_sample)。

    ⚠ `gap_tol_s`（合并停顿的容差）对音效和配音必须分开设：
      · 音效（0.06s）：音效内部几乎没有长停顿，容差小能精确掐头去尾
      · **配音（0.7s 以上）**：句与句之间有几百毫秒的自然停顿，
        容差太小会把每句当成独立段、只留最长的一句
        —— 实测用 0.06s 处理配音，54 条平均时长从 5.34s 被砍到 1.89s，
        多句台词只剩第一句。这是必须避免的静默损坏。

    ⚠ `keep_all`：只保留「最长连续有声段」在**多句内容上会静默丢句**。
      实测「（平静，有压迫感）连踩七个风口的年轻人。坐。证明给我看，不是运气。」
      的新 TTS 产出是**三段独立语句**，句间停顿 0.7~1.0s：
          0.2~2.1s 语音 → 2.2~2.9s 停顿(−76dB, 0.8s) → 3.0~3.2s 语音
          → 3.3~3.9s 停顿(0.7s) → 4.0~5.6s 语音
      即使 gap_tol 已设到 0.8s，那 0.8s 的停顿**恰好超过容差**，
      于是第一句被整段丢掉、加工件从 5.10s 变成 2.79s，ASR 只剩「坐证明给我看，不是运气。」
      —— 而这一步不会报任何错。
      所以凡「内容必须完整」的素材（台词配音）都用 keep_all=True：
      取**首尾有声帧**，不做长度择优。代价是可能多留一点段间房间声，
      但「多留一点静音」远好于「少说一句话」。

    判据：**相对内容峰值**。阈值 = 峰值 dB - floor_guard。

    ⚠ 为什么下限不能靠底噪：
      实测「暗杠」原始件底噪 -55dB、峰值 -10.6dB，开头 0.9s 是 -55dB 的房间声，
      内容从 0.9s 才开始。但该条安静帧多，10% 分位被拉低到约 -60，
      「底噪 + 10dB = -50dB」反而**低于**房间声，结果房间声被当成内容，
      0.9s 前导静音切不掉。改成「峰值 - 38dB」就分开了。

    ⚠ 为什么不能用绝对 dBFS 阈值：
      各条内容峰值差异极大（-2.5 ~ -35 dBFS），绝对阈值对轻的条目必然判错。

    另含：段内收紧首尾、允许 <=gap_tol 的中断（避免字中停顿截断）。
    """
    win = max(1, int(win_ms / 1000.0 * SR))
    n = x.size // win
    if n < 3:
        return 0, x.size

    frames = x[: n * win].reshape(n, win)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    db = 20 * np.log10(np.maximum(rms, 1e-12))

    # ⚠ 阈值用「响亮帧的 90 分位」而不是「样本峰值」：
    #   音效里常有极短的瞬态尖峰（转动卡位、牌碰的一下），
    #   用样本峰值算阈值会把阈值抬得过高，导致**持续时间较长但电平略低的主体内容被判成静音**。
    #   实测症状：sfx-cir-rotate 真实内容约 1.5 秒，但用峰值判据只认出 0.02 秒，
    #   于是被「过度裁剪保护」整体放行，前导静音 1.75 秒一直留着。
    #   分位数对瞬态不敏感，能反映"这段音频的整体有声水平"。
    floor = float(np.percentile(db, 10))
    ref_db = float(np.percentile(db, 90))
    thr = max(ref_db - rel_db, floor + floor_guard)
    loud = db >= thr

    if not loud.any():
        return 0, x.size

    # 合并段内短暂下陷：允许 <= 60ms 的中断，避免字与字之间的自然停顿把段截断
    gap_tol = max(1, int(gap_tol_s / (win_ms / 1000.0)))

    # 最长连续有声段
    best_len = best_start = cur_len = 0
    cur_start = 0
    gap = 0
    for i in range(n):
        if loud[i]:
            if cur_len == 0:
                cur_start = i
            cur_len += gap + 1
            gap = 0
            if cur_len > best_len:
                best_len, best_start = cur_len, cur_start
        else:
            if cur_len > 0:
                gap += 1
                if gap > gap_tol:
                    cur_len = gap = 0

    if keep_all:
        # 取首尾有声帧：不做长度择优，避免「多句内容被丢掉一句」。
        # 段间房间声会一并保留，但语音里那点底噪人耳几乎无感，
        # 而少一句话是硬伤。台词配音一律走这条路。
        idx = np.flatnonzero(loud)
        seg_start, seg_end = int(idx[0]), int(idx[-1]) + 1
        # 段内收紧首尾：去掉最外侧那截低于阈值的帧
        return seg_start * win, min(x.size, seg_end * win)

    seg_start, seg_end = best_start, min(n, best_start + best_len)
    # 段内再收紧首尾：把段自身开头/结尾那截低于阈值的帧也去掉。
    # 否则「最长段」会把它内部的起始静音一并带进来（实测残留 0.3~0.7s 前导静音）。
    inner = np.flatnonzero(loud[seg_start:seg_end])
    if inner.size:
        seg_start = seg_start + int(inner[0])
        seg_end = seg_start + int(inner[-1] - inner[0]) + 1

    return seg_start * win, min(x.size, seg_end * win)


# ══════════════════════════════════════════════════════════════════════════
# 预设：把踩过的坑固化成参数组，避免每次手写命令行时又把参数配错。
#
# 为什么需要：
#   同一个 rel_db 对「60 秒环境音」和「0.3 秒单字」的意义完全不同。
#   实测用环境音的 rel_db=24 去处理麻将牌名，平均时长被削掉 24%，
#   一度误判为「切到字尾」；查波形后发现削掉的确实是 TTS 产出的房间底噪
#   （原始件 40~49% 是静音），但**短音节的衰减尾巴确实更容易被吃掉**，
#   所以短词需要比长句更保守的 rel_db 与更小的尾部余量。
# ══════════════════════════════════════════════════════════════════════════
PRESETS = {
    # 游戏音效：内部几乎没有长停顿，可以精确掐头去尾
    "sfx": dict(lufs=-16.0, pad=0.025, tail_pad=0.12, fade_in=0.005,
                fade_out=0.015, gap_tol=0.06, rel_db=30.0, keep_all=False),
    # 配音（旁白/台词）：句间有几百毫秒自然停顿，gap_tol 必须放大，
    # 否则多句台词只会留下最长的一句（实测 5.34s 被砍到 1.89s）。
    # keep_all=True 是双保险：即使某句的停顿超过 gap_tol 也不会被丢掉
    # （实测新 TTS 有 0.8s 句间停顿、恰好越过 gap_tol=0.8，导致首句整段消失）。
    "voice": dict(lufs=-16.0, pad=0.030, tail_pad=0.12, fade_in=0.005,
                  fade_out=0.015, gap_tol=0.80, rel_db=34.0, keep_all=True),
    # 麻将牌名等「短词」：单字/两字，音节衰减尾容易被判成静音。
    # rel_db 抬到 42 更保守，尾部余量按长度自适应（见 process_one）。
    "word": dict(lufs=-16.0, pad=0.030, tail_pad=0.06, fade_in=0.005,
                 fade_out=0.012, gap_tol=0.15, rel_db=42.0, keep_all=False),
    # 环境音：不裁剪内容，只做统一响度与去首尾静音
    "amb": dict(lufs=-22.0, pad=0.02, tail_pad=0.05, fade_in=0.02,
                fade_out=0.02, gap_tol=5.0, rel_db=60.0, keep_all=True),
    # BGM：循环播放，必须处理接缝（见 loop_crossfade）。
    # 响度 −22 低于音效 −16，避免盖住配音；对应 AudioSys.BGM_VOL=0.42。
    "bgm": dict(lufs=-22.0, pad=0.02, tail_pad=0.05, fade_in=0.02,
                fade_out=0.02, gap_tol=5.0, rel_db=60.0, keep_all=True,
                loop_xf=1.0),
}


def probe_duration(path: str) -> float:
    p = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", path], capture_output=True)
    try:
        return float(p.stdout.decode().strip())
    except Exception:
        return 0.0


def loop_crossfade(src: str, dst: str, xf: float = 1.0) -> tuple:
    """把「尾部 xf 秒」交叉淡化进「开头 xf 秒」，做成可无缝循环的 BGM。

    为什么需要（实测数据）：
      BGM 在游戏里是 `a.loop = true` 播放的，接缝处电平跳变就是循环「咔」一下。
      实测生成的 5 条里 `dark` 末尾是**作曲家式自然淡出**（最近 2.5s 从 −16 掉到 −41 dB）——
      对一次性聆听是对的收尾，**对循环就是每次绕回时「掉下去再跳回来」**，
      末尾 150ms 比开头低 21.1 dB。只做 20ms 淡入淡出救不了：20ms 归零消掉了爆音，
      但那 2.5s 的渐弱仍留在文件里。
      参考做法（游戏音频的通行解法）：把结尾最响的那 0.5~1.5s 叠回开头，
      `out = body + tail(淡出) + head(淡入)`，这样边界处电平连续、听不出接缝。

    实现：out = x[:-n] ，其中前 n 个样本用 x[:n] 与 x[-n:] 做等功率交叉淡化。
      · 等功率（cos/sin）而不是线性：线性淡化在中点会掉 3dB，循环处会出现「凹陷」。
      · 只沿用一个方向（把尾巴并进头部），不做「中间截断重排」——后者对音乐结构破坏更大。
    """
    x, err = decode(src)
    if x is None:
        return False, err
    n = int(xf * SR)
    if n * 2 >= x.size:
        return False, f"音频太短（{x.size/SR:.2f}s），无法做 {xf}s 交叉淡化"

    head = x[:n].astype(np.float64)
    tail = x[-n:].astype(np.float64)
    # 等功率淡入淡出：cos/sin 平方和为 1，避免中点掉电平
    t = np.linspace(0.0, np.pi / 2, n, endpoint=False)
    fi, fo = np.sin(t), np.cos(t)
    blended = head * fi + tail * fo
    out = np.concatenate([blended, x[n:]]).astype(np.float32)

    raw = (np.clip(out, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
    cmd = [FFMPEG, "-y", "-v", "error",
           "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
           "-ac", "1", "-ar", "48000", "-b:a", "128k", dst]
    p = subprocess.run(cmd, input=raw, capture_output=True)
    if p.returncode != 0 or not os.path.exists(dst) or os.path.getsize(dst) < 800:
        return False, (p.stderr.decode("utf-8", "replace")[:160] or "输出异常")
    return True, ""


def process_one(src: str, dst: str, pad: float, lufs: float,
                fade_in: float, fade_out: float, tail_pad: float,
                gap_tol_s: float = 0.06, rel_db: float = 30.0,
                keep_all: bool = False) -> tuple:
    x, err = decode(src)
    if x is None:
        return False, err
    if x.size == 0:
        return False, "解码为空"

    a, b = content_bounds(x, rel_db=rel_db, gap_tol_s=gap_tol_s, keep_all=keep_all)
    if b <= a:
        return False, "未检测到有声内容"

    # 防呆下限：判定结果比 0.12s 还短，才认为边界检测跑偏了。
    # 不用「占原始时长比例」做判据 —— 实测有不少条目真正有声的部分只占全长 6%
    # （例如「过」4.82s 里只有约 0.3s 是人声，其余是房间底噪），
    # 按比例设阈值会把这种**正当的裁剪**误拦掉。
    if (b - a) / SR < 0.12:
        a, b = 0, x.size

    # 尾部多留一点：语音/音效的自然衰减被硬切时，听起来会有"啪"的一下。
    # 实测留 0.05s 时有 6/45 条末尾 20ms 内能量不降（典型硬切特征）；
    # 尾部放宽到 0.12s 后消失。
    #
    # ⚠ 但尾部余量必须随内容长度自适应：
    #   对 0.5s 的「碰」，0.12s 尾部余量等于给一个短促字音额外拖 24% 的静音，
    #   点牌时听起来像"卡了一下"。实测短音节用 0.03~0.06s 才自然。
    tp = pad if tail_pad is None else tail_pad
    voice_len = (b - a) / SR
    if voice_len < 0.35:
        tp = min(tp, 0.02)
    elif voice_len < 0.80:
        tp = min(tp, 0.04)
    a = max(0, a - int(pad * SR))
    b = min(x.size, b + int(tp * SR))
    trimmed = x[a:b]

    # 响度归一用 ffmpeg 的 loudnorm（两遍太慢，短音效用单遍足够）
    # 淡入必须极短（默认 5ms）：实测把淡入设成 20ms 时，45 条的起手 20ms 全被淡掉
    # （起点能量比峰值低 40~66dB），游戏里点牌就"慢半拍"。淡入只为防爆音，不需要更长。
    # 淡出可以长一些（默认 15ms），让尾部自然收住。
    raw = (np.clip(trimmed, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
    cmd = [FFMPEG, "-y", "-v", "error",
           "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
           "-af", f"loudnorm=I={lufs}:TP=-1.5:LRA=11,"
                  f"afade=t=in:st=0:d={fade_in},"
                  f"areverse,afade=t=in:st=0:d={fade_out},areverse",
           "-ac", "1", "-ar", "48000", "-b:a", "128k", dst]
    p = subprocess.run(cmd, input=raw, capture_output=True)
    if p.returncode != 0 or not os.path.exists(dst) or os.path.getsize(dst) < 800:
        return False, (p.stderr.decode("utf-8", "replace")[:160] or "输出异常")

    # 防呆：加工后若比 0.12s 还短，说明边界检测出了问题，别把废件留在库里
    out_dur = probe_duration(dst)
    if out_dur < 0.12:
        os.remove(dst)
        return False, f"加工后仅 {out_dur:.2f}s，疑似切光，已丢弃"
    return True, ""


def main():
    ap = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="预设：\n" + "\n".join(
            f"  {k:<6} " + "  ".join(f"{kk}={vv}" for kk, vv in v.items())
            for k, v in PRESETS.items())
        + "\n\n显式传入的参数会覆盖预设值。")
    ap.add_argument("--src", required=True, help="原始件目录")
    ap.add_argument("--out", required=True, help="加工件输出目录")
    ap.add_argument("--preset", choices=sorted(PRESETS), default=None,
                    help="参数预设：sfx 音效 / voice 长配音 / word 短词（麻将牌名）/ amb 环境音")
    # 以下默认 None，便于区分「没传」和「传了默认值」，让预设能生效
    ap.add_argument("--pad", type=float, default=None, help="首尾保留余量（秒）")
    ap.add_argument("--lufs", type=float, default=None, help="目标响度（游戏音效建议 -16）")
    ap.add_argument("--fade-in", type=float, default=None, help="淡入秒数（要极短，否则起手被淡掉）")
    ap.add_argument("--fade-out", type=float, default=None, help="淡出秒数")
    ap.add_argument("--tail-pad", type=float, default=None, help="尾部额外余量（秒），防硬切；短词会自动收紧")
    ap.add_argument("--gap-tol", type=float, default=None,
                    help="合并停顿的容差（秒）。音效 0.06；**配音要 0.7 以上**，否则多句台词会被截成一句")
    ap.add_argument("--rel-db", type=float, default=None,
                    help="有声判据：内容参考电平往下多少 dB 算有声。音效 30；短词 42（更保守）")
    ap.add_argument("--only", help="只处理指定文件名（逗号分隔，可不带扩展名），用于修单条坏件")
    ap.add_argument("--keep-all", dest="keep_all", action="store_true", default=None,
                    help="取首尾有声帧而不是最长段（台词必备：多句内容否则会静默丢句）")
    ap.add_argument("--no-keep-all", dest="keep_all", action="store_false",
                    help="强制关掉 keep_all（覆盖预设）")
    ap.add_argument("--loop-xf", type=float, default=None,
                    help="循环交叉淡化秒数（BGM 用）。设了就在加工后再做一次尾→头等功率交叉淡化")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    # 预设打底，显式参数覆盖
    p = dict(PRESETS.get(args.preset) or PRESETS["sfx"])
    for k in ("pad", "lufs", "fade_in", "fade_out", "tail_pad", "gap_tol", "rel_db"):
        v = getattr(args, k)
        if v is not None:
            p[k] = v
    if args.keep_all is not None:
        p["keep_all"] = args.keep_all
    if args.loop_xf is not None:
        p["loop_xf"] = args.loop_xf
    args.pad, args.lufs = p["pad"], p["lufs"]
    args.fade_in, args.fade_out = p["fade_in"], p["fade_out"]
    args.tail_pad, args.gap_tol, args.rel_db = p["tail_pad"], p["gap_tol"], p["rel_db"]
    args.keep_all = p.get("keep_all", False)
    args.loop_xf = p.get("loop_xf", 0.0) or 0.0
    print(f"[预设 {args.preset or '自定义'}] lufs={args.lufs} pad={args.pad} "
          f"tail={args.tail_pad} gap_tol={args.gap_tol} rel_db={args.rel_db} "
          f"keep_all={args.keep_all} loop_xf={args.loop_xf}")

    files = sorted(f for f in os.listdir(args.src) if f.lower().endswith(".mp3"))
    if args.only:
        want = {x.strip() for x in args.only.split(",") if x.strip()}
        files = [f for f in files if f in want or f[:-4] in want]
        if not files:
            print(f"--only 未匹配到条目：{args.only}")
            return 1
    if not files:
        print("原始件目录里没有 mp3")
        return 1
    os.makedirs(args.out, exist_ok=True)

    ok = fail = 0
    rows, failed = [], []
    for i, name in enumerate(files, 1):
        src, dst = os.path.join(args.src, name), os.path.join(args.out, name)
        if os.path.exists(dst) and not args.force:
            print(f"[{i}/{len(files)}] {name}  跳过（已存在）")
            continue
        before = probe_duration(src)
        good, err = process_one(src, dst, args.pad, args.lufs,
                                args.fade_in, args.fade_out, args.tail_pad,
                                args.gap_tol, args.rel_db, args.keep_all)
        if good and args.loop_xf:
            # 循环接缝：把尾部叠进开头（见 loop_crossfade 的说明）
            tmp = dst + ".loop.tmp.mp3"
            okxf, xerr = loop_crossfade(dst, tmp, args.loop_xf)
            if okxf:
                os.replace(tmp, dst)
            else:
                print(f"    ! 循环交叉淡化失败（保留原加工件）：{xerr}")
                if os.path.exists(tmp):
                    os.remove(tmp)
        if good:
            after = probe_duration(dst)
            rows.append((name, before, after))
            print(f"[{i}/{len(files)}] {name}  {before:.2f}s -> {after:.2f}s")
            ok += 1
        else:
            print(f"[{i}/{len(files)}] {name}  失败: {err}")
            failed.append((name, err))
            fail += 1

    print("\n" + "=" * 58)
    if rows:
        b = sum(r[1] for r in rows) / len(rows)
        a = sum(r[2] for r in rows) / len(rows)
        print(f"处理 {ok} 条 · 失败 {fail} 条")
        print(f"平均时长 {b:.2f}s -> {a:.2f}s（缩短 {100*(1-a/b):.0f}%）")
    for n, e in failed:
        print(f"  ! {n}: {e}")
    print(f"加工件：{args.out}")
    print(f"原始件：{args.src}（已保留）")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
