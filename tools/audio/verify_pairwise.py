#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_pairwise.py — 牌名「同词跨座位」交叉验证（补上总时长测不出的盲区）

═══ 为什么需要这个工具 ═══
之前用来「验证」座位音色的指标是**加工前后总时长**。它有个致命盲区：
它只能说明「削掉了静音」，**不能说明「留下了完整人声」**。
实测因此漏掉了一个存在很久的严重缺陷：

  共用目录（座位0，主角报牌）43 条里 15 条的有声内容被削到不足座位目录的 55%：
    「杠开」0.02s、「1筒」0.04s、「杠」0.02s（座位目录中位 0.24~0.50s）
  短到连「五万」和「一万」都分不出来 —— 实测 5万 被听成「喂」。
  而当时的时长报表一切「正常」。

═══ 三种子命令（对应三种不同的失效模式）═══
  --len     有声段时长：座位0 vs 其它座位中位数 → 抓「内容被削短/截断」
  --content ASR 内容核对（拼音同音）           → 抓「念错/提示泄漏」
  --acoustic MFCC-DTW 交叉验证                 → 判可疑件是「ASR 判错」还是「真坏件」

⚠ 三者都不是万能的，脚本会说明各自的适用边界：
  · --len 衡量的是「与其它座位一致」，不是「这条对不对」。
    座位0 换音色后整体语速不同，比值会整体偏移，要结合 --content 看。
  · --acoustic 对**单音节爆破音**（杠/碰/东/白）区分度差，会给假阳性 ——
    这类词必须以人耳为准，脚本会明确标注「不作结论」。

用法：
    python verify_pairwise.py --len
    python verify_pairwise.py --content
    python verify_pairwise.py --acoustic --words 5万,1筒,7筒
