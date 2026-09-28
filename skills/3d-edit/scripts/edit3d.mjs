#!/usr/bin/env node
/* ============================================================================
 * edit3d.mjs — 3d-edit 技能：对单文件 HTML 场景做确定性 patch 与结构体检
 *
 * 设计：写文件（离线、可脚本化）与看效果（浏览器 + CITY.shot）分离。
 *       本脚本只碰两处标记区：patches（编辑数据）和 kit（运行时，用 sync 维护）。
 *
 *   node edit3d.mjs check    <file>             结构体检：标记区/锚点唯一性/MANIFEST/kit 同步态
 *   node edit3d.mjs find     <file> <词>        口语 → 可编辑地址（参数/实体）
 *   node edit3d.mjs manifest <file> [--json]    参数说明书
 *   node edit3d.mjs entities <file> [--like X]  场景注册的语义实体 id
 *   node edit3d.mjs list     <file>             当前 patches
 *   node edit3d.mjs apply    <file> --set k=v --note "..." --entity id:prop=v --preset 3
 *   node edit3d.mjs apply    <file> --json '[{"op":"param","path":"fog","value":0.002}]'
 *   node edit3d.mjs apply    <file> --json '[{"op":"add","id":"prop-1-box","kind":"box","props":{...}}]'
 *                            op 支持 param/entity/preset/add/remove；add.kind ∈ box/cyl/cone/sphere/torus/plane
 *                            remove 只能删 op:add 加出来的物件（原生几何走 visible=false 或锚点手术）
 *   node edit3d.mjs undo     <file> [n]         丢弃最后 n 条 patch（默认 1）
 *   node edit3d.mjs clear    <file>             清空 patches（回出厂状态）
 *   node edit3d.mjs upgrade  <file>             给 v1.0 老文件注入 patches+kit 区
 *   node edit3d.mjs sync     <file>             用技能内 editkit.js 覆盖 kit 区
 *   node edit3d.mjs editor   <file> [--install|--remove|--status]  人工编辑宿主页 editor.html 装卸（不碰场景文件）
 *   node edit3d.mjs serve    [dir|file] [--port 5173]  本地 http + 接收页内「保存」写回 patches 区
 *
 * 退出码：0 成功 / 2 参数或校验错误 / 3 文件结构不合规
 * ==========================================================================*/
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { createServer } from 'node:http';

