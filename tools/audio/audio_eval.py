#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audio_eval.py — 音频素材评估器（声学 + 内容 + 感知 三层合一）

═══ 它解决什么问题 ═══
StepAudio 生成完，「这条音频好不好」原先只能靠人耳听。本工具把人耳要听的东西
拆成三层可自动化的检查，**并明确区分哪层能信、哪层只能当线索**：

| 层 | 手段 | 能定论吗 | 回答 |
|---|---|---|---|
| 1 声学 | ffmpeg + numpy | **能**（精确、可复现） | 是否合格：静音/削波/时长/响度/循环接缝 |
| 2 内容 | 本地 ASR | **部分**（同音字要人判） | 念对了吗：拼音同音比对 + 提示泄漏 |
| 3 感知 | Qwen-Omni | **不能**（会幻觉） | 像什么：类别/情绪/空间感/自然度 |

⚠ 核心设计原则：**第 3 层永远不下最终结论**。
   Omni 输出是流畅自然语言，实测会对逐样本全零的静音编出「游戏界面提示音」。
   所以它的作用被限定为两件事：
     · 覆盖 ASR 的盲区（音效/音乐/环境音 —— ASR 对它们返回空）
     · **提出可疑项**，由第 1/2 层去证实或推翻
   两层结论冲突时标记 [需人耳]，**不自动判定**。

═══ 为什么第 2、3 层要交叉 ═══
实测抓到过两类只有交叉才能发现的缺陷：
  · 座位0 的「1筒」：ASR 说「红」、Omni 说「嗯/哦类单音节」—— 都指它不对，但
    声学交叉验证（MFCC-DTW）显示它和其它座位的「1筒」高度相似 => ASR 判错，文件正常。
  · 座位0 的「5万」：ASR 说「5外」、Omni 说「喂」，且**有声段只有 0.14s**
    （其它座位 0.4s）=> 两个独立信号 + 声学异常，三重印证，是真坏件。
  单看任何一层都会误判。

用法：
    python audio_eval.py <目录或文件> [--per-cat N] [--json out.json] [--no-omni]
    python audio_eval.py <目录> --only 1筒,5万
    python audio_eval.py <目录> --no-omni          # 只跑声学+ASR（离线、免费）
