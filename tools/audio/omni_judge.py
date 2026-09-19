#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
omni_judge.py — 用全模态模型（Qwen-Omni）做音频的「感知层」验收

═══ 为什么需要它 ═══
现有手段只覆盖了音频的两头，中间一大段是盲区：

| 层 | 手段 | 能覆盖 | 覆盖不到 |
|---|---|---|---|
| 1 声学 | check_audio.py / check_bgm.py | 时长/响度/静音/削波/循环接缝 | 内容是什么 |
| 2 内容 | ASR（SenseVoice / verify_*.py） | **只有语音** | 音效、音乐、环境音（ASR 直接返回空） |
| 3 感知 | ← 本工具 | 音效/音乐/环境音 + 情绪/空间感/自然度 | 逐字准确度（仍要靠 ASR） |

实测证据：`暗杠.mp3`（纯牌碰音效）ASR 转录结果是**空字符串**，
当时的结论是「废件」。**音效类素材在纯 ASR 眼里等于不存在** —— 这就是要补的洞。

═══ ⚠ 本工具最重要的设计：先测「可不可信」，再测「音频对不对」 ═══
Omni 输出的是流畅自然语言，**听起来总是很有道理**，很容易把幻觉当结论用。
所以脚本内置**已知答案的对照题**（T2）：

  · 纯静音文件 → 模型若说「有声音/有语音」= 它在编
  · 已知末尾有 3s 静音的语音 → 模型若说「尾部有很长静音」= 它真能听出来
  · 已知循环接缝 21dB 的 BGM → 模型能否察觉

**对照题不通过，后面的判断一概不可信** —— 脚本会明确告诉你这一点，
而不是继续输出一堆看起来很专业的描述。

═══ 用法 ═══
    set DASHSCOPE_API_KEY=sk-xxx
    python omni_judge.py --selftest                 # T1+T2：先验证模型可信度（必跑）
    python omni_judge.py --dir <目录>               # T3：批量判类（音效/音乐/语音/环境音）
    python omni_judge.py --dir <目录> --only a,b    # 只判指定几个
    python omni_judge.py --file x.mp3 --ask "这段音频的结尾是否自然收束？"

Base URL 用「OpenAI 兼容模式」，需要你的百炼业务空间 ID：
    DASHSCOPE_BASE_URL=https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
若你的空间支持通用域名，也可以用 https://dashscope.aliyuncs.com/compatible-mode/v1
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    import paths as PA  # noqa: E402
except Exception:
    PA = None

# 模型选择（按任务性质分，详见 --help）
MODEL_UNDERSTAND = "qwen3.8-omni-flash"   # 文本输出，音视频理解主力，1M 上下文
MODEL_SPEAK = "qwen3.5-omni-plus"         # 需要模型「出声」时用这个（本工具不用）

# base64 硬限制：文档明确「音频和视频编码后的 Base64 字符串必须小于 10MB」。
# 本地素材远小于此（最大的 BGM 1.7MB → base64 约 2.3MB），但转录件可能超，故设阈值提醒。
B64_LIMIT = 10 * 1024 * 1024
WARN_BYTES = 7 * 1024 * 1024

# 兼容模式通用域名（不需要业务空间 ID）。
# 若报鉴权/地域错误，改用你的专属域名：
#   https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


def api_key():
    k = (os.environ.get("DASHSCOPE_API_KEY") or "").strip()
    if not k:
        print("请先设置 DASHSCOPE_API_KEY（阿里云百炼的 API Key）", file=sys.stderr)
        print("  控制台：https://bailian.console.aliyun.com/  → API-KEY 管理", file=sys.stderr)
        sys.exit(2)
    return k


def base_url():
    """兼容模式的服务地址。

    阿里云文档的示例用的是**业务空间专属域名**：
        https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
    那样必须先查出 WorkspaceId，多一个必填项。百炼同时提供**通用兼容域名**，
    不需要 WorkspaceId，先用它试；不行再设环境变量覆盖。
    ⚠ 地域必须与 API Key 一致（北京 key 打新加坡域名会失败）。
    """
    return (os.environ.get("DASHSCOPE_BASE_URL") or "").strip() or DEFAULT_BASE_URL


def client():
    try:
        from openai import OpenAI
    except ImportError:
        print("需要 openai SDK：pip install openai", file=sys.stderr)
        sys.exit(2)
    return OpenAI(api_key=api_key(), base_url=base_url())


_client = None


def get_client():
    global _client
    if _client is None:
        _client = client()
    return _client


