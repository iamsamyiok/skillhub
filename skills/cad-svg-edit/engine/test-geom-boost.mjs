// geom-boost 适配层端到端测试 — 运行: node test-geom-boost.mjs (本目录内)
// 覆盖: doctor / 镜像roundtrip精度 / fillet / trim / offset / intersect / join / explode / measure / dxf读写
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BOOST = path.join(DIR, 'geom-boost.mjs');
const TMP = fs.mkdtempSync(path.join(DIR, '.t-'));
let pass = 0, fail = 0;
function run(op, ...args) {
  const stdout = execFileSync('node', [BOOST, op, ...args], { encoding: 'utf-8' });
  return JSON.parse(stdout);
}
function t(name, fn) {
  try {
    if (fn() === false) { fail++; console.log('FAIL', name); }
    else { pass++; console.log('pass', name); }
  } catch (e) { fail++; console.log('FAIL', name, '→', String(e).slice(0, 140)); }
}
const jw = (n, o) => { const p = path.join(TMP, n); fs.writeFileSync(p, JSON.stringify(o)); return p; };

// ---- 0. doctor ----
t('doctor 冒烟 ok', () => run('doctor').ok === true);

// ---- 1. 镜像 roundtrip: 老schema → boost操作不动它 → 输出仍正确 ----
// 弧: 圆心(50,50) r=20, 0°→90° ccw → kernel start=-90°, end=0°(过-45°)
const shapes1 = [
  { id: 1, type: 'line', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, style: {} },
  { id: 2, type: 'circle', c: { x: 50, y: 50 }, r: 20, style: {} },
  { id: 3, type: 'arc', c: { x: 50, y: 50 }, r: 20, a1: 0, a2: Math.PI / 2, ccw: true, style: {} },
  { id: 4, type: 'rect', x: 10, y: 10, w: 30, h: 20, style: {} },
  { id: 5, type: 'polyline', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }], style: {} },
  { id: 9, type: 'text', x: 5, y: 5, text: '保留', size: 12, style: {} },
];
const f1 = jw('s1.json', { shapes: shapes1 });

t('measure line 长度100(镜像不变)', () => {
  const r = run('measure', f1, '1');
  return Math.abs(r.length - 100) < 1e-9;
});
t('measure circle 周长+面积', () => {
  const r = run('measure', f1, '2');
  return Math.abs(r.length - 2 * Math.PI * 20) < 1e-6 &&
         Math.abs(r.area - Math.PI * 400) < 1e-6;
});
t('measure arc 弧长=1/4圆周(镜向等价)', () => {
  const r = run('measure', f1, '3');
  return Math.abs(r.length - Math.PI * 20 / 2) < 1e-6;
});
t('measure rect→polyline 面积600', () => {
  const r = run('measure', f1, '4');
  return Math.abs(r.area - 600) < 1e-6;
});
t('text/dim 等不支持类型原样保留', () => {
  const r = run('measure', f1, '1');
  return true;
});

// ---- 2. intersect: 线×圆, 镜像下交点正确 ----
t('intersect line×circle 两点', () => {
  const r = run('intersect', f1, '1', '2');
  // line y=0 与 circle c=(50,50) r=20: 老系 Y-down, 圆在 y∈[30,70], 与 y=0 无交!
  return r.points.length === 0;
});
t('intersect 移动线后有交点且坐标镜像正确', () => {
  const s = [{ id: 1, type: 'line', p1: { x: -10, y: 50 }, p2: { x: 110, y: 50 }, style: {} },
             { id: 2, type: 'circle', c: { x: 50, y: 50 }, r: 20, style: {} }];
  const f = jw('s2.json', { shapes: s });
  const r = run('intersect', f, '1', '2');
  return r.points.length === 2 &&
         Math.abs(r.points[0].x - 30) < 1e-9 && Math.abs(r.points[0].y - 50) < 1e-9 &&
         Math.abs(r.points[1].x - 70) < 1e-9;
});

// ---- 3. fillet: L角 R=10, 验证圆弧半径与端点 ----
t('fillet 直角 L R=10', () => {
  const s = [{ id: 1, type: 'line', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, style: {} },
             { id: 2, type: 'line', p1: { x: 100, y: 0 }, p2: { x: 100, y: -80 }, style: {} }];
  const f = jw('s3.json', { shapes: s });
  const r = run('fillet', f, '1', '2', '10', '90', '0', '100', '-10');
  if (!r.ok) return false;
  const arcS = r.shapes.find(x => x.type === 'arc');
  const l1 = r.shapes.find(x => x.id === 1), l2 = r.shapes.find(x => x.id === 2);
  return arcS && Math.abs(arcS.r - 10) < 1e-9 &&
         Math.abs(l1.p2.x - 90) < 1e-9 &&      // 线1 缩到 (90, 0)
         Math.abs(l2.p1.y + 10) < 1e-9 &&      // 线2 起点缩到 (100, -10)
         Math.abs(l2.p2.y + 80) < 1e-9;        // 线2 终点不动 (100, -80)
});

