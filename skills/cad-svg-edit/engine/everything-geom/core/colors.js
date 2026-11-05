/**
 * Indexed colors. Index 1..255 maps to RGB through a fixed palette that DXF
 * files rely on for interchange: nine base colors, 240 hue/value/saturation
 * steps, and six grays. The palette is computed rather than tabulated.
 *
 * Index 7 is the "foreground" color: drawn white on a dark canvas and black
 * on a light canvas (and black on paper).
 */
import { COLOR_BYBLOCK, COLOR_BYLAYER } from './schema.js';

const BASE = [
  null,
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 0],
  [0, 255, 255],
  [0, 0, 255],
  [255, 0, 255],
  [255, 255, 255],
  [128, 128, 128],
  [192, 192, 192],
];
const VALUES = [255, 204, 153, 127, 76];
const GRAYS = [51, 91, 132, 173, 214, 255];

function hsv(h, s, v) {
  const c = v * s;
  const hp = (h / 60) % 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [Math.round(r + m), Math.round(g + m), Math.round(b + m)];
}

/** PALETTE[i] = [r, g, b] for i in 1..255. */
export const PALETTE = (() => {
  const out = new Array(256);
  for (let i = 1; i <= 9; i++) out[i] = BASE[i];
  for (let i = 10; i <= 249; i++) {
    const k = i - 10;
    const hue = Math.floor(k / 10) * 15;
    const j = k % 10;
    const v = VALUES[j >> 1];
    out[i] = hsv(hue, j & 1 ? 0.5 : 1, v);
  }
  for (let i = 250; i <= 255; i++) out[i] = [GRAYS[i - 250], GRAYS[i - 250], GRAYS[i - 250]];
  return out;
})();

export const COLOR_NAMES = { 1: 'Red', 2: 'Yellow', 3: 'Green', 4: 'Cyan', 5: 'Blue', 6: 'Magenta', 7: 'White' };

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/** Closest palette index (1..255, excluding 7) for an RGB triple. */
export function nearestIndex([r, g, b]) {
  let best = 1,
    bestD = Infinity;
  for (let i = 1; i <= 255; i++) {
    if (i === 7) continue;
    const p = PALETTE[i];
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Resolve an entity color value to RGB. `layerColor` is the owning layer's
 * color and `blockColor` the color an enclosing block reference passes down.
 * `fg` is the RGB used for index 7.
 */
export function resolveRgb(color, layerColor, blockColor, fg) {
  let c = color;
  if (c === COLOR_BYLAYER || c == null) c = layerColor;
  else if (c === COLOR_BYBLOCK) c = blockColor ?? 7;
  if (c === COLOR_BYLAYER || c === COLOR_BYBLOCK || c == null) c = 7;
  if (typeof c === 'string') return hexToRgb(c);
  if (c === 7) return fg;
  return PALETTE[c] ?? fg;
}

/** Human-readable label for a color value. */
export function colorLabel(c) {
  if (c === COLOR_BYLAYER) return 'ByLayer';
  if (c === COLOR_BYBLOCK) return 'ByBlock';
  if (typeof c === 'string') return c.toUpperCase();
  return COLOR_NAMES[c] ?? `Color ${c}`;
}

/** CSS color for a swatch. Index 7 shows as the current foreground. */
export function colorCss(c, layerColor = 7, fgCss = 'var(--fg)') {
  let v = c;
  if (v === COLOR_BYLAYER) v = layerColor;
  if (v === COLOR_BYBLOCK || v === 7 || v == null) return fgCss;
  if (typeof v === 'string') return v;
  const p = PALETTE[v];
  return p ? `rgb(${p[0]},${p[1]},${p[2]})` : fgCss;
}
