/**
 * Offset curves. offsetEntity(ent, dist, sideX, sideY) builds a new entity
 * parallel to ent at distance dist on the side of the point (sideX, sideY).
 */
import { TWO_PI, normAngle, wrapPi, tolFor } from './vec.js';
import { arcFromBulge, BULGE_EPS } from './bulge.js';
import { derive, polylineFrom } from './entity.js';
import { toPrims, ellipsePrim, splinePrim } from './prims.js';
import { closestOnPrims } from './nearest.js';
import { intersectPrims, curveAt } from './intersect.js';
import { signedAreaPolyline, pointInPolygon } from './measure.js';
import { bulgePolyPoints } from './tessellate.js';
import { isFullEllipse } from './ellipse.js';

/** Signed side of (px, py) relative to a direction: +1 left, -1 right, 0 on. */
function sideOf(x, y, dx, dy, px, py) {
  const c = dx * (py - y) - dy * (px - x);
  const t = 1e-12 * Math.hypot(dx, dy) * Math.max(1, Math.hypot(px - x, py - y));
  return c > t ? 1 : c < -t ? -1 : 0;
}

/** Unit tangent (direction of travel) at the closest point of a primitive. */
function primTangent(p, t) {
  if (p.t === 'seg') {
    const l = Math.hypot(p.x2 - p.x1, p.y2 - p.y1) || 1;
    return { x: (p.x2 - p.x1) / l, y: (p.y2 - p.y1) / l };
  }
  if (p.t === 'inf') return { x: p.dx, y: p.dy };
  if (p.t === 'arc') {
    const s = p.rev ? -1 : 1;
    return { x: -Math.sin(t) * s, y: Math.cos(t) * s };
  }
  const c = curveAt(p.src, t);
  const l = Math.hypot(c.dx, c.dy) || 1;
  return { x: c.dx / l, y: c.dy / l };
}

/** +1 when (px, py) is left of the entity's direction of travel, -1 right, 0 on it. */
function pickSide(prims, px, py) {
  const c = closestOnPrims(prims, px, py);
  if (!c) return 0;
  const tg = primTangent(c.prim, c.t);
  return sideOf(c.x, c.y, tg.x, tg.y, px, py);
}

/**
 * Offset a polyline by signed distance s (positive = left of travel).
 * Returns { pts, closed } or null.
 */
