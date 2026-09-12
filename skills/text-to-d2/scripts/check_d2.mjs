#!/usr/bin/env node
'use strict';
// D2 源码语法校验 CLI（Agent 自动修复循环用）
// 用法：node scripts/check_d2.mjs <file.d2 | ->   （- = stdin）
// 输出：ok 时 exit 0；错误时 exit 1 并打印结构化错误（行:列 + 信息 + 修复提示）

import { readFileSync } from 'node:fs';

// 注意：用动态 import（node-esm 入口）。包的 node-cjs 入口在其顶层 "type":"module"
// 下会被误判为 ESM（包自身 bug），createRequire 会踩坑。
const { D2 } = await import('@terrastruct/d2');

const arg = process.argv[2];
if (!arg) {
  console.error('用法：node scripts/check_d2.mjs <file.d2 | ->');
  process.exit(2);
}
const src = arg === '-' ? readFileSync(0, 'utf8') : readFileSync(arg, 'utf8');

const d2 = new D2();
try {
  await d2.compile(src, { layout: 'dagre' });
  console.log('OK：D2 语法校验通过');
  process.exit(0);
} catch (e) {
  // compile 抛错 message 是 JSON 数组：[{range:"file,l:c:c-l:c:c", errmsg}, ...]
  let items = [];
  try { items = JSON.parse(e.message); } catch { items = null; }
  console.log('FAIL：D2 语法错误');
  if (Array.isArray(items)) {
    for (const it of items) {
      const m = /:(\d+):(\d+):/.exec(it.errmsg || '');
      const loc = m ? `第 ${m[1]} 行第 ${m[2]} 列：` : '';
      console.log(`  - ${loc}${(it.errmsg || '').replace(/^index:\d+:\d+:\s*/, '')}`);
    }
    console.log('修复提示：常见错误为括号/引号不匹配、连线缺少端点、未知 shape 名。修复后重新校验。');
  } else {
    console.log('  - ' + String(e.message).slice(0, 500));
  }
  process.exit(1);
}
// Go WASM 运行时不会自行退出
process.exit(process.exitCode ?? 0);
