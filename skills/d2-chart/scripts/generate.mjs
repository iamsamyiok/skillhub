#!/usr/bin/env node
'use strict';
// D2 图表一键生成链路：
//   JSON spec 文件 → 结构校验 → 生成 D2 源码 → 真实编译器验证 → 输出 .d2（+ 可选内嵌预览 HTML）
//   或已有 D2 文件 → 编译器验证 → 输出（+ 可选内嵌预览 HTML）
//
// 用法：node scripts/generate.mjs <spec.json> [-o 输出前缀] [--preview [输出.html]]
//       node scripts/generate.mjs --from-d2 <file.d2> [--preview [输出.html]]
//   -o        输出文件前缀（默认与 spec 同名），生成 <前缀>.d2
//   --preview 额外生成单文件内嵌版预览 HTML（<前缀>-preview.html），双击离线可用
// spec 格式见 SKILL.md；校验失败时 exit 1 并逐条打印错误

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec } from './validate_spec.mjs';
import { jsonToD2 } from './json_to_d2.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const specPath = process.argv[2];
if (!specPath) {
  console.error('用法：node scripts/generate.mjs <spec.json> [-o 输出前缀] [--preview [输出.html]]');
  console.error('      node scripts/generate.mjs --from-d2 <file.d2> [--preview [输出.html]]');
  process.exit(2);
}
const argIs = (flag) => {
  const i = process.argv.indexOf(flag);
  return i < 0 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true);
};
const wantPreview = argIs('--preview');

const { D2 } = await import('@terrastruct/d2');
const d2c = new D2();

let d2;
let d2Path;

if (specPath === '--from-d2') {
  const src = process.argv[3];
  if (!src) { console.error('FAIL：--from-d2 需要 D2 源文件路径'); process.exit(2); }
  try {
    d2 = readFileSync(src, 'utf8');
  } catch (e) {
    console.error(`FAIL：无法读取 D2 文件：${e.message}`);
    process.exit(2);
  }
  d2Path = src;
} else {
  const outPrefix = argIs('-o') || specPath.replace(/\.json$/i, '');
  const previewPath = typeof wantPreview === 'string' ? wantPreview : `${outPrefix}-preview.html`;

  let spec;
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8'));
  } catch (e) {
    console.error(`FAIL：spec 文件不是合法 JSON：${e.message}`);
    process.exit(2);
  }

  // 1. 结构校验
  const v = validateSpec(spec);
  if (!v.ok) {
    console.log('FAIL：spec 校验未通过');
    for (const e of v.errors) console.log(`  - [${e.path}] ${e.message}`);
    process.exit(1);
  }

  // 2. 生成 D2 源码
  d2 = jsonToD2(spec);
  d2Path = `${outPrefix}.d2`;
}

// 3. 真实编译器验证（语法/结构兜底，报错转人话供 Agent 修复循环）
try {
  await d2c.compile(d2, { layout: 'dagre' });
} catch (e) {
  console.log('FAIL：D2 编译未通过（生成器 bug 或 spec 越界，请把以下信息反馈修复）');
  try {
    for (const it of JSON.parse(e.message)) console.log(`  - ${(it.errmsg || '').replace(/^index:\d+:\d+:\s*/, '')}`);
  } catch { console.log('  - ' + String(e.message).slice(0, 300)); }
  process.exit(1);
}

// 4. 落盘
writeFileSync(d2Path, d2);
console.log(`OK：D2 编译通过`);
console.log(`  D2 源码：${d2Path}`);

if (wantPreview) {
  const { execFileSync } = await import('node:child_process');
  const previewPath = typeof wantPreview === 'string' ? wantPreview : `${d2Path.replace(/\.d2$/i, '')}-preview.html`;
  execFileSync(process.execPath, [join(here, 'build_preview.mjs'), d2Path, previewPath], { stdio: 'inherit' });
  console.log(`  预览页：${previewPath}（双击离线打开）`);
}
process.exit(0);
