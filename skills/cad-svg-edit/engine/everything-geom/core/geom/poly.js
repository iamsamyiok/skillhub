/**
 * Polyline vertex helpers. Polyline points are flat [x, y, bulge, ...]
 * (stride 3). A position along a polyline is a parameter U = i + f: segment
 * index i plus fraction f in [0, 1] (by sweep angle for arc segments).
 */
import { arcFromBulge, bulgePoint, BULGE_EPS } from './bulge.js';

/** Number of vertices in a stride-3 point array. */
export function vertexCount(pts) {
  return Math.floor(pts.length / 3);
}

/** Number of segments of a polyline. */
export function segmentCount(pts, closed) {
  const n = vertexCount(pts);
  if (n < 2) return 0;
  return closed ? n : n - 1;
}

/** Point at parameter U. */
export function polyPointAt(pts, closed, U) {
  const n = vertexCount(pts);
  const m = segmentCount(pts, closed);
  if (m === 0) return n ? { x: pts[0], y: pts[1] } : { x: 0, y: 0 };
  if (closed) U = ((U % m) + m) % m;
  let i = Math.floor(U);
  if (i >= m) i = m - 1;
  if (i < 0) i = 0;
  const f = U - i;
  const j = (i + 1) % n;
  return bulgePoint(pts[i * 3], pts[i * 3 + 1], pts[j * 3], pts[j * 3 + 1], pts[i * 3 + 2], f);
}

/** Bulge of the part [f0, f1] of a segment with bulge b. */
function partBulge(b, f0, f1) {
  if (!(Math.abs(b) > BULGE_EPS)) return 0;
  return Math.tan(Math.atan(b) * (f1 - f0));
}

/**
 * Open piece of a polyline between parameters U0 < U1, as stride-3 points.
 * For closed polylines U1 may exceed the segment count (wraps around).
 */
export function subPolyline(pts, closed, U0, U1) {
  const n = vertexCount(pts);
  const m = segmentCount(pts, closed);
  const out = [];
  if (m === 0 || !(U1 > U0)) return out;
  if (!closed) {
    U0 = Math.max(0, U0);
    U1 = Math.min(m, U1);
  }
  let i = Math.floor(U0);
  let f0 = U0 - i;
  if (f0 > 1 - 1e-12) {
    i++;
    f0 = 0;
  }
  for (;;) {
    const si = ((i % m) + m) % m;
    const a = si * 3,
      b = ((si + 1) % n) * 3;
    const bulge = pts[a + 2];
    const segEndU = i + 1;
    const f1 = U1 < segEndU ? U1 - i : 1;
    const p = f0 === 0 ? { x: pts[a], y: pts[a + 1] } : bulgePoint(pts[a], pts[a + 1], pts[b], pts[b + 1], bulge, f0);
    if (f1 - f0 > 1e-12) out.push(p.x, p.y, partBulge(bulge, f0, f1));
    if (U1 <= segEndU + 1e-12) {
      const q = f1 === 1 ? { x: pts[b], y: pts[b + 1] } : bulgePoint(pts[a], pts[a + 1], pts[b], pts[b + 1], bulge, f1);
      out.push(q.x, q.y, 0);
      break;
    }
    i++;
    f0 = 0;
  }
  return out;
}

/** Reverse a stride-3 point array, negating and shifting bulges. */
export function reversePolyPts(pts, closed) {
  const n = vertexCount(pts);
  const out = new Array(n * 3);
  for (let j = 0; j < n; j++) {
    const o = (n - 1 - j) * 3;
    out[j * 3] = pts[o];
    out[j * 3 + 1] = pts[o + 1];
    let b = 0;
    if (j < n - 1) b = -pts[(n - 2 - j) * 3 + 2];
    else if (closed) b = -pts[(n - 1) * 3 + 2];
    out[j * 3 + 2] = b || 0;
  }
  return out;
}

/** Arc of segment i, or null when the segment is straight. */
export function segmentArc(pts, i) {
  const n = vertexCount(pts);
  const a = i * 3,
    b = ((i + 1) % n) * 3;
  return arcFromBulge(pts[a], pts[a + 1], pts[b], pts[b + 1], pts[a + 2]);
}
