'use strict';
/*
 * cad-engine.js — Mini-CAD 无头绘图引擎 (L2 集成版)
 * 从 cad-draw.html 的 cadAPI v2.0 抽取纯逻辑核心，去除全部 DOM 依赖。
 * 新增：
 *   - 软件光栅化 PNG 导出（零原生依赖，纯 JS，生成真实位图）
 *   - CSV 几何数据导出（每个图形的结构化坐标表）
 *   - Node CLI：node cad-engine.js <draw.js> [--svg] [--png] [--csv] [--dxf] [--all] [--out DIR] [--name NAME]
 *   - 自检：node cad-engine.js doctor
 *   - CommonJS 导出：require('./cad-engine.js').api / toCSV / ...
 */
const fs = require('fs');
const zlib = require('zlib');

// ==================== 状态 ====================
const state = {
  shapes: [],
  nextId: 1,
  defStyle: { strokeW: 2, stroke: "#1a1a1a", fill: "none" },
  display: { showGrid: false, showAxis: false, bgColor: "#ffffff" },
  view: { x: 0, y: 0, scale: 1 },
  history: [],
  histIdx: -1,
  _log: []
};

function log(msg, type) { state._log.push(`[${type || 'info'}] ${msg}`); }
function toast() { /* headless: 无 UI */ }

const pt = (x, y) => ({ x: +x, y: +y });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const D2R = (d) => (d * Math.PI) / 180;
const R2D = (r) => (r * 180) / Math.PI;
const clone = (o) => JSON.parse(JSON.stringify(o));

function numPos(v, name) {
  const n = +v;
  if (!Number.isFinite(n) || n <= 0) throw new Error(name + " 须为正数");
  return n;
}

function newShape(partial) {
  const s = Object.assign({
    id: state.nextId++,
    type: "line",
    layer: 0,
    stroke: state.defStyle.stroke,
    strokeW: state.defStyle.strokeW,
    fill: state.defStyle.fill
  }, partial);
  state.shapes.push(s);
  return s;
}

function pushHistory() {
  state.history = state.history.slice(0, state.histIdx + 1);
  state.history.push(clone(state.shapes));
  if (state.history.length > 50) state.history.shift();
  state.histIdx = state.history.length - 1;
}

function findShape(id) { return state.shapes.find(s => s.id === +id); }

// ==================== 形状 → SVG ====================
function shapeToSVG(s) {
  const common = `stroke="${s.stroke}" stroke-width="${s.strokeW}" fill="${s.fill}"`;
  switch (s.type) {
    case "line":
      return `<line x1="${s.p1.x}" y1="${s.p1.y}" x2="${s.p2.x}" y2="${s.p2.y}" ${common}/>`;
    case "circle":
      return `<circle cx="${s.c.x}" cy="${s.c.y}" r="${s.r}" ${common}/>`;
    case "rect":
      return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" ${common}/>`;
    case "ellipse":
      return `<ellipse cx="${s.c.x}" cy="${s.c.y}" rx="${s.rx}" ry="${s.ry}" transform="rotate(${R2D(s.rot || 0)} ${s.c.x} ${s.c.y})" ${common}/>`;
    case "arc": {
      const a1 = s.a1, a2 = s.a2;
      const x1 = s.c.x + s.r * Math.cos(a1), y1 = s.c.y + s.r * Math.sin(a1);
      const x2 = s.c.x + s.r * Math.cos(a2), y2 = s.c.y + s.r * Math.sin(a2);
      const large = Math.abs(a2 - a1) > Math.PI ? 1 : 0;
      const sweep = s.ccw ? 0 : 1;
      return `<path d="M ${x1} ${y1} A ${s.r} ${s.r} 0 ${large} ${sweep} ${x2} ${y2}" ${common}/>`;
    }
    case "polyline":
      return `<polyline points="${s.points.map(p => p.x + "," + p.y).join(" ")}" ${common}/>`;
    case "polygon":
      return `<polygon points="${s.points.map(p => p.x + "," + p.y).join(" ")}" ${common}/>`;
    case "spline": {
      const pts = s.points;
      if (pts.length < 2) return "";
      const samples = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        for (let t = 0; t < 1; t += 0.1) {
          const t2 = t * t, t3 = t2 * t;
          samples.push({
            x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
            y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
          });
        }
      }
      samples.push(pts[pts.length - 1]);
      if (s.closed) samples.push(pts[0]);
      const d = (s.closed ? "M" : "M") + samples.map(p => p.x + " " + p.y).join(" L") + (s.closed ? " Z" : "");
      return `<path d="${d}" ${common}/>`;
    }
    case "text":
      return `<text x="${s.x}" y="${s.y}" fill="${s.stroke}" font-size="${s.size || 14}">${s.text}</text>`;
    case "dimLine": {
      const dx = s.p2.x - s.p1.x, dy = s.p2.y - s.p1.y;
      const len = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const mx = (s.p1.x + s.p2.x) / 2, my = (s.p1.y + s.p2.y) / 2;
      const off = 20;
      const ox = -Math.sin(ang) * off, oy = Math.cos(ang) * off;
      let svg = `<line x1="${s.p1.x}" y1="${s.p1.y}" x2="${s.p1.x + ox}" y2="${s.p1.y + oy}" stroke="#888" stroke-width="1"/>`;
      svg += `<line x1="${s.p2.x}" y1="${s.p2.y}" x2="${s.p2.x + ox}" y2="${s.p2.y + oy}" stroke="#888" stroke-width="1"/>`;
      svg += `<line x1="${s.p1.x + ox}" y1="${s.p1.y + oy}" x2="${s.p2.x + ox}" y2="${s.p2.y + oy}" stroke="#1a1a1a" stroke-width="1"/>`;
      svg += `<text x="${mx + ox}" y="${my + oy - 4}" fill="#1a1a1a" font-size="12" text-anchor="middle" transform="rotate(${R2D(ang)} ${mx + ox} ${my + oy})">${len.toFixed(1)}</text>`;
      return svg;
    }
    case "dimRadius": {
      const c = s.c, r = s.r, p2 = s.p2;
      const ang = Math.atan2(p2.y - c.y, p2.x - c.x);
      const ex = c.x + Math.cos(ang) * r, ey = c.y + Math.sin(ang) * r;
      let svg = `<line x1="${c.x}" y1="${c.y}" x2="${ex}" y2="${ey}" stroke="#1a1a1a" stroke-width="1"/>`;
      svg += `<text x="${(c.x + ex) / 2}" y="${(c.y + ey) / 2 - 4}" fill="#1a1a1a" font-size="12">R${r.toFixed(0)}</text>`;
      return svg;
    }
    default: return "";
  }
}

