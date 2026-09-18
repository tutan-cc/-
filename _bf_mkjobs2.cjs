/* 生成 _bf_jobs2_a.json / _bf_jobs2_b.json：**from 段直接从句柄文件里抠真实字节**，
   避免手抄长中文段落出错（唯一性 / 幂等由 _bf_patch.cjs 在写入前再校验一遍）。 */
"use strict";
const fs = require("fs"), path = require("path");
const OUT = __dirname;
const B = fs.readFileSync(path.join(OUT, "breakfast.js"), "utf8");
const NEW = f => ({ textFile: f });

/** 抠出 [from 的第一个字符 .. to 的最后一个字符]（含两端），并校验 from/to 各只出现 1 次 */
function seg(from, to, label) {
  const i = B.indexOf(from);
  if (i < 0) throw new Error("找不到 from：" + label + "\n  " + from.slice(0, 80));
  if (B.indexOf(from, i + 1) >= 0) throw new Error("from 不唯一：" + label);
  const j = B.indexOf(to, i);
  if (j < 0) throw new Error("找不到 to：" + label + "\n  " + to.slice(0, 80));
  const end = j + to.length;
  const s = B.slice(i, end);
  if (B.indexOf(s, i + 1) >= 0) throw new Error("from..to 段不唯一：" + label);
  return s;
}
const w = (name, obj) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2), "utf8");

/* ═══ A：加载器 / 映射表 / 背景 ═══ */
const jobsA = { jobs: [] };
jobsA.jobs.push({
  file: "breakfast.js",
  from: "  var GEAR_ICON = mkIconGroup(\"gear\", \"art/icons/gear/\",\n    [\"pot\", \"griddle\", \"steamer\", \"plate_empty\", \"plate_egg_bacon\", \"plate_bun\", \"juice_jug\", \"tray\", \"tools\"]);\n  var FACE_ICON = mkIconGroup(\"face\", \"art/icons/faces/\",\n    [\"stud_calm\", \"stud_urgent\", \"office_calm\", \"office_urgent\", \"uncle_calm\", \"uncle_urgent\"]);",
  textFile: "_bf_new2_groupids.txt"
});
jobsA.jobs.push({ file: "breakfast.js", from: "  FACE_ICON.urgentAt = 0.40;", to: "（阈值常量，可调）", textFile: "_bf_new2_urgent.txt" });
/* 背景槽 + v2 测量常量 + initBackground()（结束锚 = initBackground 的收尾；
   后面的 bgDrawArgs / counterTopCanvasY 交给 job#5 整体换成新版）*/
const bgEnd = "    return BG_IMG;\n  }\n  /** 重新预加载**全部**贴图（4 组 + 背景）；baseDir 给测试用来强制「全部加载失败」 */";
if (B.indexOf(bgEnd) < 0) throw new Error("找不到背景块结束锚");
jobsA.jobs.push({ file: "breakfast.js", from: "  var BG_IMG = {", to: bgEnd, textFile: "_bf_new2_bg.txt" });
jobsA.jobs.push({ file: "breakfast.js", from: "  var GEAR_OF_KIND = { pot:\"pot\"", to: "    return FACE_KINDS[k] + (n > FACE_ICON.urgentAt ? \"_calm\" : \"_urgent\");\n  }", textFile: "_bf_new2_plateface.txt" });
jobsA.jobs.push({ file: "breakfast.js", from: "  function bgDrawArgs(img) {", to: "    return Math.round(BG_IMG.counterTopInCrop * H / c.h * 10) / 10;\n  }", textFile: "_bf_new2_bgmeta.txt" });
jobsA.jobs.push({ file: "breakfast.js", from: "  var art = {", to: "      return n;\n    }\n  };\n\n\n  var PAL = {\n    ink:\"#f6efe2\"", textFile: "_bf_new2_art.txt" });
w("_bf_jobs2_a.json", jobsA);

/* ═══ B：drawBg / drawCustomerFace / faces() / tex() ═══ */
const jobsB = { jobs: [] };
jobsB.jobs.push({
  file: "breakfast.js",
  from: seg("    /* 背景：最底层先铺 art/bg/kitchen.png", "      g.fillStyle = rg; g.fillRect(0, LAY.topH, W, H - LAY.topH);\n    }", "drawBg"),
  textFile: "_bf_new2_drawbg.txt"
});
jobsB.jobs.push({
  file: "breakfast.js",
  from: seg("    /** 顾客头像贴图：耐心 > FACE_ICON.urgentAt（40%）→ 平静脸", "      drawAvatar(g, box.x + 38, box.y + 58, 21, c.id);\n      return false;\n    }", "drawCustomerFace"),
  textFile: "_bf_new2_face.txt"
});
w("_bf_jobs2_b.json", jobsB);
console.log("生成 _bf_jobs2_a.json（" + jobsA.jobs.length + " 个 job）与 _bf_jobs2_b.json（" + jobsB.jobs.length + " 个 job）");
