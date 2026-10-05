#!/usr/bin/env node
// 回归测试：doctor + 模板结构体检 + patch 写入/撤销闭环 + kit 区零污染
const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const here = __dirname;
const cli = join(here, '..', 'scripts', 'edit3d.mjs');
const tpl = join(here, '..', 'assets', 'template.html');
const tmp = join(here, '.tmp');
const scene = join(tmp, 'scene.html');
const node = process.execPath;
let failed = 0;

function run(args) { return spawnSync(node, [cli, ...args], { encoding: 'utf8' }); }
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  <- ' + String(detail).slice(0, 200)));
  if (!ok) failed++;
}

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const orig = readFileSync(tpl, 'utf8');
writeFileSync(scene, orig);

const d = run(['doctor']);
check('doctor 自检', d.status === 0 && /"template": "OK"/.test(d.stdout) && /"glbExport": "OK"/.test(d.stdout), d.stdout + d.stderr);

const c0 = run(['check', scene]);
check('模板结构体检 check 全绿', c0.status === 0 && c0.stdout.includes('✓ 全绿'), c0.stdout + c0.stderr);

const m = run(['manifest', scene, '--json']);
let man = null;
try { man = JSON.parse(m.stdout); } catch (e) {}
check('manifest 可解析', m.status === 0 && Array.isArray(man) && man.length > 10, m.stdout.slice(0, 150));
const perUnit = man && man.find(p => p.path === 'perUnit');
check('测量参数 perUnit 已登记', !!perUnit, 'manifest 无 perUnit');

const a = run(['apply', scene, '--set', 'perUnit=2', '--note', '回归测试：单位换算改 2 米']);
check('apply 参数补丁', a.status === 0 && a.stdout.includes('1 条已写入'), a.stdout + a.stderr);

const l1 = run(['list', scene]);
check('list 记录补丁', l1.status === 0 && l1.stdout.includes('perUnit') && l1.stdout.includes('共 1 条'), l1.stdout);

const u = run(['undo', scene]);
const l2 = run(['list', scene]);
check('undo 回出厂', u.status === 0 && l2.stdout.includes('（无编辑，出厂状态）'), u.stdout + l2.stdout);

const c1 = run(['check', scene]);
check('补丁往返后 check 仍全绿', c1.status === 0, c1.stdout + c1.stderr);

const kitRegion = s => { const m2 = s.match(/\/\/<<3d-edit:kit[\s\S]*?\/\/<<\/3d-edit:kit>>/); return m2 ? m2[0] : ''; };
check('kit 区零污染', kitRegion(readFileSync(scene, 'utf8')) === kitRegion(orig) && kitRegion(orig).length > 0, 'kit 区被改动');

check('GLB 导出 API 在位', /async glb\(\)/.test(orig) && /saveGlb/.test(orig));
check('测量模式 API 在位', /measure\(t\)/.test(orig) && /updMeas\(\)/.test(orig));

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? 'ALL_PASS' : failed + ' FAILED');
process.exit(failed === 0 ? 0 : 1);