"""

import argparse
import base64
import json
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

# ── 阈值（都在本项目实测校准过，别凭直觉改）─────────────────────────
TH = {
    "min_dur": 0.12,        # 短于此基本是废件
    "silence_db": -60.0,    # 峰值低于此 = 全静音
    "clip_db": -0.5,        # 峰值高于此 = 可能削波
    "weak_db": -24.0,       # 峰值低于此 = 太轻
    "lead_sil_max": 0.15,   # 前导静音超过此秒数 = 启动会"慢半拍"
    "voiced_ratio_min": 0.15,   # 有声段占全长比例下限（实测正当值可低至 6%，故只报警不判死）
}
# 舞台提示词泄漏的特征词（本项目实测 cixingnansheng 会念出括号里的提示）
PROMPT_LEAK = ["报牌", "爆牌", "利落", "语速", "偏快", "平静地", "短促",
               "得意", "急促", "高兴地", "平淡地", "放松地", "兴奋地"]

TILES_PY = {
    **{f"{n}万": f"{NUM}wan" for n, NUM in zip("123456789",
      ["yi", "er", "san", "si", "wu", "liu", "qi", "ba", "jiu"])},
    **{f"{n}条": f"{NUM}tiao" for n, NUM in zip("123456789",
      ["yi", "er", "san", "si", "wu", "liu", "qi", "ba", "jiu"])},
    **{f"{n}筒": f"{NUM}tong" for n, NUM in zip("123456789",
      ["yi", "er", "san", "si", "wu", "liu", "qi", "ba", "jiu"])},
    "东": "dong", "南": "nan", "西": "xi", "北": "bei", "中": "zhong",
    "发": "fa", "白": "bai", "碰": "peng", "杠": "gang", "胡": "hu",
    "自摸": "zimo", "抢杠": "qianggang", "杠开": "gangkai", "听": "ting",
    "过": "guo", "流局": "liuju",
}


# ══════════════════════════════════════════════════════════════════════
# 第 1 层：声学（可定论）
# ══════════════════════════════════════════════════════════════════════
def layer_acoustic(path):
    x, err = P.decode(path)
    if x is None or x.size == 0:
        return {"ok": False, "fatal": f"解码失败/空文件: {err}"}
    total = x.size / P.SR
    peak = float(np.max(np.abs(x)))
    peak_db = 20 * np.log10(max(peak, 1e-12))
    rms_db = 20 * np.log10(max(float(np.sqrt(np.mean(x.astype(np.float64) ** 2))), 1e-12))
    a, b = P.content_bounds(x, rel_db=42.0, gap_tol_s=0.15)
    voiced = (b - a) / P.SR
    lead = a / P.SR
    tail = total - b / P.SR

    problems, warns = [], []
    if peak_db < TH["silence_db"]:
        problems.append(f"全静音（峰值 {peak_db:.1f}dB）")
    if peak_db > TH["clip_db"]:
        warns.append(f"峰值 {peak_db:.1f}dB 接近满刻度，可能削波")
    if total < TH["min_dur"]:
        problems.append(f"过短（{total:.2f}s）")
    if peak_db < TH["weak_db"] and peak_db >= TH["silence_db"]:
        warns.append(f"过轻（峰值 {peak_db:.1f}dB）")
    if lead > TH["lead_sil_max"]:
        warns.append(f"前导静音 {lead:.2f}s，起手会慢半拍")
    if voiced > 0 and voiced / total < TH["voiced_ratio_min"]:
        warns.append(f"有声段仅占 {voiced/total*100:.0f}%")
    # 尾部硬切：末 100ms 分 5 段，能量不降反平 => 衰减被切断
    n = int(P.SR * 0.1)
    if x.size >= n * 2:
        segs = np.array_split(x[-n:], 5)
        es = [float(np.sqrt(np.mean(s.astype(np.float64) ** 2))) for s in segs]
        if es[0] > 1e-6 and es[-1] / es[0] > 0.85:
            warns.append("尾部能量不衰减，疑似硬切（会有『啪』声）")

    return {
        "ok": not problems, "total": round(total, 3), "voiced": round(voiced, 3),
        "lead_sil": round(lead, 3), "tail_sil": round(tail, 3),
        "peak_db": round(peak_db, 1), "rms_db": round(rms_db, 1),
        "problems": problems, "warns": warns,
    }


# ══════════════════════════════════════════════════════════════════════
# 第 1b 层：音色质感（mel 频带平坦度）—— 判「物理音 vs 合成提示音」
#
# ⚠ 这一层是踩了两次坑才做对的，实现细节别动：
#   v1 直接用 rfft 功率谱算 geometric_mean/arithmetic_mean，结果**真实录音**
#      （实拍视频音轨，必然含噪声）算出 0.0000 —— 物理上不可能，且加数值下限也救不回。
#      根因：**rfft 的 bin 数随信号长度/采样率变化**，48kHz 的成品与 16kHz 的对照
#      不可比。基于它的「65 条音效全是合成音」结论是错的，已作废。
#   v2（现在这版）先聚合成**固定 26 个 mel 频带**再算平坦度，与人耳一致、跨文件可比，
#      并在 dB 域求均值稳住数值。用合成基准校准过：
#          纯正弦 −71 · 白噪声 −5.4 · 粉红噪声 −37.8 · 真实录音 −11~−20
#
# 判据不能一刀切：文件名已经说明了它**应该**是什么类型 ——
#   碰撞/摩擦类（clack/dice/shuffle/type…）期望噪声型；
#   提示/结算类（click/win/toast…）音调型是合理甚至更好的。
#   所以只有「期望物理音却做成纯音」才算问题。
# ══════════════════════════════════════════════════════════════════════
PHYSICAL_HINTS = [
    "clack", "dice", "shuffle", "buildwall", "deal", "draw", "discard", "chip",
    "sizzle", "flip", "plate", "trash", "type", "scratch", "mash", "hit",
    "block", "whiff", "hurt", "graze", "serve", "card", "rotate",
]
TONAL_OK_HINTS = [
    "click", "close", "open", "toast", "gain", "loss", "win", "lose", "ready",
    "right", "wrong", "tick", "cue", "fail", "ok", "achv", "save", "tab",
    "hover", "settle", "buy", "sell", "up", "down", "none", "end", "perfect",
]
N_BANDS, F_LO, F_HI = 26, 20.0, 8000.0


def _mel_bands(x, sr):
    nfft = 2048
    if x.size < nfft:
        x = np.pad(x, (0, nfft - x.size))
    hop = nfft // 2
    nfr = max(1, 1 + (x.size - nfft) // hop)
    frames = np.stack([x[i * hop:i * hop + nfft] for i in range(nfr)])
    S = (np.abs(np.fft.rfft(frames * np.hanning(nfft), nfft)) ** 2).mean(axis=0)

    def hz2mel(f):
        return 2595.0 * np.log10(1.0 + f / 700.0)

    def mel2hz(m):
        return 700.0 * (10 ** (m / 2595.0) - 1.0)

    pts = mel2hz(np.linspace(hz2mel(F_LO), hz2mel(min(F_HI, sr / 2.0 - 1)), N_BANDS + 2))
    bins = np.floor((nfft + 1) * pts / sr).astype(int)
    fb = np.zeros((N_BANDS, nfft // 2 + 1))
    for i in range(1, N_BANDS + 1):
        a = bins[i - 1]
        b = max(bins[i], a + 1)
        c = max(bins[i + 1], b + 1)
        for k in range(a, min(b, fb.shape[1])):
            fb[i - 1, k] = (k - a) / (b - a)
        for k in range(b, min(c, fb.shape[1])):
            fb[i - 1, k] = (c - k) / (c - b)
    return S @ fb.T


def timbre_flatness_db(x, sr):
    """mel 频带平坦度（dB 域）。0 = 完全平坦（噪声）；越负越"纯音"。"""
    e = _mel_bands(x, sr)
    e = np.maximum(e, e.max() * 1e-8 + 1e-30)
    db = 10 * np.log10(e)
    return float(db.mean() - db.max())


def layer_timbre(path, name):
    x, err = P.decode(path)
    if x is None or x.size == 0:
        return {}
    a, b = P.content_bounds(x, rel_db=42.0, gap_tol_s=0.15)
    seg = x[a:b] if b > a else x
    if seg.size < 256:
        return {}
    fd = timbre_flatness_db(seg, P.SR)
    s = seg - seg.mean()
    r = np.correlate(s, s, mode="full")[s.size - 1:]
    r = r / r[0] if r[0] > 0 else r
    lo, hi = int(0.002 * P.SR), min(int(0.015 * P.SR), r.size - 1)
    ac = float(np.max(r[lo:hi])) if hi > lo else 0.0
    typ = "噪声型" if fd > -12 else ("音调型" if fd < -25 else "混合")
    n = name.lower()
    want = ("期望物理音" if any(h in n for h in PHYSICAL_HINTS)
            else ("音调合理" if any(h in n for h in TONAL_OK_HINTS) else "未分类"))
    out = {"flat_db": round(fd, 2), "ac": round(ac, 3), "timbre": typ, "expect": want}
    # 只有「期望物理音」才有对错可言；提示音做成乐音是对的
    if want == "期望物理音" and typ == "音调型":
        out["verdict"] = "bad"
        out["note"] = (f"期望物理音（噪声型），实测是纯音（flat_db={fd:.1f}、"
                       f"基频自相关={ac:.2f}）—— 听感是电子提示音而非真实撞击/摩擦声")
    else:
        out["verdict"] = "ok"
    return out


# ══════════════════════════════════════════════════════════════════════
# 第 2 层：内容（ASR，部分可定论）
# ══════════════════════════════════════════════════════════════════════
_asr_rec = None


def _asr(path):
    global _asr_rec
    if _asr_rec is None:
        import sherpa_onnx
        _asr_rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=os.path.join(PA.ASR_MODEL, "model.int8.onnx"),
            tokens=os.path.join(PA.ASR_MODEL, "tokens.txt"),
            use_itn=True, language="zh", num_threads=4)
    tmp = os.path.join(os.environ.get("TEMP", "."), "_ae.wav")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path, "-ar", "16000",
                    "-ac", "1", tmp], capture_output=True)
    with wave.open(tmp, "rb") as w:
        d = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    s = _asr_rec.create_stream()
    s.accept_waveform(16000, d.astype(np.float32) / 32768.0)
    _asr_rec.decode_stream(s)
    return s.result.text.strip()


def _norm_txt(s):
    t = re.sub(r"[^\u4e00-\u9fff0-9]", "", s or "")
    for cn, ar in [("一", "1"), ("二", "2"), ("两", "2"), ("三", "3"), ("四", "4"),
                   ("五", "5"), ("六", "6"), ("七", "7"), ("八", "8"), ("九", "9")]:
        t = t.replace(cn, ar)
    return t


def _to_py(text):
    from pypinyin import lazy_pinyin
    num = {"1": "yi", "2": "er", "3": "san", "4": "si", "5": "wu",
           "6": "liu", "7": "qi", "8": "ba", "9": "jiu"}
    t = _norm_txt(text)
    return "".join(lazy_pinyin("".join(num.get(c, c) for c in t)))


def layer_content(path, expect_word=None):
    """expect_word 给了就做同音比对（牌名场景）；没给就只报告转写结果。"""
    txt = _asr(path)
    leak = [k for k in PROMPT_LEAK if k in (txt or "")]
    out = {"asr": txt, "leak": leak}
    if not _norm_txt(txt):
        out["verdict"] = "empty"
        out["note"] = "ASR 无输出（音效/音乐属正常；若期望是人声则是问题）"
        return out
    if leak:
        out["verdict"] = "leak"
        out["note"] = f"念出了舞台提示词（{[*leak]}）而不是内容"
        return out
    if expect_word:
        exp = TILES_PY.get(expect_word)
        if exp:
            if exp in _to_py(txt):
                out["verdict"] = "ok"
            else:
                # 同音字误写不算错（桶/筒、挑/条…），交给声学层 + 人耳复核
                out["verdict"] = "mismatch"
                out["note"] = f"期望读作 {exp}，ASR 转写 {_to_py(txt)}（同音字属正常，需复核）"
            return out
    out["verdict"] = "text-only"
    return out


# ══════════════════════════════════════════════════════════════════════
# 第 3 层：感知（Omni —— 只提线索，不下结论）
# ══════════════════════════════════════════════════════════════════════
OMNI_PROMPT = (
    "请判断这段音频里**实际**有什么。只回答 JSON，不要多余文字：\n"
    '{"类别":"静音/语音/音效/音乐/环境音 之一'
    '（若几乎听不到任何声音，必须选「静音」，不要猜测或补充并不存在的内容）",'
    '"内容":"只描述你确实听到的；若为静音就写 无",'
    '"情绪":"氛围或情绪，没有就空串",'
    '"空间感":"干/有混响/空旷 之一",'
    '"语速":"慢/适中/偏快/不适用 之一",'
    '"清晰度":"清晰/略糊/听不清/不适用 之一",'
    '"人声":"有/无",'
    '"异常":"任何不正常的地方（如混入提示词、念错、多段拼接、明显噪声、中断），没有就空串"}'
)


def omni_available():
    return bool((os.environ.get("DASHSCOPE_API_KEY") or "").strip())


def layer_omni(path, model="qwen3.8-omni-flash"):
    """返回 (结果dict, usage)。任何失败都降级为 {'error': ...}，不让评估整体失败。"""
    try:
        from openai import OpenAI
    except ImportError:
        return {"error": "未安装 openai SDK"}, None
    url = (os.environ.get("DASHSCOPE_BASE_URL") or "").strip() \
        or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    mp3 = path
    if not path.lower().endswith(".mp3"):
        tmp = os.path.join(os.environ.get("TEMP", "."), "_ae.mp3")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path, "-ac", "1",
                        "-ar", "24000", "-b:a", "64k", tmp], capture_output=True)
        mp3 = tmp
    size = os.path.getsize(mp3)
    if size * 1.34 > 10 * 1024 * 1024:
        return {"error": f"base64 后超 10MB 上限（{size/1e6:.1f}MB）"}, None
    b64 = base64.b64encode(open(mp3, "rb").read()).decode("ascii")
    try:
        c = OpenAI(api_key=os.environ["DASHSCOPE_API_KEY"], base_url=url)
        r = c.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": [
                {"type": "input_audio",
                 "input_audio": {"data": f"data:audio/mpeg;base64,{b64}", "format": "mp3"}},
                {"type": "text", "text": OMNI_PROMPT}]}],
            modalities=["text"], reasoning_effort="low", stream=False, timeout=180)
        txt = (r.choices[0].message.content or "").strip()
        m = re.search(r"\{.*\}", txt, re.S)
        d = json.loads(m.group(0)) if m else {"raw": txt}
        u = getattr(r, "usage", None)
        return d, ({"in": getattr(u, "prompt_tokens", None),
                    "out": getattr(u, "completion_tokens", None)} if u else None)
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:160]}"}, None


# ══════════════════════════════════════════════════════════════════════
# 融合裁决
# ══════════════════════════════════════════════════════════════════════
def fuse(ac, tb, ct, om, expect_word=None, expect_cat=None):
    """把各层结论合成一个裁决。

    设计原则：**声学/音色/内容能否决，感知层只能提示**。
      · 声学硬问题（全静音/过短/解码失败）        → FAIL
      · 音色层：期望物理音却做成纯音              → FAIL（这是确定的质量缺陷）
      · 内容层发现提示泄漏                        → FAIL（确定的功能性错误）
      · 感知层说异常，但前面几层都没问题           → SUSPECT，交人耳（模型可能幻觉）
      · 感知层说「静音」但声学显示有信号           → 以声学为准，标注模型幻觉
    """
    if ac.get("fatal"):
        return "FAIL", [f"声学：{ac['fatal']}"]
    if ac.get("problems"):
        return "FAIL", [f"声学：{p}" for p in ac["problems"]]
    if tb and tb.get("verdict") == "bad":
        return "FAIL", [f"音色：{tb['note']}"]
    if ct and ct.get("verdict") == "leak":
        return "FAIL", [f"内容：{ct['note']}"]

    suspect = []
    if ct and ct.get("verdict") == "mismatch":
        suspect.append(f"内容：{ct['note']}")
    if om and not om.get("error"):
        cat = str(om.get("类别", "")).strip()
        abn = str(om.get("异常", "")).strip()
        if cat == "静音" and ac.get("peak_db", -99) > TH["silence_db"]:
            suspect.append(f"感知层误报静音（声学峰值 {ac['peak_db']}dB），以声学为准")
        elif expect_cat and cat and cat not in expect_cat:
            suspect.append(f"感知：类别判为「{cat}」，预期 {expect_cat}")
        if abn:
            suspect.append(f"感知：异常『{abn}』")
    elif om and om.get("error"):
        suspect.append(f"感知层不可用（{om['error']}）")

    if suspect:
        return "SUSPECT", suspect
    return "PASS", []


# ══════════════════════════════════════════════════════════════════════
def eval_one(path, name, do_omni, expect_word=None, expect_cat=None, model="qwen3.8-omni-flash"):
    ac = layer_acoustic(path)
    tb = layer_timbre(path, name)
    ct = layer_content(path, expect_word)
    om, usage = (layer_omni(path, model) if do_omni else ({}, None))
    verdict, reasons = fuse(ac, tb, ct, om, expect_word, expect_cat)
    return {"file": name, "verdict": verdict, "reasons": reasons,
            "acoustic": ac, "timbre": tb, "content": ct, "omni": om, "omni_usage": usage}


def guess_expect(name):
    """按文件名猜期望（牌名场景）：返回 (期望词, 期望类别集合)。"""
    stem = os.path.splitext(os.path.basename(name))[0]
    if stem in TILES_PY:
        return stem, {"语音"}
    return None, None


def guess_cat(dirname):
    return {"sfx": {"音效", "环境音"}, "amb": {"环境音", "音效"},
            "bgm": {"音乐"}, "vo_real": {"语音"}, "mj": {"语音"},
            "seat1": {"语音"}, "seat2": {"语音"}, "seat3": {"语音"}}.get(dirname)


def collect(target, only=None, per_cat=None):
    """收集待评文件 → [(path, name, expect_word, expect_cat)]"""
    if os.path.isfile(target):
        w, c = guess_expect(target)
        return [(target, os.path.basename(target), w, c)]
    out = []
    base = os.path.basename(os.path.normpath(target))
    for root, _dirs, files in os.walk(target):
        mp3s = sorted(f for f in files if f.lower().endswith(".mp3"))
        if only:
            mp3s = [f for f in mp3s if os.path.splitext(f)[0] in only]
        if per_cat:
            mp3s = mp3s[:per_cat]
        for f in mp3s:
            p = os.path.join(root, f)
            w, c = guess_expect(f)
            # 类别按文件所在目录名猜（mj/seat1 → 语音）
            d = os.path.basename(root)
            out.append((p, os.path.relpath(p, target), w, guess_cat(d) or guess_cat(base) or c))
    return out


def audit_sfx(args):
    """全量音色审计：对所有音效做「文件名语义 × 实测音色」交叉判断。

    为什么不一刀切说「音调型就是坏」：文件名已经说明了它**应该**是什么 ——
      碰撞/摩擦类（clack/dice/shuffle/type…）期望噪声型；
      提示/结算类（click/win/toast/gain…）音调型是合理甚至更好的。
    所以只有「期望物理音却做成纯音」才算问题。
    """
    d = PA.DIR_SFX
    if not os.path.isdir(d):
        print(f"找不到音效目录：{d}")
        return 1
    rows = []
    for f in sorted(os.listdir(d)):
        if not f.lower().endswith(".mp3"):
            continue
        r = layer_timbre(os.path.join(d, f), f)
        if r:
            rows.append((f[:-4], r))
    print("=" * 94)
    print("音效音色审计（mel 平坦度：>-12 噪声型 / <-25 音调型 / 中间混合）")
    print("=" * 94)
    print(f"{'文件':<28}{'期望':<11}{'实测':<9}{'flat_db':>9}{'ac':>7}  判定")
    print("-" * 94)
    bad, mixed, good = [], [], []
    for n, r in rows:
        v = "✘ 需重做" if r["verdict"] == "bad" else ""
        print(f"{n:<28}{r['expect']:<11}{r['timbre']:<9}{r['flat_db']:>9.2f}"
              f"{r['ac']:>7.3f}  {v}")
        if r["verdict"] == "bad":
            bad.append((n, r))
        elif r["expect"] == "期望物理音" and r["timbre"] == "混合":
            mixed.append((n, r))
        elif r["expect"] == "期望物理音":
            good.append((n, r))

    print("-" * 94)
    print(f"★★ 本该是物理音、实测却是纯音：{len(bad)} 条" + ("（需重做）" if bad else " ✔"))
    for n, r in bad:
        print(f"   {n:<28} flat_db={r['flat_db']:>7.2f}  ac={r['ac']:.3f}")
        print(f"      {r['note']}")
    print(f"\n△ 期望物理音但质感偏薄（混合）：{len(mixed)} 条")
    for n, r in mixed:
        print(f"   {n:<28} flat_db={r['flat_db']:>7.2f}")
    print(f"\n✔ 期望物理音且确实是噪声型：{len(good)} 条")
    for n, r in good:
        print(f"   {n:<28} flat_db={r['flat_db']:>7.2f}")
    if bad:
        print(f"\n重做用：python tools\\audio\\regen_sfx_noise.py"
              f"（物理音效的提示词要写「不要音调、不要音乐感」，见该脚本注释）")
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser(description="音频素材评估器（声学 + 音色 + 内容 + 感知）")
    ap.add_argument("target", nargs="?", help="目录或单个文件")
    ap.add_argument("--audit-sfx", action="store_true",
                    help="全量音色审计：找出「本该是物理音却做成了纯音」的音效")
    ap.add_argument("--only", help="只评指定文件名（逗号分隔，不带扩展名）")
    ap.add_argument("--per-cat", type=int, help="目录模式下每层最多评几个")
    ap.add_argument("--no-omni", action="store_true", help="跳过感知层（离线免费）")
    ap.add_argument("--model", default="qwen3.8-omni-flash")
    ap.add_argument("--json", help="把完整结果写到这个 JSON")
    ap.add_argument("--quiet", action="store_true", help="只打印汇总")
    args = ap.parse_args()

    if args.audit_sfx:
        return audit_sfx(args)

    if not args.target:
        ap.print_help()
        return 1

    do_omni = not args.no_omni
    if do_omni and not omni_available():
        print("⚠ 未设置 DASHSCOPE_API_KEY，自动跳过感知层（等价于 --no-omni）\n")
        do_omni = False

    only = {x.strip() for x in args.only.split(",")} if args.only else None
    items = collect(args.target, only, args.per_cat)
    if not items:
        print("没有找到 mp3")
        return 1

    print("=" * 96)
    print(f"音频评估：{len(items)} 条 · 感知层{'开' if do_omni else '关'}")
    print("=" * 96)
    results, tok_in, tok_out = [], 0, 0
    for i, (p, name, ew, ec) in enumerate(items, 1):
        r = eval_one(p, name, do_omni, ew, ec, args.model)
        results.append(r)
        if r.get("omni_usage"):
            tok_in += r["omni_usage"].get("in") or 0
            tok_out += r["omni_usage"].get("out") or 0
        if not args.quiet:
            mark = {"PASS": "✔", "SUSPECT": "?", "FAIL": "✘"}[r["verdict"]]
            ac = r["acoustic"]
            tb = r.get("timbre") or {}
            print(f"[{i}/{len(items)}] {mark} {name}")
            print(f"      {ac.get('total','?')}s 有声{ac.get('voiced','?')}s "
                  f"峰值{ac.get('peak_db','?')}dB"
                  + (f" · 音色 {tb.get('timbre','')}({tb.get('flat_db','')})" if tb else ""))
            if r["content"].get("asr"):
                print(f"      ASR: {r['content']['asr']}")
            om = r["omni"]
            if om and not om.get("error"):
                print(f"      感知: {om.get('类别','?')} / {om.get('内容','') or '—'}")
                print(f"            情绪 {om.get('情绪','') or '—'} · 语速 {om.get('语速','?')}"
                      f" · 清晰 {om.get('清晰度','?')} · 空间 {om.get('空间感','?')}")
            for rs in r["reasons"]:
                print(f"      ⚠ {rs}")

    print("\n" + "=" * 96)
    n = {"PASS": 0, "SUSPECT": 0, "FAIL": 0}
    for r in results:
        n[r["verdict"]] += 1
    print(f"汇总：通过 {n['PASS']} · 需人耳 {n['SUSPECT']} · 失败 {n['FAIL']}")
    if do_omni:
        # 粗略成本参考（按 text 单价折算，仅示意量级）
        print(f"感知层 token：输入 {tok_in} · 输出 {tok_out}")
    if n["FAIL"]:
        print("\n【失败 —— 必须重做】")
        for r in results:
            if r["verdict"] == "FAIL":
                print(f"  {r['file']}")
                for rs in r["reasons"]:
                    print(f"     {rs}")
    if n["SUSPECT"]:
        print("\n【需人耳 —— 自动判定不了，别当成品交付】")
        for r in results:
            if r["verdict"] == "SUSPECT":
                print(f"  {r['file']}")
                for rs in r["reasons"]:
                    print(f"     {rs}")
    if n["PASS"] == len(results):
        print("\n全部通过（声学与内容层无问题，感知层无异常提示）。")
    print("=" * 96)

    if args.json:
        os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"target": args.target, "omni": do_omni,
                       "summary": n, "results": results}, f, ensure_ascii=False, indent=1)
        print(f"完整结果：{args.json}")
    return 1 if n["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
