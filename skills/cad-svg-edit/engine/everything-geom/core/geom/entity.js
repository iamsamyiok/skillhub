/**
 * Helpers for building entities from other entities: copy the non-geometric
 * fields (layer, color, linetype, width, text, ...) and replace the geometry.
 */

/** Geometry fields per entity type. */
export const GEOM_KEYS = {
  line: ['x1', 'y1', 'x2', 'y2'],
  xline: ['x', 'y', 'dx', 'dy'],
  ray: ['x', 'y', 'dx', 'dy'],
  circle: ['cx', 'cy', 'r'],
  arc: ['cx', 'cy', 'r', 'start', 'end'],
  ellipse: ['cx', 'cy', 'mx', 'my', 'ratio', 'start', 'end'],
  polyline: ['pts', 'closed'],
  spline: ['degree', 'ctrl', 'knots', 'fit', 'closed'],
  point: ['x', 'y'],
  leader: ['pts'],
  hatch: ['loops'],
};

/**
 * New entity of `type` with the non-geometric fields of `src` (minus its id)
 * and the given geometry fields.
 */
export function derive(src, type, geom) {
  const skip = GEOM_KEYS[src.type];
  const out = {};
  for (const k in src) {
    if (k === 'id' || (skip && skip.includes(k))) continue;
    out[k] = src[k];
  }
  out.type = type;
  return Object.assign(out, geom);
}

/** Copy of `src` with some fields replaced; keeps the id (an in-place edit). */
export function update(src, geom) {
  return Object.assign({ ...src }, geom);
}

/** Line entity derived from src. */
export function lineFrom(src, x1, y1, x2, y2) {
  return derive(src, 'line', { x1, y1, x2, y2 });
}

/** Arc entity derived from src. */
export function arcFrom(src, cx, cy, r, start, end) {
  return derive(src, 'arc', { cx, cy, r, start, end });
}

/** Polyline entity derived from src (keeps width when src is a polyline). */
export function polylineFrom(src, pts, closed = false) {
  const out = derive(src, 'polyline', { pts, closed });
  if (out.width === undefined) out.width = 0;
  return out;
}
