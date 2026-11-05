/**
 * Linetypes. A pattern is a list of lengths in drawing units at a linetype
 * scale of 1: positive = dash, negative = gap, 0 = dot. An empty pattern is
 * a continuous line.
 */
export const STANDARD_LINETYPES = [
  { name: 'Continuous', description: 'Solid line', pattern: [] },
  { name: 'Dashed', description: 'Dashed __ __ __', pattern: [12, -6] },
  { name: 'Dashed2', description: 'Dashed (half) _ _ _', pattern: [6, -3] },
  { name: 'DashedX2', description: 'Dashed (double) ____  ____', pattern: [24, -12] },
  { name: 'Hidden', description: 'Hidden _ _ _ _', pattern: [6, -3] },
  { name: 'Hidden2', description: 'Hidden (half) - - - -', pattern: [3, -1.5] },
  { name: 'Center', description: 'Center ____ _ ____ _', pattern: [30, -6, 6, -6] },
  { name: 'Center2', description: 'Center (half) __ _ __ _', pattern: [18, -3, 3, -3] },
  { name: 'Phantom', description: 'Phantom ____ _ _ ____', pattern: [30, -6, 6, -6, 6, -6] },
  { name: 'Dot', description: 'Dotted . . . .', pattern: [0, -3] },
  { name: 'DashDot', description: 'Dash dot __ . __ .', pattern: [12, -4, 0, -4] },
  { name: 'Border', description: 'Border __ __ . __ __ .', pattern: [12, -4, 12, -4, 0, -4] },
  { name: 'Divide', description: 'Divide __ . . __ . .', pattern: [12, -4, 0, -4, 0, -4] },
];

export function patternLength(pattern) {
  let s = 0;
  for (const v of pattern) s += Math.abs(v);
  return s;
}

/**
 * Split a polyline (flat [x, y, ...]) into dash pieces following `pattern`
 * scaled by `scale`. Dots become zero-length pieces. Used by exporters; the
 * GPU renderer evaluates patterns in its fragment shader instead.
 * Returns an array of flat point arrays.
 */
export function dashPolyline(pts, pattern, scale, closed = false) {
  const n = pts.length >> 1;
  if (!pattern.length || n < 2) return [pts.slice()];
  const pat = pattern.map((v) => v * scale);
  const total = patternLength(pat);
  if (total <= 0) return [pts.slice()];
  const out = [];
  let idx = 0;
  let remain = Math.abs(pat[0]);
  let on = pat[0] >= 0;
  let cur = on ? [pts[0], pts[1]] : null;
  if (on && pat[0] === 0) {
    out.push([pts[0], pts[1], pts[0], pts[1]]);
    cur = null;
  }
  const segs = closed ? n : n - 1;
  for (let s = 0; s < segs; s++) {
    let x0 = pts[s * 2],
      y0 = pts[s * 2 + 1];
    const e = (s + 1) % n;
    const x1 = pts[e * 2],
      y1 = pts[e * 2 + 1];
    let len = Math.hypot(x1 - x0, y1 - y0);
    if (len === 0) continue;
    const ux = (x1 - x0) / len,
      uy = (y1 - y0) / len;
    while (len > 0) {
      const step = Math.min(len, remain);
      const nx = x0 + ux * step,
        ny = y0 + uy * step;
      if (on && cur) cur.push(nx, ny);
      x0 = nx;
      y0 = ny;
      len -= step;
      remain -= step;
      if (remain <= 1e-12) {
        if (on && cur) out.push(cur);
        cur = null;
        idx = (idx + 1) % pat.length;
        on = pat[idx] >= 0;
        remain = Math.abs(pat[idx]);
        if (on) {
          if (pat[idx] === 0) {
            out.push([x0, y0, x0, y0]);
            idx = (idx + 1) % pat.length;
            on = pat[idx] >= 0;
            remain = Math.abs(pat[idx]);
            cur = on ? [x0, y0] : null;
          } else cur = [x0, y0];
        }
      }
    }
  }
  if (cur && cur.length >= 4) out.push(cur);
  return out;
}
