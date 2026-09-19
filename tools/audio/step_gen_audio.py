#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
step_gen_audio.py — 用 StepFun StepAudio 3 Gen 生成游戏音频素材

API: POST https://api.stepfun.com/v1/audio/generate
模型: stepaudio-3-gen-preview（限时免费）

本脚本是「通用批量生成器 + 麻将音效预设」：
  · 通用：读一份 JSON 任务表，逐条生成
  · 麻将：内置 45 条牌名/动作音效的预设（--preset mahjong）

用法：
  set STEP_API_KEY=xxx
  python step_gen_audio.py --preset mahjong --out "H:\\...\\audio\\mj"
  python step_gen_audio.py --jobs my.json --out outdir
  python step_gen_audio.py --preset mahjong --only 碰,杠 --out somedir   # 只跑指定几条

设计取舍（为什么这么写）：
  · 逐条串行 + 间隔，避免触发限流（套餐额度虽免费，RPM 仍受限）
  · 每条独立重试，单条失败不影响整批
  · 已存在的文件默认跳过（幂等），要覆盖加 --force
  · 台词用 () 描述语气、用 [] 描述音效，这是官方文档的写法
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

API_URL = "https://api.stepfun.com/v1/audio/generate"      # 音效/综合音频（Gen）
TTS_URL = "https://api.stepfun.com/v1/audio/speech"        # 语音合成（TTS）
MODEL = "stepaudio-3-gen-preview"
TTS_MODEL = "stepaudio-3-tts"

# 简易音色→音效风格映射说明（供参考，不参与逻辑）：
#   cixingnansheng 磁性男声 · shuangkuainansheng 爽快男声 · zhengpaiqingnian 正派青年
#   lengyanyujie 冷艳御姐 · wenroushunv 温柔熟女 · shuangkuaijiejie 爽快姐姐
#   ruanmengnvsheng 软萌少女 · yuanqishaonv 元气少女 · qingchunshaonv 清纯少女
#   linjiameimei 邻家妹妹 · linjiajiejie 邻家姐姐 · ganliannvsheng 干练女声

# ── 麻将音效预设 ────────────────────────────────────────────────────
# 牌名（27 张序数牌 + 7 张字牌）：要求「牌桌报牌」的感觉 —— 短促、字正腔圆、带一点起伏。
# 注意「发」：素材名用简体「发」，而牌面字符是「發」（U+767C），代码里已做映射。
HONORS = ["东", "南", "西", "北", "中", "发", "白"]
TILES = [f"{n}{s}" for n in "123456789" for s in ["万", "条", "筒"]] + HONORS

# 动作词：碰/杠/胡/自摸/抢杠/杠开/听/过/流局 是**喊出来的**（真人打牌会出声）
CALLS = ["碰", "杠", "胡", "自摸", "抢杠", "杠开", "听", "过", "流局"]
# 暗杠/补杠 是自己手上的动作，不喊 —— 用**牌碰击声**表达，比喊出来更像真的
SILENT_ACTIONS = ["暗杠", "补杠"]


def tile_job(name: str) -> dict:
    """牌名：报牌口吻。"""
    return {
        "file": f"{name}.mp3",
        "roles": [
            {"name": "打牌的人",
             "description": "成年男性，常打麻将的中年人，嗓音厚实略带沙哑，报牌干脆利落，"
                            "中气足但不吼，尾音略上扬，像牌桌上随口但清楚地报出一张牌"}
        ],
        "scripts": [{"speaker": "打牌的人", "text": f"（利落报牌，语速偏快）{name}"}],
        "instruction": "室内麻将桌旁，安静环境，只有人声报牌，不要任何背景音乐和回声",
        "response_format": "mp3",
        "sample_rate": 48000,
    }


def call_job(name: str) -> dict:
    """动作词：喊牌口吻，比报牌更有情绪。"""
    mood = {
        "碰": "短促有力，略带果断的满足感",
        "杠": "音量提高，带一点兴奋和得意",
        "暗杠": "压低声音，带克制的得意",
        "补杠": "语气平稳，像补上一手",
        "胡": "明显上扬，带压抑不住的欣喜",
        "自摸": "兴奋而克制，像忍着不笑出来",
        "抢杠": "急促，带一点抢到的紧张感",
        "杠开": "兴奋，尾音上扬",
        "听": "平静陈述，像提醒自己也提醒别人",
        "过": "平淡，略带犹豫后放弃",
        "流局": "语气放松，像松一口气",
    }.get(name, "自然")
    return {
        "file": f"{name}.mp3",
        "roles": [
            {"name": "打牌的人",
             "description": "成年男性，常打麻将的中年人，嗓音厚实略带沙哑，"
                            "情绪外放但有分寸，不做作不夸张"}
        ],
        "scripts": [{"speaker": "打牌的人", "text": f"（{mood}）{name}"}],
        "instruction": "室内麻将桌旁，安静环境，只有人声，不要背景音乐和回声",
        "response_format": "mp3",
        "sample_rate": 48000,
    }


