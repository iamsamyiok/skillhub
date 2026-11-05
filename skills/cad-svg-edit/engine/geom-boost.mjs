#!/usr/bin/env node
// geom-boost.mjs — cad-svg-edit A 路增强引擎(基于 vendor 的 everything-cad 几何内核)
//
// 用途: 当 `node engine/geom-boost.mjs doctor` 报 ok 时, A 路(无 CADCraft 二进制)也能做
// 真精确几何编辑: fillet/chamfer/trim/extend/offset/intersect/join/explode/measure/
// break/pfillet/pchamfer/hatch, 并提供独立于 CADCraft 的 DXF R2000 读写与 DWG 读取。
//
// CLI(无头, stdout 全 JSON, 退出码 0 成功 / 2 失败):
//   node geom-boost.mjs doctor
//   node geom-boost.mjs fillet   <shapes.json> <id1> <id2> <radius> <px1> <py1> <px2> <py2>
//   node geom-boost.mjs chamfer  <shapes.json> <id1> <id2> <d1> <d2> <px1> <py1> <px2> <py2>
//   node geom-boost.mjs trim     <shapes.json> <id> <px> <py> <cutterId,...>
//   node geom-boost.mjs extend   <shapes.json> <id> <px> <py> <boundId,...>
//   node geom-boost.mjs offset   <shapes.json> <id> <dist> <sideX> <sideY>
//   node geom-boost.mjs intersect <shapes.json> <id1> <id2>
//   node geom-boost.mjs join     <shapes.json> <id1> <id2> [id3...]
//   node geom-boost.mjs explode  <shapes.json> <id>
//   node geom-boost.mjs break    <shapes.json> <id> <x1> <y1> <x2> <y2>   (两点断口; 同点=breakAtPoint)
//   node geom-boost.mjs pfillet  <shapes.json> <id> <radius>               (整条闭合多段线全顶点倒圆)
//   node geom-boost.mjs pchamfer <shapes.json> <id> <d1> [d2]              (整条倒角)
//   node geom-boost.mjs hatch    <shapes.json> <ids,...> [pattern] [scale] [angleDeg]
//            pattern='SOLID' 实心填充(输出边界多边形); 其余=图案名(patternNames() 查询,
//            输出剖面线); ids 为闭环实体(circle/rect/polygon/闭合polyline), 最大者为外环
//   node geom-boost.mjs measure  <shapes.json> <id>
//   node geom-boost.mjs dxf-write <shapes.json> <out.dxf>
//   node geom-boost.mjs dxf-read  <in.dxf> <out-shapes.json>
//   node geom-boost.mjs dwg-read  <in.dwg> <out-shapes.json>   (R13-2018 导入)
//
// shapes.json 格式: {"shapes":[...老引擎 shape...]} 或裸数组 [...]
// 输出: {"ok":true, "op":..., "shapes":[操作后全部 shape(老 schema)], ...op特有字段}
// 坐标约定: 老引擎=SVG 系 Y 向下; 本内核=数学系 Y 向上。适配层负责镜像变换与弧向翻转。
import * as G from './everything-geom/core/geom/index.js';
import { writeDxf } from './everything-geom/io/dxf/writer.js';
import { parseDxf } from './everything-geom/io/dxf/reader.js';
import { parseDwg } from './everything-geom/io/dwg/import.js';
import { loopsToRings, solidPolygons, patternSegments } from './everything-geom/core/hatch/fill.js';
import { patternNames } from './everything-geom/core/hatch/patterns.js';
import fs from 'node:fs';
import path from 'node:path';

const TAU = Math.PI * 2;
const VERSION = 'boost-1.1.0 (kernel 8a25746)';