function allShapesBBox() {
  if (!state.shapes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expand = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  state.shapes.forEach(s => {
    if (s.type === "line" || s.type === "dimLine") { expand(s.p1.x, s.p1.y); expand(s.p2.x, s.p2.y); }
    else if (s.type === "circle" || s.type === "arc") { expand(s.c.x - s.r, s.c.y - s.r); expand(s.c.x + s.r, s.c.y + s.r); }
    else if (s.type === "rect") { expand(s.x, s.y); expand(s.x + s.w, s.y + s.h); }
    else if (s.type === "ellipse") { expand(s.c.x - s.rx, s.c.y - s.ry); expand(s.c.x + s.rx, s.c.y + s.ry); }
    else if (s.type === "text") { expand(s.x, s.y); expand(s.x + 100, s.y + 20); }
    else if (s.points) s.points.forEach(p => expand(p.x, p.y));
  });
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// ==================== 几何工具 ====================
function shapeToSegments(s) {
  const segs = [];
  if (s.type === "line" || s.type === "dimLine") segs.push({ p1: s.p1, p2: s.p2 });
  else if (s.type === "rect") {
    segs.push({ p1: pt(s.x, s.y), p2: pt(s.x + s.w, s.y) });
    segs.push({ p1: pt(s.x + s.w, s.y), p2: pt(s.x + s.w, s.y + s.h) });
    segs.push({ p1: pt(s.x + s.w, s.y + s.h), p2: pt(s.x, s.y + s.h) });
    segs.push({ p1: pt(s.x, s.y + s.h), p2: pt(s.x, s.y) });
  } else if (s.type === "polyline" || s.type === "polygon") {
    for (let i = 0; i < s.points.length - 1; i++) segs.push({ p1: s.points[i], p2: s.points[i + 1] });
    if (s.type === "polygon" && s.points.length > 2) segs.push({ p1: s.points[s.points.length - 1], p2: s.points[0] });
  } else if (s.type === "circle") {
    for (let i = 0; i < 36; i++) {
      const a1 = (i / 36) * Math.PI * 2, a2 = ((i + 1) / 36) * Math.PI * 2;
      segs.push({ p1: pt(s.c.x + s.r * Math.cos(a1), s.c.y + s.r * Math.sin(a1)), p2: pt(s.c.x + s.r * Math.cos(a2), s.c.y + s.r * Math.sin(a2)) });
    }
  } else if (s.type === "arc") {
    for (let i = 0; i < 18; i++) {
      const a1 = s.a1 + (s.a2 - s.a1) * (i / 18), a2 = s.a1 + (s.a2 - s.a1) * ((i + 1) / 18);
      segs.push({ p1: pt(s.c.x + s.r * Math.cos(a1), s.c.y + s.r * Math.sin(a1)), p2: pt(s.c.x + s.r * Math.cos(a2), s.c.y + s.r * Math.sin(a2)) });
    }
  }
  return segs;
}

function segIntersect(a, b) {
  const d = (b.p2.y - b.p1.y) * (a.p2.x - a.p1.x) - (b.p2.x - b.p1.x) * (a.p2.y - a.p1.y);
  if (Math.abs(d) < 1e-9) return null;
  const ua = ((b.p2.x - b.p1.x) * (a.p1.y - b.p1.y) - (b.p2.y - b.p1.y) * (a.p1.x - b.p1.x)) / d;
  const ub = ((a.p2.x - a.p1.x) * (a.p1.y - b.p1.y) - (a.p2.y - a.p1.y) * (a.p1.x - b.p1.x)) / d;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  return pt(a.p1.x + ua * (a.p2.x - a.p1.x), a.p1.y + ua * (a.p2.y - a.p1.y));
}

function shapeIntersections(s1, s2) {
  const segs1 = shapeToSegments(s1), segs2 = shapeToSegments(s2);
  const pts = [];
  for (const a of segs1) for (const b of segs2) {
    const ip = segIntersect(a, b);
    if (ip && !pts.some(p => dist(p, ip) < 0.1)) pts.push(ip);
  }
  return pts;
}

function ptToSegDist(p, seg) {
  const dx = seg.p2.x - seg.p1.x, dy = seg.p2.y - seg.p1.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return dist(p, seg.p1);
  let t = ((p.x - seg.p1.x) * dx + (p.y - seg.p1.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: seg.p1.x + t * dx, y: seg.p1.y + t * dy });
}

// ==================== 渲染（无头：no-op） ====================
function render() { /* headless: 不需要刷新 DOM */ }

// ==================== cadAPI ====================
const api = {};
const mkStyle = (st) => st ? Object.assign({}, state.defStyle, st) : clone(state.defStyle);

api.line = (x1, y1, x2, y2, style) => {
  const s = newShape({ type: "line", p1: pt(x1, y1), p2: pt(x2, y2) });
  Object.assign(s, mkStyle(style));
  pushHistory(); render();
  return { id: s.id, bbox: allShapesBBox() };
};
api.circle = (cx, cy, r, style) => {
  numPos(r, "r");
  const s = newShape({ type: "circle", c: pt(cx, cy), r: +r });
  Object.assign(s, mkStyle(style));
  pushHistory(); render();
  return { id: s.id, bbox: allShapesBBox() };
};
api.rect = (x, y, w, h, style) => {
  numPos(w, "w"); numPos(h, "h");
  const s = newShape({ type: "rect", x: +x, y: +y, w: +w, h: +h });
  Object.assign(s, mkStyle(style));
  pushHistory(); render();
  return { id: s.id, bbox: allShapesBBox() };
};
api.polyline = (points, style) => {
  if (!points || points.length < 2) throw new Error("polyline 至少 2 点");
  const s = newShape({ type: "polyline", points: points.map(p => pt(p[0], p[1])) });
  Object.assign(s, mkStyle(style));
  pushHistory(); render();
  return { id: s.id, bbox: allShapesBBox() };
};
api.polygon = (points, style) => {
  if (!points || points.length < 3) throw new Error("polygon 至少 3 点");
  const s = newShape({ type: "polygon", points: points.map(p => pt(p[0], p[1])) });
  Object.assign(s, mkStyle(style));
  pushHistory(); render();
  return { id: s.id, bbox: allShapesBBox() };
};
api.spline = (points, closed, style) => {
  if (!points || points.length < 3) throw new Error("spline 至少 3 点");
  const s = newShape({ type: "spline", points: points.map(p => pt(p[0], p[1])), closed: !!closed });
  Object.assign(s, mkStyle(style));
  pushHistory(); render();
  return { id: s.id, bbox: allShapesBBox() };
};
api.arc = (cx, cy, r, a1Deg, a2Deg, ccw, style) => {
  numPos(r, "r");
  const s = newShape({ type: "arc", c: pt(cx, cy), r: +r, a1: D2R(a1Deg), a2: D2R(a2Deg), ccw: ccw !== false });
  Object.assign(s, mkStyle(style));
  pushHistory(); render();
  return { id: s.id, bbox: allShapesBBox() };
};
api.ellipse = (cx, cy, rx, ry, rotDeg, style) => {
  numPos(rx, "rx"); numPos(ry, "ry");
  const s = newShape({ type: "ellipse", c: pt(cx, cy), rx: +rx, ry: +ry, rot: D2R(rotDeg || 0) });
  Object.assign(s, mkStyle(style));
  pushHistory(); render();
  return { id: s.id, bbox: allShapesBBox() };
};
api.text = (x, y, str, size, style) => {
  const s = newShape({ type: "text", x: +x, y: +y, text: String(str), size: size || 14 });
  Object.assign(s, mkStyle(style));
  s.fill = s.stroke;
  pushHistory(); render();
  return { id: s.id, bbox: allShapesBBox() };
};
api.dimLine = (x1, y1, x2, y2, style) => {
  const s = newShape({ type: "dimLine", p1: pt(x1, y1), p2: pt(x2, y2) });
  Object.assign(s, mkStyle(style));
  pushHistory(); render();
  return { id: s.id, bbox: allShapesBBox() };
};
api.dimRadius = (circleId, style) => {
  const c = findShape(circleId);
  if (!c || c.type !== "circle") throw new Error("dimRadius 需要有效的 circle id");
  const ang = -Math.PI / 4;
  const s = newShape({ type: "dimRadius", c: c.c, r: c.r, p2: pt(c.c.x + Math.cos(ang) * c.r, c.c.y + Math.sin(ang) * c.r) });
  Object.assign(s, mkStyle(style));
  pushHistory(); render();
  return { id: s.id, bbox: allShapesBBox() };
};
api.point = (x, y, style) => {
  const s = newShape({ type: "circle", c: pt(x, y), r: 2 });
  Object.assign(s, mkStyle(style));
  s.fill = s.stroke;
  pushHistory(); render();
  return { id: s.id, bbox: allShapesBBox() };
};

// 变换类
const getIds = (ids) => Array.isArray(ids) ? ids : [ids];
api.move = (ids, dx, dy) => {
  getIds(ids).forEach(id => {
    const s = findShape(id); if (!s) return;
    if (s.p1) { s.p1.x += dx; s.p1.y += dy; }
    if (s.p2) { s.p2.x += dx; s.p2.y += dy; }
    if (s.c) { s.c.x += dx; s.c.y += dy; }
    if (s.points) s.points.forEach(p => { p.x += dx; p.y += dy; });
    if (s.x != null) { s.x += dx; s.y += dy; }
  });
  pushHistory(); render();
  return allShapesBBox();
};
api.rotate = (ids, cx, cy, deg) => {
  const rad = D2R(deg), co = Math.cos(rad), si = Math.sin(rad);
  const rot = (p) => { const dx = p.x - cx, dy = p.y - cy; p.x = cx + dx * co - dy * si; p.y = cy + dx * si + dy * co; };
  getIds(ids).forEach(id => {
    const s = findShape(id); if (!s) return;
    if (s.p1) rot(s.p1); if (s.p2) rot(s.p2); if (s.c) rot(s.c);
    if (s.points) s.points.forEach(rot);
    if (s.x != null) rot(s);
  });
  pushHistory(); render();
  return allShapesBBox();
};
api.mirror = (ids, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) throw new Error("镜像轴零长");
  const mir = (p) => {
    const t = ((p.x - x1) * dx + (p.y - y1) * dy) / len2;
    const fx = x1 + 2 * t * dx - p.x, fy = y1 + 2 * t * dy - p.y;
    p.x = fx; p.y = fy;
  };
  getIds(ids).forEach(id => {
    const s = findShape(id); if (!s) return;
    if (s.p1) mir(s.p1); if (s.p2) mir(s.p2); if (s.c) mir(s.c);
    if (s.points) s.points.forEach(mir);
    if (s.x != null) mir(s);
  });
  pushHistory(); render();
  return allShapesBBox();
};
api.scale = (ids, cx, cy, factor) => {
  numPos(factor, "factor");
  const sc = (p) => { p.x = cx + (p.x - cx) * factor; p.y = cy + (p.y - cy) * factor; };
  getIds(ids).forEach(id => {
    const s = findShape(id); if (!s) return;
    if (s.p1) sc(s.p1); if (s.p2) sc(s.p2); if (s.c) sc(s.c);
    if (s.r) s.r *= factor;
    if (s.rx) s.rx *= factor; if (s.ry) s.ry *= factor;
    if (s.w) s.w *= factor; if (s.h) s.h *= factor;
    if (s.points) s.points.forEach(sc);
    if (s.x != null) sc(s);
  });
  pushHistory(); render();
  return allShapesBBox();
};
api.clone = (ids, dx, dy) => {
  const newIds = [];
  getIds(ids).forEach(id => {
    const s = findShape(id); if (!s) return;
    const c = clone(s); c.id = state.nextId++;
    state.shapes.push(c); newIds.push(c.id);
    api.move(c.id, dx, dy);
  });
  render();
  return newIds;
};
api.arrayRect = (ids, rows, cols, dx, dy) => {
  const orig = getIds(ids).map(id => clone(findShape(id)));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (r === 0 && c === 0) continue;
    orig.forEach(s => { const ns = clone(s); ns.id = state.nextId++; state.shapes.push(ns); api.move(ns.id, c * dx, r * dy); });
  }
  render();
  return allShapesBBox();
};
api.arrayPolar = (ids, cx, cy, count, angleDeg, rotateItems) => {
  if (count > 5000) throw new Error("阵列数过大");
  const orig = getIds(ids).map(id => clone(findShape(id)));
  const total = D2R(angleDeg || 360);
  for (let i = 1; i < count; i++) {
    const ang = (i / count) * total;
    orig.forEach(s => {
      const ns = clone(s); ns.id = state.nextId++; state.shapes.push(ns);
      api.rotate(ns.id, cx, cy, R2D(ang));
    });
  }
  render();
  return allShapesBBox();
};
api.deleteShape = (ids) => {
  getIds(ids).forEach(id => {
    const i = state.shapes.findIndex(s => s.id === +id);
    if (i >= 0) state.shapes.splice(i, 1);
  });
  pushHistory(); render();
  return allShapesBBox();
};
api.setStyle = (id, style) => {
  const s = findShape(id); if (!s) throw new Error("无效 id");
  Object.assign(s, style);
  if (style.fill === undefined) s.fill = "none";
  pushHistory(); render();
  return allShapesBBox();
};

