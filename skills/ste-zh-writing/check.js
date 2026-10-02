#!/usr/bin/env node
// STE-ZH 写作规范检查器（skill 自带）
// 用法: node check.js <文件.md|txt> [--min 90]
// 退出码: 0 = 达标（得分 >= min 且无错误级）；1 = 未达标；2 = 用法/文件错误
const fs = require('fs');
const path = require('path');
const SteZh = require('./engine.js');

const args = process.argv.slice(2);
let file = null, min = 90;
for (const a of args) {
  if (a === '--min') continue;
  if (/^\d+$/.test(a) && args[args.indexOf(a) - 1] === '--min') { min = +a; continue; }
  if (!a.startsWith('--')) file = a;
}
if (!file) {
  console.error('用法: node check.js <文件.md|txt> [--min 90]');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`文件不存在: ${file}`);
  process.exit(2);
}

const text = fs.readFileSync(file, 'utf8');
const r = SteZh.analyze(text);
const errs = r.violations.filter(v => v.sev === '错误').length;
const pass = r.score >= min && errs === 0;

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log('=== STE-ZH 技术写作规范检查 ===');
console.log(`文件: ${file}`);
console.log(`字数: ${r.stats.chars}  句数: ${r.stats.sentences}  步骤: ${r.stats.steps}  问题: ${r.stats.issues}`);
console.log(`得分: ${r.score}/100  等级: ${r.grade}  错误级: ${errs}  门禁: 得分>=${min} 且 错误级=0`);
console.log('');

if (r.violations.length === 0) {
  console.log('未发现问题。');
} else {
  console.log(pad('ID', 6) + pad('级别', 6) + pad('规则', 16) + '说明');
  console.log('-'.repeat(72));
  r.violations.forEach(v => {
    console.log(pad(v.id, 6) + pad(v.sev, 6) + pad(v.name, 16) + `[${v.matched}] ${v.fix}`);
  });
  console.log('-'.repeat(72));
}
console.log(pass ? `达标（${r.score} 分，错误级 ${errs}）。` : `未达标（${r.score} 分，错误级 ${errs}）。先清零错误级，再处理建议级。`);
process.exit(pass ? 0 : 1);