export function offsetPolylinePts(pts, closed, s) {
  const n = Math.floor(pts.length / 3);
  if (n < 2) return null;
  const segCount = closed ? n : n - 1;
  let scale = 0;
  for (let i = 0; i < n * 3; i += 3) scale = Math.max(scale, Math.abs(pts[i]), Math.abs(pts[i + 1]));
  const tol = tolFor(scale, s);
  // Raw offset segments.
  const raw = [];
  for (let i = 0; i < segCount; i++) {
    const a = i * 3,
      b = ((i + 1) % n) * 3;
    const x1 = pts[a],
      y1 = pts[a + 1],
      x2 = pts[b],
      y2 = pts[b + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (!(len > tol)) continue;
    const bulge = pts[a + 2];
    if (Math.abs(bulge) > BULGE_EPS) {
      const arc = arcFromBulge(x1, y1, x2, y2, bulge);
      const r = arc.ccw ? arc.r - s : arc.r + s;
      if (!(r > tol)) continue;
      raw.push({
        arc: true,
        cx: arc.cx,
        cy: arc.cy,
        r,
        sweep: arc.sweep,
        a0: arc.a0,
        a1: arc.a0 + arc.sweep,
        x1: arc.cx + r * Math.cos(arc.a0),
        y1: arc.cy + r * Math.sin(arc.a0),
        x2: arc.cx + r * Math.cos(arc.a1),
        y2: arc.cy + r * Math.sin(arc.a1),
        vx: x2,
        vy: y2,
      });
    } else {
      const ux = (x2 - x1) / len,
        uy = (y2 - y1) / len;
      const ox = -uy * s,
        oy = ux * s;
      raw.push({ arc: false, ux, uy, x1: x1 + ox, y1: y1 + oy, x2: x2 + ox, y2: y2 + oy, vx: x2, vy: y2 });
    }
  }
  let segs = raw;
  for (let pass = 0; pass <= raw.length; pass++) {
    const m = segs.length;
    if (m === 0) return null;
    const res = segs.map((g) => ({ g, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, join: 0 }));
    const nj = closed ? m : m - 1;
    for (let k = 0; k < nj; k++) {
      const A = res[k],
        B = res[(k + 1) % m];
      joinSegs(A, B, s, tol);
    }
    // Validity: segments must keep their direction after trimming.
    const bad = new Set();
    for (const r of res) {
      if (closed && m === 1) break;
      if (r.g.arc) {
        const ds = wrapPi(Math.atan2(r.y1 - r.g.cy, r.x1 - r.g.cx) - r.g.a0);
        const de = wrapPi(Math.atan2(r.y2 - r.g.cy, r.x2 - r.g.cx) - r.g.a1);
        r.sweep = r.g.sweep - ds + de;
        if (r.sweep * r.g.sweep <= 0 || Math.abs(r.sweep) >= TWO_PI) bad.add(r.g);
      } else {
        const along = (r.x2 - r.x1) * r.g.ux + (r.y2 - r.y1) * r.g.uy;
        if (!(along > tol)) bad.add(r.g);
      }
    }
    if (bad.size && bad.size < m) {
      segs = segs.filter((g) => !bad.has(g));
      continue;
    }
    if (bad.size) return null;
    // Emit vertices.
    const out = [];
    for (let k = 0; k < m; k++) {
      const r = res[k];
      out.push(r.x1, r.y1, r.g.arc ? Math.tan(r.sweep / 4) : 0);
      if (r.join) out.push(r.x2, r.y2, r.join);
    }
    if (!closed) {
      const r = res[m - 1];
      out.push(r.x2, r.y2, 0);
    }
    return { pts: out, closed };
  }
  return null;
}

/** Primitive of a raw offset segment, used to intersect neighbours. */
function segPrim(g) {
  if (!g.arc) return { t: 'seg', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 };
  return { t: 'arc', cx: g.cx, cy: g.cy, r: g.r, a0: 0, a1: TWO_PI, full: true };
}

/** Connect the end of A to the start of B (extend / trim or round join). */
function joinSegs(A, B, s, tol) {
  const ex = A.x2,
    ey = A.y2,
    sx = B.x1,
    sy = B.y1;
  if (Math.hypot(ex - sx, ey - sy) <= tol * 10) {
    const mx = (ex + sx) / 2,
      my = (ey + sy) / 2;
    A.x2 = B.x1 = mx;
    A.y2 = B.y1 = my;
    return;
  }
  const hits = intersectPrims(segPrim(A.g), segPrim(B.g), { extA: true, extB: true });
  // Reference: the original vertex the two segments met at.
  const rx = A.g.vx,
    ry = A.g.vy;
  let best = null,
    bd = Infinity;
  for (const h of hits) {
    const d = Math.hypot(h.x - rx, h.y - ry);
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  // Accept the corner when it is not absurdly far compared to the offset.
  if (best && bd <= Math.abs(s) * 1e3) {
    A.x2 = B.x1 = best.x;
    A.y2 = B.y1 = best.y;
    return;
  }
  // Round join around the original vertex.
  const a0 = Math.atan2(ey - ry, ex - rx),
    a1 = Math.atan2(sy - ry, sx - rx);
  let sw = normAngle(a1 - a0);
  if (s > 0) sw -= TWO_PI;
  if (sw === 0 || Math.abs(sw) >= TWO_PI) return;
  A.join = Math.tan(sw / 4);
}

/**
 * Offset an entity by dist toward the side of (sideX, sideY). Supports line,
 * xline, ray, circle, arc, polyline (open / closed, with bulges), ellipse and
 * spline (approximated by a polyline). Returns a new entity or null.
 */
export function offsetEntity(ent, dist, sideX, sideY, opts) {
  const d = Math.abs(dist);
  if (!(d > 0)) return null;
  switch (ent.type) {
    case 'line': {
      const dx = ent.x2 - ent.x1,
        dy = ent.y2 - ent.y1;
      const l = Math.hypot(dx, dy);
      if (!(l > 0)) return null;
      const side = sideOf(ent.x1, ent.y1, dx, dy, sideX, sideY);
      if (!side) return null;
      const ox = (-dy / l) * d * side,
        oy = (dx / l) * d * side;
      return derive(ent, 'line', { x1: ent.x1 + ox, y1: ent.y1 + oy, x2: ent.x2 + ox, y2: ent.y2 + oy });
    }
    case 'xline':
    case 'ray': {
      const l = Math.hypot(ent.dx, ent.dy);
      if (!(l > 0)) return null;
      const side = sideOf(ent.x, ent.y, ent.dx, ent.dy, sideX, sideY);
      if (!side) return null;
      return derive(ent, ent.type, { x: ent.x + (-ent.dy / l) * d * side, y: ent.y + (ent.dx / l) * d * side, dx: ent.dx, dy: ent.dy });
    }
    case 'circle':
    case 'arc': {
      const ds = Math.hypot(sideX - ent.cx, sideY - ent.cy);
      const r = ds < ent.r ? ent.r - d : ent.r + d;
      if (!(r > tolFor(ent.r))) return null;
      return ent.type === 'circle'
        ? derive(ent, 'circle', { cx: ent.cx, cy: ent.cy, r })
        : derive(ent, 'arc', { cx: ent.cx, cy: ent.cy, r, start: ent.start, end: ent.end });
    }
    case 'polyline': {
      const closed = !!ent.closed;
      let side;
      const area = closed ? signedAreaPolyline(ent.pts, true) : 0;
      if (closed && Math.abs(area) > 0) {
        const ring = bulgePolyPoints(ent.pts, true, Math.sqrt(Math.abs(area)) * 1e-4);
        const inside = pointInPolygon(sideX, sideY, ring);
        side = (inside ? 1 : -1) * (area > 0 ? 1 : -1);
      } else side = pickSide(toPrims(ent), sideX, sideY);
      if (!side) return null;
      const r = offsetPolylinePts(ent.pts, closed, d * side);
      return r ? polylineFrom(ent, r.pts, r.closed) : null;
    }
    case 'ellipse':
    case 'spline':
      return offsetCurve(ent, d, sideX, sideY, opts?.relTol ?? 2e-5);
    default:
      return null;
  }
}

/** Offset of an ellipse or spline approximated as a polyline. */
function offsetCurve(ent, d, sideX, sideY, relTol) {
  if (ent.type === 'spline' && !(ent.ctrl && ent.ctrl.length >= 4)) return null;
  const prim = ent.type === 'ellipse' ? ellipsePrim(ent, relTol) : splinePrim(ent, relTol);
  const side = pickSide([prim], sideX, sideY);
  if (!side) return null;
  const s = d * side;
  const us = prim.us,
    p = prim.pts;
  const out = [];
  const n = us.length;
  for (let i = 0; i < n; i++) {
    const c = curveAt(ent, us[i]);
    let tx = c.dx,
      ty = c.dy;
    let l = Math.hypot(tx, ty);
    if (!(l > 0)) {
      // Zero derivative (cusp or stacked control points): use the chord direction.
      const a = i < n - 1 ? i : i - 1;
      tx = p[2 * a + 2] - p[2 * a];
      ty = p[2 * a + 3] - p[2 * a + 1];
      l = Math.hypot(tx, ty) || 1;
    }
    out.push(c.x - (ty / l) * s, c.y + (tx / l) * s, 0);
  }
  const closed = ent.type === 'ellipse' ? isFullEllipse(ent) : !!ent.closed;
  if (closed && out.length >= 6) {
    const k = out.length;
    if (Math.hypot(out[k - 3] - out[0], out[k - 2] - out[1]) <= tolFor(out[0], out[1]) * 1e3) out.length -= 3;
  }
  return polylineFrom(ent, out, closed);
}