// 查询类
api.list = () => state.shapes.map(s => ({ id: s.id, type: s.type, layer: s.layer }));
api.get = (id) => { const s = findShape(id); return s ? clone(s) : null; };
api.bbox = (ids) => {
  if (ids) {
    const old = state.shapes;
    state.shapes = getIds(ids).map(id => findShape(id)).filter(Boolean);
    const bb = allShapesBBox();
    state.shapes = old;
    return bb;
  }
  return allShapesBBox();
};
api.area = (id) => {
  const s = findShape(id); if (!s) throw new Error("无效 id");
  if (s.type === "circle") return Math.PI * s.r * s.r;
  if (s.type === "rect") return s.w * s.h;
  if (s.type === "ellipse") return Math.PI * s.rx * s.ry;
  if (s.points && s.points.length >= 3) {
    let a = 0;
    for (let i = 0; i < s.points.length; i++) { const j = (i + 1) % s.points.length; a += s.points[i].x * s.points[j].y - s.points[j].x * s.points[i].y; }
    return Math.abs(a) / 2;
  }
  return 0;
};
api.length = (id) => {
  const s = findShape(id); if (!s) throw new Error("无效 id");
  if (s.type === "line") return dist(s.p1, s.p2);
  if (s.type === "circle") return 2 * Math.PI * s.r;
  if (s.type === "rect") return 2 * (s.w + s.h);
  if (s.points) {
    let L = 0;
    for (let i = 0; i < s.points.length - 1; i++) L += dist(s.points[i], s.points[i + 1]);
    if (s.type === "polygon") L += dist(s.points[s.points.length - 1], s.points[0]);
    return L;
  }
  return 0;
};
api.count = () => state.shapes.length;
api.byType = (type) => state.shapes.filter(s => s.type === type).map(s => s.id);

// 几何校验
const dirOf = (s) => {
  if (s.type === "line" || s.type === "dimLine") return { x: s.p2.x - s.p1.x, y: s.p2.y - s.p1.y };
  if (s.type === "rect") return { x: s.w, y: 0 };
  if ((s.type === "polyline" || s.type === "polygon" || s.type === "spline") && s.points.length >= 2) return { x: s.points[1].x - s.points[0].x, y: s.points[1].y - s.points[0].y };
  return null;
};
const norm = (v) => { const l = Math.hypot(v.x, v.y); return l < 1e-9 ? null : { x: v.x / l, y: v.y / l }; };
const angBetween = (a, b) => { const na = norm(a), nb = norm(b); if (!na || !nb) return null; return Math.acos(Math.max(-1, Math.min(1, na.x * nb.x + na.y * nb.y))); };