def silent_action_job(name: str) -> dict:
    """暗杠/补杠：不喊，用麻将牌碰撞的实音。"""
    detail = {
        "暗杠": "四张牌在桌面上叠起再扣下的闷响，连贯的三四下轻碰，短促克制",
        "补杠": "一张牌啪地拍到已有的刻子上，一下清脆的牌碰牌声，简短",
    }[name]
    return {
        "file": f"{name}.mp3",
        "scripts": [{"text": f"[{detail}]"}],
        "instruction": "安静的室内麻将桌旁，只有麻将牌碰撞的实音，不要人声、不要背景音乐",
        "response_format": "mp3",
        "sample_rate": 48000,
    }


def mahjong_preset() -> list:
    jobs = [tile_job(n) for n in TILES]
    jobs += [call_job(n) for n in CALLS]
    jobs += [silent_action_job(n) for n in SILENT_ACTIONS]
    return jobs


# ── 通用：读 JSON 任务表 ─────────────────────────────────────────────
def load_jobs(path: str) -> list:
    # utf-8-sig：容忍 PowerShell / 记事本写出的 UTF-8 BOM，
    # 否则 json.load 会报 "Unexpected UTF-8 BOM"
    with open(path, encoding="utf-8-sig") as f:
        data = json.load(f)
    if isinstance(data, dict):
        data = data.get("jobs", [])
    return data


# ── API 调用 ────────────────────────────────────────────────────────
def is_tts_job(job: dict) -> bool:
    """有 voice 字段 = TTS 配音任务；否则是 Gen 音效任务。

    TTS 任务字段：file / voice / reading（要念的话）/ 可选 speed
    Gen 任务字段：file / roles / scripts / instruction
    """
    return bool(job.get("voice"))


