#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_sfx.py — 生成 P0 游戏音效与环境音（StepAudio 3 Gen）

清单来源：从游戏代码的调用点反推（不是凭空列）——
  index.html 里的 AudioSys.{click,ding,good,bad} 遍布所有玩法，
  mahjong.js 的 sfx() 只有 4 个 beep，breakfast.js 完全没有音效。

产出目录约定：
  audio/sfx/<分类>-<名字>.mp3     玩法音效（麻将/早餐店/谈判/格斗/躲避/股市/答题/刮刮乐/UI）
  audio/amb/<地点>.mp3            场景环境音（对应 index.html 的 9 个 loc）

用法：
  set STEP_API_KEY=xxx
  python gen_sfx.py --out "...\\audio" --group sfx      # 只生成音效
  python gen_sfx.py --out "...\\audio" --group amb      # 只生成环境音
  python gen_sfx.py --out DIR --dry-run
"""

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "step_gen_audio.py")


def sfx(name, desc, instruction=None, dur=None):
    """一条音效任务。desc 是 [音效描述]，StepAudio 用 [] 识别音效而非人声。"""
    return {
        "file": f"{name}.mp3",
        "scripts": [{"text": f"[{desc}]"}],
        "instruction": instruction or "游戏音效，短促干净，无背景音乐，无混响尾巴",
        "response_format": "mp3", "sample_rate": 48000,
        "dur": dur,
    }


# ── 玩法音效 ────────────────────────────────────────────────────────
# 命名 sfx-<分类><名>。分类前缀便于日后按玩法批量替换。
SFX = [
    # ── 麻将（牌名播报已有 45 条人声，这里补「物理音」）──
    sfx("sfx-mj-shuffle",    "四个人在桌上搓麻将牌，哗啦哗啦的洗牌声，持续两三秒"),
    sfx("sfx-mj-buildwall",  "麻将牌被整齐码成一排排牌墙的轻响，卡嗒卡嗒"),
    sfx("sfx-mj-deal",       "麻将开局发牌，四张牌依次被推出去的轻响"),
    sfx("sfx-mj-draw",       "从牌墙里抽出一张麻将牌，牌与牌摩擦的一声轻响"),
    sfx("sfx-mj-discard",    "一张麻将牌被拍到桌面上，清脆的一下，带一点回弹"),
    sfx("sfx-mj-clack",      "两张麻将牌互相碰撞的清脆卡嗒声，很短"),
    sfx("sfx-mj-dice",       "两颗骰子落在麻将桌上滚动后停住"),
    sfx("sfx-mj-chip",       "筹码在桌面上堆叠碰撞的几声清脆响"),
    sfx("sfx-mj-win",        "麻将胡牌的结算提示音，明亮上扬的一串音"),
    sfx("sfx-mj-lose",       "麻将流局或输牌的结算提示音，低沉下行"),

    # ── 早餐店（原来 0 个音效）──
    sfx("sfx-bf-sizzle",     "食物下到热油锅里，滋啦一声，短促有力"),
    sfx("sfx-bf-flip",       "锅铲把食物翻面，金属碰锅的一声"),
    sfx("sfx-bf-ready",      "食物熟了，一声清脆的上扬提示音"),
    sfx("sfx-bf-burnt",      "食物糊了，一声低沉的警告音，带轻微焦糊的滋滋声"),
    sfx("sfx-bf-plate",      "把食物盛到盘子上的轻响，瓷器碰触"),
    sfx("sfx-bf-serve",      "把盘子端给顾客，轻快的两声提示音"),
    sfx("sfx-bf-happy",      "顾客满意地离开，明亮愉悦的上行音"),
    sfx("sfx-bf-angry",      "顾客不满地离开，低沉短促的下行音"),
    sfx("sfx-bf-trash",      "食物被倒进垃圾桶，闷闷的一声"),

    # ── 谈判 ──
    sfx("sfx-talk-card",     "一张纸牌被拍到桌面上，干脆的一下"),
    sfx("sfx-talk-pressure", "沉重的施压音效，低频下压，带压迫感"),
    sfx("sfx-talk-offer",    "递出东西的轻柔音效，温和上扬"),
    sfx("sfx-talk-probe",    "试探性的提示音，轻而短，带一点悬念"),
    sfx("sfx-talk-deal",     "谈判成交，明亮肯定的两声提示音"),
    sfx("sfx-talk-break",    "谈判谈崩，低沉的一声闷响"),

    # ── 格斗 ──
    sfx("sfx-fight-whiff",   "拳头挥空的破风声，很快"),
    sfx("sfx-fight-hit",     "拳头结实打在身上的闷响，短促有力"),
    sfx("sfx-fight-hurt",    "自己被打中的闷响，比命中更沉，带一点耳鸣"),
    sfx("sfx-fight-block",   "手臂格挡攻击，沉闷的一下碰撞"),
    sfx("sfx-fight-perfect", "时机判定成功的清脆提示音，明亮短促"),
    sfx("sfx-fight-win",     "格斗胜利，简短有力的胜利提示音"),
    sfx("sfx-fight-lose",    "格斗失败，低沉下行的提示音"),

    # ── 躲避（数据洪流）──
    sfx("sfx-dodge-hit",     "被数据流击中，电子故障的刺耳短音"),
    sfx("sfx-dodge-graze",   "险险擦过的破风声，很快很轻"),
    sfx("sfx-dodge-end",     "躲避结束，一声放松的提示音"),

    # ── 股市 ──
    sfx("sfx-stock-buy",     "买入成交，干净利落的一声确认音"),
    sfx("sfx-stock-sell",    "卖出成交，比买入略低的一声确认音"),
    sfx("sfx-stock-up",      "股价上涨的提示音，明亮上行"),
    sfx("sfx-stock-down",    "股价下跌的提示音，低沉下行"),
    sfx("sfx-stock-settle",  "交易日结算，沉稳的收尾提示音"),

    # ── 答题 / QTE / 连打 ──
    sfx("sfx-quiz-right",    "答对，清脆愉悦的上行提示音"),
    sfx("sfx-quiz-wrong",    "答错，低沉的下行提示音"),
    sfx("sfx-quiz-tick",     "倒计时最后一秒的紧迫滴答声"),
    sfx("sfx-qte-hit",       "时机判定命中绿区，清脆明亮的成功音"),
    sfx("sfx-qte-miss",      "时机判定失误，闷闷的失败音"),
    sfx("sfx-mash",          "快速连打时每一下的短促敲击声，干净有力"),

    # ── 刮刮乐 ──
    sfx("sfx-lot-scratch",   "手指刮开涂层表面的沙沙摩擦声，很短的几下"),
    sfx("sfx-lot-win",       "中奖，明亮欢快的上行音"),
    sfx("sfx-lot-none",      "没中奖，平淡的一声下行音"),

    # ── 信号复原（memory）──
    sfx("sfx-mem-cue",       "记忆提示音，短促清澈的单音"),
    sfx("sfx-mem-ok",        "记忆序列输入正确的一步，清脆确认音"),
    sfx("sfx-mem-fail",      "记忆序列输错，低沉的错误音"),

    # ── 线路取证（circuit）──
    sfx("sfx-cir-rotate",    "旋钮或转盘转动的一格卡位声"),
    sfx("sfx-cir-lock",      "线路接通的锁定声，一声清脆的确认"),

    # ── UI ──
    sfx("ui-click",          "界面按钮点击，干净轻快的一声点击音"),
    sfx("ui-hover",          "鼠标划过选项的极轻提示音，很轻很短"),
    sfx("ui-open",           "面板打开的提示音，轻微上扬"),
    sfx("ui-close",          "面板关闭的提示音，轻微下行"),
    sfx("ui-tab",            "在标签页之间切换，短促的一声"),
    sfx("ui-type",           "文字逐字出现的打字机轻响，很轻很短"),
    sfx("ui-gain",           "数值增加，清脆悦耳的上行提示音"),
    sfx("ui-loss",           "数值减少，低沉的下行提示音"),
    sfx("ui-toast",          "消息提示弹出，轻快的一声"),
    sfx("ui-achv",           "成就解锁，比普通提示更隆重的一小段上扬音"),
    sfx("ui-save",           "存档完成，沉稳的确认音"),
]

# ── 场景环境音（对应 index.html 的 loc）──────────────────────────────
AMB = [
    sfx("amb-rent",   "老式出租屋室内环境音：冰箱低频嗡鸣、楼道远处偶尔的脚步与关门声、窗外车流",
        "环境音，安静持续，无人声，无音乐，可无缝循环"),
    sfx("amb-alley",  "老城区窄巷环境音：巷子回声、远处犬吠、偶尔经过的电动车、风穿过晾衣绳",
        "环境音，安静持续，无人声，无音乐，可无缝循环"),
    sfx("amb-ktv",    "KTV 走廊环境音：厚重地毯吸音后的混响、远处包厢闷闷的歌声与笑声、空调声",
        "环境音，安静持续，无人声（只有远处模糊的闷响），无音乐，可无缝循环"),
    sfx("amb-office", "办公室环境音：中央空调送风、稀疏的键盘敲击、远处打印机与电话铃",
        "环境音，安静持续，无人声，无音乐，可无缝循环"),
    sfx("amb-capital","投资大厦交易室环境音：低频的设备嗡鸣、偶尔的键盘与鼠标点击、电梯到站提示",
        "环境音，安静持续，无人声，无音乐，可无缝循环"),
    sfx("amb-park",   "滨河公园环境音：鸟鸣、江水轻拍、风过树叶、远处孩子玩耍的模糊声",
        "环境音，舒缓持续，无人声，无音乐，可无缝循环"),
    sfx("amb-library","图书馆环境音：极安静的空间感、偶尔翻书、远处脚步声、笔尖写字",
        "环境音，非常安静持续，无人声，无音乐，可无缝循环"),
    sfx("amb-boxing", "拳击馆环境音：沙袋被击打的闷响、围绳吱呀、呼吸声、远处跳绳落地",
        "环境音，持续，无人声，无音乐，可无缝循环"),
    sfx("amb-bar",    "酒吧环境音：低沉的交谈声、杯盏碰撞、远处点唱机传来的模糊音乐、冰块声",
        "环境音，持续，无人声（只有模糊的低语），无音乐，可无缝循环"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="audio 目录（会建 sfx/ 与 amb/ 子目录）")
    ap.add_argument("--group", choices=["sfx", "amb", "all"], default="all")
    ap.add_argument("--sleep", type=float, default=7.0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    groups = []
    if args.group in ("sfx", "all"):
        groups.append(("sfx", os.path.join(args.out, "sfx"), SFX))
    if args.group in ("amb", "all"):
        groups.append(("amb", os.path.join(args.out, "amb"), AMB))

    total = sum(len(items) for _, _, items in groups)
    print(f"共 {total} 条")
    for g, d, items in groups:
        print(f"  {g:<4} {len(items):>3} 条 -> {d}")
    if args.dry_run:
        for g, d, items in groups:
            print(f"\n=== {g} ===")
            for j in items:
                print("  " + j["file"])
        return 0

    key = os.environ.get("STEP_API_KEY", "").strip()
    if not key:
        print("请先设置 STEP_API_KEY", file=sys.stderr)
        return 2

    rc = 0
    for g, d, items in groups:
        os.makedirs(d, exist_ok=True)
        jobfile = os.path.join(args.out, f"_jobs_{g}.json")
        clean = []
        for j in items:
            j = dict(j)
            j.pop("dur", None)
            clean.append(j)
        with open(jobfile, "w", encoding="utf-8") as f:
            json.dump({"jobs": clean}, f, ensure_ascii=False, indent=1)
        print(f"\n=== {g} · {len(clean)} 条 ===")
        r = subprocess.run([sys.executable, GEN, "--jobs", jobfile, "--out", d,
                            "--sleep", str(args.sleep), "--retry", "3"])
        rc = rc or r.returncode
        os.remove(jobfile)
    return rc


if __name__ == "__main__":
    sys.exit(main())