// ---------- schema 转换 ----------
// 老引擎 shape → kernel entity; 不支持的类型返回 null(留在老引擎侧原样输出)
function toKernel(s) {
  if (!s || !s.type) return null;
  switch (s.type) {
    case 'line':
      return { id: s.id, type: 'line', x1: s.p1.x, y1: -s.p1.y, x2: s.p2.x, y2: -s.p2.y, layer: '0' };
    case 'circle':
      return { id: s.id, type: 'circle', cx: s.c.x, cy: -s.c.y, r: s.r, layer: '0' };
    case 'arc': {
      // 镜像 Y 翻转扫掠方向: kernel 恒 CCW start→end
      let start, end;
      if (s.ccw !== false) { start = -s.a2; end = -s.a1; }
      else { start = -s.a1; end = -s.a2; }
      while (end <= start) end += TAU;
      return { id: s.id, type: 'arc', cx: s.c.x, cy: -s.c.y, r: s.r, start, end, layer: '0' };
    }
    case 'ellipse': {
      const rx = s.rx, ry = s.ry;
      if (!(rx > 0) || !(ry > 0)) return null;
      const major = Math.max(rx, ry), minor = Math.min(rx, ry);
      const a = rx >= ry ? (s.rot || 0) : (s.rot || 0) + Math.PI / 2;
      return { id: s.id, type: 'ellipse', cx: s.c.x, cy: -s.c.y,
               mx: Math.cos(a) * major, my: -Math.sin(a) * major,
               ratio: minor / major, start: 0, end: TAU, layer: '0' };
    }
    case 'rect': {
      const x2 = s.x + s.w, y2 = s.y + s.h;
      return { id: s.id, type: 'polyline',
               pts: [s.x, -s.y, 0, x2, -s.y, 0, x2, -y2, 0, s.x, -y2, 0],
               closed: true, width: 0, layer: '0' };
    }
    case 'polyline':
    case 'polygon': {
      if (!s.points || s.points.length < 2) return null;
      const pts = [];
      for (const p of s.points) pts.push(p.x, -p.y, 0);
      return { id: s.id, type: 'polyline', pts, closed: s.type === 'polygon' || !!s.closed, width: 0, layer: '0' };
    }
    case 'point':
      return { id: s.id, type: 'point', x: s.x, y: -s.y, layer: '0' };
    default:
      return null; // text / dim* / spline 等留在老引擎
  }
}

// kernel entity → 老 shape; srcShape 提供样式底版(可空)
function toOld(k, srcShape) {
  const base = srcShape ? JSON.parse(JSON.stringify(srcShape)) : { id: k.id, style: {} };
  switch (k.type) {
    case 'line':
      return Object.assign(base, { type: 'line', p1: { x: k.x1, y: -k.y1 }, p2: { x: k.x2, y: -k.y2 } });
    case 'circle':
      return Object.assign(base, { type: 'circle', c: { x: k.cx, y: -k.cy }, r: k.r });
    case 'arc': {
      // kernel CCW start→end → 老系 ccw=true, a1=-end, a2=-start (同一几何点集)
      return Object.assign(base, { type: 'arc', c: { x: k.cx, y: -k.cy }, r: k.r,
                                   a1: wrap(-k.end), a2: wrap(-k.start), ccw: true });
    }
    case 'polyline': {
      const points = [];
      for (let i = 0; i + 1 < k.pts.length; i += 3) points.push({ x: k.pts[i], y: -k.pts[i + 1] });
      return Object.assign(base, { type: k.closed ? 'polygon' : 'polyline', points, closed: !!k.closed });
    }
    case 'point':
      return Object.assign(base, { type: 'point', x: k.x, y: -k.y });
    default:
      return null;
  }
}
const wrap = a => { a = a % TAU; if (a < 0) a += TAU; return a > Math.PI ? a - TAU : a; };

function kernelDrawing(ents) {
  return { header: {}, layers: [{ name: '0', color: 7 }], linetypes: [],
           textStyles: [], dimStyles: [], blocks: [], entities: ents };
}

