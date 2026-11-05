/**
 * Display lists: the resolved, world-space drawing primitives an entity
 * turns into. The WebGL renderer, the SVG, PDF and PNG exporters, and the
 * plot preview all consume the same records, so what is printed matches what
 * is on screen.
 *
 * A sink receives two kinds of primitives:
 *
 *   sink.line(pts, closed, style)
 *     pts     flat [x0, y0, x1, y1, ...] world coordinates (at least 2 points)
 *     closed  join the last point back to the first
 *
 *   sink.fill(rings, style)
 *     rings   array of flat [x, y, ...] rings; rings[0] is the outer boundary,
 *             the rest are holes (non-overlapping, already nested correctly)
 *
 *   style = {
 *     rgb:     [r, g, b]  0..255, resolved (index 7 already mapped)
 *     aci7:    boolean    true when the color came from index 7, so exporters
 *                         can print it black on white paper
 *     lw:      number     lineweight in hundredths of a millimetre (resolved, >= 0)
 *     pattern: number[]   linetype pattern in drawing units, already multiplied
 *                         by the global and entity linetype scales ([] = solid)
 *     basePattern: number[]  the linetype's own pattern (same array object for
 *                         every use of a linetype, so renderers can key on it)
 *     ltscale: number     factor that turns basePattern into pattern
 *     lwIndex: number     index of `lw` in LINEWEIGHTS (renderer lookup)
 *     id:      number     id of the top-level entity that produced the primitive
 *     alpha:   number     0..1 opacity (from layer transparency)
 *   }
 */

/** A sink that records primitives into an array, for exporters and tests. */
export class RecordingSink {
  constructor() {
    this.items = [];
  }
  line(pts, closed, style) {
    this.items.push({ kind: 'line', pts: Array.from(pts), closed: !!closed, style });
  }
  fill(rings, style) {
    this.items.push({ kind: 'fill', rings: rings.map((r) => Array.from(r)), style });
  }
}

/** Bounding box [minX, minY, maxX, maxY] of recorded items, or null. */
export function recordedBounds(items) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const add = (p) => {
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i],
        y = p[i + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  };
  for (const it of items) {
    if (it.kind === 'line') add(it.pts);
    else for (const r of it.rings) add(r);
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}