def call_tts(job: dict, api_key: str, timeout: int = 180):
    """语音合成。返回 (音频字节, 错误信息)。"""
    text = job.get("reading") or job.get("input") or ""
    if not text:
        return None, "TTS 任务缺 reading 文本"
    payload = {
        "model": TTS_MODEL,
        "input": text,
        "voice": job["voice"],
        "response_format": job.get("response_format", "mp3"),
        "sample_rate": job.get("sample_rate", 48000),
        "speed": job.get("speed", 1.0),
    }
    # stepaudio-3-tts 不支持 voice_label（情绪写在文本的 () 里）
    if job.get("volume"):
        payload["volume"] = job["volume"]

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        TTS_URL, data=body, method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {api_key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ctype = resp.headers.get("Content-Type", "")
            raw = resp.read()
            if "application/json" in ctype:
                try:
                    j = json.loads(raw.decode("utf-8"))
                except Exception as e:
                    return None, f"JSON 解析失败: {e}"
                import base64
                b64 = j.get("data") or j.get("audio") or j.get("audio_base64")
                if b64:
                    return base64.b64decode(b64), ""
                return None, f"JSON 里找不到音频字段；键={list(j)[:8]}"
            return raw, ""
    except urllib.error.HTTPError as e:
        detail = e.read()[:400]
        try:
            detail = json.loads(detail.decode("utf-8"))
        except Exception:
            detail = detail.decode("utf-8", "replace")
        return None, f"HTTP {e.code}: {detail}"
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


def call_api(payload: dict, api_key: str, timeout: int = 180):
    """返回 (音频字节, 错误信息)。错误信息非空表示失败。"""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        API_URL, data=body, method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ctype = resp.headers.get("Content-Type", "")
            raw = resp.read()
            if "application/json" in ctype:
                # 服务端返回 JSON：可能是 base64 音频，也可能是错误体
                try:
                    j = json.loads(raw.decode("utf-8"))
                except Exception as e:
                    return None, f"JSON 解析失败: {e}; 原文前 200 字: {raw[:200]!r}"
                if isinstance(j, dict) and j.get("error"):
                    return None, f"API 错误: {j['error']}"
                b64 = (j.get("data") or j.get("audio") or j.get("audio_base64")
                       or (j.get("choices") or [{}])[0].get("audio") if isinstance(j, dict) else None)
                if b64:
                    import base64
                    return base64.b64decode(b64), ""
                return None, f"JSON 里找不到音频字段，键={list(j)[:8] if isinstance(j, dict) else type(j)}"
            # 否则按二进制音频处理
            return raw, ""
    except urllib.error.HTTPError as e:
        detail = e.read()[:400]
        try:
            detail = json.loads(detail.decode("utf-8"))
        except Exception:
            detail = detail.decode("utf-8", "replace")
        return None, f"HTTP {e.code}: {detail}"
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


def sane_filename(s: str) -> str:
    """去掉 Windows 非法字符。"""
    return re.sub(r'[\\/:*?"<>|]', "_", s).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preset", choices=["mahjong"], help="内置预设")
    ap.add_argument("--jobs", help="JSON 任务表")
    ap.add_argument("--out", required=True, help="输出目录")
    ap.add_argument("--only", help="只跑指定名字（逗号分隔）")
    ap.add_argument("--force", action="store_true", help="覆盖已存在文件")
    ap.add_argument("--sleep", type=float, default=1.5, help="每条之间的间隔秒数")
    ap.add_argument("--retry", type=int, default=3, help="单条重试次数")
    ap.add_argument("--limit", type=int, help="只跑前 N 条（试跑用）")
    args = ap.parse_args()

    api_key = os.environ.get("STEP_API_KEY", "").strip()
    if not api_key:
        print("错误：请先设置环境变量 STEP_API_KEY", file=sys.stderr)
        sys.exit(2)

    if args.preset == "mahjong":
        jobs = mahjong_preset()
    elif args.jobs:
        jobs = load_jobs(args.jobs)
    else:
        print("错误：给 --preset 或 --jobs", file=sys.stderr)
        sys.exit(2)

    if args.only:
        want = {x.strip() for x in args.only.split(",") if x.strip()}
        jobs = [j for j in jobs if j["file"].rsplit(".", 1)[0] in want]
    if args.limit:
        jobs = jobs[: args.limit]

    os.makedirs(args.out, exist_ok=True)
    total = len(jobs)
    ok = skip = fail = 0
    failures = []

    print(f"输出目录：{args.out}")
    print(f"共 {total} 条\n")

    for i, job in enumerate(jobs, 1):
        name = sane_filename(job["file"])
        dest = os.path.join(args.out, name)
        tag = f"[{i}/{total}] {name}"

        if os.path.exists(dest) and not args.force:
            size = os.path.getsize(dest)
            if size > 1000:
                print(f"{tag}  跳过（已存在 {size} B）")
                skip += 1
                continue

        got = None
        last_err = ""
        for attempt in range(1, args.retry + 1):
            if is_tts_job(job):
                data, err = call_tts(job, api_key)
            else:
                payload = {"model": MODEL, "task": "text_to_audio"}
                for k in ("roles", "scripts", "instruction", "response_format",
                          "speed", "volume", "sample_rate", "stream_format", "return_url"):
                    if k in job:
                        payload[k] = job[k]
                data, err = call_api(payload, api_key)
            if data and len(data) > 1000:
                got = data
                break
            last_err = err or "返回内容过短"
            if attempt < args.retry:
                wait = 3 * attempt
                print(f"{tag}  第 {attempt} 次失败（{last_err[:110]}），{wait}s 后重试")
                time.sleep(wait)

        if got:
            with open(dest, "wb") as f:
                f.write(got)
            print(f"{tag}  OK  {len(got):,} B")
            ok += 1
        else:
            print(f"{tag}  FAIL  {last_err[:200]}")
            failures.append({"file": name, "error": last_err})
            fail += 1

        if i < total:
            time.sleep(args.sleep)

    print("\n" + "═" * 60)
    print(f"成功 {ok} · 跳过 {skip} · 失败 {fail} · 共 {total}")
    if failures:
        report = os.path.join(args.out, "_failures.json")
        with open(report, "w", encoding="utf-8") as f:
            json.dump(failures, f, ensure_ascii=False, indent=2)
        print(f"失败明细已写出：{report}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