# ── 音频准备 ────────────────────────────────────────────────────────
def to_mp3(path, tmp_dir):
    """统一成 mp3（体积小，base64 后不易超限）。

    为什么不用 wav：wav 是未压缩的，1 秒 48kHz 单声道就有 96KB。
    这个项目里最长的 BGM 是 106s —— 转成 wav 是 10MB，base64 后 13MB，**直接超限**。
    mp3 同样内容约 1.7MB，完全够用。
    """
    if path.lower().endswith(".mp3"):
        return path, "mp3"
    os.makedirs(tmp_dir, exist_ok=True)
    dst = os.path.join(tmp_dir, os.path.splitext(os.path.basename(path))[0] + ".mp3")
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path,
                        "-ac", "1", "-ar", "24000", "-b:a", "64k", dst],
                       capture_output=True)
    if r.returncode != 0 or not os.path.exists(dst):
        raise RuntimeError(f"转 mp3 失败：{r.stderr.decode('utf-8', 'replace')[:200]}")
    return dst, "mp3"


def dur(path):
    o = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", path], capture_output=True)
    try:
        return float(o.stdout.decode().strip())
    except Exception:
        return 0.0


def ask_about(path, prompt, tmp_dir, model=MODEL_UNDERSTAND, reasoning="low", timeout=180):
    """把本地音频以 base64 内联发给 Omni，返回 (文本, usage)。

    ⚠ 为什么强调 base64 内联：文档的示例都用**公网 URL**，
    而这个项目的素材在本地、且分发包里含授权未核实的第三方素材
    （不该传到任何公开位置）。base64 内联是唯一合适的方式。
    """
    mp3, fmt = to_mp3(path, tmp_dir)
    size = os.path.getsize(mp3)
    if size > WARN_BYTES:
        print(f"    ⚠ 文件 {size/1e6:.1f}MB，base64 后约 {size*1.34/1e6:.1f}MB，接近 10MB 上限")
    if size * 1.34 > B64_LIMIT:
        return f"[跳过] base64 后超过 10MB 上限（{size/1e6:.1f}MB）", None
    b64 = base64.b64encode(open(mp3, "rb").read()).decode("ascii")

    kw = dict(
        model=model,
        messages=[{
            "role": "user",
            "content": [
                {"type": "input_audio", "input_audio": {"data": f"data:audio/mpeg;base64,{b64}", "format": "mp3"}},
                {"type": "text", "text": prompt},
            ],
        }],
        modalities=["text"],
        stream=False,
    )
    if reasoning:
        kw["reasoning_effort"] = reasoning
    try:
        c = get_client()
        t0 = time.time()
        r = c.chat.completions.create(**kw, timeout=timeout)
        txt = (r.choices[0].message.content or "").strip()
        u = getattr(r, "usage", None)
        usage = None
        if u is not None:
            usage = {"in": getattr(u, "prompt_tokens", None), "out": getattr(u, "completion_tokens", None)}
        usage = usage or {}
        usage["sec"] = round(time.time() - t0, 1)
        return txt, usage
    except Exception as e:
        return f"[调用失败] {type(e).__name__}: {e}", None


# ── 判类：从自由文本里抽结构化结论 ──────────────────────────────────
CATS = ["语音", "音效", "音乐", "环境音", "静音"]


def classify_prompt():
    """判类提示词。

    ⚠ 提示词写法直接决定幻觉率 —— 这是实测出来的，不是理论：

      第一版（把静音排在类别列表最后、且用「这是一段游戏音频素材」开头）：
        对一段 ffmpeg 生成的**纯静音**文件问 5 次
        → 4 次编出「游戏界面确认/通知蜂鸣声」「短促的电子提示音，带轻微尾音衰减」
        → 只有 1 次说了「几乎没有可辨识的声音」
        自检命中率 1/3，静音那条把一段不存在的 drone 氛围音连同情绪一起编了出来。

      第二版（下面这版：把「静音」列在**最前**，并显式要求「必须选静音，不要猜测或补充
      并不存在的内容」，同时去掉「这是一段…素材」这种预设）：
        同一个静音文件问 4 次 → **4 次全对**；纯音仍准确判为「音效」并说对频率约 1kHz。

    结论：**别让提示词预设「里面一定有内容」**。质检场景下，
    必须显式给出「什么都没有」这个出口，否则模型会为了配合提问而编造。
    这也是本工具坚持先跑 --selftest 的原因。
    """
    return (
        "请判断这段音频里**实际**有什么。只回答 JSON，不要多余文字：\n"
        '{"类别":"静音/语音/音效/音乐/环境音 之一'
        '（若几乎听不到任何声音，必须选「静音」，不要猜测或补充并不存在的内容）",'
        '"内容":"只描述你确实听到的；若为静音就写 无",'
        '"情绪":"若有情绪或氛围则写，否则空串",'
        '"结尾":"自然收束/突然截断/淡出到静音 之一",'
        '"开头":"立即开始/有前导静音 之一",'
        '"人声":"有/无"}'
    )


