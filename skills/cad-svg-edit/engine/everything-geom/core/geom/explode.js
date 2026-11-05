/**
 * Explode polylines into lines and arcs.
 */
import { arcFromBulge, BULGE_EPS } from './bulge.js';
import { lineFrom, arcFrom } from './entity.js';
import { normAngle } from './vec.js';

/** Lines and arcs (no ids) for every non-degenerate segment of a polyline. */
export function explodePolyline(poly) {
  const pts = poly.pts;
  const n = Math.floor(pts.length / 3);
  const out = [];
  if (n < 2) return out;
  const segs = poly.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 3,
      b = ((i + 1) % n) * 3;
    const x1 = pts[a],
      y1 = pts[a + 1],
      x2 = pts[b],
      y2 = pts[b + 1],
      bulge = pts[a + 2];
    if (x1 === x2 && y1 === y2) continue;
    const arc = Math.abs(bulge) > BULGE_EPS ? arcFromBulge(x1, y1, x2, y2, bulge) : null;
    if (!arc) {
      const l = lineFrom(poly, x1, y1, x2, y2);
      delete l.width;
      out.push(l);
    } else {
      const s = arc.ccw ? arc.a0 : arc.a1,
        e = arc.ccw ? arc.a1 : arc.a0;
      const ar = arcFrom(poly, arc.cx, arc.cy, arc.r, normAngle(s), normAngle(e));
      delete ar.width;
      out.push(ar);
    }
  }
  return out;
}

/** Explode an entity into simpler ones (polylines only here), or null. */
export function explodeEntity(ent) {
  if (ent.type === 'polyline') return explodePolyline(ent);
  return null;
}
