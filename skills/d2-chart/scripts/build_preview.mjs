#!/usr/bin/env node
'use strict';
// 生成「单文件内嵌版」预览 HTML：D2 渲染库（8MB wasm）与图表源码全部内联，
// 双击即可离线打开，无 CORS / 联网问题。
//
// 用法：node scripts/build_preview.mjs <diagram.d2> [输出.html]
//       echo "a -> b" | node scripts/build_preview.mjs - [输出.html]
// 不传源码文件时仅打包空模板（网页内含示例图）。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const template = readFileSync(join(root, 'web', 'index.html'), 'utf8');
const lib = readFileSync(join(root, 'vendor', 'd2.browser.js'), 'utf8');

// browser 构建含 3 处顶层导出（BrotliDecode / setupMessageHandler / D2），
// 普通内联 <script> 不允许 export 语句：逐一降级为局部声明 + window 挂载
if (!/export\{(\w+) as D2\}/.test(lib)) {
  console.error('FAIL：vendor/d2.browser.js 导出形态变化，无法内联（期望 export{X as D2}）');
  process.exit(2);
}
const libInline = lib
  .replace(/export\{(\w+) as D2\};?/, 'window.D2Class=$1;')
  .replace(/export let BrotliDecode =/, 'let BrotliDecode =')
  .replace(/export function setupMessageHandler\(/, 'function setupMessageHandler(');
if (/^export /m.test(libInline)) {
  console.error('FAIL：内联库中仍有未处理的 export 语句');
  process.exit(2);
}
// 防御：库内字符串字面量若含 </script 序列会提前终结 HTML script 块，转义之（JS 中 \/ 等价 /）
const libSafe = libInline.replace(/<\/(script)/gi, '<\\/$1');

let source = '';
if (process.argv[2] && process.argv[2] !== '-') {
  source = readFileSync(process.argv[2], 'utf8');
} else if (process.argv[2] === '-') {
  source = readFileSync(0, 'utf8');
}

const out = process.argv[3] || 'd2-preview.html';
// 关键：replacement 必须用函数形式——字符串形式的 $&/$'/$1 会被特殊展开，
// 8MB minified 库里大量 $ 序列会把整个模板污染成非法 HTML
const html = template
  .replace('<!--D2_LIB_INLINE-->', () => `<script>\n${libSafe}\n</script>`)
  .replace(
    '<script type="module">',
    () => `<script>window.EMBEDDED_D2 = ${JSON.stringify(source).replace(/<\/(script)/gi, '<\\/$1')};\n</script>\n<script type="module">`
  );

writeFileSync(out, html);
console.log(`OK：已生成 ${out}（${(html.length / 1024 / 1024).toFixed(1)} MB，内嵌渲染库，双击离线可用${source ? '，已注入图表源码' : ''}）`);