const KIT_MARK_OPEN = '//<<3d-edit:kit';
const KIT_MARK_CLOSE = '//<</3d-edit:kit>>';
const P_OPEN = '//<<3d-edit:patches>>';
const P_CLOSE = '//<</3d-edit:patches>>';
const here = decodeURIComponent(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const die = (msg, code = 2) => { console.error('✗ ' + msg); process.exit(code); };
const ok = msg => console.log('✓ ' + msg);
const J = v => JSON.stringify(v, null, 1);
const stripMarks = (s, name) => s.split('\n').filter(l => !new RegExp('^\\s*\\/\\/<<\\/?3d-edit:(?:' + name + ')').test(l)).join('\n').trim();

function read(file) {
  const p = resolve(file);
  if (!existsSync(p)) die('文件不存在: ' + p);
  const src = readFileSync(p, 'utf8');
  if (!/three/i.test(src)) die('看起来不是 three.js 场景 HTML: ' + file, 3);
  return { p, src };
}
const write = ({ p, src }) => { writeFileSync(p, src, 'utf8'); return p; };

/* ---------- 标记区读写 ---------- */
function region(src, open, close) {
  const a = src.indexOf(open), b = src.indexOf(close);
  if (a < 0 || b < 0) return null;
  return { start: a, end: b + close.length, body: src.slice(a + open.length, b) };
}
function setRegion(src, open, close, body) {
  const r = region(src, open, close);
  if (!r) return src;
  /* 折叠历史遗留的叠层 close 标记（早期 sync 多写了一行），否则越sync越长 */
  const re = new RegExp('^\\s*' + close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n?');
  let tail = src.slice(r.end);
  while (re.test(tail)) tail = tail.replace(re, '');
  return src.slice(0, r.start) + open + '\n' + stripMarks(body, 'kit|ui|patches').trim() + '\n' + close + tail;
}

const kitSource = () => stripMarks(readFileSync(resolve(here, '../assets/editkit.js'), 'utf8'), 'kit');

/* ---------- patches ---------- */
function readPatches(src) {
  const r = region(src, P_OPEN, P_CLOSE);
  if (!r) return [];
  const m = r.body.match(/window\.__3D_EDITS__\s*=\s*(\[[\s\S]*\])/);
  if (!m) return [];
  try { return Function('"use strict";return (' + m[1] + ')')(); }
  catch (e) { die('patches 区不是合法 JS 数组: ' + e.message, 3); }
}
const patchesBlock = arr =>
  `window.__3D_EDITS__ = ${arr.length ? '[\n' + arr.map(p => ' ' + JSON.stringify(p)).join(',\n') + '\n]' : '[]'};`;

/* ---------- 场景侧清单（静态解析，不跑浏览器） ---------- */
function manifest(src) {
  const m = src.match(/const\s+MANIFEST\s*=\s*(\[[\s\S]*?\n\]);/);
  if (!m) return [];
  let arr;
  try { arr = Function('"use strict";return (' + m[1] + ')')(); }
  catch (e) { die('MANIFEST 解析失败（检查是否只用字面量）: ' + e.message, 3); }
  return arr.map(d => ({ path: d.path, label: d.label, kind: d.kind || 'number',
    effect: d.effect || 'rebuild', min: d.min, max: d.max, step: d.step,
    unit: d.unit, aliases: d.aliases || [], desc: d.desc }));
}
const configDefaults = src => {
  const m = src.match(/const\s+CONFIG\s*=\s*(\{[\s\S]*?\n\});/);
  if (!m) return {};
  try { return Function('"use strict";return (' + m[1].replace(/\/\/[^\n]*/g, '') + ')')(); }
  catch { return {}; }
};
function entities(src, like) {
  const out = [];
  const re = /SCENE\.reg\(\s*(`[^`]*`|'[^']*'|"[^"]*")\s*,([\s\S]*?)\{([\s\S]*?)\}\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const id = m[1].replace(/[`'"]/g, '');
    const meta = m[3] || '';
    const label = (meta.match(/label:\s*(`[^`]*`|'[^']*')/) || [, ''])[1].replace(/[`']/g, '');
    const group = (meta.match(/group:\s*'([^']*)'/) || [, ''])[1];
    if (like && !(id.includes(like) || label.includes(like) || group.includes(like))) continue;
    out.push({ id, label, group });
  }
  return out;
}

/* ---------- 值解析与校验 ---------- */
function parseVal(s) {
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return +s;
  if (/^0x[0-9a-fA-F]{6}$/.test(s)) return s;         // 以字符串存，运行时 hex 解析，diff 友好
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (s === 'true' || s === 'false') return s === 'true';
  if (/^\[.*\]$/.test(s) || /^\{.*\}$/.test(s)) return JSON.parse(s);
  return s;
}
function checkParam(p, man, cfg) {
  const d = man.find(x => x.path === p.path);
  if (!d) {
    const near = man.filter(x => x.path.includes(p.path) || (x.aliases || []).some(a => p.path.includes(a))).map(x => x.path);
    die(`未知参数 ${p.path}` + (near.length ? `；近似候选: ${near.slice(0, 6).join(', ')}` : `；先跑 find/manifest`));
  }
  const cur = p.path.split('.').reduce((a, k) => (a == null ? a : a[k]), cfg);
  if (d.kind === 'number') {
    if (typeof p.value !== 'number') die(`${p.path} 需要数字，得到 ${JSON.stringify(p.value)}`);
    const lo = d.min ?? -Infinity, hi = d.max ?? Infinity;
    if (p.value < lo || p.value > hi) die(`${p.path}=${p.value} 超出范围 [${lo}, ${hi}]`);
  }
  if (d.kind === 'color' && !/^(#[0-9a-fA-F]{6}|0x[0-9a-fA-F]{6}|\d+)$/.test(String(p.value)))
    die(`${p.path} 需要颜色，如 #ffd9a0 / 0xffd9a0`);
  return { ...d, current: cur };
}

/* ---------- 写回校验：只接受合法 op，只改 patches 区，落 .bak ---------- */
const XF_PROPS = new Set(['visible', 'translate', 'scale', 'rotateY', 'rotate']);
const MF_PROPS = new Set(['color', 'emissive', 'emissiveIntensity', 'opacity', 'roughness', 'metalness', 'intensity']);
const KINDS = new Set(['box', 'cyl', 'cone', 'sphere', 'torus', 'plane']);   // 与 kit 的 KIND_GEO 对齐
function validOps(arr, man) {
  if (!Array.isArray(arr)) return '不是数组';
  for (const x of arr) {
    if (!x || typeof x !== 'object') return '元素不是对象';
    if (x.op === 'param') { if (!man.some(d => d.path === x.path)) return '未知参数 path: ' + x.path; }
    else if (x.op === 'entity') { if (!XF_PROPS.has(x.prop) && !MF_PROPS.has(x.prop)) return '未知实体属性: ' + x.prop;
      if (!x.id) return 'entity 缺 id'; }
    else if (x.op === 'preset') { /* 机位号，不入历史，允许 */ }
    else if (x.op === 'add') { if (!/^[\w.\-]+$/.test(String(x.id || ''))) return 'add 缺 id 或含非法字符';
      if (!KINDS.has(x.kind)) return 'add 不支持的 kind: ' + x.kind + '（可用 ' + [...KINDS].join('/') + '）'; }
    else if (x.op === 'remove') { if (!x.id) return 'remove 缺 id'; }
    else return '未知 op: ' + x.op;
  }
  return null;
}
function writeBack(root, name, arr) {
  const target = resolve(root, name);
  if (!target.startsWith(resolve(root))) return { error: '路径越界' };
  if (!existsSync(target)) return { error: '文件不存在: ' + name };
  const src = readFileSync(target, 'utf8');
  if (!region(src, P_OPEN, P_CLOSE)) return { error: name + ' 没有 patches 区（先跑 upgrade）' };
  const err = validOps(arr, manifest(src));
  if (err) return { error: 'patch 校验不过: ' + err };
  writeFileSync(target + '.bak', src, 'utf8');
  const out = setRegion(src, P_OPEN, P_CLOSE, patchesBlock(arr));
  writeFileSync(target, out, 'utf8');
  return { ok: true, count: arr.length, file: name, bak: name + '.bak' };
}

/* ---------- 命令 ---------- */
function main() {
const [cmd, ...rest] = process.argv.slice(2);
const file = rest[0];
const flags = rest.slice(1);
const flag = name => { const i = flags.indexOf('--' + name); return i < 0 ? null : flags[i + 1]; };
const all = name => flags.reduce((a, f, i) => (f === '--' + name ? [...a, flags[i + 1]] : a), []);

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('=*=/')[0].replace(/^[\s\S]*?\/\*/, '').replace(/\*\/$/, ''));
  process.exit(0);
}

if (cmd === 'serve') {
  let root = resolve(file || '.');
  const entry = existsSync(root) && /\.[a-z0-9]{2,5}$/i.test(root) ? root.split(/[\\/]/).pop() : '';
  if (entry) root = root.slice(0, root.length - entry.length).replace(/[\\/]$/, '') || '.';   // 传的是文件 → 起其所在目录，避免全 404
  const port = +(flag('port') || 5173);
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css' };
  createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const u = decodeURIComponent(url.pathname);
    res.setHeader('access-control-allow-origin', '*');
    /* 人工编辑器「保存」的落点：只写 patches 区，先备份 .bak，非法 op 直接拒 */
    if (req.method === 'POST' && u === '/__save') {
      let body = '';
      req.on('data', c => (body += c)).on('end', () => {
        res.setHeader('content-type', 'application/json');
        let arr;
        try { arr = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('{"error":"body 不是 JSON"}'); }
        const name = (flag('file') || url.searchParams.get('file')
          || decodeURIComponent(req.headers['x-file'] || '') || entry || 'index.html')
          .split(/[\\/]/).pop().replace(/[^\w.\-]/g, '');
        if (!/^[\w.\-]+\.html?$/i.test(name)) { res.writeHead(400); return res.end('{"error":"文件名不合法: ' + name + '"}'); }
        const r = writeBack(root, name, arr);
        res.writeHead(r.ok ? 200 : 400);
        console.log((r.ok ? '✓ 写回 ' : '✗ 拒绝 ') + name + ' ' + (r.count || 0) + ' 条' + (r.error ? ' → ' + r.error : ''));
        res.end(JSON.stringify(r));
      });
      return;
    }
    let f = join(root, u === '/' ? (entry || 'index.html') : u);
    if (!existsSync(f) || !f.startsWith(root)) { res.writeHead(404); return res.end('404'); }
    if (!/\.[a-z0-9]+$/i.test(f)) f = join(f, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    readFileSync(f).length && res.end(readFileSync(f));
  }).listen(port, '127.0.0.1', () => console.log(`serving ${root} → http://localhost:${port}/${entry}
   人工编辑器：node edit3d.mjs editor <scene.html> --install 后开 http://localhost:${port}/editor.html?src=${entry || 'index.html'}`));
  return;
}

if (cmd === 'editor') {
  const { p, src } = read(file);
  const dir = p.slice(0, p.length - p.split(/[\\/]/).pop().length).replace(/[\\/]$/, '');
  const host = join(dir, 'editor.html');
  const name = p.split(/[\\/]/).pop();
  const ours = t => /3d-edit host v1/.test(t);
  const want = flags.includes('--remove') ? 'remove' : flags.includes('--status') ? 'status' : 'install';
  if (want === 'status') {
    if (!existsSync(host)) { console.log('! 未安装（跑 editor <file> --install）'); process.exit(1); }
    const oursOk = ours(readFileSync(host, 'utf8'));
    console.log((oursOk ? '✓ ' : '! ') + '宿主页面在位: ' + host + (oursOk ? '' : '  ⚠ 不是本技能装的，别覆盖'));
    console.log('  场景 kit: ' + (/kit:\s*'v1\.3'/.test(src) ? 'v1.3 ✓' : '需要 sync 到 v1.3 ✗'));
    console.log('  契约 controls: ' + (/three:\s*\{[^}]*controls/.test(src) ? '有 ✓'
      : '缺 ✗（拖 gizmo 会同时转相机；在 SCENE.three 里补 controls）'));
    process.exit(0);
  }
  if (want === 'remove') {
    if (!existsSync(host)) return ok('没有可移除的 editor.html');
    if (!ours(readFileSync(host, 'utf8'))) die(host + ' 不是本技能装的文件，拒绝删除（自己确认后再手动删）');
    rmSync(host);
    return ok('已移除 ' + host + '（场景文件本来就没被改过，patches/kit 区不受影响）');
  }
  if (!region(src, P_OPEN, P_CLOSE) || !region(src, KIT_MARK_OPEN, KIT_MARK_CLOSE))
    die('场景缺 patches/kit 区：先跑 upgrade + sync', 3);
  if (!/kit:\s*'v1\.3'/.test(src)) console.warn('! 场景 kit 不像 v1.3 —— 先跑 sync，否则编辑器会提示版本不匹配');
  if (existsSync(host) && !ours(readFileSync(host, 'utf8')))
    die('目录里已有非本技能装的 editor.html，拒绝覆盖: ' + host);
  writeFileSync(host, readFileSync(resolve(here, '../assets/editor.html'), 'utf8'), 'utf8');
  ok('已装宿主编辑器 → ' + host);
  console.log(`用法：node edit3d.mjs serve ${name} --port 8765
     然后浏览器打开 http://localhost:8765/editor.html?src=${name}
   场景文件本身一个字节都没多（UI 不进场景），只依赖它的 kit v1.3 + patches 区。`);
  return;
}

const { p, src } = read(file);

if (cmd === 'manifest') {
  const man = manifest(src), cfg = configDefaults(src);
  const show = (d, v) => d.kind === 'color' && typeof v === 'number' ? '#' + v.toString(16).padStart(6, '0') : v;
  const rows = man.map(d => ({ ...d, value: show(d, d.path.split('.').reduce((a, k) => (a == null ? a : a[k]), cfg)) }));
  if (!rows.length) die('没找到 const MANIFEST = [...]（v1.0 老文件？先跑 upgrade）', 3);
  console.log(flags.includes('--json') ? J(rows)
    : rows.map(r => `${r.path.padEnd(20)} ${String(r.effect).padEnd(8)} ${String(r.value).padEnd(12)} ${r.label || ''}${r.desc ? ' — ' + r.desc : ''}`).join('\n')
      + `\n\n共 ${rows.length} 个可编辑参数（hot ${rows.filter(r => r.effect === 'hot').length} / rebuild ${rows.filter(r => r.effect !== 'hot').length}）`);
  return;
}

if (cmd === 'entities') {
  const list = entities(src, flag('like'));
  if (!list.length) die('没解析到 SCENE.reg(...) 实体注册', 3);
  console.log(flags.includes('--json') ? J(list) : list.map(e => `${e.id.padEnd(24)} ${e.group.padEnd(10)} ${e.label}`).join('\n') + `\n\n共 ${list.length} 个实体`);
  return;
}

if (cmd === 'list') {
  const ps = readPatches(src);
  console.log(ps.length ? ps.map((x, i) => `${String(i + 1).padStart(3)}  ${J(x).replace(/\n\s*/g, ' ')}`).join('\n') + `\n\n共 ${ps.length} 条` : '（无编辑，出厂状态）');
  return;
}

if (cmd === 'check') {
  const issues = [];
  const say = (cond, label, extra) => { console.log((cond ? '✓ ' : '✗ ') + label + (extra ? '  ' + extra : '')); if (!cond) issues.push(label); };
  say(!!region(src, P_OPEN, P_CLOSE), 'patches 标记区在位');
  const kr = region(src, KIT_MARK_OPEN, KIT_MARK_CLOSE);
  say(!!kr, 'kit 标记区在位');
  if (kr) {
    const synced = kr.body.trim() === kitSource().trim();
    console.log((synced ? '✓ ' : '! ') + 'kit 与技能 assets/editkit.js 同步' + (synced ? '' : '（跑 sync 更新）'));
    if (!synced) issues.push('kit 未同步');
  }
  say(/kit:\s*'v1\.3'/.test(src), 'kit 版本 v1.3（人工编辑器依赖）', '低于 v1.3 时 editor.html 会拒绝装载');
  say(/three:\s*\{[^}]*\bcontrols\b/.test(src), 'SCENE.three 契约含 controls',
    /three:\s*\{[^}]*\bcontrols\b/.test(src) ? '' : '缺则拖 gizmo 会同时转相机');
  const invalid = validOps(readPatches(src), manifest(src));
  say(!invalid, 'patches 全部是合法 op', invalid || '');
  say(/window\.SCENE\s*=/.test(src), 'SCENE 契约在位');
  say(/const\s+CONFIG\s*=/.test(src), 'CONFIG 在位');
  const man = manifest(src);
  say(man.length > 0, 'MANIFEST 解析成功', man.length + ' 参数');
  const dupMan = man.map(d => d.path).filter((p, i, a) => a.indexOf(p) !== i);
  say(!dupMan.length, 'MANIFEST path 唯一', dupMan.join(', '));
  const ids = entities(src).map(e => e.id);
  const dupId = ids.filter((x, i, a) => a.indexOf(x) !== i);
  say(!dupId.length, '实体注册 id（字面量）唯一', dupId.join(', '));
  const anchors = [...src.matchAll(/\/\*@([a-z0-9][a-z0-9-]*)@\*\//g)].map(m => m[1]);
  const dupA = anchors.filter((x, i, a) => a.indexOf(x) !== i);
  say(anchors.length > 0, '规则锚点', anchors.length + ' 个' + (anchors.length ? ': ' + anchors.join(', ') : ''));
  say(!dupA.length, '锚点名唯一', '重复: ' + dupA.join(', '));
  const ps2 = readPatches(src);
  console.log('✓ patches 可解析 ' + ps2.length + ' 条');
  say(/\[(3d-creat|3d-edit)\] OK/.test(src), '自检锚点日志在位（[3d-edit] OK，旧产物 [3d-creat] OK 亦可）');
  const host = join(p.slice(0, p.length - p.split(/[\\/]/).pop().length).replace(/[\\/]$/, ''), 'editor.html');
  console.log(existsSync(host) ? '✓ 人工编辑宿主页在位 ' + host
    : '! 未装人工编辑器（node edit3d.mjs editor ' + p.split(/[\\/]/).pop() + ' --install）');
  console.log(issues.length ? '✗ 体检不过 ' + issues.length + ' 项: ' + issues.join(' / ') : '✓ 全绿');
  process.exit(issues.length ? 3 : 0);
}

if (cmd === 'find') {
  const q = (flags[0] || '').trim();
  const man = manifest(src).filter(d => [d.path, d.label, d.desc || '', ...(d.aliases || [])].join(' ').includes(q));
  const ent = entities(src).filter(e => (e.id + e.label + e.group).includes(q));
  console.log(J({ query: q, params: man, entities: ent.slice(0, 40), total: { params: man.length, entities: ent.length } }));
  if (!man.length && !ent.length) console.error('（无命中：换词再 find，或用 manifest/entities 全量看）');
  return;
}

if (cmd === 'apply') {
  if (region(src, P_OPEN, P_CLOSE) === null && !src.includes(P_OPEN))
    die('没有 patches 区，先跑 upgrade', 3);
  const man = manifest(src), cfg = configDefaults(src);
  const ps = readPatches(src);
  const batch = [];
  for (const s of all('set')) {
    const i = s.indexOf('='); if (i < 0) die(`--set 需要 path=value，得到 ${s}`);
    batch.push({ op: 'param', path: s.slice(0, i).trim(), value: parseVal(s.slice(i + 1).trim()) });
  }
  for (const s of all('entity')) {
    const i = s.indexOf(':'), j = s.indexOf('=', i);
    if (i < 0 || j < 0) die(`--entity 需要 id:prop=value，得到 ${s}`);
    batch.push({ op: 'entity', id: s.slice(0, i).trim(), prop: s.slice(i + 1, j).trim(), value: parseVal(s.slice(j + 1).trim()) });
  }
  for (const v of all('preset')) batch.push({ op: 'preset', value: parseVal(v) });
  for (const j of all('json')) batch.push(...JSON.parse(j));
  if (!batch.length) die('没有要应用的编辑：给 --set / --entity / --preset / --json');

  const XF = XF_PROPS, MF = MF_PROPS;
  const known = entities(src).map(e => e.id);
  const bad = validOps(batch, man);
  if (bad) die(bad);
  for (const x of batch) {
    if (x.op === 'param') { const d = checkParam(x, man, cfg); x.note = x.note || d.label; }
    if (x.op === 'entity') {
      const dyn = known.some(k => k.includes('${'));
      if (!known.includes(x.id)) {
        if (!dyn) die(`未知实体 ${x.id}；先跑 entities --like 查 id`);
        console.warn(`! 实体 id ${x.id} 是模板串（bld-i-j 这类），离线无法校验存在性——浏览器里若报"未知实体"，用 CITY.entities('building') 看实际 id`);
      }
    }
    if (x.op === 'add') {
      if (known.includes(x.id)) die(`add 的 id 与场景已有实体冲突: ${x.id}（换个 id，如 prop-1-${x.kind}）`);
      const P = x.props || {};
      for (const k of ['size', 'height', 'radius', 'depth']) if (P[k] != null && !isFinite(+P[k])) die(`add.props.${k} 需要数字`);
      if (P.pos && (!Array.isArray(P.pos) || P.pos.length !== 3 || P.pos.some(n => !isFinite(+n))))
        die('add.props.pos 需要 [x,y,z] 三个数字');
    }
    if (x.op === 'remove') {
      const added = [...ps.filter(q => q.op === 'add'), ...batch.filter(q => q.op === 'add')].map(q => q.id);
      if (!added.includes(x.id))
        die(`remove 只能删 op:add 加出来的物件（当前可删: ${added.join(', ') || '无'}）。原生几何属生成规则层 → 用 entity visible=false 隐藏，或走 P3 锚点手术`);
    }
  }
  const note = flag('note');
  if (note) batch.forEach(x => { x.note = note; });
  const merged = [...ps, ...batch];
  write({ p, src: setRegion(src, P_OPEN, P_CLOSE, patchesBlock(merged)) });
  ok(`${batch.length} 条已写入 ${p}（累计 ${merged.length}）`);
  console.log(batch.map(x => '  · ' + J(x).replace(/\n\s*/g, ' ')).join('\n'));
  console.log('下一步：serve + 浏览器打开，看 CITY.editLog()/shot 复核；不满意用 undo');
  return;
}

if (cmd === 'undo') {
  const n = +(flags[0] || 1);
  const ps = readPatches(src);
  if (!ps.length) return ok('已经是出厂状态，无需 undo');
  const dropped = ps.splice(-n);
  write({ p, src: setRegion(src, P_OPEN, P_CLOSE, patchesBlock(ps)) });
  ok(`丢弃 ${dropped.length} 条: ${dropped.map(d => d.path || d.id || d.op).join(', ')}（剩余 ${ps.length}）`);
  return;
}

if (cmd === 'clear') {
  write({ p, src: setRegion(src, P_OPEN, P_CLOSE, patchesBlock([])) });
  ok('patches 已清空（回出厂状态）: ' + p);
  return;
}

if (cmd === 'sync' || cmd === 'upgrade') {
  let out = src;
  const placeholder = '/*@3d-edit:kit@*/';
  // 占位符/upgrade 注入必须自带标记行：kitSource() 是剥过标记的裸代码，直接塞进去会让 kit 区不可寻址（check 不过、后续 sync 找不到边界）
  const kitBlock = () => KIT_MARK_OPEN + '\n' + kitSource() + '\n' + KIT_MARK_CLOSE + '\n';
  if (out.includes(placeholder)) out = out.replace(placeholder, kitBlock());
  else if (region(out, KIT_MARK_OPEN, KIT_MARK_CLOSE)) out = setRegion(out, KIT_MARK_OPEN, KIT_MARK_CLOSE, kitSource());
  else if (cmd === 'upgrade') {
    const i = out.lastIndexOf('</script>');
    if (i < 0) die('找不到 </script>，无法定位插入点', 3);
    out = out.slice(0, i) + '\n/* ============ 3d-edit kit（由 edit3d.mjs sync 维护） ============ */\n'
      + kitBlock() + '\n' + out.slice(i);
  } else die('没有 kit 标记区，先跑 upgrade', 3);

  if (cmd === 'upgrade') {
    if (region(out, P_OPEN, P_CLOSE)) { console.warn('! 已有 patches 区，跳过'); }
    else {
      const i = out.search(/const\s+CONFIG\s*=/);
      if (i < 0) die('找不到 CONFIG，插入点不明（手工把 patches 区放到 CONFIG 之前）', 3);
      out = out.slice(0, i) + `/* 3d-edit patches 区（edit3d.mjs 维护） */\n${P_OPEN}\nwindow.__3D_EDITS__ = [];\n${P_CLOSE}\n\n` + out.slice(i);
    }
  }
  write({ p, src: out });
  ok(`${cmd} 完成: ${p}`);
  if (cmd === 'upgrade') console.log(`
⚠ upgrade 只装运行时。要真正可编辑，还需在场景里补 SCENE 契约（否则控制台会打 [3d-edit] SKIP）：
  1) 把生成几何的代码包成 build*() + rebuild()，让参数改动能重建；
  2) 加 const MANIFEST = [...]（每个参数：path/label/kind/min/max/step/effect/aliases/desc，hot 的写 apply）；
  3) 给可指认的对象加 SCENE.reg(id, target, {label, group})，实例用 {index:k}，id 要跨 rebuild 稳定；
  4) 末尾加 window.SCENE = { meta, THREE, CONFIG, home, three, manifest, rebuild, regQueue:[], reg(...a){this.regQueue.push(a)} };
  照抄参考：本技能 assets/template.html 的第 5/7/10 节（契约/注册/rebuild 三节）。`);
  return;
}

die(`未知命令 ${cmd}（--help 看用法）`);
}
main();