api.checkParallel = (id1, id2, tolDeg) => {
  const s1 = findShape(id1), s2 = findShape(id2); if (!s1 || !s2) throw new Error("无效 id");
  const d1 = dirOf(s1), d2 = dirOf(s2); if (!d1 || !d2) return { ok: false, reason: "图形无方向" };
  const ang = angBetween(d1, d2); const tol = D2R(tolDeg == null ? 0.5 : tolDeg);
  return { ok: Math.abs(ang) < tol || Math.abs(ang - Math.PI) < tol, angleDeg: R2D(ang) };
};
api.checkPerpendicular = (id1, id2, tolDeg) => {
  const s1 = findShape(id1), s2 = findShape(id2); if (!s1 || !s2) throw new Error("无效 id");
  const d1 = dirOf(s1), d2 = dirOf(s2); if (!d1 || !d2) return { ok: false, reason: "图形无方向" };
  const ang = angBetween(d1, d2); const tol = D2R(tolDeg == null ? 0.5 : tolDeg);
  return { ok: Math.abs(ang - Math.PI / 2) < tol, angleDeg: R2D(ang) };
};
api.checkTangent = (id1, id2, tol) => {
  const s1 = findShape(id1), s2 = findShape(id2); if (!s1 || !s2) throw new Error("无效 id");
  const t = tol == null ? 0.5 : tol;
  const isCirc = s => s.type === "circle" || s.type === "arc";
  if (isCirc(s1) && isCirc(s2)) {
    const d = dist(s1.c, s2.c); const sum = s1.r + s2.r, diff = Math.abs(s1.r - s2.r);
    return { ok: Math.abs(d - sum) < t || Math.abs(d - diff) < t, type: Math.abs(d - sum) < t ? "外切" : "内切" };
  }
  const pts = shapeIntersections(s1, s2);
  return { ok: pts.length === 1, type: pts.length === 1 ? "单交点相切" : "交点数=" + pts.length, points: pts };
};
api.findIntersections = (id1, id2) => {
  const s1 = findShape(id1), s2 = findShape(id2); if (!s1 || !s2) throw new Error("无效 id");
  const pts = shapeIntersections(s1, s2);
  return { count: pts.length, points: pts, intersect: pts.length > 0 };
};
api.containsPoint = (id, x, y) => {
  const s = findShape(id); if (!s) throw new Error("无效 id");
  const p = pt(x, y);
  if (s.type === "circle") return { inside: dist(s.c, p) < s.r };
  if (s.type === "rect") return { inside: p.x > s.x && p.x < s.x + s.w && p.y > s.y && p.y < s.y + s.h };
  if (s.type === "polygon" || s.type === "polyline") {
    let inside = false;
    for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) {
      if ((s.points[i].y > p.y) !== (s.points[j].y > p.y) && p.x < (s.points[j].x - s.points[i].x) * (p.y - s.points[i].y) / (s.points[j].y - s.points[i].y) + s.points[i].x) inside = !inside;
    }
    return { inside };
  }
  return { inside: false };
};
api.distance = (id1, id2) => {
  const s1 = findShape(id1), s2 = findShape(id2); if (!s1 || !s2) throw new Error("无效 id");
  const segs1 = shapeToSegments(s1), segs2 = shapeToSegments(s2);
  if (!segs1.length || !segs2.length) return { distance: null };
  let minD = Infinity;
  for (const a of segs1) for (const b of segs2) {
    const ip = segIntersect(a, b); if (ip) return { distance: 0, intersect: true };
    for (const p of [a.p1, a.p2]) { const d = ptToSegDist(p, b); if (d < minD) minD = d; }
    for (const p of [b.p1, b.p2]) { const d = ptToSegDist(p, a); if (d < minD) minD = d; }
  }
  return { distance: minD, intersect: false };
};
api.validate = () => {
  const issues = [];
  const tol = 0.5;
  state.shapes.forEach(s => {
    try { const L = api.length(s.id); if (L < tol) issues.push({ severity: "warn", type: "zero-length", id: s.id }); } catch (e) {}
  });
  return { ok: issues.length === 0, issueCount: issues.length, issues };
};
api.diagnose = () => {
  const v = api.validate();
  const suggestions = [];
  v.issues.forEach(i => { if (i.type === "zero-length") suggestions.push({ id: i.id, action: "delete" }); });
  return { ok: suggestions.length === 0, suggestions };
};

// 特征点
api.keyPoints = (id) => {
  const s = findShape(id); if (!s) throw new Error("无效 id");
  const pts = [];
  const push = (name, x, y) => pts.push({ name, x: +x.toFixed(4), y: +y.toFixed(4) });
  if (s.type === "circle") {
    push("圆心", s.c.x, s.c.y);
    push("0度", s.c.x + s.r, s.c.y);
    push("90度", s.c.x, s.c.y + s.r);
    push("180度", s.c.x - s.r, s.c.y);
    push("270度", s.c.x, s.c.y - s.r);
  } else if (s.type === "arc") {
    push("圆心", s.c.x, s.c.y);
    push("起点", s.c.x + Math.cos(D2R(s.a1)) * s.r, s.c.y + Math.sin(D2R(s.a1)) * s.r);
    push("终点", s.c.x + Math.cos(D2R(s.a2)) * s.r, s.c.y + Math.sin(D2R(s.a2)) * s.r);
  } else if (s.type === "ellipse") {
    push("圆心", s.c.x, s.c.y);
    push("右端", s.c.x + s.rx, s.c.y);
    push("左端", s.c.x - s.rx, s.c.y);
    push("上端", s.c.x, s.c.y - s.ry);
    push("下端", s.c.x, s.c.y + s.ry);
  } else if (s.type === "rect") {
    push("左上", s.x, s.y); push("右上", s.x + s.w, s.y); push("右下", s.x + s.w, s.y + s.h); push("左下", s.x, s.y + s.h);
    push("中心", s.x + s.w / 2, s.y + s.h / 2);
    push("上中", s.x + s.w / 2, s.y); push("下中", s.x + s.w / 2, s.y + s.h);
    push("左中", s.x, s.y + s.h / 2); push("右中", s.x + s.w, s.y + s.h / 2);
  } else if (s.type === "line" || s.type === "dimLine") {
    push("端点1", s.p1.x, s.p1.y); push("端点2", s.p2.x, s.p2.y);
    push("中点", (s.p1.x + s.p2.x) / 2, (s.p1.y + s.p2.y) / 2);
  } else if (s.points && s.points.length) {
    s.points.forEach((p, i) => push(`P${i}`, p.x, p.y));
    if (s.points.length >= 2) { const n = s.points.length; push("首中末", (s.points[0].x + s.points[n - 1].x) / 2, (s.points[0].y + s.points[n - 1].y) / 2); }
  }
  return { id: s.id, type: s.type, points: pts };
};

// 自动标注
api.autoDim = (ids, opts) => {
  const list = ids == null
    ? state.shapes.filter(s => s.type !== "dimLine" && s.type !== "dimRadius" && s.type !== "text" && s.type !== "point")
    : (Array.isArray(ids) ? ids : [ids]).map(id => findShape(id)).filter(Boolean);
  const o = Object.assign({ offset: 15, skipText: true, skipPoint: true, skipDim: true }, opts || {});
  const created = [];
  const off = o.offset;
  const pushDim = (dim) => { created.push(dim.id); return dim.id; };
  list.forEach(s => {
    if (o.skipDim && (s.type === "dimLine" || s.type === "dimRadius")) return;
    if (o.skipText && s.type === "text") return;
    if (o.skipPoint && s.type === "point") return;
    if (s.type === "circle") {
      pushDim(api.dimRadius(s.id, { stroke: "#c0392b" }).id);
    } else if (s.type === "line") {
      const dx = s.p2.x - s.p1.x, dy = s.p2.y - s.p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len * off, ny = dx / len * off;
      pushDim(api.dimLine(s.p1.x + nx, s.p1.y + ny, s.p2.x + nx, s.p2.y + ny, { stroke: "#c0392b" }).id);
    } else if (s.type === "rect") {
      pushDim(api.dimLine(s.x, s.y + s.h + off, s.x + s.w, s.y + s.h + off, { stroke: "#c0392b" }).id);
      pushDim(api.dimLine(s.x - off, s.y, s.x - off, s.y + s.h, { stroke: "#c0392b" }).id);
    } else if (s.type === "arc") {
      pushDim(api.text(s.c.x + s.r * 0.7, s.c.y - s.r * 0.7, `R${+s.r.toFixed(2)}`, 12, { stroke: "#c0392b" }).id);
    } else if (s.type === "ellipse") {
      pushDim(api.dimLine(s.c.x - s.rx, s.c.y, s.c.x + s.rx, s.c.y, { stroke: "#c0392b" }).id);
      pushDim(api.dimLine(s.c.x, s.c.y - s.ry, s.c.x, s.c.y + s.ry, { stroke: "#c0392b" }).id);
    }
  });
  render();
  log(`autoDim: 为 ${list.length} 个图形添加 ${created.length} 个标注`, "ok");
  return { dimCount: created.length, ids: created, sourceCount: list.length };
};