// ---------- 工具 ----------
function die(msg) { console.log(JSON.stringify({ ok: false, error: String(msg).slice(0, 300) })); process.exit(2); }
function out(obj) { console.log(JSON.stringify(obj)); process.exit(0); }
function loadShapes(path) {
  const j = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const shapes = Array.isArray(j) ? j : (j.shapes || []);
  if (!Array.isArray(shapes)) die('shapes.json 格式错误: 缺 shapes 数组');
  return shapes;
}
const find = (shapes, id) => shapes.find(s => String(s.id) === String(id));
const nextId = shapes => 1 + shapes.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0);
const num = (v, name) => { const n = Number(v); if (!Number.isFinite(n)) die(`参数 ${name} 不是数字: ${v}`); return n; };
// 通用合并: replaceMap(id→新kernel实体数组) + 追加新实体
function merge(shapes, replaceMap, kAdded) {
  const outS = [];
  const extra = [];
  const nid = nextId(shapes);
  let n = 0;
  kAdded.forEach(k => { if (k.id == null) k.id = nid + (n++); });
  for (const s of shapes) {
    const reps = replaceMap.get(String(s.id));
    if (reps) {
      reps.forEach((k, i) => {
        const o = toOld(k, i === 0 ? s : null);
        if (o) outS.push(o);
      });
      if (reps.length) continue;
    }
    outS.push(s);
  }
  for (const k of kAdded) { const o = toOld(k, null); if (o) extra.push(o); }
  return { shapes: outS.concat(extra), replacedIds: [...replaceMap.keys()], addedN: extra.length };
}

const [op, ...a] = process.argv.slice(2);

if (op === 'doctor') {
  let smoke = 'fail';
  try {
    const r = G.fillet({ id: 1, type: 'line', x1: 0, y1: 0, x2: 10, y2: 0, layer: '0' },
                       { x: 10, y: 0 },
                       { id: 2, type: 'line', x1: 10, y1: 0, x2: 10, y2: 10, layer: '0' },
                       { x: 10, y: 0 }, 2);
    smoke = r && r.arc && Math.abs(r.arc.r - 2) < 1e-9 ? 'ok' : 'fail';
  } catch (e) { smoke = 'fail: ' + String(e).slice(0, 80); }
  out({ ok: smoke === 'ok', engine: 'geom-boost', version: VERSION, kernel_smoke: smoke,
        usage: 'fillet/chamfer/trim/extend/offset/intersect/join/explode/break/pfillet/pchamfer/hatch/patterns/measure/dxf-write/dxf-read/dwg-read' });
}

