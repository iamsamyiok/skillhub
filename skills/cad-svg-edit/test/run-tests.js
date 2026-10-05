#!/usr/bin/env node
// 回归测试：doctor + 全部正例示例 + bad.js 负例
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const here = __dirname;
const engine = path.join(here, '..', 'engine', 'cad-engine.js');
const examples = path.join(here, '..', 'examples');
const tmp = path.join(here, '.tmp');
const node = process.execPath;
let failed = 0;

function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  <- ' + String(detail).slice(0, 200)));
  if (!ok) failed++;
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const d = spawnSync(node, [engine, 'doctor'], { encoding: 'utf8' });
check('doctor 自检', d.status === 0 && /"smoke":\s*"OK"/.test(d.stdout), d.stdout + d.stderr);

const good = ['gear.js', 'house.js', 'nut.js', 'flange.js'];
for (const f of good) {
  const base = f.replace('.js', '');
  const outDir = path.join(tmp, base);
  const r = spawnSync(node, [engine, path.join(examples, f), '--all', '--out', outDir, '--name', base], { encoding: 'utf8' });
  const filesOk = ['svg', 'csv', 'dxf'].every(ext => {
    const p = path.join(outDir, base + '.' + ext);
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  });
  check('示例 ' + f, r.status === 0 && filesOk, (r.stderr || r.stdout));
}

const bad = spawnSync(node, [engine, path.join(examples, 'bad.js'), '--svg', '--out', tmp, '--name', 'bad'], { encoding: 'utf8' });
check('示例 bad.js 期望失败', bad.status !== 0, '意外成功');

console.log(failed === 0 ? 'ALL_PASS' : failed + ' FAILED');
process.exit(failed === 0 ? 0 : 1);
