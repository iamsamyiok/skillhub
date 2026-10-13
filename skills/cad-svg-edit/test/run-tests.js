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

// ---------- v3.0 CADCraft bridge 测试 ----------
const bridge = path.join(here, '..', 'scripts', 'cadcraft-bridge.mjs');
const ccTmp = path.join(tmp, 'cc');
fs.mkdirSync(ccTmp, { recursive: true });

// 无二进制路径：禁用扫描 → found:false + exit 2
const dNo = spawnSync(node, [bridge, 'doctor'], { encoding: 'utf8', env: { ...process.env, CADCRAFT_SCAN: '0', CADCRAFT_CLI: '' } });
check('bridge doctor 降级路径', dNo.status === 2 && /"found":false/.test(dNo.stdout), dNo.stdout + dNo.stderr);

// 二进制可用时跑端到端；不可用则跳过
const dOk = spawnSync(node, [bridge, 'doctor'], { encoding: 'utf8' });
const ccAvail = dOk.status === 0 && /"found":true/.test(dOk.stdout);
if (!ccAvail) {
  console.log('SKIP  bridge 端到端（未安装 cadcraft-cli，A+ 后端不可用）');
} else {
  const job = path.join(examples, 'flange-cc.job.json');
  const jobJson = JSON.parse(fs.readFileSync(job, 'utf8'));
  jobJson.out = ccTmp;
  const jobPath = path.join(ccTmp, 'job.json');
  fs.writeFileSync(jobPath, JSON.stringify(jobJson));

  const r = spawnSync(node, [bridge, 'run', jobPath], { encoding: 'utf8' });
  let ack = null;
  try { ack = JSON.parse(r.stdout); } catch {}
  const filesOk = ack && ['dxf', 'png', 'svg'].every(k => ack.files[k] && fs.existsSync(ack.files[k]) && fs.statSync(ack.files[k]).size > 0);
  check('bridge run 法兰示例', r.status === 0 && filesOk && ack.handles.length >= 5, (r.stderr || r.stdout));

  const dxf = ack ? ack.files.dxf : '';
  const v1 = spawnSync(node, [bridge, 'verify', dxf, '--expect', '{"Circle":11,"MText":1,"Dimension":1}'], { encoding: 'utf8' });
  check('bridge verify 断言通过', v1.status === 0 && /"pass":true/.test(v1.stdout), v1.stdout + v1.stderr);

  const v2 = spawnSync(node, [bridge, 'verify', dxf, '--expect', '{"Circle":999}'], { encoding: 'utf8' });
  check('bridge verify 断言失败退出 1', v2.status === 1 && /"pass":false/.test(v2.stdout), v2.stdout + v2.stderr);

  const q = spawnSync(node, [bridge, 'query', dxf, '--type', 'Circle'], { encoding: 'utf8' });
  let qc = null; try { qc = JSON.parse(q.stdout); } catch {}
  check('bridge query 圆计数', q.status === 0 && qc && qc.count === 11, q.stdout.slice(0, 120));

  const c = spawnSync(node, [bridge, 'convert', dxf, '--svg', path.join(ccTmp, 'w.svg'), '--window', '-200,-200,200,250'], { encoding: 'utf8' });
  check('bridge convert 取景导出', c.status === 0 && fs.existsSync(path.join(ccTmp, 'w.svg')), c.stdout + c.stderr);

  const badJob = { name: 'badcc', commands: [{ cmd: 'offset', params: { handle: 'HANDLE[9]', distance: 1, side: [0, 0] } }], out: ccTmp };
  const bj = path.join(ccTmp, 'bad.json');
  fs.writeFileSync(bj, JSON.stringify(badJob));
  const rb = spawnSync(node, [bridge, 'run', bj], { encoding: 'utf8' });
  check('bridge run 坏占位符失败', rb.status === 1 && /无法解析/.test(rb.stderr), rb.stderr);
}

console.log(failed === 0 ? 'ALL_PASS' : failed + ' FAILED');
process.exit(failed === 0 ? 0 : 1);