// 一键校验快照
api.verify = (ids) => {
  const v = api.validate();
  let dimResult = null;
  if (ids == null || ids.length) dimResult = api.autoDim(ids);
  api.fit();
  const url = api.snapshot();
  const summary = {
    count: api.count(), validate: v.ok, issues: v.issues,
    dims: dimResult ? dimResult.dimCount : 0, bbox: api.bbox(),
    snapshot: url, snapshotLength: url.length
  };
  log(`verify: ${summary.count} 图形 / ${summary.dims} 标注 / 校验${v.ok ? "通过" : "有问题"}`, v.ok ? "ok" : "warn");
  return summary;
};

// 视图类
api.fit = () => { render(); log("fit 视图", "info"); return allShapesBBox(); };
api.zoom = (f) => { render(); return null; };
api.snapshot = () => exportSVGDataUrl();

// 导出类
function exportSVGDataUrl() { return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(api.exportSVG()))); }
api.exportSVG = () => {
  const bb = allShapesBBox();
  const pad = 20;
  const x = bb ? bb.minX - pad : 0, y = bb ? bb.minY - pad : 0;
  const w = bb ? bb.w + pad * 2 : 600, h = bb ? bb.h + pad * 2 : 400;
  let body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>\n`;
  state.shapes.forEach(s => { body += shapeToSVG(s) + "\n"; });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">\n${body}</svg>`;
};
api.exportSVGDataUrl = exportSVGDataUrl;
api.exportPNGDataUrl = () => new Promise((resolve, reject) => {
  try { resolve(rasterizePNG()); } catch (e) { reject(e); }
});

// 批量类
api.loadJSON = (data) => {
  if (data.shapes) {
    data.shapes.forEach(sh => {
      const style = sh.style || {};
      if (sh.type === "line") api.line(sh.x1, sh.y1, sh.x2, sh.y2, style);
      else if (sh.type === "circle") api.circle(sh.cx, sh.cy, sh.r, style);
      else if (sh.type === "rect") api.rect(sh.x, sh.y, sh.w, sh.h, style);
      else if (sh.type === "ellipse") api.ellipse(sh.cx, sh.cy, sh.rx, sh.ry, sh.rotDeg, style);
      else if (sh.type === "arc") api.arc(sh.cx, sh.cy, sh.r, sh.a1, sh.a2, sh.ccw, style);
      else if (sh.type === "polyline") api.polyline(sh.points, style);
      else if (sh.type === "polygon") api.polygon(sh.points, style);
      else if (sh.type === "spline") api.spline(sh.points, sh.closed, style);
      else if (sh.type === "text") api.text(sh.x, sh.y, sh.text, sh.size, style);
      else if (sh.type === "dimLine") api.dimLine(sh.x1, sh.y1, sh.x2, sh.y2, style);
    });
  }
  return { ids: state.shapes.map(s => s.id), bbox: allShapesBBox() };
};
api.clear = () => { state.shapes = []; state.history = []; state.histIdx = -1; render(); log("清空图纸", "info"); };
api.undo = () => { if (state.histIdx > 0) { state.histIdx--; state.shapes = clone(state.history[state.histIdx]); render(); } };
api.redo = () => { if (state.histIdx < state.history.length - 1) { state.histIdx++; state.shapes = clone(state.history[state.histIdx]); render(); } };
api.setDisplay = (opts) => { Object.assign(state.display, opts); render(); };
api.help = () => Object.keys(api).join(", ");
api.version = () => "cadAPI-2.1-headless";

if (typeof window !== 'undefined') window.cadAPI = api;

