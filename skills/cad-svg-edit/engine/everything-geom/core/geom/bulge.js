/**
 * Polyline bulge math. A segment from p1 to p2 with bulge b is a circular arc
 * of sweep 4 * atan(b): positive = counter-clockwise, 0 = straight.
 */
import { ccwSweep } from './vec.js';

/** Bulges smaller than this are treated as straight segments. */
export const BULGE_EPS = 1e-12;

/**
 * Arc of a bulged segment: { cx, cy, r, a0, a1, ccw, sweep } where a0 is the
 * angle at p1, a1 the angle at p2 (traversal order) and sweep is signed.
 * Returns null for straight or zero-length segments.
 */
export function arcFromBulge(x1, y1, x2, y2, b) {
  if (!(Math.abs(b) > BULGE_EPS)) return null;
  const dx = x2 - x1,
    dy = y2 - y1;
  const c = Math.hypot(dx, dy);
  if (c === 0) return null;
  const k = (1 - b * b) / (4 * b);
  const cx = (x1 + x2) / 2 - dy * k;
  const cy = (y1 + y2) / 2 + dx * k;
  const r = (c * (1 + b * b)) / (4 * Math.abs(b));
  return {
    cx,
    cy,
    r,
    a0: Math.atan2(y1 - cy, x1 - cx),
    a1: Math.atan2(y2 - cy, x2 - cx),
    ccw: b > 0,
    sweep: 4 * Math.atan(b),
  };
}

/**
 * Bulge of an arc traversed from angle a0 to angle a1, counter-clockwise when
 * ccw is true, clockwise otherwise.
 */
export function bulgeFromArc(cx, cy, r, a0, a1, ccw = true) {
  return ccw ? Math.tan(ccwSweep(a0, a1) / 4) : -Math.tan(ccwSweep(a1, a0) / 4);
}

/** Bulge for a signed sweep angle. */
export function bulgeFromSweep(sweep) {
  return Math.tan(sweep / 4);
}

/** Midpoint of a bulged segment (on the arc). */
export function bulgeMidpoint(x1, y1, x2, y2, b) {
  const h = b / 2;
  return { x: (x1 + x2) / 2 + (y2 - y1) * h, y: (y1 + y2) / 2 - (x2 - x1) * h };
}

/** Length of a bulged segment. */
export function bulgeLength(x1, y1, x2, y2, b) {
  const c = Math.hypot(x2 - x1, y2 - y1);
  if (!(Math.abs(b) > BULGE_EPS)) return c;
  const s = Math.abs(4 * Math.atan(b));
  return (c * (1 + b * b) * s) / (4 * Math.abs(b));
}

/**
 * Point at fraction f (0..1, by sweep for arcs) along a bulged segment.
 * `arc` may be passed when already computed.
 */
export function bulgePoint(x1, y1, x2, y2, b, f, arc = null) {
  const a = arc ?? arcFromBulge(x1, y1, x2, y2, b);
  if (!a) return { x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f };
  const ang = a.a0 + a.sweep * f;
  return { x: a.cx + a.r * Math.cos(ang), y: a.cy + a.r * Math.sin(ang) };
}

/** Unit tangent (direction of travel) at fraction f along a bulged segment. */
export function bulgeTangent(x1, y1, x2, y2, b, f, arc = null) {
  const a = arc ?? arcFromBulge(x1, y1, x2, y2, b);
  if (!a) {
    const l = Math.hypot(x2 - x1, y2 - y1) || 1;
    return { x: (x2 - x1) / l, y: (y2 - y1) / l };
  }
  const ang = a.a0 + a.sweep * f;
  const s = a.sweep > 0 ? 1 : -1;
  return { x: -Math.sin(ang) * s, y: Math.cos(ang) * s };
}