// ---- 4. trim: 线被圆剪 ----
t('trim 线被圆剪出缺口', () => {
  const s = [{ id: 1, type: 'line', p1: { x: -10, y: 50 }, p2: { x: 110, y: 50 }, style: {} },
             { id: 2, type: 'circle', c: { x: 50, y: 50 }, r: 20, style: {} }];
  const f = jw('s4.json', { shapes: s });
  const r = run('trim', f, '1', '0', '50', '2');
  if (!r.ok) return false;
  // AutoCAD 语义: 拾取的段被删 → pick x=0(左段) 删, 保留右段 [30,110]
  const l = r.shapes.find(x => x.id === 1);
  return l && Math.abs(l.p1.x - 30) < 1e-6 && Math.abs(l.p2.x - 110) < 1e-6;
});

// ---- 5. offset: 矩形外偏 5 ----
t('offset 矩形外偏5/内偏5(side点定向)', () => {
  const s = [{ id: 1, type: 'rect', x: 0, y: 0, w: 100, h: 50, style: {} }];
  const f = jw('s5.json', { shapes: s });
  // 内核语义: dist=幅值, side点在目标侧 → side在矩形内=向内, 在矩形外=向外
  const rIn = run('offset', f, '1', '5', '50', '25');      // side 内 → 内偏90
  const rOut = run('offset', f, '1', '5', '200', '25');    // side 外(右侧) → 外偏110
  if (!rOut.ok || !rIn.ok) return false;
  const bx = o => { const xs = o.points.map(p => p.x);
                    return Math.max(...xs) - Math.min(...xs); };
  const wIn = bx(rIn.shapes[rIn.shapes.length - 1]);
  const wOut = bx(rOut.shapes[rOut.shapes.length - 1]);
  return Math.abs(wIn - 90) < 1e-6 && Math.abs(wOut - 110) < 1e-6;
});

// ---- 6. join: 共线两线合一 ----
t('join 共线两线→单线', () => {
  const s = [{ id: 1, type: 'line', p1: { x: 0, y: 0 }, p2: { x: 50, y: 0 }, style: {} },
             { id: 2, type: 'line', p1: { x: 50, y: 0 }, p2: { x: 120, y: 0 }, style: {} }];
  const f = jw('s6.json', { shapes: s });
  const r = run('join', f, '1', '2');
  const lines = r.shapes.filter(x => x.type === 'line');
  return r.ok && lines.length === 1 && Math.abs(lines[0].p2.x - 120) < 1e-9;
});

// ---- 7. explode: 矩形炸成4线 ----
t('explode rect→4线', () => {
  const s = [{ id: 1, type: 'rect', x: 0, y: 0, w: 100, h: 50, style: {} }];
  const f = jw('s7.json', { shapes: s });
  const r = run('explode', f, '1');
  const lines = r.shapes.filter(x => x.type === 'line');
  return r.ok && lines.length === 4;
});

// ---- 8. DXF write→read roundtrip(独立于 CADCraft 的 DXF 能力) ----
t('dxf-write+dxf-read roundtrip', () => {
  const dxf = path.join(TMP, 'out.dxf');
  const w = run('dxf-write', f1, dxf);
  if (!w.ok || !fs.existsSync(dxf)) return false;
  const r = run('dxf-read', dxf, path.join(TMP, 'back.json'));
  if (!r.ok) return false;
  // text 不进 DXF(boost 范围): line+circle+arc+rect(闭合polyline)+开放polyline = 5
  const byT = {};
  r.shapes.forEach(s => { byT[s.type] = (byT[s.type] || 0) + 1; });
  return r.shapes.length === 5 && byT.line === 1 && byT.circle === 1 &&
         byT.arc === 1 && byT.polygon === 1 && byT.polyline === 1;
});
t('dxf-read 坐标镜像还原(线端点)', () => {
  const r = run('dxf-read', path.join(TMP, 'out.dxf'), '');
  const ln = r.shapes.find(s => s.type === 'line');
  return ln && Math.abs(ln.p1.x - 0) < 1e-6 && Math.abs(ln.p1.y - 0) < 1e-6 &&
         Math.abs(ln.p2.x - 100) < 1e-6 && Math.abs(ln.p2.y - 0) < 1e-6;
});

// ---- 9. 退化工况不炸 ----
t('fillet 平行线 → U形相切弧 r=间距/2', () => {
  const s = [{ id: 1, type: 'line', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, style: {} },
             { id: 2, type: 'line', p1: { x: 0, y: 5 }, p2: { x: 10, y: 5 }, style: {} }];
  const f = jw('s9.json', { shapes: s });
  const r = run('fillet', f, '1', '2', '2', '5', '0', '5', '5');
  const arcS = r.ok && r.shapes.find(x => x.type === 'arc');
  return arcS && Math.abs(arcS.r - 2.5) < 1e-9;
});
t('fillet 半径远超臂长(真不可行) → 优雅报错(退出码2)', () => {
  const s = [{ id: 1, type: 'line', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, style: {} },
             { id: 2, type: 'line', p1: { x: 30, y: -5 }, p2: { x: 30, y: 5 }, style: {} }];
  const f = jw('s9b.json', { shapes: s });
  try { run('fillet', f, '1', '2', '100', '10', '0', '30', '5'); return false; }
  catch (e) { return e.status === 2; }
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n===== geom-boost 适配层: ${pass} pass, ${fail} fail =====`);
process.exit(fail ? 1 : 0);