// =====================================================================
// PNG 软件光栅化（纯 JS，无原生依赖）
// =====================================================================
function hexToRgb(h) {
  if (!h || h[0] !== '#') return [26, 26, 26];
  let s = h.slice(1);
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rasterizePNG() {
  const bb = allShapesBBox();
  const pad = 20;
  const minX = bb ? bb.minX - pad : 0;
  const minY = bb ? bb.minY - pad : 0;
  const wWorld = bb ? bb.w + pad * 2 : 600;
  const hWorld = bb ? bb.h + pad * 2 : 400;
  let SCALE = 2;
  let W = Math.ceil(wWorld * SCALE), H = Math.ceil(hWorld * SCALE);
  const MAX = 4000;
  if (W > MAX || H > MAX) { const k = MAX / Math.max(W, H); SCALE = SCALE * k; W = Math.ceil(wWorld * SCALE); H = Math.ceil(hWorld * SCALE); }
  if (W < 1) W = 1; if (H < 1) H = 1;
  const buf = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = 255; buf[i * 4 + 1] = 255; buf[i * 4 + 2] = 255; buf[i * 4 + 3] = 255; }

  const toPx = (x, y) => [(x - minX) * SCALE, (y - minY) * SCALE];

  function blend(x, y, r, g, b, a) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    const ia = a / 255, oa = buf[i + 3] / 255;
    const na = ia + oa * (1 - ia);
    if (na <= 0) return;
    buf[i] = Math.round((r * ia + buf[i] * oa * (1 - ia)) / na);
    buf[i + 1] = Math.round((g * ia + buf[i + 1] * oa * (1 - ia)) / na);
    buf[i + 2] = Math.round((b * ia + buf[i + 2] * oa * (1 - ia)) / na);
    buf[i + 3] = Math.round(na * 255);
  }
  function disc(cx, cy, rad, r, g, b, a) {
    const R = Math.ceil(rad);
    for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
      if (xx * xx + yy * yy <= rad * rad + 0.6) blend(cx + xx, cy + yy, r, g, b, a);
    }
  }
  function thickLine(x0, y0, x1, y1, rgb, wpx) {
    const [r, g, b] = rgb;
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len));
    const rad = Math.max(0.5, wpx / 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      disc(x0 + dx * t, y0 + dy * t, rad, r, g, b, 255);
    }
  }
  function arrowhead(tx, ty, dirx, diry, size, rgb) {
    const [r, g, b] = rgb;
    const px = -diry, py = dirx; // perpendicular
    const baseX = tx - dirx * size, baseY = ty - diry * size;
    const a = [tx, ty];
    const b1 = [baseX + px * size * 0.5, baseY + py * size * 0.5];
    const b2 = [baseX - px * size * 0.5, baseY - py * size * 0.5];
    // filled triangle via scanline
    const minx = Math.min(a[0], b1[0], b2[0]), maxx = Math.max(a[0], b1[0], b2[0]);
    const miny = Math.min(a[1], b1[1], b2[1]), maxy = Math.max(a[1], b1[1], b2[1]);
    for (let yy = Math.floor(miny); yy <= Math.ceil(maxy); yy++) {
      for (let xx = Math.floor(minx); xx <= Math.ceil(maxx); xx++) {
        if (pointInTri(xx + 0.5, yy + 0.5, a, b1, b2)) blend(xx, yy, r, g, b, 255);
      }
    }
  }
  function pointInTri(px, py, a, b, c) {
    const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
    const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
    const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
    const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(neg && pos);
  }
  function fillScanPoly(pts, rgb) {
    const [r, g, b] = rgb;
    let minY = Infinity, maxY = -Infinity;
    pts.forEach(p => { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length];
        if ((a[1] <= y && c[1] > y) || (c[1] <= y && a[1] > y)) {
          const x = a[0] + (y - a[1]) / (c[1] - a[1]) * (c[0] - a[0]);
          xs.push(x);
        }
      }
      xs.sort((m, n) => m - n);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.floor(xs[i]); x <= Math.ceil(xs[i + 1]); x++) blend(x, y, r, g, b, 255);
      }
    }
  }

  // ---- 极简 5x7 矢量字体（笔画式），覆盖 0-9 A-Z 与常用符号 ----
  const FONT = {
    '0': [[0,0,4,0],[4,0,4,7],[4,7,0,7],[0,7,0,0]],
    '1': [[1,1,3,0],[3,0,3,7]],
    '2': [[0,0,4,0],[4,0,4,3],[4,3,0,3],[0,3,0,7],[0,7,4,7]],
    '3': [[0,0,4,0],[4,0,4,7],[4,7,0,7],[4,3,0,3]],
    '4': [[0,0,0,3],[0,3,4,3],[4,0,4,7]],
    '5': [[0,0,4,0],[0,0,0,3],[0,3,4,3],[4,3,4,7],[4,7,0,7]],
    '6': [[4,0,0,0],[0,0,0,7],[0,7,4,7],[4,7,4,3],[4,3,0,3]],
    '7': [[0,0,4,0],[4,0,3,7]],
    '8': [[0,0,4,0],[4,0,4,7],[4,7,0,7],[0,7,0,0],[0,3,4,3]],
    '9': [[0,3,4,3],[4,3,4,0],[4,0,0,0],[0,0,0,7],[0,7,4,7]],
    'A': [[0,7,2,0],[2,0,4,7],[1,4,3,4]],
    'B': [[0,0,0,7],[0,0,3,0],[3,0,3,3],[3,3,0,3],[0,3,3,3],[3,3,3,7],[3,7,0,7]],
    'C': [[4,0,0,0],[0,0,0,7],[0,7,4,7]],
    'D': [[0,0,0,7],[0,0,3,0],[3,0,4,3],[4,3,3,4],[3,4,0,7]],
    'E': [[0,0,4,0],[0,0,0,7],[0,7,4,7],[0,3,3,3]],
    'F': [[0,0,4,0],[0,0,0,7],[0,3,3,3]],
    'G': [[4,0,0,0],[0,0,0,7],[0,7,4,7],[4,7,4,3],[4,3,2,3]],
    'H': [[0,0,0,7],[4,0,4,7],[0,3,4,3]],
    'I': [[0,0,4,0],[2,0,2,7],[0,7,4,7]],
    'J': [[4,0,4,7],[4,7,0,7],[0,7,0,4]],
    'K': [[0,0,0,7],[0,0,3,3],[3,3,4,0],[3,3,4,7]],
    'L': [[0,0,0,7],[0,7,4,7]],
    'M': [[0,7,0,0],[0,0,2,4],[2,4,4,0],[4,0,4,7]],
    'N': [[0,7,0,0],[0,0,4,7],[4,7,4,0]],
    'O': [[0,0,4,0],[4,0,4,7],[4,7,0,7],[0,7,0,0]],
    'P': [[0,0,0,7],[0,0,3,0],[3,0,3,3],[3,3,0,3]],
    'Q': [[0,0,4,0],[4,0,4,7],[4,7,0,7],[0,7,0,0],[2,5,4,7]],
    'R': [[0,0,0,7],[0,0,3,0],[3,0,3,3],[3,3,0,3],[0,3,3,3],[3,3,4,7]],
    'S': [[4,0,0,0],[0,0,0,3],[0,3,4,3],[4,3,4,7],[4,7,0,7]],
    'T': [[0,0,4,0],[2,0,2,7]],
    'U': [[0,0,0,7],[0,7,4,7],[4,7,4,0]],
    'V': [[0,0,2,7],[2,7,4,0]],
    'W': [[0,0,0,7],[0,7,2,3],[2,3,4,7],[4,7,4,0]],
    'X': [[0,0,4,7],[4,0,0,7]],
    'Y': [[0,0,2,3],[4,0,2,3],[2,3,2,7]],
    'Z': [[0,0,4,0],[4,0,0,7],[0,7,4,7]],
    ' ': [],
    '-': [[0,4,4,4]],
    '.': [[2,6,2,6]],
    ',': [[2,6,1,7]],
    '/': [[4,0,0,7]],
    ':': [[2,2,2,2],[2,5,2,5]],
    '(': [[3,0,1,2],[1,2,1,5],[3,5,3,7]],
    ')': [[1,0,3,2],[3,2,3,5],[1,5,1,7]],
    '+': [[0,3,4,3],[2,1,2,6]],
    '=': [[0,2,4,2],[0,5,4,5]]
  };

  function drawText(xWorld, yWorld, str, sizeWorld, rgb) {
    const pxH = Math.max(5, sizeWorld * SCALE);
    const u = pxH / 7;
    const colW = 5 * u, spacing = u;
    let cx = (xWorld - minX) * SCALE;
    const baseY = (yWorld - minY) * SCALE;
    const wpx = Math.max(1, Math.round(u * 0.8));
    for (const chRaw of String(str)) {
      const ch = chRaw.toUpperCase();
      if (ch === ' ') { cx += colW + spacing; continue; }
      const glyph = FONT[ch];
      if (!glyph) { cx += colW + spacing; continue; }
      for (const seg of glyph) {
        const ax = cx + seg[0] * u, ay = baseY - (7 - seg[1]) * u;
        const bx = cx + seg[2] * u, by = baseY - (7 - seg[3]) * u;
        thickLine(ax, ay, bx, by, rgb, wpx);
      }
      cx += colW + spacing;
    }
  }

  function strokeWpx(s) { return Math.max(1, Math.round((s.strokeW || 1) * SCALE)); }

  function drawShape(s) {
    const stRgb = hexToRgb(s.stroke || "#1a1a1a");
    const fill = (s.fill && s.fill !== "none") ? hexToRgb(s.fill) : null;
    const wpx = strokeWpx(s);
    if (s.type === 'line') {
      const [a, b] = [toPx(s.p1.x, s.p1.y), toPx(s.p2.x, s.p2.y)];
      thickLine(a[0], a[1], b[0], b[1], stRgb, wpx);
    } else if (s.type === 'dimLine') {
      const off = 20 * SCALE;
      const [p1, p2] = [toPx(s.p1.x, s.p1.y), toPx(s.p2.x, s.p2.y)];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy) || 1;
      const ox = -dy / len * off, oy = dx / len * off;
      const gray = [136, 136, 136];
      thickLine(p1[0], p1[1], p1[0] + ox, p1[1] + oy, gray, 1);
      thickLine(p2[0], p2[1], p2[0] + ox, p2[1] + oy, gray, 1);
      const [q1, q2] = [[p1[0] + ox, p1[1] + oy], [p2[0] + ox, p2[1] + oy]];
      thickLine(q1[0], q1[1], q2[0], q2[1], stRgb, 1);
      const ex = (dx / len), ey = (dy / len);
      arrowhead(q1[0], q1[1], ex, ey, 6, stRgb);
      arrowhead(q2[0], q2[1], -ex, -ey, 6, stRgb);
      const midX = (q1[0] + q2[0]) / 2, midY = (q1[1] + q2[1]) / 2;
      drawText(s.p1.x + (ox / SCALE), s.p1.y + (oy / SCALE) - 4 / SCALE, Math.hypot(s.p2.x - s.p1.x, s.p2.y - s.p1.y).toFixed(1), 12, stRgb);
    } else if (s.type === 'circle') {
      const c = toPx(s.c.x, s.c.y);
      const r = s.r * SCALE;
      const N = Math.max(16, Math.ceil(r * 2));
      if (fill) { disc(c[0], c[1], r, fill[0], fill[1], fill[2], 255); }
      let prev = null;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const p = [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
        if (prev) thickLine(prev[0], prev[1], p[0], p[1], stRgb, wpx);
        prev = p;
      }
    } else if (s.type === 'arc') {
      const c = toPx(s.c.x, s.c.y);
      const r = s.r * SCALE;
      const N = Math.max(16, Math.ceil(r));
      const a1 = s.a1, a2 = s.a2;
      let prev = null;
      for (let i = 0; i <= N; i++) {
        const a = a1 + (a2 - a1) * (i / N);
        const p = [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
        if (prev) thickLine(prev[0], prev[1], p[0], p[1], stRgb, wpx);
        prev = p;
      }
    } else if (s.type === 'ellipse') {
      if (s.rot) { // 旋转椭圆：采样后旋转
        const c = toPx(s.c.x, s.c.y);
        const N = 64;
        const co = Math.cos(s.rot), si = Math.sin(s.rot);
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2;
          const ex = Math.cos(a) * s.rx * SCALE, ey = Math.sin(a) * s.ry * SCALE;
          pts.push([c[0] + ex * co - ey * si, c[1] + ex * si + ey * co]);
        }
        if (fill) fillScanPoly(pts, fill);
        for (let i = 1; i < pts.length; i++) thickLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], stRgb, wpx);
      } else {
        const c = toPx(s.c.x, s.c.y);
        const rx = s.rx * SCALE, ry = s.ry * SCALE;
        if (fill) {
          const R = Math.ceil(Math.max(rx, ry));
          for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
            if ((xx * xx) / (rx * rx + 1e-6) + (yy * yy) / (ry * ry + 1e-6) <= 1) blend(c[0] + xx, c[1] + yy, fill[0], fill[1], fill[2], 255);
          }
        }
        const N = Math.max(24, Math.ceil((rx + ry) * 2));
        let prev = null;
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2;
          const p = [c[0] + Math.cos(a) * rx, c[1] + Math.sin(a) * ry];
          if (prev) thickLine(prev[0], prev[1], p[0], p[1], stRgb, wpx);
          prev = p;
        }
      }
    } else if (s.type === 'rect') {
      const a = toPx(s.x, s.y), b = toPx(s.x + s.w, s.y + s.h);
      if (fill) for (let y = Math.round(a[1]); y <= Math.round(b[1]); y++) for (let x = Math.round(a[0]); x <= Math.round(b[0]); x++) blend(x, y, fill[0], fill[1], fill[2], 255);
      thickLine(a[0], a[1], b[0], a[1], stRgb, wpx);
      thickLine(b[0], a[1], b[0], b[1], stRgb, wpx);
      thickLine(b[0], b[1], a[0], b[1], stRgb, wpx);
      thickLine(a[0], b[1], a[0], a[1], stRgb, wpx);
    } else if (s.type === 'polyline' || s.type === 'polygon') {
      const pts = s.points.map(p => toPx(p.x, p.y));
      if (fill && s.type === 'polygon') fillScanPoly(pts, fill);
      for (let i = 1; i < pts.length; i++) thickLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], stRgb, wpx);
      if (s.type === 'polygon' && pts.length > 2) thickLine(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], stRgb, wpx);
    } else if (s.type === 'spline') {
      const sp = [];
      const op = s.points;
      for (let i = 0; i < op.length - 1; i++) {
        const p0 = op[i - 1] || op[i], p1 = op[i], p2 = op[i + 1], p3 = op[i + 2] || p2;
        for (let t = 0; t < 1; t += 0.1) {
          const t2 = t * t, t3 = t2 * t;
          sp.push([p1.x + 0.5 * ((-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
                   p1.y + 0.5 * ((-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)]);
        }
      }
      sp.push(op[op.length - 1]);
      const pts = sp.map(p => toPx(p[0], p[1]));
      for (let i = 1; i < pts.length; i++) thickLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], stRgb, wpx);
    } else if (s.type === 'text') {
      drawText(s.x, s.y, s.text, s.size || 14, stRgb);
    } else if (s.type === 'dimRadius') {
      const a = toPx(s.c.x, s.c.y), b = toPx(s.c.x + s.r * Math.cos(-Math.PI / 4), s.c.y + s.r * Math.sin(-Math.PI / 4));
      thickLine(a[0], a[1], b[0], b[1], stRgb, 1);
      drawText((s.c.x + b[0] / SCALE + s.c.x) / 2, (s.c.y + b[1] / SCALE + s.c.y) / 2 - 4 / SCALE, "R" + Math.round(s.r), 12, stRgb);
    }
  }

  state.shapes.forEach(drawShape);
  return "data:image/png;base64," + encodePNG(W, H, buf).toString('base64');
}

