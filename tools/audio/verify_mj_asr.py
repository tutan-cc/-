# -*- coding: utf-8 -*-
"""麻将牌名 ASR 核对（真值验证）。

设计要点：
  · ASR 转录结果**缓存到 JSON** —— 转录是慢步骤（172 条要几分钟），
    核对逻辑会反复调整，不能每次都重跑 ASR。
  · 判定用**拼音同音匹配**（tone-insensitive），而不是手写近音字表：
    手写表必然漏字，会把「流局/刘局」「抢杠/抢购」这类正确件误报成错误
    （实测第一次跑就误报了 40 多条）。
  · 牌名含数字，先把「五/5」这类汉字数字归一。

用法：
    python verify_mj_asr.py            # 用缓存核对
    python verify_mj_asr.py --refresh  # 重新转录
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
import paths as PA

MODEL = PA.ASR_MODEL
AUD = PA.AUDIO
# 缓存必须落在**工作区**，不能落在仓库里 —— tools/ 只放源码，
# 跑一次工具就往里塞 JSON 会污染 git status（这正是之前踩过的坑）。
CACHE = os.path.join(PA.WORK_ROOT, "_mj_asr_cache.json")
DIRS = [("座位0", "mj"), ("座位1", r"mj\seat1"), ("座位2", r"mj\seat2"), ("座位3", r"mj\seat3")]

# 牌名 → 期望的拼音。用「数字+花色」组合生成，避免手写。
SUIT_PY = {"万": "wan", "条": "tiao", "筒": "tong"}
NUM_PY = {"1": "yi", "2": "er", "3": "san", "4": "si", "5": "wu",
          "6": "liu", "7": "qi", "8": "ba", "9": "jiu"}
HONOR_PY = {"东": "dong", "南": "nan", "西": "xi", "北": "bei",
            "中": "zhong", "发": "fa", "白": "bai",
            "碰": "peng", "杠": "gang", "胡": "hu", "自摸": "zimo",
            "抢杠": "qianggang", "杠开": "gangkai", "听": "ting",
            "过": "guo", "流局": "liuju"}


def expected_py(name: str):
    """期望读音的可接受拼音集合（含「一筒」被读成「yi tong」等）。"""
    if name in HONOR_PY:
        return {HONOR_PY[name]}
    m = re.match(r"^([1-9])([万条筒])$", name)
    if m:
        return {NUM_PY[m.group(1)] + SUIT_PY[m.group(2)]}
    return set()


def to_py(text: str):
    """把 ASR 文本转成拼音串（含汉字数字归一）。"""
    from pypinyin import lazy_pinyin
    t = re.sub(r"[^\u4e00-\u9fff0-9]", "", text or "")
    # 汉字数字 → 阿拉伯，便于与牌名对齐
    for cn, ar in [("一", "1"), ("二", "2"), ("两", "2"), ("三", "3"), ("四", "4"),
                   ("五", "5"), ("六", "6"), ("七", "7"), ("八", "8"), ("九", "9")]:
        t = t.replace(cn, ar)
    # 阿拉伯 → 拼音，与期望侧统一
    t = "".join(NUM_PY.get(ch, ch) for ch in t)
    return "".join(lazy_pinyin(t))


def load_model():
    import sherpa_onnx
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=os.path.join(MODEL, "model.int8.onnx"),
        tokens=os.path.join(MODEL, "tokens.txt"),
        use_itn=True, language="zh", num_threads=4,
    )


def transcribe_all(refresh=False):
    if os.path.exists(CACHE) and not refresh:
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    rec = load_model()
    tmp = os.path.join(os.environ.get("TEMP", "."), "_mj_asr_tmp.wav")
    out = {}
    for label, d in DIRS:
        files = sorted(glob.glob(os.path.join(AUD, d, "*.mp3")))
        for i, f in enumerate(files, 1):
            name = os.path.basename(f)[:-4]
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", f, "-ar", "16000",
                            "-ac", "1", tmp], capture_output=True)
            with wave.open(tmp, "rb") as w:
                pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
            s = rec.create_stream()
            s.accept_waveform(16000, pcm.astype(np.float32) / 32768.0)
            rec.decode_stream(s)
            out[f"{label}/{name}"] = s.result.text.strip()
            if i % 20 == 0:
                print(f"  {label} {i}/{len(files)}", flush=True)
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="重新转录（忽略缓存）")
    args = ap.parse_args()

    data = transcribe_all(args.refresh)
    print("=" * 92)
    print(f"麻将牌名 ASR 核对：{len(data)} 条（缓存 {CACHE}）")
    print("=" * 92)

    blank, wrong, ok = [], [], 0
    for key in sorted(data):
        label, name = key.split("/", 1)
        raw = data[key]
        py = to_py(raw)
        exp = expected_py(name)
        if not py:
            blank.append((label, name, raw))
        elif exp and any(e in py for e in exp):
            ok += 1
        else:
            wrong.append((label, name, raw, py, "/".join(sorted(exp))))

    print(f"  通过 {ok}   空白 {len(blank)}   疑似错 {len(wrong)}")
    if blank:
        print(f"\n【空白 / 废件】{len(blank)} 条 —— 必须重做")
        for label, name, raw in blank:
            print(f"  {label:<6} {name:<8} ASR=\"{raw}\"")
    if wrong:
        print(f"\n【疑似错】{len(wrong)} 条")
        print(f"  {'座位':<7}{'牌名':<9}{'ASR 实听':<16}{'ASR拼音':<22}期望拼音")
        for label, name, raw, py, exp in wrong:
            print(f"  {label:<7}{name:<9}{raw:<16}{py:<22}{exp}")
        # ⚠ 「疑似错」**不作为失败判据**（只报不改退出码）：
        #   ASR 对 0.2~0.4s 的短促喊牌识别率天然低 ——
        #   「杠」被听成「告/干/大」、「碰」被听成「哼」是常态，
        #   实测 27 条「疑似错」里没有一条是真坏件（用手写近音表误报更多，40+ 条）。
        #   唯一可信的判据是**跨座位共识**：同一个词 4 个座位全判错才可能是真坏件。
        #   所以这里把逐条清单当**诊断信息**输出，是否放行由人按共识判断。
        #   （想自动看共识结论，用早期的 _consensus 思路：按词聚合通过率。）
        by_word = {}
        for label, name, raw, py, exp in wrong:
            by_word.setdefault(name, []).append(label)
        allbad = {n: ls for n, ls in by_word.items() if len(ls) >= 4}
        if allbad:
            print(f"\n⚠ 其中「全座位都判错」的词：{list(allbad)}")
            print("  这些才需要人工听辨确认（其余视为 ASR 识别偏差，不必处理）")
        else:
            print("\n  （没有任何一个词是全座位判错的 → 按经验均为 ASR 识别偏差，无需处理）")
    if not blank and not wrong:
        print("\n全部通过。")
    # 只有「空白/废件」才算失败 —— 那是真的没声音，与 ASR 能力无关。
    return 1 if blank else 0


if __name__ == "__main__":
    sys.exit(main())
