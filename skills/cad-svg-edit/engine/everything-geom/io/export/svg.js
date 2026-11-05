/**
 * SVG export of a display list (see core/display.js).
 *
 * Paper mode (settings.paper or settings.custom set): a page-sized SVG in
 * millimetres laid out with computePlot, clipped to the plot window.
 * Drawing mode: an SVG covering the drawing bounds (or settings.area) plus a
 * margin, in drawing units with y flipped and the lower-left corner moved to
 * the origin. Lineweights are then sized for a nominal pixel width
 * (settings.width or settings.size px, default 1000 on the long side).
 *
 * Consecutive line items with the same style share one <path> with several
 * subpaths (each subpath restarts the dash pattern, like each item would).
 * Fills get one <path> each (fill-rule evenodd) so overlapping fills do not
 * cancel, grouped in a <g> carrying the shared fill attributes.
 */
import { recordedBounds } from '../../core/display.js';
import {
  computePlot,
  dashArray,
  lineweightMm,
  lineweightOptions,
  parseBackground,
  plotColor,
} from './plot.js';

const PX_PER_MM = 96 / 25.4;
const DEFAULT_STYLE = { rgb: [0, 0, 0], aci7: true, lw: -1, pattern: [], alpha: 1 };

/** '#rrggbb' for an RGB triple (components clamped and rounded). */
export function hexColor(rgb) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + ((1 << 24) | (c(rgb[0]) << 16) | (c(rgb[1]) << 8) | c(rgb[2])).toString(16).slice(1);
}

/** Length value with up to 4 significant digits (widths, dashes). */
function len(v) {
  if (!(Math.abs(v) >= 1e-6)) return '0';
  return String(Number(v.toPrecision(4)));
}

/** Number of decimals that keeps about 6 significant digits over `extent`. */
function decimalsFor(extent) {
  if (!(extent > 0)) return 3;
  return Math.max(0, Math.min(6, 6 - Math.ceil(Math.log10(extent))));
}

/**
 * Append SVG path data for a flat point list mapped by T, quantized to 1/q:
 * an absolute moveto followed by relative linetos built from the rounded
 * integer grid, so rounding errors never accumulate.
 */
function pushPath(out, pts, closed, T, q) {
  const n = pts.length >> 1;
  if (n < 1) return;
  const [a, b, c, d, e, f] = T;
  let px = Math.round((a * pts[0] + c * pts[1] + e) * q);
  let py = Math.round((b * pts[0] + d * pts[1] + f) * q);
  out.push(`M${px / q} ${py / q}`);
  let wrote = false;
  for (let i = 1; i < n; i++) {
    const x = pts[2 * i],
      y = pts[2 * i + 1];
    const qx = Math.round((a * x + c * y + e) * q);
    const qy = Math.round((b * x + d * y + f) * q);
    const dx = qx - px,
      dy = qy - py;
    if (dx === 0 && dy === 0) continue;
    out.push(wrote ? ` ${dx / q} ${dy / q}` : `l${dx / q} ${dy / q}`);
    wrote = true;
    px = qx;
    py = qy;
  }
  // A zero-length subpath still draws a dot with round caps.
  if (!wrote) out.push('l0 0');
  if (closed) out.push('z');
}

/**
 * Export display-list items to an SVG string.
 * settings: paper/custom/orientation/area/scale/units/margins/center/offset
 *   (paper mode, see computePlot), margin (drawing mode, fraction of the
 *   larger side, default 0.02), width/height/size (drawing mode, px),
 *   monochrome, background ('#rrggbb' | [r, g, b]), lineweights (default
 *   true), lineweightScale, uniformWidth (mm), lineCap ('round' default),
 *   nonScalingStroke (drawing mode: constant screen widths for solid lines).
 */
