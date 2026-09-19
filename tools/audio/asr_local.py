#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
asr_local.py — 用本地 SenseVoice 做语音识别（离线、免费、不上传）

为什么用本地而不是云 ASR：
  · 免费、无 RPM 限制
  · 不上传音频（游戏素材/未发布内容不该外传）
  · 不受「云 ASR 下载不到我们的 URL」影响
    —— 实测 StepFun ASR 对临时 CDN 链接报 stage=audio_download 失败

用途之一（本仓库的主要用途）：**校验生成的配音/报牌音效内容对不对**。
生成模型返回成功 ≠ 内容正确，转录回来跟预期文字一比就知道。

依赖：sherpa-onnx（pip install sherpa-onnx）+ 一个 SenseVoice ONNX 模型
模型目录需含：
  model.onnx      模型本体（若无 metadata，则由本脚本提供 language/textnorm）
  tokens.txt      每行 "<token> <id>"，共 25055 行

用法：
  python asr_local.py <文件或目录> [--model DIR] [--json]
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.request
import wave

import numpy as np
import paths as PA  # noqa: E402  (同目录模块)

SR = 16000


def find_model(explicit: str = None) -> str:
    """按优先级找一个可用的模型目录（含 model.onnx 或 model.int8.onnx + tokens.txt）。"""
    cands = []
    if explicit:
        cands.append(explicit)
    cands += [
        PA.ASR_MODEL,
        os.path.join(PA.MODEL_ROOT, "sensevoice-small"),
        os.path.expandvars(r"%APPDATA%\Shandianshuo\models\sensevoice-small"),
    ]
    for d in cands:
        if not d or not os.path.isfile(os.path.join(d, "tokens.txt")):
            continue
        if os.path.isfile(os.path.join(d, "model.int8.onnx")) or \
           os.path.isfile(os.path.join(d, "model.onnx")):
            return d
    return ""


def model_file(model_dir: str) -> str:
    """优先用 int8 量化版（体积小、CPU 上更快，精度损失可忽略）。"""
    for name in ("model.int8.onnx", "model.onnx"):
        p = os.path.join(model_dir, name)
        if os.path.isfile(p):
            return p
    raise FileNotFoundError("模型目录里没有 model.onnx 或 model.int8.onnx")


def load_wav_16k(path: str) -> np.ndarray:
    """任意音频 → 16kHz 单声道 float32（走 ffmpeg，避免依赖 soundfile）。"""
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le",
           "-acodec", "pcm_f32le", "-ac", "1", "-ar", str(SR), "-"]
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0 or not p.stdout:
        raise RuntimeError("ffmpeg 解码失败: " + p.stderr.decode("utf-8", "replace")[:160])
    return np.frombuffer(p.stdout, dtype=np.float32)


# ── 可选：StepFun 云端 ASR（multipart 直传，无需公网 URL）──
# 实测：比本地 SenseVoice 略准，输出**不带标点**（利于逐字比对）。
# ⚠ 这个端点只支持 stepaudio-2.5-asr / step-asr。
#   stepaudio-3-asr-max（错误率 0.57%）只在 file/submit 那套流程里，要求公网 URL，
#   实测对临时带鉴权的 CDN 链接会报 stage=audio_download 失败 —— 本机素材用不了。
STEP_ASR_SUBMIT = "https://api.stepfun.com/v1/audio/transcriptions"
STEP_ASR_MODEL = "stepaudio-2.5-asr"


def transcribe_cloud(path: str, api_key: str, timeout: int = 180) -> str:
    """用 StepFun 的 transcriptions 接口识别。

    走 curl 而不是自己拼 multipart —— 手写 multipart 边界极易出错
    （实测手工拼的请求返回 400，curl 的 -F 一次就通）。
    """
    import json as _json

    cmd = [
        "curl", "-sS", "--max-time", str(timeout),
        STEP_ASR_SUBMIT,
        "-H", "Authorization: Bearer " + api_key,
        "-F", "model=" + STEP_ASR_MODEL,
        "-F", "response_format=json",
        "-F", "file=@" + path,
    ]
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError("curl 失败: " + p.stderr.decode("utf-8", "replace")[:200])
    raw = p.stdout.decode("utf-8", "replace")
    try:
        j = _json.loads(raw)
    except Exception:
        raise RuntimeError("返回非 JSON: " + raw[:200])
    if "error" in j:
        raise RuntimeError(str(j["error"])[:200])
    return (j.get("text") or "").strip()


def build_recognizer(model_dir: str, num_threads: int = 2):
    import sherpa_onnx

    model = model_file(model_dir)
    tokens = os.path.join(model_dir, "tokens.txt")
    # use_itn=True 打开逆文本正则化：把「一二三」规范成「123」等，报牌数字更直观
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=model, tokens=tokens, num_threads=num_threads,
        language="zh", use_itn=True,
    )


def transcribe(rec, path: str) -> str:
    x = load_wav_16k(path)
    s = rec.create_stream()
    s.accept_waveform(SR, x)
    rec.decode_stream(s)
    return (s.result.text or "").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="音频文件或目录")
    ap.add_argument("--model", help="模型目录")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--threads", type=int, default=2)
    args = ap.parse_args()

    model_dir = find_model(args.model)
    if not model_dir:
        print("找不到 SenseVoice 模型（需含 model.onnx 与 tokens.txt）", file=sys.stderr)
        return 2
    print(f"模型：{model_dir}", file=sys.stderr)

    if os.path.isdir(args.path):
        files = sorted(os.path.join(args.path, f) for f in os.listdir(args.path)
                       if f.lower().endswith((".mp3", ".wav", ".flac", ".m4a", ".opus")))
    else:
        files = [args.path]
    if not files:
        print("没有音频文件", file=sys.stderr)
        return 1

    rec = build_recognizer(model_dir, args.threads)
    rows = []
    for p in files:
        try:
            text = transcribe(rec, p)
        except Exception as e:
            text = f"<错误: {e}>"
        rows.append({"file": os.path.basename(p), "text": text})

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
    else:
        for r in rows:
            print(f"{r['file']:<14} {r['text']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
