#!/usr/bin/env node
/* aft 回归测试 —— local 通道回环：send → status → recv → verify → 篡改/错码/续传/幂等/清理
   期望输出末行 ALL_PASS（与 3d-edit 同约定，可被 CI grep） */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');

const HERE = __dirname;
const CLI = path.join(HERE, '..', 'scripts', 'transfer.py');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aft-test-'));
const store = path.join(tmp, 'store');
const src = path.join(tmp, 'src');
fs.mkdirSync(path.join(src, 'proj', 'nested'), { recursive: true });

// 样例：文本 + 256KB 随机二进制 + 嵌套目录文件（chunk 64K → 多分片）
fs.writeFileSync(path.join(src, 'readme.txt'), 'hello aft\n'.repeat(100));
fs.writeFileSync(path.join(src, 'blob.bin'), createHash ? randomBytes(256 * 1024) : Buffer.alloc(1));
fs.writeFileSync(path.join(src, 'proj', 'nested', 'deep.json'), JSON.stringify({ a: 1, b: [1, 2, 3] }));

function randomBytes(n) {
  const { randomFillSync } = require('crypto');
  const b = Buffer.alloc(n);
  randomFillSync(b);
  return b;
}
function run(args, expectCode = 0) {
  const r = spawnSync('python3', [CLI, ...args, '--provider', 'local', '--dir', store],
    { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (!Number.isInteger(expectCode)) return { code: r.status, out };
  if (r.status !== expectCode) {
    console.log(`FAIL exit=${r.status} expect=${expectCode}\n${out}`);
    process.exit(1);
  }
  return { code: r.status, out };
}
function sha(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
let pass = 0;
function ok(name, cond) {
  if (!cond) { console.log(`FAIL ${name}`); process.exit(1); }
  pass++; console.log(`PASS ${name}`);
}

// t1 发送（固定码保证可复现）
const CODE = 'aft-TESTBX9';
let r = run(['send', path.join(src, 'readme.txt'), path.join(src, 'blob.bin'),
  path.join(src, 'proj'), '--code', CODE, '--chunk', '64K']);
ok('send OK 锚点', r.out.includes(`[aft] OK box=${CODE}`) && r.out.includes('parts='));
const partsTotal = parseInt(r.out.match(/parts=(\d+)\//)[1], 10);
ok('多分片产生', partsTotal >= 5);

// t2 status 完整性
r = run(['status', CODE]);
ok('status parts=k/k', new RegExp(`parts=${partsTotal}/${partsTotal}`).test(r.out));

// t3 recv 往返逐字节一致
const out1 = path.join(tmp, 'out1');
r = run(['recv', CODE, '--out', out1]);
ok('recv verified 锚点', r.out.includes(`verified=${partsTotal}/${partsTotal}`));
ok('文件字节一致', sha(path.join(out1, 'readme.txt')) === sha(path.join(src, 'readme.txt'))
  && sha(path.join(out1, 'blob.bin')) === sha(path.join(src, 'blob.bin'))
  && sha(path.join(out1, 'proj', 'nested', 'deep.json')) === sha(path.join(src, 'proj', 'nested', 'deep.json')));

// t4 verify 本地复验
r = run(['verify', CODE, '--out', out1]);
ok('verify 本地', r.out.includes('[aft] OK verified=local'));

// t5 错误配对码 → 2（box 与码同体，错码=查无此箱）
const boxDir = path.join(store, 'box', CODE);
r = run(['recv', 'aft-WRNGCD9', '--out', path.join(tmp, 'out-wrong')], 2);
ok('错码拒绝', r.out.includes('不存在'));

// t5b 篡改 manifest → 3（端到端 MAC 校验路径）
fs.copyFileSync(path.join(boxDir, 'manifest.bin'), path.join(tmp, 'manifest.bak'));
const mb = fs.readFileSync(path.join(boxDir, 'manifest.bin'));
mb[mb.length - 35] ^= 0x33;
fs.writeFileSync(path.join(boxDir, 'manifest.bin'), mb);
r = run(['recv', CODE, '--out', path.join(tmp, 'out-mac')], 3);
ok('manifest 篡改退3', r.out.includes('MAC'));
fs.copyFileSync(path.join(tmp, 'manifest.bak'), path.join(boxDir, 'manifest.bin'));

// t6 篡改一片 → 3
const partFile = fs.readdirSync(boxDir).filter(n => n.startsWith('part-'))[0];
const buf = fs.readFileSync(path.join(boxDir, partFile));
buf[buf.length - 40] ^= 0x5a;
fs.writeFileSync(path.join(boxDir, partFile), buf);
r = run(['recv', CODE, '--out', path.join(tmp, 'out-tamper')], 3);
ok('篡改拒绝', r.out.includes('哈希不符') || r.out.includes('MAC'));

// 恢复该片（重发同码 = 幂等重建，兼测续传语义）
r = run(['send', path.join(src, 'readme.txt'), path.join(src, 'blob.bin'),
  path.join(src, 'proj'), '--code', CODE, '--chunk', '64K']);
ok('幂等重发', r.out.includes(`[aft] OK box=${CODE}`));

// t7 断点续传：删缓存一片 + 删已落盘输出 → 重 recv 成功
const out2 = path.join(tmp, 'out2');
run(['recv', CODE, '--out', out2]);
const cacheDir = path.join(out2, '.aft-cache', CODE);
fs.unlinkSync(path.join(cacheDir, fs.readdirSync(cacheDir)[0]));
fs.unlinkSync(path.join(out2, 'blob.bin'));
r = run(['recv', CODE, '--out', out2]);
ok('续传重recv', r.out.includes(`verified=${partsTotal}/${partsTotal}`)
  && sha(path.join(out2, 'blob.bin')) === sha(path.join(src, 'blob.bin')));

// t8 不完整 box：删一片 → status 缺口 + recv 退 2 → 重发补齐
const parts = fs.readdirSync(boxDir).filter(n => n.startsWith('part-'));
fs.unlinkSync(path.join(boxDir, parts[parts.length - 1]));
r = run(['status', CODE]);
ok('status 见缺口', r.out.includes(`parts=${partsTotal - 1}/${partsTotal}`));
r = run(['recv', CODE, '--out', path.join(tmp, 'out3')], 2);
ok('不完整退2', r.out.includes('不完整'));
run(['send', path.join(src, 'readme.txt'), path.join(src, 'blob.bin'),
  path.join(src, 'proj'), '--code', CODE, '--chunk', '64K']);
r = run(['recv', CODE, '--out', path.join(tmp, 'out3')]);
ok('补齐后可收', r.out.includes(`verified=${partsTotal}/${partsTotal}`));

// t9 清箱
run(['clean', CODE]);
r = run(['status']);
ok('清箱后空', !r.out.includes(CODE));

console.log(`ALL_PASS (${pass} checks)`);
fs.rmSync(tmp, { recursive: true, force: true });