try {
  if (op === 'fillet' || op === 'chamfer') {
    // fillet:  <file> <id1> <id2> <radius> <px1> <py1> <px2> <py2>
    // chamfer: <file> <id1> <id2> <d1> <d2> <px1> <py1> <px2> <py2>
    const file = a[0], id1 = a[1], id2 = a[2];
    let d1, d2, px1, py1, px2, py2;
    if (op === 'fillet') { d1 = a[3]; px1 = a[4]; py1 = a[5]; px2 = a[6]; py2 = a[7]; }
    else { d1 = a[3]; d2 = a[4]; px1 = a[5]; py1 = a[6]; px2 = a[7]; py2 = a[8]; }
    const shapes = loadShapes(file);
    const s1 = find(shapes, id1), s2 = find(shapes, id2);
    if (!s1 || !s2) die(`找不到 id ${id1} 或 ${id2}`);
    const k1 = toKernel(s1), k2 = toKernel(s2);
    if (!k1 || !k2) die('fillet/chamfer 仅支持 line/circle/arc/ellipse/polyline/rect');
    const P1 = { x: num(px1, 'px1'), y: -num(py1, 'py1') };
    const P2 = { x: num(px2, 'px2'), y: -num(py2, 'py2') };
    const res = op === 'fillet'
      ? G.fillet(k1, P1, k2, P2, num(d1, 'radius'))
      : G.chamfer(k1, P1, k2, P2, num(d1, 'd1'), num(d2 ?? d1, 'd2'));
    if (!res) die('fillet/chamfer 不可行(平行/相离/半径过大)');
    const map = new Map([[String(s1.id), [res.e1]], [String(s2.id), [res.e2]]]);
    out(Object.assign({ ok: true, op }, merge(shapes, map, [res.arc || res.line].filter(Boolean))));
  } else if (op === 'trim' || op === 'extend') {
    const [file, id, px, py, cutList] = a;
    const shapes = loadShapes(file);
    const s = find(shapes, id);
    if (!s) die(`找不到 id ${id}`);
    const k = toKernel(s);
    if (!k) die('trim/extend 仅支持 line/circle/arc/ellipse/polyline');
    const cutters = String(cutList || '').split(',').filter(Boolean)
      .flatMap(cid => { const cs = find(shapes, cid.trim()); if (!cs) die(`找不到 cutter id ${cid}`);
                    const kc = toKernel(cs); if (!kc) die(`cutter ${cid} 类型不支持`);
                    return G.toPrims(kc).flat(); });  // 内核 trim 吃 prim 不吃实体
    const pick = { x: num(px, 'px'), y: -num(py, 'py') };
    const res = op === 'trim' ? G.trimEntity(k, cutters, pick.x, pick.y)
                              : G.extendEntity(k, cutters, pick.x, pick.y);
    // 内核返回 {remove:true, add:[保留段]} 或裸实体/数组
    const resEnts = (res && res.add ? res.add
                     : (Array.isArray(res) ? res : [res])).filter(Boolean);
    if (!resEnts.length) die(op + ' 结果为空(拾取段全被剪/拾取点不在实体上?)');
    out(Object.assign({ ok: true, op }, merge(shapes, new Map([[String(s.id), resEnts]]), [])));
  } else if (op === 'offset') {
    const [file, id, dist, sx, sy] = a;
    const shapes = loadShapes(file);
    const s = find(shapes, id);
    if (!s) die(`找不到 id ${id}`);
    const k = toKernel(s);
    if (!k) die('offset 仅支持 line/circle/arc/ellipse/polyline/rect');
    const res = G.offsetEntity(k, num(dist, 'dist'), num(sx, 'sideX'), -num(sy, 'sideY'));
    const resEnts = (Array.isArray(res) ? res : [res]).filter(Boolean);
    if (!resEnts.length) die('offset 失败(自交/退化)');
    out(Object.assign({ ok: true, op }, merge(shapes, new Map(), resEnts)));
  } else if (op === 'intersect') {
    const [file, id1, id2] = a;
    const shapes = loadShapes(file);
    const k1 = toKernel(find(shapes, id1)), k2 = toKernel(find(shapes, id2));
    if (!k1 || !k2) die('intersect 类型不支持或 id 不存在');
    const pts = G.intersectEntities(k1, k2, false) || [];
    out({ ok: true, op, points: pts.map(p => ({ x: p.x, y: -p.y })) });
  } else if (op === 'join') {
    const [file, ...ids] = a;
    if (ids.length < 2) die('join 至少 2 个 id');
    const shapes = loadShapes(file);
    const ents = ids.map(id => { const s = find(shapes, id); if (!s) die(`找不到 id ${id}`);
                                const k = toKernel(s); if (!k) die(`id ${id} 类型不支持`); return k; });
    const res = G.joinEntities(ents);
    // 内核返回 {result:[...], consumedIds:[...]} 或裸数组
    const joined = (Array.isArray(res) ? res : (res && res.result) || []).filter(Boolean);
    if (!joined.length) die('join 失败(不相邻?)');
    const delIds = new Set(ids);
    const rest = shapes.filter(s => !delIds.has(String(s.id)));
    const nid = nextId(shapes);
    const added = joined.map((k, i) => toOld({ ...k, id: nid + i }, null)).filter(Boolean);
    out({ ok: true, op, shapes: rest.concat(added), deleted: ids, addedN: added.length });
  } else if (op === 'explode') {
    const [file, id] = a;
    const shapes = loadShapes(file);
    const s = find(shapes, id);
    if (!s) die(`找不到 id ${id}`);
    const k = toKernel(s);
    if (!k) die('explode 仅支持 polyline/polygon/rect');
    const parts = (G.explodeEntity(k) || []).filter(Boolean);
    const nid = nextId(shapes);
    const added = parts.map((p, i) => toOld({ ...p, id: nid + i }, null)).filter(Boolean);
    const rest = shapes.filter(x => String(x.id) !== String(id));
    out({ ok: true, op, shapes: rest.concat(added), deleted: [id], addedN: added.length });
  } else if (op === 'measure') {
    const [file, id] = a;
    const shapes = loadShapes(file);
    const k = toKernel(find(shapes, id));
    if (!k) die('measure 类型不支持或 id 不存在');
    const b = G.entityBounds(k);
    out({ ok: true, op, length: G.lengthOf(k), area: (G.areaOf(k) || 0),
          bounds: { minX: b[0], minY: -b[3], maxX: b[2], maxY: -b[1] } });
  } else if (op === 'break') {
    const [file, id, x1, y1, x2, y2] = a;
    const shapes = loadShapes(file);
    const s = find(shapes, id);
    if (!s) die(`找不到 id ${id}`);
    const k = toKernel(s);
    if (!k) die('break 仅支持 line/circle/arc/ellipse/polyline');
    const sameP = String(x1) === String(x2) && String(y1) === String(y2);
    const res = sameP
      ? G.breakAtPoint(k, num(x1, 'x1'), -num(y1, 'y1'))
      : G.breakEntity(k, num(x1, 'x1'), -num(y1, 'y1'), num(x2, 'x2'), -num(y2, 'y2'));
    const pieces = (Array.isArray(res) ? res : (res && res.add) || [res]).filter(Boolean);
    if (!pieces.length) die('break 失败(点不在实体上?)');
    out(Object.assign({ ok: true, op }, merge(shapes, new Map([[String(s.id), pieces]]), [])));
  } else if (op === 'pfillet' || op === 'pchamfer') {
    const [file, id, d1, d2] = a;
    const shapes = loadShapes(file);
    const s = find(shapes, id);
    if (!s) die(`找不到 id ${id}`);
    const k = toKernel(s);
    if (!k || k.type !== 'polyline') die('pfillet/pchamfer 仅支持 polyline/polygon/rect');
    const res = op === 'pfillet'
      ? G.filletPolyline(k, num(d1, 'radius'))
      : G.chamferPolyline(k, num(d1, 'd1'), d2 !== undefined ? num(d2, 'd2') : undefined);
    if (!res) die(op + ' 失败(半径/距离过大或非闭合?)');
    // 老schema polyline 无 bulge → 倒圆结果炸成线+弧段交付(几何等价)
    const hasBulge = (res.pts || []).some((v, i) => i % 3 === 2 && v);
    const pieces = hasBulge ? (G.explodeEntity(res) || [res]) : [res];
    out(Object.assign({ ok: true, op }, merge(shapes, new Map([[String(s.id), pieces]]), [])));
  } else if (op === 'hatch') {
    const [file, idList, patternIn = 'LINES', scaleS = '1', angleS = '0'] = a;
    // 常用 ANSI 名映射到内核原生图案(内核用自研图案体系, 全名单见 patterns 操作)
    const ANSI_MAP = { ANSI31: 'LINES', ANSI32: 'DASH', ANSI34: 'GRID', ANSI37: 'CROSS', ANSI38: 'DOTS' };
    const pattern = ANSI_MAP[String(patternIn).toUpperCase()] || patternIn;
    const shapes = loadShapes(file);
    const ids = String(idList).split(',').map(x => x.trim()).filter(Boolean);
    if (!ids.length) die('hatch 需要至少一个闭环实体 id');
    // loop = 平铺 [x, y, bulge] 闭曲线(kernel 坐标)
    const loops = [];
    for (const id of ids) {
      const s = find(shapes, id);
      if (!s) die(`找不到 id ${id}`);
      const k = toKernel(s);
      if (!k) die(`id ${id} 类型不支持`);
      if (k.type === 'circle') loops.push([k.cx - k.r, k.cy, 1, k.cx + k.r, k.cy, 1]);
      else if (k.type === 'polyline' && k.closed) loops.push(k.pts.slice());
      else die(`id ${id} 不支持 hatch(需 circle/rect/polygon/闭合polyline)`);
    }
    const rings = loopsToRings(loops);
    if (!rings || !rings.length) die('hatch: 未能构成有效环');
    // 方向在 ring 层做(bulge 环顶点面积退化, loop 层不可靠):
    // |面积|最大=外环强制 CCW(正), 其余=岛强制 CW(负) — 翻转平铺坐标对
    rings.sort((p, q) => Math.abs(G.signedAreaFlat(q)) - Math.abs(G.signedAreaFlat(p)));
    rings.forEach((r, i) => {
      const a = G.signedAreaFlat(r);
      if ((i === 0 && a < 0) || (i > 0 && a > 0)) {
        const pts = [];
        for (let j = r.length - 2; j >= 0; j -= 2) pts.push(r[j], r[j + 1]);
        rings[i] = pts;
      }
    });
    const nid = nextId(shapes);
    const added = [];
    let truncated = false;
    if (String(pattern).toUpperCase() === 'SOLID') {
      // solidPolygons → [[外环, 岛...], ...] 每环输出为闭合边界多边形
      const polys = solidPolygons(rings) || [];
      let n = 0;
      for (const poly of polys) {
        for (const ring of poly || []) {
          const pts = [];
          for (let j = 0; j + 1 < ring.length; j += 2) pts.push({ x: ring[j], y: -ring[j + 1] });
          added.push({ id: nid + (n++), type: 'polygon', points: pts, closed: true, style: {} });
        }
      }
    } else {
      const seg = patternSegments(rings, pattern, Number(scaleS), Number(angleS) * Math.PI / 180) || {};
      truncated = !!seg.truncated;
      const flat = seg.segs || [];
      let lc = 0;
      for (let j = 0; j + 3 < flat.length && lc < 3000; j += 4, lc++) {
        added.push({ id: nid + lc, type: 'line',
                     p1: { x: flat[j], y: -flat[j + 1] }, p2: { x: flat[j + 2], y: -flat[j + 3] }, style: {} });
      }
      const dots = seg.dots || [];
      for (let j = 0; j + 1 < dots.length && lc < 3800; j += 2, lc++) {
        added.push({ id: nid + lc, type: 'point', x: dots[j], y: -dots[j + 1], style: {} });
      }
      if (!lc) die('hatch: 图案「' + pattern + '」无线段产出(用 patterns 操作查名单)');
    }
    out({ ok: true, op, shapes: shapes.concat(added), addedN: added.length,
          pattern, scale: Number(scaleS), angle: Number(angleS),
          outerArea: Math.abs(G.signedAreaFlat(rings[0]))
            .toFixed(2) * 1, netArea: Math.round(
              rings.reduce((a, r) => a + G.signedAreaFlat(r), 0) * 100) / 100,
          loops: loops.length, truncated });
  } else if (op === 'dwg-read') {
    const [inPath, outPath] = a;
    const parsed = parseDwg(new Uint8Array(fs.readFileSync(inPath)));
    const shapes = (parsed.drawing.entities || [])
      .map(k => toOld(k, null)).filter(Boolean)
      .map((s, i) => ({ ...s, id: i + 1 }));
    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify({ shapes }, null, 1));
    }
    out({ ok: true, op, shapes, version: parsed.version, release: parsed.release,
          warnings: (parsed.warnings || []).slice(0, 5), stats: parsed.stats });
  } else if (op === 'patterns') {
    out({ ok: true, op, patterns: patternNames() });
  } else if (op === 'dxf-write') {
    const [file, outPath] = a;
    const shapes = loadShapes(file);
    const ents = shapes.map(toKernel).filter(Boolean);
    if (!ents.length) die('无可转换实体(全是 text/dim/spline?)');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, writeDxf(kernelDrawing(ents)));
    out({ ok: true, op, written: outPath, entities: ents.length });
  } else if (op === 'dxf-read') {
    const [inPath, outPath] = a;
    const parsed = parseDxf(fs.readFileSync(inPath, 'utf-8'));
    const shapes = (parsed.drawing.entities || [])
      .map(k => toOld(k, null)).filter(Boolean)
      .map((s, i) => ({ ...s, id: i + 1 }));
    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify({ shapes }, null, 1));
    }
    out({ ok: true, op, shapes, warnings: (parsed.warnings || []).slice(0, 5), stats: parsed.stats });
  } else {
    die('未知操作: ' + op + ' (见 doctor.usage)');
  }
} catch (e) {
  die(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
}
