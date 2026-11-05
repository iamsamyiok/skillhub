/**
 * Geometry helpers shared by the DXF reader and writer: angle normalization,
 * B-spline knot handling and evaluation, fit point interpolation, and the
 * conversion of a projected circle (two conjugate radius vectors) into the
 * ellipse fields used by the drawing schema.
 */
import { TWO_PI } from '../../core/schema.js';

/** Normalize an angle to [0, 2*PI). */
export function normAngle(a) {
  a %= TWO_PI;
  if (a < 0) a += TWO_PI;
  return a;
}

/** Clamped uniform knot vector for `n` control points of `degree`. */
export function uniformKnots(n, degree) {
  const k = [];
  const spans = n - degree;
  for (let i = 0; i <= degree; i++) k.push(0);
  for (let i = 1; i < spans; i++) k.push(i / spans);
  for (let i = 0; i <= degree; i++) k.push(1);
  return k;
}

/** True when the first and last `degree + 1` knots are equal. */
export function isClamped(degree, knots) {
  const m = knots.length;
  const tol = 1e-10 * (Math.abs(knots[m - 1] - knots[0]) || 1);
  for (let i = 1; i <= degree; i++) {
    if (Math.abs(knots[i] - knots[0]) > tol) return false;
    if (Math.abs(knots[m - 1 - i] - knots[m - 1]) > tol) return false;
  }
  return true;
}

/** Insert knot `u` once (Boehm). `P` is flat [x, y, ...]. Returns [U', P']. */
function insertKnot(p, U, P, u) {
  const n = P.length >> 1;
  let k = p;
  while (k < n - 1 && U[k + 1] <= u) k++;
  const Q = new Array((n + 1) * 2);
  for (let i = 0; i <= k - p; i++) {
    Q[i * 2] = P[i * 2];
    Q[i * 2 + 1] = P[i * 2 + 1];
  }
  for (let i = k - p + 1; i <= k; i++) {
    const d = U[i + p] - U[i];
    const a = d > 0 ? (u - U[i]) / d : 0;
    Q[i * 2] = (1 - a) * P[i * 2 - 2] + a * P[i * 2];
    Q[i * 2 + 1] = (1 - a) * P[i * 2 - 1] + a * P[i * 2 + 1];
  }
  for (let i = k + 1; i <= n; i++) {
    Q[i * 2] = P[i * 2 - 2];
    Q[i * 2 + 1] = P[i * 2 - 1];
  }
  const V = U.slice(0, k + 1);
  V.push(u);
  for (let i = k + 1; i < U.length; i++) V.push(U[i]);
  return [V, Q];
}

/** Clamp the start of a spline at its domain start U[p]. */
function clampStart(p, U, P) {
  const a = U[p];
  const tol = 1e-10 * (Math.abs(U[U.length - 1] - U[0]) || 1);
  let s = 0;
  for (const u of U) if (Math.abs(u - a) <= tol) s++;
  if (s <= p) {
    for (let r = s; r < p; r++) [U, P] = insertKnot(p, U, P, a);
    let j = 0;
    while (Math.abs(U[j] - a) > tol) j++;
    const K = new Array(p + 1).fill(a);
    for (let i = j + p; i < U.length; i++) K.push(U[i]);
    return [K, P.slice((j - 1) * 2)];
  }
  let j = 0;
  while (Math.abs(U[j] - a) > tol) j++;
  const drop = j + s - (p + 1);
  return [U.slice(drop), P.slice(drop * 2)];
}

function reverseSpline(U, P) {
  const R = [];
  for (let i = U.length - 1; i >= 0; i--) R.push(-U[i]);
  const Q = [];
  for (let i = P.length - 2; i >= 0; i -= 2) Q.push(P[i], P[i + 1]);
  return [R, Q];
}

/**
 * Convert any valid B-spline (clamped, unclamped or periodic knots) into an
 * equivalent clamped one over the same domain. Returns { knots, ctrl } or
 * null when the knot vector does not match the control point count.
 */