// ==================== PNG 编码（纯 JS） ====================
const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = (c >>> 0); }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const off = y * (w * 4 + 1);
    raw[off] = 0;
    for (let x = 0; x < w * 4; x++) raw[off + 1 + x] = rgba[y * w * 4 + x];
  }
  const idat = zlib.deflateSync(raw);
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ==================== CSV 几何导出 ====================
function geomSummary(s) {
  switch (s.type) {
    case 'line': case 'dimLine': return `p1=(${s.p1.x},${s.p1.y}) p2=(${s.p2.x},${s.p2.y})`;
    case 'circle': return `c=(${s.c.x},${s.c.y}) r=${s.r}`;
    case 'arc': return `c=(${s.c.x},${s.c.y}) r=${s.r} a1=${R2D(s.a1).toFixed(1)} a2=${R2D(s.a2).toFixed(1)}`;
    case 'ellipse': return `c=(${s.c.x},${s.c.y}) rx=${s.rx} ry=${s.ry} rot=${(R2D(s.rot || 0)).toFixed(1)}`;
    case 'rect': return `x=${s.x} y=${s.y} w=${s.w} h=${s.h}`;
    case 'polyline': case 'polygon': case 'spline': return `points=${s.points.map(p => `(${p.x},${p.y})`).join(' ')}${s.closed ? ' [closed]' : ''}`;
    case 'text': return `pos=(${s.x},${s.y}) text="${s.text}" size=${s.size}`;
    case 'dimRadius': return `c=(${s.c.x},${s.c.y}) r=${s.r}`;
    default: return '';
  }
}
function fmt(n) { return (n && isFinite(n)) ? (+n).toFixed(2) : ''; }
function csvCell(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCSV() {
  const rows = [['id', 'type', 'layer', 'stroke', 'strokeW', 'fill', 'geometry', 'length', 'area']];
  state.shapes.forEach(s => {
    rows.push([s.id, s.type, s.layer, s.stroke, s.strokeW, s.fill, geomSummary(s), fmt(api.length(s.id)), fmt(api.area(s.id))]);
  });
  return rows.map(r => r.map(csvCell).join(',')).join('\n');
}

// ==================== 导出文件辅助 ====================
function exportPNGFile(path) {
  return api.exportPNGDataUrl().then(d => {
    const b = Buffer.from(d.split(',')[1], 'base64');
    fs.writeFileSync(path, b);
    return { path, bytes: b.length, width: 0, height: 0 };
  });
}
function exportCSVFile(path) { fs.writeFileSync(path, toCSV()); return { path }; }
function exportSVGFile(path) { fs.writeFileSync(path, api.exportSVG()); return { path }; }

// ==================== DXF 导出（R12 ASCII，Y 轴翻转为 CAD 惯例） ====================
function dxfPair(code, value) { return code + "\n" + value + "\n"; }
function dxfNum(v) { const n = +(+v).toFixed(4); return Object.is(n, -0) ? "0" : String(n); }
function dxfY(y) { return dxfNum(-y); }

function splineSamplePoints(pts, closed) {
  const src = closed ? pts.concat([pts[0]]) : pts;
  const samples = [];
  for (let i = 0; i < src.length - 1; i++) {
    const p0 = src[i - 1] || src[i], p1 = src[i], p2 = src[i + 1], p3 = src[i + 2] || p2;
    for (let t = 0; t < 1; t += 0.1) {
      const t2 = t * t, t3 = t2 * t;
      samples.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
      });
    }
  }
  samples.push(src[src.length - 1]);
  return samples;
}