"""

import argparse
import os
import re
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import paths as PA  # noqa: E402
import process_sfx as P  # noqa: E402

MJ = PA.DIR_MJ
SEATS = ["", "seat1", "seat2", "seat3"]

# 牌名 → 期望拼音（与 verify_mj_asr.py 同源，避免两处维护）
SUIT_PY = {"万": "wan", "条": "tiao", "筒": "tong"}
NUM_PY = {"1": "yi", "2": "er", "3": "san", "4": "si", "5": "wu",
          "6": "liu", "7": "qi", "8": "ba", "9": "jiu"}
HONOR_PY = {"东": "dong", "南": "nan", "西": "xi", "北": "bei", "中": "zhong",
            "发": "fa", "白": "bai", "碰": "peng", "杠": "gang", "胡": "hu",
            "自摸": "zimo", "抢杠": "qianggang", "杠开": "gangkai",
            "听": "ting", "过": "guo", "流局": "liuju"}

# 单音节爆破/短促音：MFCC 区分度差，--acoustic 对它们不作结论
WEAK_ACOUSTIC = {"杠", "碰", "东", "白", "中", "发", "听", "过", "胡"}


def words_on_disk():
    return sorted(f[:-4] for f in os.listdir(MJ) if f.endswith(".mp3"))


def voiced_len(p):
    x, err = P.decode(p)
    if x is None or x.size == 0:
        return None
    a, b = P.content_bounds(x, rel_db=42.0, gap_tol_s=0.15)
    return (b - a) / P.SR


# ──────────────────────────────────────────────────────────────────────
def cmd_len(args):
    print("座位0 有声段时长 vs 其它座位中位数")
    print("（抓「内容被削短/截断」—— 总时长指标测不出这个）\n")
    rows = []
    for w in words_on_disk():
        p0 = os.path.join(MJ, w + ".mp3")
        if not os.path.exists(p0):
            continue
        v0 = voiced_len(p0)
        others = [voiced_len(os.path.join(MJ, s, w + ".mp3"))
                  for s in ("seat1", "seat2", "seat3")
                  if os.path.exists(os.path.join(MJ, s, w + ".mp3"))]
        others = [o for o in others if o is not None]
        if v0 is None or not others:
            continue
        med = float(np.median(others))
        rows.append((w, v0, med, v0 / med if med > 0 else 1.0))

    print(f"{'牌名':<8}{'座位0':>8}{'座位中位':>10}{'比值':>8}  判定")
    print("-" * 52)
    short, long_ = [], []
    for w, a, b, r in sorted(rows, key=lambda t: t[3]):
        flag = ""
        if r < 0.55:
            flag = "★★ 明显偏短"
            short.append((w, a, b, r))
        elif r < 0.75:
            flag = "△ 偏短"
        elif r > 1.8:
            flag = "△ 偏长"
            long_.append((w, a, b, r))
        print(f"{w:<8}{a:>7.2f}s{b:>9.2f}s{r:>8.2f}  {flag}")

    vals = [r for _, _, _, r in rows]
    print("-" * 52)
    print(f"共 {len(rows)} 条；明显偏短 {len(short)} 条，偏长 {len(long_)} 条")
    print(f"比值 中位 {np.median(vals):.2f}  最小 {min(vals):.2f}  最大 {max(vals):.2f}")
    if short:
        print("\n明显偏短（要重做）：")
        for w, a, b, r in short:
            print(f"  {w:<8} 座位0 {a:.2f}s vs 中位 {b:.2f}s（{r*100:.0f}%）")
    if long_:
        print("\n偏长（结合 --content 判断是「慢念」还是「多念了提示」）：")
        for w, a, b, r in long_[:10]:
            print(f"  {w:<8} 座位0 {a:.2f}s vs 中位 {b:.2f}s（{r*100:.0f}%）")
    print("\n⚠ 比值只衡量「与其它座位一致」，不衡量「这条对不对」——")
    print("   座位0 换过音色，整体语速本就不同，务必同时跑 --content。")
    return 0


# ──────────────────────────────────────────────────────────────────────
def _norm(s):
    t = re.sub(r"[^\u4e00-\u9fff0-9]", "", s or "")
    for cn, ar in [("一", "1"), ("二", "2"), ("两", "2"), ("三", "3"), ("四", "4"),
                   ("五", "5"), ("六", "6"), ("七", "7"), ("八", "8"), ("九", "9")]:
        t = t.replace(cn, ar)
    return t


def _expect_py(name):
    if name in HONOR_PY:
        return {HONOR_PY[name]}
    m = re.match(r"^([1-9])([万条筒])$", name)
    if m:
        return {NUM_PY[m.group(1)] + SUIT_PY[m.group(2)]}
    return set()


def _to_py(text):
    from pypinyin import lazy_pinyin
    t = _norm(text)
    t = "".join(NUM_PY.get(c, c) for c in t)
    return "".join(lazy_pinyin(t))


def _asr_engine():
    import sherpa_onnx
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=os.path.join(PA.ASR_MODEL, "model.int8.onnx"),
        tokens=os.path.join(PA.ASR_MODEL, "tokens.txt"),
        use_itn=True, language="zh", num_threads=4)


def _asr(rec, p):
    tmp = os.path.join(os.environ.get("TEMP", "."), "_pw.wav")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", p, "-ar", "16000",
                    "-ac", "1", tmp], capture_output=True)
    with wave.open(tmp, "rb") as w:
        d = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    s = rec.create_stream()
    s.accept_waveform(16000, d.astype(np.float32) / 32768.0)
    rec.decode_stream(s)
    return s.result.text.strip()


def cmd_content(args):
    print("ASR 内容核对（拼音同音匹配 + 提示泄漏检测）\n")
    rec = _asr_engine()
    # 「利落报牌」这类舞台提示被念成正文，是本项目踩过的真坑（cixingnansheng 会泄漏）
    LEAK = ["报牌", "爆牌", "利落", "语速", "偏快", "平静地", "短促", "得意", "急促"]
    bad, leak = [], []
    for w in words_on_disk():
        t = _asr(rec, os.path.join(MJ, w + ".mp3"))
        if any(k in t for k in LEAK):
            leak.append((w, t))
        py = _to_py(t)
        exp = _expect_py(w)
        if not (py and exp and any(x in py for x in exp)):
            bad.append((w, t))
    print(f"座位0 共 {len(words_on_disk())} 条")
    print(f"  提示泄漏 {len(leak)} 条" + ("  ★★ 必须重做" if leak else "  ✔"))
    for w, t in leak:
        print(f"    {w:<8} ASR=\"{t}\"  ← 念出了提示词而不是牌名")
    print(f"  内容不符 {len(bad)} 条（含 ASR 判错，需 --acoustic 复核）")
    for w, t in bad:
        print(f"    {w:<8} ASR=\"{t}\"")
    if not leak and not bad:
        print("  全部通过。")
    return 1 if leak else 0


# ──────────────────────────────────────────────────────────────────────
def dct2(x):
    """DCT-II（正交归一）。不引 scipy —— 本机没有，为一个检查装重依赖不值得。"""
    N = x.shape[1]
    k = np.arange(N)
    basis = np.cos(np.pi * (2 * k[None, :] + 1) * k[:, None] / (2 * N))
    basis *= np.sqrt(2.0 / N)
    basis[0] *= np.sqrt(1.0 / 2.0)
    return x @ basis.T


def mfcc(x, sr=16000, n_mfcc=13, win=400, hop=160, nfft=512, nfilt=26):
    if x.size < win:
        x = np.pad(x, (0, win - x.size))
    x = np.append(x[0], x[1:] - 0.97 * x[:-1])
    nfr = 1 + (x.size - win) // hop
    frames = np.stack([x[i * hop:i * hop + win] for i in range(nfr)]) * np.hamming(win)
    spec = np.abs(np.fft.rfft(frames, nfft)) ** 2

    def hz2mel(f):
        return 2595 * np.log10(1 + f / 700.0)

    def mel2hz(m):
        return 700 * (10 ** (m / 2595.0) - 1)

    pts = mel2hz(np.linspace(hz2mel(20), hz2mel(sr / 2), nfilt + 2))
    bins = np.floor((nfft + 1) * pts / sr).astype(int)
    fb = np.zeros((nfilt, nfft // 2 + 1))
    for i in range(1, nfilt + 1):
        a, b, c = bins[i - 1], bins[i], bins[i + 1]
        b = max(b, a + 1)
        c = max(c, b + 1)
        for k in range(a, min(b, fb.shape[1])):
            fb[i - 1, k] = (k - a) / (b - a)
        for k in range(b, min(c, fb.shape[1])):
            fb[i - 1, k] = (c - k) / (c - b)
    return dct2(np.log(spec @ fb.T + 1e-10))[:, :n_mfcc]


def dtw_dist(a, b):
    D = np.linalg.norm(a[:, None, :] - b[None, :, :], axis=2)
    n, m = D.shape
    C = np.full((n + 1, m + 1), np.inf)
    C[0, 0] = 0
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            C[i, j] = D[i - 1, j - 1] + min(C[i - 1, j], C[i, j - 1], C[i - 1, j - 1])
    return C[n, m] / (n + m)


def _feat(path):
    x = P.decode(path)[0]
    a, b = P.content_bounds(x, rel_db=42.0, gap_tol_s=0.15)
    seg = x[a:b] if b > a else x
    m = mfcc(seg)
    d = np.diff(m, axis=0) if m.shape[0] > 1 else np.zeros_like(m)
    if m.shape[0] > 1:
        d = np.vstack([d[:1], d])
    return np.concatenate([m, d], axis=1)


def cmd_acoustic(args):
    """判可疑件是「ASR 判错」还是「真坏件」。

    判据：与「同词其它座位」的距离  vs  与「同座位其它词」的距离。
      更像同词   → ASR 判错，文件没问题
      更像别的词 → 真坏件

    ⚠⚠ 适用边界（实测撞出来的，别当成万能判据）：
      牌名多是 0.4~0.7s 的**两字短词**，MFCC-DTW 在这个尺度上分辨力很差 ——
      实测同类词之间的距离（5筒 7.67 / 东 8.78）与异类词（10.49）**高度重叠**。
      曾经因为「异词距离更小」就把一条**刚重新生成、内容已确认正确**的 5万
      判成「真坏件」，是误报：两者的分差只有 1.47，而基准词的散布比这还大。

      所以加了两道闸：
        ① `MARGIN`：两类距离的分差不到 2.0 就**不下结论**（噪声区间）
        ② `WEAK_ACOUSTIC`：单音节短促音（杠/碰/东/白…）直接不作结论
      只有「分差够大 **且** 不是弱区分度词」才给结论。
      拿不准就以人耳为准 —— 这个工具的定位是**缩小人工听辨的范围**，不是替代它。
    """
    MARGIN = 2.0
    words = [w.strip() for w in (args.words or "").split(",") if w.strip()] or words_on_disk()
    refs = ["1万", "5筒", "9条", "东", "白"]
    print("MFCC-DTW 交叉验证（距离越小越像）")
    print(f"判定门槛：两类距离分差需 ≥ {MARGIN}，且不是单音节弱区分度词\n")
    for w in words:
        p0 = os.path.join(MJ, w + ".mp3")
        if not os.path.exists(p0):
            continue
        f0 = _feat(p0)
        same = [(s, dtw_dist(f0, _feat(os.path.join(MJ, s, w + ".mp3"))))
                for s in ("seat1", "seat2", "seat3")
                if os.path.exists(os.path.join(MJ, s, w + ".mp3"))]
        diff = [(o, dtw_dist(f0, _feat(os.path.join(MJ, o + ".mp3"))))
                for o in refs if o != w and os.path.exists(os.path.join(MJ, o + ".mp3"))]
        if not same or not diff:
            print(f"── {w} ── 样本不足，跳过\n")
            continue
        sa = float(np.mean([d for _, d in same]))
        da = float(np.mean([d for _, d in diff]))
        margin = da - sa
        print(f"── {w} ──")
        print(f"   同词其它座位 平均 {sa:.2f}   " + " ".join(f"{s}:{d:.2f}" for s, d in same))
        print(f"   同座位其它词 平均 {da:.2f}   " + " ".join(f"{o}:{d:.2f}" for o, d in diff))
        if w in WEAK_ACOUSTIC:
            print("   → ⚠ 单音节短促音，MFCC 区分度不足，本项不作结论；请人耳确认\n")
        elif abs(margin) < MARGIN:
            print(f"   → ⚠ 分差仅 {margin:+.2f}（< {MARGIN}），落在噪声区间，**不下结论**；")
            print("     本项只适合缩小范围，这条请人耳确认\n")
        elif margin > 0:
            print(f"   → 更像同词（分差 {margin:+.2f}）→ ASR 判错，文件正常\n")
        else:
            print(f"   → ★★ 更像别的词（分差 {margin:+.2f}）→ 疑似真坏件，请人耳确认\n")
    return 0


def main():
    ap = argparse.ArgumentParser(description="牌名同词跨座位交叉验证")
    ap.add_argument("--len", dest="m_len", action="store_true", help="有声段时长对比")
    ap.add_argument("--content", action="store_true", help="ASR 内容核对 + 提示泄漏检测")
    ap.add_argument("--acoustic", action="store_true", help="MFCC-DTW 交叉验证")
    ap.add_argument("--words", help="--acoustic 只查指定词（逗号分隔）")
    args = ap.parse_args()
    if args.m_len:
        return cmd_len(args)
    if args.content:
        return cmd_content(args)
    if args.acoustic:
        return cmd_acoustic(args)
    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
