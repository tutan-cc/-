#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_audio_content.py — 用 ASR 转录音频并与期望文字比对，确认内容真的对

为什么需要：生成 API 返回成功、文件也落盘，但**内容可能是错的**。
声学指标（时长/响度）抓不出「说的是不是这句话」。

两个 ASR 后端：
  默认  本地 SenseVoice（离线免费，输出阿拉伯数字）
  --cloud StepFun transcriptions（0.15 元/小时，输出汉字数字，略准）
         需要环境变量 STEP_API_KEY

判定四类：
  OK        转录命中期望（含同音字、数字写法差异）
  PARTIAL   包含期望的一部分（多字/漏字）
  MISMATCH  对不上
  NOSPEECH  转录为空（音效条正常，人声条异常）

两种模式：
  默认      把文件名当期望文字（适合「文件名=触发词」的音效，如麻将牌名）
  --jobs F  用 JSON 任务表里的 reading 字段当期望（适合配音，文件名是 voKey）

用法：
  python verify_audio_content.py "目录"
  python verify_audio_content.py "目录" --jobs vo_jobs.json --cloud
  python verify_audio_content.py "目录" --sound-only 暗杠,补杠
"""

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asr_local import build_recognizer, find_model, transcribe, transcribe_cloud  # noqa: E402

# 本该是音效、不含人声的条目（麻将里这两个是手上动作，不喊）
DEFAULT_SOUND_ONLY = {"暗杠", "补杠"}

# ── 归一化 ──────────────────────────────────────────────────────────
_CN_NUM = {"0": "零", "1": "一", "2": "二", "3": "三", "4": "四", "5": "五",
           "6": "六", "7": "七", "8": "八", "9": "九"}


def _digits_to_cn(s: str) -> str:
    """阿拉伯数字 → 汉字（逐位转换，够用于比对）。"""
    return "".join(_CN_NUM.get(c, c) for c in s)


# ── 同音判定：用拼音（忽略声调），而不是手写同音字表 ──────────────────
# 手写表很快就漏（她/他、的/得、牌/排、脚/角、阮/软、握/卧…），改用 pypinyin。
# 忽略声调是刻意的：pypinyin 对轻声（的/得）标注不一致，且声调差异本就听不出来，
# 用严格声调会大量误报。代价是极少数「声调不同但拼音相同」的真错会漏过 —— 可接受。
try:
    from pypinyin import lazy_pinyin as _py  # type: ignore
    _HAS_PYPINYIN = True
except Exception:  # 没装就退化为「严格相等」
    _HAS_PYPINYIN = False


def _py_of(ch: str) -> str:
    if not _HAS_PYPINYIN:
        return ch
    try:
        r = _py(ch)
        return r[0] if r else ch
    except Exception:
        return ch


def same_sound(a: str, b: str) -> bool:
    """同音判定：相同，或拼音（忽略声调）相同。非汉字退化为严格相等。"""
    if a == b:
        return True
    if not ("\u4e00" <= a <= "\u9fff" and "\u4e00" <= b <= "\u9fff"):
        return False
    return _py_of(a) == _py_of(b)


def readings_equal(e: str, g: str) -> bool:
    """逐字比较，同音算相等。长度不同直接不等。"""
    if len(e) != len(g):
        return False
    return all(same_sound(x, y) for x, y in zip(e, g))


def _cn_to_digits(s: str) -> str:
    """中文数词 → 阿拉伯数字。处理「十一」这类，让「十一点」与「11点」可比。

    只处理 0-99 的常见读法，够用于台词比对。
    """
    d = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
         "六": 6, "七": 7, "八": 8, "九": 9}
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == "十":
            # 十 / 十一 / 二十 / 二十三
            prev = out[-1] if out and out[-1].isdigit() else None
            if prev:                      # 二十X
                out[-1] = str(int(prev) * 10)
                if i + 1 < len(s) and s[i + 1] in d:
                    out[-1] = str(int(out[-1]) + d[s[i + 1]]); i += 1
            else:                         # 十 / 十一
                v = 10
                if i + 1 < len(s) and s[i + 1] in d:
                    v += d[s[i + 1]]; i += 1
                out.append(str(v))
            i += 1
            continue
        if c in d:
            # 连续汉字数字（如 二零二五）逐位；单个也逐位（后续可被十修正）
            out.append(str(d[c]))
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _strip_direction(s: str) -> str:
    """去掉 () / （） 包裹的表演指示 —— 它们本来就不该被念出来。

    注意只去**成对括号内**的内容；台词里正常的「」引号要保留判断。
    """
    s = re.sub(r"[（(][^）)]*[）)]", "", s)
    return s


def _fill_noise(s: str) -> str:
    """去掉 ASR 常见的语气词/口水音标记，它们不代表读错。"""
    for ch in "呃嗯啊哦哎诶":
        s = s.replace(ch, "")
    return s


def normalize(s: str, strip_direction: bool = True) -> str:
    """比对前的归一化：去表演指示 → 去语气词 → 中文数词转数字 → 只留字与数字。"""
    if strip_direction:
        s = _strip_direction(s)
    s = _fill_noise(s)
    s = _cn_to_digits(s)
    return "".join(ch for ch in s if ch.isalnum() or "\u4e00" <= ch <= "\u9fff")



def classify(expected: str, got: str, sound_only: bool):
    """判定结果分三类。

    ⚠ 关键：**逐字对不上 ≠ 生成错了**。ASR 在含混语音上会产生幻觉
      （例如把「报酬」听成「我也找」），逐字对不上但音频可能是对的。
      所以对不上的标为 **UNCERTAIN（需人耳确认）**，而不是判定为错误 —— 不夸大结论。
    """
    # 期望文本先剥掉表演指示（() 内容本就不该被念）
    e_raw = _strip_direction(expected)
    e, g = normalize(e_raw), normalize(got, strip_direction=False)
    if sound_only:
        return ("OK", "音效条无人声（符合预期）") if not g else \
               ("UNCERTAIN", f"预期无人声，却转录出「{got}」")
    if not g:
        return "UNCERTAIN", "转录为空：可能没生成出人声，也可能 ASR 没抓到"
    if e == g:
        return "OK", ""
    if readings_equal(e, g):
        return "OK", f"同音（{g}），读音正确"
    if e and e in g:
        return "OK", "期望被完整包含在转录里（多出的是 ASR 增字）"
    if g and g in e:
        return "UNCERTAIN", f"只识别出「{g[:26]}」，期望更长（可能漏字，也可能 ASR 截断）"
    cov = len(set(g) & set(e)) / max(1, len(set(e)))
    return "UNCERTAIN", f"逐字对不上（字集重合 {cov:.0%}）；实得「{g[:30]}」"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--jobs", help="JSON 任务表（用 reading 当期望文字）")
    ap.add_argument("--cloud", action="store_true", help="用 StepFun 云 ASR（需 STEP_API_KEY）")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--sound-only", default=",".join(DEFAULT_SOUND_ONLY))
    ap.add_argument("--threads", type=int, default=2)
    args = ap.parse_args()

    sound_only = {x.strip() for x in args.sound_only.split(",") if x.strip()}

    # 期望文字表：默认用文件名，--jobs 时用 reading
    expect = {}
    if args.jobs:
        with open(args.jobs, encoding="utf-8-sig") as f:
            jd = json.load(f)
        for j in (jd.get("jobs") if isinstance(jd, dict) else jd):
            expect[j["file"]] = j.get("reading") or j.get("input") or ""

    api_key = os.environ.get("STEP_API_KEY", "").strip()
    if args.cloud and not api_key:
        print("--cloud 需要环境变量 STEP_API_KEY", file=sys.stderr)
        return 2

    rec = None
    if not args.cloud:
        md = find_model()
        if not md:
            print("找不到 SenseVoice 模型", file=sys.stderr)
            return 2
        rec = build_recognizer(md, args.threads)

    files = sorted(f for f in os.listdir(args.dir)
                   if f.lower().endswith((".mp3", ".wav", ".flac", ".m4a", ".opus")))
    rows = []
    for f in files:
        p = os.path.join(args.dir, f)
        base = os.path.splitext(f)[0]
        expected = expect.get(f, base)
        try:
            got = transcribe_cloud(p, api_key) if args.cloud else transcribe(rec, p)
        except Exception as ex:
            got = f"<错误: {ex}>"
        verdict, detail = classify(expected, got, base in sound_only)
        rows.append({"file": f, "expected": expected, "got": got,
                     "verdict": verdict, "detail": detail})

    if args.json:
        print(json.dumps({"rows": rows}, ensure_ascii=False, indent=1))
    else:
        print(f"{'文件':<18}{'判定':<10}转录 / 说明")
        print("-" * 78)
        for r in rows:
            print(f"{r['file']:<18}{r['verdict']:<10}{r['got'][:46]}")
            if r["detail"]:
                print(f"{'':<28}{r['detail'][:60]}")

    counts = {}
    for r in rows:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    print("\n" + "=" * 62)
    print("  ".join(f"{k}={v}" for k, v in sorted(counts.items())) + f"   共 {len(rows)} 条")
    bad = [r for r in rows if r["verdict"] != "OK"]
    if bad:
        print(f"\n需要关注 {len(bad)} 条：")
        for r in bad:
            print(f"  ! {r['file']:<18}{r['verdict']:<10}{r['detail'][:64]}")
    else:
        print("\n全部通过内容校验 ✔")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