function shapeToDXF(s, out) {
  const P = (c, v) => out.push(dxfPair(c, v));
  const line = (x1, y1, x2, y2) => {
    P(0, "LINE"); P(8, "0"); P(10, dxfNum(x1)); P(20, dxfY(y1)); P(11, dxfNum(x2)); P(21, dxfY(y2));
  };
  const polyline = (pts, closed) => {
    P(0, "POLYLINE"); P(8, "0"); P(66, 1); P(70, closed ? 1 : 0);
    pts.forEach(p => { P(0, "VERTEX"); P(8, "0"); P(10, dxfNum(p.x)); P(20, dxfY(p.y)); });
    P(0, "SEQEND");
  };
  const text = (x, y, str, size) => {
    P(0, "TEXT"); P(8, "0"); P(10, dxfNum(x)); P(20, dxfY(y)); P(40, dxfNum(size || 14)); P(1, String(str));
  };
  switch (s.type) {
    case "line": line(s.p1.x, s.p1.y, s.p2.x, s.p2.y); break;
    case "circle": P(0, "CIRCLE"); P(8, "0"); P(10, dxfNum(s.c.x)); P(20, dxfY(s.c.y)); P(40, dxfNum(s.r)); break;
    case "arc": {
      let a1 = R2D(s.a1), a2 = R2D(s.a2);
      if (s.ccw === false) { const t = a1; a1 = a2; a2 = t; }
      if (a2 <= a1) a2 += 360;
      P(0, "ARC"); P(8, "0"); P(10, dxfNum(s.c.x)); P(20, dxfY(s.c.y)); P(40, dxfNum(s.r)); P(50, dxfNum(a1)); P(51, dxfNum(a2));
      break;
    }
    case "rect":
      line(s.x, s.y, s.x + s.w, s.y);
      line(s.x + s.w, s.y, s.x + s.w, s.y + s.h);
      line(s.x + s.w, s.y + s.h, s.x, s.y + s.h);
      line(s.x, s.y + s.h, s.x, s.y);
      break;
    case "polyline": polyline(s.points, false); break;
    case "polygon": polyline(s.points, true); break;
    case "ellipse": {
      const pts = [];
      for (let i = 0; i <= 48; i++) {
        const t = (i / 48) * Math.PI * 2;
        const px = s.rx * Math.cos(t), py = s.ry * Math.sin(t);
        pts.push({ x: s.c.x + px * Math.cos(s.rot) - py * Math.sin(s.rot), y: s.c.y + px * Math.sin(s.rot) + py * Math.cos(s.rot) });
      }
      polyline(pts, true);
      break;
    }
    case "spline": polyline(splineSamplePoints(s.points, s.closed), !!s.closed); break;
    case "text": text(s.x, s.y, s.text, s.size); break;
    case "point": P(0, "POINT"); P(8, "0"); P(10, dxfNum(s.x)); P(20, dxfY(s.y)); break;
    case "dimLine": {
      const dx = s.p2.x - s.p1.x, dy = s.p2.y - s.p1.y;
      const len = Math.hypot(dx, dy); const ang = Math.atan2(dy, dx);
      const off = 20; const ox = -Math.sin(ang) * off, oy = Math.cos(ang) * off;
      line(s.p1.x, s.p1.y, s.p1.x + ox, s.p1.y + oy);
      line(s.p2.x, s.p2.y, s.p2.x + ox, s.p2.y + oy);
      line(s.p1.x + ox, s.p1.y + oy, s.p2.x + ox, s.p2.y + oy);
      text((s.p1.x + s.p2.x) / 2 + ox, (s.p1.y + s.p2.y) / 2 + oy, len.toFixed(1), 12);
      break;
    }
    case "dimRadius": {
      const ang = Math.atan2(s.p2.y - s.c.y, s.p2.x - s.c.x);
      const ex = s.c.x + Math.cos(ang) * s.r, ey = s.c.y + Math.sin(ang) * s.r;
      line(s.c.x, s.c.y, ex, ey);
      text((s.c.x + ex) / 2, (s.c.y + ey) / 2, "R" + s.r.toFixed(0), 12);
      break;
    }
    default: break;
  }
}

function toDXF() {
  const out = [dxfPair(0, "SECTION"), dxfPair(2, "ENTITIES")];
  state.shapes.forEach(s => shapeToDXF(s, out));
  out.push(dxfPair(0, "ENDSEC"), dxfPair(0, "EOF"));
  return out.join("");
}
api.exportDXF = () => toDXF();
function exportDXFFile(path) { fs.writeFileSync(path, toDXF()); return { path }; }

// ==================== 暴露接口 ====================
const engine = { api, state, toCSV, toDXF, exportPNGFile, exportCSVFile, exportSVGFile, exportDXFFile, version: api.version };
if (typeof module !== 'undefined' && module.exports) module.exports = engine;

// ==================== CLI ====================
if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);

    if (argv[0] === 'doctor') {
      const cp = require('child_process');
      const py = cp.spawnSync('python3', ['--version'], { encoding: 'utf8' });
      global.cadAPI = api;
      global.window = global;
      api.clear();
      api.circle(0, 0, 5);
      const v = api.validate();
      const report = {
        engine: api.version(),
        node: process.version,
        platform: process.platform,
        smoke: v && v.ok ? 'OK' : 'FAIL',
        python3: py.status === 0 ? (py.stdout || py.stderr).trim() : 'MISSING (仅 SVG-EDIT 需要)',
        note: 'CAD-CREATE 仅需 Node; SVG-EDIT 另需 python3'
      };
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.smoke === 'OK' ? 0 : 1);
    }

    let scriptPath = null;
    let outDir = '.';
    let name = 'cad-drawing';
    let doSvg = false, doPng = false, doCsv = false, doDxf = false;
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--out') outDir = argv[++i];
      else if (a === '--name') name = argv[++i];
      else if (a === '--svg') doSvg = true;
      else if (a === '--png') doPng = true;
      else if (a === '--csv') doCsv = true;
      else if (a === '--dxf') doDxf = true;
      else if (a === '--all') { doSvg = doPng = doCsv = doDxf = true; }
      else if (!a.startsWith('--') && !scriptPath) scriptPath = a;
    }
    if (!scriptPath) {
      console.error('用法: node cad-engine.js <draw.js> [--svg] [--png] [--csv] [--dxf] [--all] [--out DIR] [--name NAME]');
      console.error('自检: node cad-engine.js doctor');
      process.exit(2);
    }
    if (!doSvg && !doPng && !doCsv && !doDxf) { doSvg = doPng = doCsv = doDxf = true; } // 默认全导出
    global.cadAPI = api;
    global.window = global;
    const code = fs.readFileSync(scriptPath, 'utf8');
    const fn = new Function('cadAPI', 'window', code);
    fn(api, global);
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}
    const out = { name, count: api.count() };
    if (doSvg) { const r = exportSVGFile(require('path').join(outDir, name + '.svg')); out.svg = r.path; }
    if (doCsv) { const r = exportCSVFile(require('path').join(outDir, name + '.csv')); out.csv = r.path; }
    if (doDxf) { const r = exportDXFFile(require('path').join(outDir, name + '.dxf')); out.dxf = r.path; }
    if (doPng) {
      const r = await exportPNGFile(require('path').join(outDir, name + '.png'));
      const buf = fs.readFileSync(r.path);
      // 读回尺寸
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      out.png = { path: r.path, bytes: r.bytes, width: w, height: h };
    }
    console.log(JSON.stringify(out));
  })().catch(e => { console.error('ERR', e && e.message); process.exit(1); });
}