def parse_json(txt):
    m = re.search(r"\{.*\}", txt, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


# ══════════════════════════════════════════════════════════════════════
# T1 / T2：可信度自检 —— **必须先跑这个**
# ══════════════════════════════════════════════════════════════════════
def make_probe_files(work):
    """造三个「已知答案」的对照件。用 ffmpeg 生成，不依赖素材库。"""
    os.makedirs(work, exist_ok=True)
    probes = []

    # ① 纯静音 3s —— 正确答案：静音 / 什么都听不到
    p = os.path.join(work, "probe_silence.mp3")
    if not os.path.exists(p):
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
                        "-i", "anullsrc=r=24000:cl=mono", "-t", "3",
                        "-b:a", "64k", p], capture_output=True)
    probes.append(("纯静音 3s", p, "静音", "模型若说听到内容 = 在编造"))

    # ② 1kHz 正弦 1s（纯音，不是语音也不是音效）—— 正确答案：一个持续的电子音
    p = os.path.join(work, "probe_tone.mp3")
    if not os.path.exists(p):
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
                        "-i", "sine=frequency=1000:duration=1",
                        "-b:a", "64k", p], capture_output=True)
    probes.append(("1kHz 纯音 1s", p, "音效", "应描述为持续的电子提示音，而非语音"))

    # ③ 白噪声 2s —— 正确答案：噪声，无语音无旋律
    p = os.path.join(work, "probe_noise.mp3")
    if not os.path.exists(p):
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
                        "-i", "anoisesrc=d=2:c=pink", "-b:a", "64k", p], capture_output=True)
    probes.append(("粉红噪声 2s", p, "音效", "应描述为噪声/沙沙声，而非语音或音乐"))
    return probes


def selftest(args):
    work = os.path.join(args.work or (PA.WORK_ROOT if PA else "."), "_omni_probe")
    print("=" * 90)
    print("T1/T2 · 可信度自检：先用「已知答案」的对照件验证模型是否真能听、是否在编")
    print("=" * 90)
    print(f"模型：{MODEL_UNDERSTAND}    base_url：{base_url()}")
    print(f"对照件目录：{work}\n")

    results = []
    for label, path, expect, why in make_probe_files(work):
        txt, usage = ask_about(path, classify_prompt(), work)
        got = parse_json(txt) or {}
        cat = str(got.get("类别", "")).strip()
        hit = (cat == expect)
        results.append((label, expect, cat, hit, txt, usage))
        u = f"{usage.get('in','?')}→{usage.get('out','?')} tok / {usage.get('sec','?')}s" if usage else "无"
        print(f"── {label} ──")
        print(f"   期望类别：{expect}    模型判：{cat or '(未解析出)'}    {'✔' if hit else '✘'}")
        print(f"   {why}")
        print(f"   模型原话：{txt[:200]}")
        print(f"   usage：{u}\n")

    hit_n = sum(1 for r in results if r[3])
    print("=" * 90)
    print(f"对照题命中 {hit_n}/{len(results)}")
    if hit_n >= 2:
        print("→ 模型**能区分**非语音音频，可以进入 T3 批量判类。")
        print("  注意：这只证明它分得清大类别；细粒度判断（如接缝、音质）仍要单独验。")
    else:
        print("→ ⚠ 模型在对照题上就不准。**此时它对真实素材的任何描述都不可信**，")
        print("  不要拿它的输出当验收依据。先确认：模型名/地域/音频格式是否正确。")
    print("=" * 90)
    return 0


