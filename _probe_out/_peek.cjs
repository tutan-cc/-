const fs = require("fs");
const src = fs.readFileSync("_bf_k2_ab.cjs", "utf8").split("\n");
src.forEach((l, i) => { if (l.indexOf("require(") >= 0 || l.indexOf("use strict") >= 0) console.log((i + 1) + ": " + l); });
console.log("--- 62..66 ---");
console.log(src.slice(61, 66).join("\n"));