export function clampSpline(degree, knots, ctrl) {
  const n = ctrl.length >> 1;
  if (n < degree + 1 || knots.length !== n + degree + 1) return null;
  for (let i = 1; i < knots.length; i++) if (!(knots[i] >= knots[i - 1])) return null;
  if (isClamped(degree, knots)) return { knots: knots.slice(), ctrl: ctrl.slice() };
  let U = knots.slice();
  let P = ctrl.slice();
  [U, P] = clampStart(degree, U, P);
  [U, P] = reverseSpline(U, P);
  [U, P] = clampStart(degree, U, P);
  [U, P] = reverseSpline(U, P);
  return { knots: U, ctrl: P };
}

/**
 * Evaluate a (optionally rational) B-spline at `u` with de Boor's algorithm.
 * `W` holds one weight per control point or is null. Writes into `out`.
 */
export function evalSpline(p, U, P, W, u, out) {
  const n = P.length >> 1;
  let k = p;
  while (k < n - 1 && U[k + 1] <= u) k++;
  const dx = new Array(p + 1);
  const dy = new Array(p + 1);
  const dw = new Array(p + 1);
  for (let j = 0; j <= p; j++) {
    const i = k - p + j;
    const w = W ? W[i] ?? 1 : 1;
    dx[j] = P[i * 2] * w;
    dy[j] = P[i * 2 + 1] * w;
    dw[j] = w;
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const d = U[i + p - r + 1] - U[i];
      const a = d > 0 ? (u - U[i]) / d : 0;
      dx[j] = (1 - a) * dx[j - 1] + a * dx[j];
      dy[j] = (1 - a) * dy[j - 1] + a * dy[j];
      dw[j] = (1 - a) * dw[j - 1] + a * dw[j];
    }
  }
  const w = dw[p] || 1;
  out[0] = dx[p] / w;
  out[1] = dy[p] / w;
  return out;
}

/** Sample a B-spline into a flat point list with `segs` segments. */
export function tessellateSpline(p, U, P, W, segs) {
  const n = P.length >> 1;
  const u0 = U[p];
  const u1 = U[n];
  const out = [];
  const pt = [0, 0];
  for (let i = 0; i <= segs; i++) {
    evalSpline(p, U, P, W, u0 + ((u1 - u0) * i) / segs, pt);
    out.push(pt[0], pt[1]);
  }
  return out;
}

/**
 * Build a clamped cubic B-spline that passes through the fit points (flat
 * [x, y, ...]), as a chain of cubic Bezier pieces with chord-length tangents.
 * `startTan` / `endTan` are optional [dx, dy] directions.
 * Returns { degree: 3, ctrl, knots } or null for fewer than two points.
 */
