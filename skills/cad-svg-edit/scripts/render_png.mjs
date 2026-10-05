#!/usr/bin/env node
// svg-edit: SVG -> PNG 渲染（可选能力，支撑 VLM 视觉定位）
// 依赖：@resvg/resvg-js（可选，从 cwd/node_modules 或 WORKBUDDY_NODE_MODULES 解析）。缺失时给出安装提示并退出非 0。
//
// 用法：
//   node render_png.mjs <input.svg> [output.png] [--bg "#ffffff" | --transparent] [--zoom 2]
//
// 说明：CAD 蓝图多为透明底，渲染时建议 --bg "#ffffff" 加白底以免黑底不可见。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("ERR usage: render_png.mjs <input.svg> [output.png] [--bg #ffffff] [--transparent] [--zoom N]");
  process.exit(1);
}

const input = args[0];
let output = args[1] && !args[1].startsWith("--") ? args[1] : input.replace(/\.svg$/i, ".png");
let bg = "#ffffff";
let transparent = false;
let zoom = 2;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--bg") bg = args[++i];
  else if (args[i] === "--transparent") transparent = true;
  else if (args[i] === "--zoom") zoom = parseFloat(args[++i]) || 2;
}

if (!existsSync(input)) {
  console.error(`ERR 文件不存在: ${input}`);
  process.exit(1);
}

let Resvg;
try {
  // ESM 的 import() 不认 NODE_PATH，改用 createRequire 从候选目录解析 CJS 包
  const candidates = [
    process.env.WORKBUDDY_NODE_MODULES,
    path.join(process.cwd(), "node_modules"),
    path.join(path.dirname(new URL(import.meta.url).pathname), "..", "node_modules"),
  ].filter(Boolean);
  let mod = null;
  let lastErr = null;
  for (const base of candidates) {
    try {
      const req = createRequire(path.join(base, "__anchor__.js"));
      mod = req("@resvg/resvg-js");
      if (mod) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!mod) throw lastErr || new Error("not found");
  Resvg = mod.Resvg || (mod.default && mod.default.Resvg) || mod.default;
  if (!Resvg) throw new Error("@resvg/resvg-js 未导出 Resvg");
} catch (e) {
  console.error("ERR 未找到 @resvg/resvg-js。请先安装：");
  console.error('  cd <任意工作目录> && npm install @resvg/resvg-js');
  console.error("  或设置环境变量 WORKBUDDY_NODE_MODULES 指向含该包的 node_modules 目录");
  process.exit(2);
}

const svg = readFileSync(input, "utf8");
const opts = {
  fitTo: { mode: "zoom", value: zoom },
  font: { loadSystemFonts: true },
};
if (!transparent) {
  opts.background = bg;
}

const resvg = new Resvg(svg, opts);
const png = resvg.render();
const buf = png.asPng();
writeFileSync(output, buf);

console.log(JSON.stringify({
  ok: true,
  png: path.resolve(output),
  bytes: buf.length,
  renderedSize: { width: png.width, height: png.height },
  zoom,
}));