export function exportSvg(items, settings = {}) {
  const paperMode = settings.paper != null || settings.custom != null;
  const bg = parseBackground(settings.background);
  const lwOpts = lineweightOptions(settings);
  const cap = settings.lineCap ?? 'round';
  let T, k, unitsPerMm, q, vbW, vbH, widthAttr, heightAttr, clip;

  if (paperMode) {
    const plot = computePlot(settings, recordedBounds(items));
    T = plot.transformDown;
    k = plot.scale;
    unitsPerMm = 1;
    q = 1000;
    vbW = plot.pageW;
    vbH = plot.pageH;
    widthAttr = `${Math.round(vbW * 1000) / 1000}mm`;
    heightAttr = `${Math.round(vbH * 1000) / 1000}mm`;
    clip = plot.clipDown;
  } else {
    const b = settings.area ?? recordedBounds(items) ?? [0, 0, 1, 1];
    const x0 = Math.min(b[0], b[2]),
      y0 = Math.min(b[1], b[3]);
    const w = Math.abs(b[2] - b[0]),
      h = Math.abs(b[3] - b[1]);
    const ext = Math.max(w, h) || 1;
    const mg = (settings.margin ?? 0.02) * ext;
    vbW = w + 2 * mg || 1;
    vbH = h + 2 * mg || 1;
    q = 10 ** decimalsFor(Math.max(vbW, vbH));
    vbW = Math.ceil(vbW * q) / q;
    vbH = Math.ceil(vbH * q) / q;
    T = [1, 0, 0, -1, mg - x0, y0 + h + mg];
    k = 1;
    let W = settings.width,
      H = settings.height;
    if (!(W > 0) && !(H > 0)) {
      const size = settings.size ?? 1000;
      if (vbW >= vbH) W = size;
      else H = size;
    }
    if (!(W > 0)) W = (H * vbW) / vbH;
    if (!(H > 0)) H = (W * vbH) / vbW;
    W = Math.max(1, Math.round(W));
    H = Math.max(1, Math.round(H));
    widthAttr = String(W);
    heightAttr = String(H);
    const pxPerUnit = Math.min(W / vbW, H / vbH);
    unitsPerMm = PX_PER_MM / pxPerUnit;
    clip = null;
  }

  const nonScaling = !paperMode && !!settings.nonScalingStroke;
  const minDash = 0.02 * unitsPerMm;
  const cache = new WeakMap();

  /** Cached { line, fill } attribute strings for a style object. */
  const attrsOf = (style) => {
    let r = cache.get(style);
    if (r) return r;
    const color = hexColor(plotColor(style, settings, bg));
    const alpha = style.alpha ?? 1;
    const lwMm = lineweightMm(style.lw, lwOpts);
    const dash = dashArray(style.pattern, k, minDash);
    let line = ` stroke="${color}"`;
    if (dash) {
      line += ` stroke-width="${len(lwMm * unitsPerMm)}"`;
      line += ` stroke-dasharray="${dash.array.map(len).join(' ')}"`;
      if (dash.offset) line += ` stroke-dashoffset="${len(dash.offset)}"`;
      if (dash.hasDot && cap !== 'round') line += ' stroke-linecap="round"';
    } else if (nonScaling) {
      line += ` stroke-width="${len(lwMm * PX_PER_MM)}" vector-effect="non-scaling-stroke"`;
    } else {
      line += ` stroke-width="${len(lwMm * unitsPerMm)}"`;
    }
    let fill = ` fill="${color}" fill-rule="evenodd"`;
    if (alpha < 1) {
      line += ` stroke-opacity="${len(Math.max(0, alpha))}"`;
      fill += ` fill-opacity="${len(Math.max(0, alpha))}"`;
    }
    r = { line: 'L' + line, fill: 'F' + fill };
    cache.set(style, r);
    return r;
  };

  const fix = (v) => String(Math.round(v * q) / q);
  const out = [];
  out.push(
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${widthAttr}" height="${heightAttr}" viewBox="0 0 ${fix(vbW)} ${fix(vbH)}">\n`,
  );
  if (bg) out.push(`<rect x="0" y="0" width="${fix(vbW)}" height="${fix(vbH)}" fill="${hexColor(bg)}"/>\n`);
  if (clip) {
    out.push(
      `<defs><clipPath id="plot-clip"><rect x="${fix(clip.x)}" y="${fix(clip.y)}" width="${fix(clip.w)}" height="${fix(clip.h)}"/></clipPath></defs>\n`,
      `<g clip-path="url(#plot-clip)" fill="none" stroke-linecap="${cap}" stroke-linejoin="round">\n`,
    );
  } else {
    out.push(`<g fill="none" stroke-linecap="${cap}" stroke-linejoin="round">\n`);
  }

  // open: '' (nothing open), 'path' (a line <path> open), 'g' (a fill <g> open)
  let open = '';
  let curKey = '';
  const close = () => {
    if (open === 'path') out.push('"/>\n');
    else if (open === 'g') out.push('</g>\n');
    open = '';
    curKey = '';
  };

  for (const it of items) {
    const a = attrsOf(it.style ?? DEFAULT_STYLE);
    if (it.kind === 'line') {
      if (!it.pts || it.pts.length < 2) continue;
      if (curKey !== a.line) {
        close();
        out.push(`<path${a.line.slice(1)} d="`);
        open = 'path';
        curKey = a.line;
      }
      pushPath(out, it.pts, it.closed, T, q);
    } else if (it.kind === 'fill') {
      if (!it.rings || !it.rings.length) continue;
      if (curKey !== a.fill) {
        close();
        out.push(`<g${a.fill.slice(1)} stroke="none">\n`);
        open = 'g';
        curKey = a.fill;
      }
      out.push('<path d="');
      for (const ring of it.rings) pushPath(out, ring, true, T, q);
      out.push('"/>\n');
    }
  }
  close();
  out.push('</g>\n</svg>\n');
  return out.join('');
}