export function fitToSpline(fit, closed = false, startTan = null, endTan = null) {
  const pts = fit.slice();
  let n = pts.length >> 1;
  if (n < 2) return null;
  if (closed && (pts[0] !== pts[n * 2 - 2] || pts[1] !== pts[n * 2 - 1])) {
    pts.push(pts[0], pts[1]);
    n++;
  }
  const t = [0];
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    t.push(t[i - 1] + Math.max(d, 1e-12));
  }
  const tx = new Array(n).fill(0);
  const ty = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const dt = t[i + 1] - t[i - 1];
    tx[i] = (pts[i * 2 + 2] - pts[i * 2 - 2]) / dt;
    ty[i] = (pts[i * 2 + 3] - pts[i * 2 - 1]) / dt;
  }
  const h0 = t[1] - t[0];
  const hn = t[n - 1] - t[n - 2];
  if (closed && n > 2) {
    const dt = h0 + hn;
    tx[0] = tx[n - 1] = (pts[2] - pts[n * 2 - 4]) / dt;
    ty[0] = ty[n - 1] = (pts[3] - pts[n * 2 - 3]) / dt;
  } else {
    const setEnd = (i, j, h, tan, sign) => {
      if (tan && (tan[0] || tan[1])) {
        const l = Math.hypot(tan[0], tan[1]);
        tx[i] = tan[0] / l;
        ty[i] = tan[1] / l;
        return;
      }
      const cx = (sign * (pts[j * 2] - pts[i * 2])) / h;
      const cy = (sign * (pts[j * 2 + 1] - pts[i * 2 + 1])) / h;
      if (n > 2) {
        tx[i] = 2 * cx - tx[j];
        ty[i] = 2 * cy - ty[j];
      } else {
        tx[i] = cx;
        ty[i] = cy;
      }
    };
    setEnd(0, 1, h0, startTan, 1);
    setEnd(n - 1, n - 2, hn, endTan, -1);
  }
  const ctrl = [pts[0], pts[1]];
  const total = t[n - 1];
  const knots = [0, 0, 0, 0];
  for (let i = 0; i < n - 1; i++) {
    const h = (t[i + 1] - t[i]) / 3;
    ctrl.push(pts[i * 2] + tx[i] * h, pts[i * 2 + 1] + ty[i] * h);
    ctrl.push(pts[i * 2 + 2] - tx[i + 1] * h, pts[i * 2 + 3] - ty[i + 1] * h);
    ctrl.push(pts[i * 2 + 2], pts[i * 2 + 3]);
    const k = i === n - 2 ? 1 : t[i + 1] / total;
    if (i === n - 2) knots.push(1, 1, 1, 1);
    else knots.push(k, k, k);
  }
  return { degree: 3, ctrl, knots };
}

/** Flat points along an ellipse arc from parameter t0 to t1 (inclusive). */
export function ellipsePoints(cx, cy, mx, my, ratio, t0, t1, segs) {
  const out = [];
  const vx = -my * ratio;
  const vy = mx * ratio;
  for (let i = 0; i <= segs; i++) {
    const t = t0 + ((t1 - t0) * i) / segs;
    const c = Math.cos(t);
    const s = Math.sin(t);
    out.push(cx + c * mx + s * vx, cy + c * my + s * vy);
  }
  return out;
}

/**
 * The curve C + cos(t) U + sin(t) V for t from t0 to t1 (increasing) is an
 * ellipse. Returns its schema fields { cx, cy, mx, my, ratio, start, end,
 * circular } with start/end counter-clockwise, or null when degenerate.
 */
export function conjugateToEllipse(cx, cy, ux, uy, vx, vy, t0, t1) {
  const uu = ux * ux + uy * uy;
  const vv = vx * vx + vy * vy;
  const uv = ux * vx + uy * vy;
  let a = 0.5 * Math.atan2(2 * uv, uu - vv);
  let ax = Math.cos(a) * ux + Math.sin(a) * vx;
  let ay = Math.cos(a) * uy + Math.sin(a) * vy;
  let bx = -Math.sin(a) * ux + Math.cos(a) * vx;
  let by = -Math.sin(a) * uy + Math.cos(a) * vy;
  if (bx * bx + by * by > ax * ax + ay * ay) {
    a += Math.PI / 2;
    const tx = ax;
    const ty = ay;
    ax = bx;
    ay = by;
    bx = -tx;
    by = -ty;
  }
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-12) return null;
  const ratio = Math.min(1, lb / la);
  if (ratio < 1e-9) return null;
  let s = t0 - a;
  let e = t1 - a;
  if (ax * by - ay * bx < 0) {
    const tmp = s;
    s = -e;
    e = -tmp;
  }
  const full = Math.abs(t1 - t0 - TWO_PI) < 1e-9;
  const start = full ? 0 : normAngle(s);
  const end = full ? TWO_PI : start + (e - s);
  return { cx, cy, mx: ax, my: ay, ratio, start, end, circular: ratio > 1 - 1e-9, full };
}