# ══════════════════════════════════════════════════════════════════════
# T3：批量判类 —— 用真实素材，看它能不能自己分清音效/语音/音乐
# ══════════════════════════════════════════════════════════════════════
def batch(args):
    roots = {
        "sfx": os.path.join(PA.AUDIO, "sfx") if PA else None,
        "amb": os.path.join(PA.AUDIO, "amb") if PA else None,
        "bgm": os.path.join(PA.AUDIO, "bgm") if PA else None,
        "vo": os.path.join(PA.AUDIO, "vo_real") if PA else None,
        "mj": os.path.join(PA.AUDIO, "mj") if PA else None,
    }
    # 每类取 N 个样本（默认 2），避免一次烧太多 token
    n = args.per_cat
    files = []
    for cat, d in roots.items():
        if not d or not os.path.isdir(d):
            continue
        cand = sorted(f for f in os.listdir(d) if f.lower().endswith(".mp3"))
        if args.only:
            cand = [f for f in cand if os.path.splitext(f)[0] in args.only]
        for f in cand[:n]:
            files.append((cat, os.path.join(d, f)))
    if not files:
        print("没有找到素材。用 --dir 指定目录，或设好文字素材库路径。")
        return 1

    # 期望：sfx/amb → 音效或环境音；bgm → 音乐；vo → 语音；mj → 语音
    expect_map = {"sfx": {"音效", "环境音"}, "amb": {"环境音", "音效"},
                  "bgm": {"音乐"}, "vo": {"语音"}, "mj": {"语音"}}

    print("=" * 90)
    print(f"T3 · 批量判类：{len(files)} 个真实素材（每类最多 {n} 个）")
    print("=" * 90)
    print("判据：模型不看文件名，自己听出类别。对得上说明它能分辨这类音频。\n")

    stat = {}
    rows = []
    for i, (cat, path) in enumerate(files, 1):
        name = os.path.basename(path)
        txt, usage = ask_about(path, classify_prompt(), os.path.join(args.work or ".", "_omni_probe"))
        got = parse_json(txt) or {}
        gcat = str(got.get("类别", "")).strip()
        d = dur(path)
        ok = gcat in expect_map.get(cat, set())
        stat.setdefault(cat, [0, 0])
        stat[cat][0] += 1
        stat[cat][1] += 1 if ok else 0
        rows.append((cat, name, d, gcat, ok, got))
        print(f"[{i}/{len(files)}] {cat:<4} {name:<26} {d:6.2f}s  → 判「{gcat}」{'✔' if ok else '✘'}"
              f"   人声:{got.get('人声','?')}  结尾:{got.get('结尾','?')}")
        print(f"          内容：{str(got.get('内容',''))[:70]}")
        if got.get("情绪"):
            print(f"          情绪：{str(got['情绪'])[:70]}")

    print("\n" + "=" * 90)
    print(f"{'目录':<6}{'样本':>6}{'判对':>6}{'正确率':>9}")
    tot = hit = 0
    for cat in sorted(stat):
        n_, h = stat[cat]
        tot += n_
        hit += h
        print(f"{cat:<6}{n_:>6}{h:>6}{h/n_*100:>8.0f}%")
    print(f"{'合计':<6}{tot:>6}{hit:>6}{hit/tot*100 if tot else 0:>8.0f}%")
    print("=" * 90)
    if tot and hit / tot >= 0.8:
        print("→ 判类可靠。可以把它接进验收流程，专门管「音效/音乐/环境音」这些 ASR 的盲区。")
    else:
        print("→ ⚠ 判类不够可靠。**别自动采信**，只把它当「提出可疑项」的助手，人来定夺。")
    return 0


# ══════════════════════════════════════════════════════════════════════
# 单文件自由提问（调试 / 深挖某个可疑件）
# ══════════════════════════════════════════════════════════════════════
def one(args):
    if not args.file:
        print("用 --file 指定一个音频文件")
        return 1
    if not os.path.exists(args.file):
        print(f"文件不存在：{args.file}")
        return 1
    prompt = args.ask or classify_prompt()
    print(f"文件：{args.file}  ({dur(args.file):.2f}s)")
    print(f"提问：{prompt}\n")
    txt, usage = ask_about(args.file, prompt, os.path.join(args.work or ".", "_omni_probe"))
    print(txt)
    if usage:
        print(f"\n[usage] {usage.get('in','?')}→{usage.get('out','?')} tok / {usage.get('sec','?')}s")
    return 0


def main():
    ap = argparse.ArgumentParser(
        description="用全模态模型（Qwen-Omni）做音频的感知层验收",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""建议顺序：
  1) python omni_judge.py --selftest          先验证模型可信度（必跑，便宜）
  2) python omni_judge.py --dir --per-cat 2   小样本判类，看正确率
  3) 正确率达标后，再考虑接进 run-all-tests
""")
    ap.add_argument("--selftest", action="store_true", help="T1/T2：用已知答案的对照件验证模型可信度")
    ap.add_argument("--batch", action="store_true", help="T3：批量判类（配合 --per-cat）")
    ap.add_argument("--file", help="单文件自由提问")
    ap.add_argument("--ask", help="配合 --file 的问题文本")
    ap.add_argument("--dir", help="（保留）指定目录")
    ap.add_argument("--only", help="只处理指定文件名（逗号分隔，不带扩展名）")
    ap.add_argument("--per-cat", type=int, default=2, help="批量判类时每类取几个样本（默认 2）")
    ap.add_argument("--work", help="对照件/临时件目录（默认 audio-工作区）")
    ap.add_argument("--model", default=MODEL_UNDERSTAND, help=f"模型名（默认 {MODEL_UNDERSTAND}）")
    args = ap.parse_args()

    if args.model != MODEL_UNDERSTAND:
        globals()["MODEL_UNDERSTAND"] = args.model

    if args.selftest:
        return selftest(args)
    if args.batch or args.dir:
        return batch(args)
    if args.file:
        return one(args)
    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
