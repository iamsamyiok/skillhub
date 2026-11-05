/**
 * Exact axis-aligned bounds of geometric entities: [minX, minY, maxX, maxY].
 */
import { HALF_PI, normAngle, ccwSweep, angleInSweep, growBox } from './vec.js';
import { arcFromBulge } from './bulge.js';
import { ellipsePoint, ellipseSweep, isFullEllipse, ellipseExtremeParams } from './ellipse.js';
import { evalSplineFull, splineBreaks } from './spline.js';

/** Grow box by the CCW arc a0 .. a0 + sweep (end points and axis crossings). */
export function growArc(box, cx, cy, r, a0, sweep) {
  growBox(box, cx + r * Math.cos(a0), cy + r * Math.sin(a0));
  growBox(box, cx + r * Math.cos(a0 + sweep), cy + r * Math.sin(a0 + sweep));
  const s = normAngle(a0);
  for (let q = 0; q < 4; q++) {
    const a = q * HALF_PI;
    if (angleInSweep(a, s, sweep, 0)) growBox(box, cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return box;
}

/** Grow box by a stride-3 bulged point list. */
export function growBulgeList(box, pts, closed) {
  const n = Math.floor(pts.length / 3);
  for (let i = 0; i < n; i++) growBox(box, pts[i * 3], pts[i * 3 + 1]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 3,
      b = ((i + 1) % n) * 3;
    const b0 = pts[a + 2];
    if (!b0) continue;
    const arc = arcFromBulge(pts[a], pts[a + 1], pts[b], pts[b + 1], b0);
    if (!arc) continue;
    if (arc.sweep > 0) growArc(box, arc.cx, arc.cy, arc.r, arc.a0, arc.sweep);
    else growArc(box, arc.cx, arc.cy, arc.r, arc.a1, -arc.sweep);
  }
  return box;
}

/** Grow box by an ellipse or elliptical arc. */
export function growEllipse(box, e) {
  const full = isFullEllipse(e);
  const sw = ellipseSweep(e);
  const t0 = normAngle(full ? 0 : e.start);
  const [tx, ty] = ellipseExtremeParams(e);
  const cand = [tx, tx + Math.PI, ty, ty + Math.PI];
  for (const t of cand) {
    if (full || angleInSweep(t, t0, sw, 0)) {
      const p = ellipsePoint(e, t);
      growBox(box, p.x, p.y);
    }
  }
  if (!full) {
    const p = ellipsePoint(e, t0),
      q = ellipsePoint(e, t0 + sw);
    growBox(box, p.x, p.y);
    growBox(box, q.x, q.y);
  }
  return box;
}

/** Root of one derivative component in [a, b] (opposite signs) by Illinois regula falsi. */
function derivRoot(s, a, b, fa, fb, useY) {
  let side = 0;
  for (let it = 0; it < 60; it++) {
    const m = (a * fb - b * fa) / (fb - fa);
    const r = evalSplineFull(s, m);
    const fm = useY ? r.dy : r.dx;
    if (fm * fb > 0) {
      b = m;
      fb = fm;
      if (side === -1) fa /= 2;
      side = -1;
    } else if (fa * fm > 0) {
      a = m;
      fa = fm;
      if (side === 1) fb /= 2;
      side = 1;
    } else return m;
    if (Math.abs(b - a) <= 1e-15 * Math.max(1, Math.abs(a))) break;
  }
  return (a + b) / 2;
}

/** Grow box by a spline: sampled points plus the roots of x' and y'. */
export function growSpline(box, s) {
  const br = splineBreaks(s);
  if (br.length < 2) {
    const p = evalSplineFull(s, br.length ? br[0] : 0);
    return growBox(box, p.x, p.y);
  }
  const SUB = 8;
  for (let k = 0; k + 1 < br.length; k++) {
    const ua = br[k],
      ub = br[k + 1];
    let prev = evalSplineFull(s, ua),
      pu = ua;
    growBox(box, prev.x, prev.y);
    for (let i = 1; i <= SUB; i++) {
      const u = i === SUB ? ub : ua + ((ub - ua) * i) / SUB;
      const cur = evalSplineFull(s, u);
      growBox(box, cur.x, cur.y);
      if (prev.dx * cur.dx < 0) {
        const p = evalSplineFull(s, derivRoot(s, pu, u, prev.dx, cur.dx, false));
        growBox(box, p.x, p.y);
      }
      if (prev.dy * cur.dy < 0) {
        const p = evalSplineFull(s, derivRoot(s, pu, u, prev.dy, cur.dy, true));
        growBox(box, p.x, p.y);
      }
      prev = cur;
      pu = u;
    }
  }
  return box;
}

/**
 * Bounds of an entity, or null for unbounded (xline, ray), empty or
 * non-geometric entities (text, mtext, dimension, insert).
 */
export function entityBounds(ent) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  switch (ent.type) {
    case 'line':
      growBox(box, ent.x1, ent.y1);
      growBox(box, ent.x2, ent.y2);
      break;
    case 'circle':
      return [ent.cx - ent.r, ent.cy - ent.r, ent.cx + ent.r, ent.cy + ent.r];
    case 'arc':
      growArc(box, ent.cx, ent.cy, ent.r, ent.start, ccwSweep(ent.start, ent.end));
      break;
    case 'ellipse':
      growEllipse(box, ent);
      break;
    case 'polyline':
      growBulgeList(box, ent.pts, !!ent.closed);
      break;
    case 'spline':
      if (!ent.ctrl || ent.ctrl.length < 2) return null;
      growSpline(box, ent);
      break;
    case 'point':
      return [ent.x, ent.y, ent.x, ent.y];
    case 'leader': {
      const p = ent.pts;
      for (let i = 0; i + 1 < p.length; i += 2) growBox(box, p[i], p[i + 1]);
      break;
    }
    case 'hatch':
      for (const l of ent.loops || []) growBulgeList(box, l, true);
      break;
    default:
      return null;
  }
  return box[0] === Infinity ? null : box;
}

/** Union of two boxes (either may be null). */
export function unionBounds(a, b) {
  if (!a) return b ? b.slice() : null;
  if (!b) return a.slice();
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}
