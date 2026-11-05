/**
 * PDF 1.4 export of display lists (see core/display.js), written from
 * scratch: one page per sheet sized to the paper, a content stream of path
 * operators in points, optional FlateDecode compression through the
 * platform CompressionStream, and an exact cross-reference table.
 *
 * Linetypes use the PDF dash operator, so dashes run continuously along
 * each item's path; every subpath restarts the pattern, as each item would.
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

/** PDF points per millimetre. */
export const PT_PER_MM = 72 / 25.4;

const DEFAULT_STYLE = { rgb: [0, 0, 0], aci7: true, lw: -1, pattern: [], alpha: 1 };
const CAPS = { butt: 0, round: 1, square: 2 };
const encoder = new TextEncoder();

/** Number with at most 3 decimals and no exponent. */
function n3(v) {
  return String(Math.round(v * 1000) / 1000);
}

/**
 * Byte sink that collects ASCII strings and encodes them in batches into
 * Uint8Array chunks; `pos` is the exact byte position (strings are ASCII).
 */
class ByteWriter {
  constructor() {
    this.chunks = [];
    this.pending = [];
    this.pos = 0;
  }
  /** Append an ASCII string. */
  str(s) {
    this.pending.push(s);
    this.pos += s.length;
    if (this.pending.length >= 16384) this.flush();
  }
  /** Append raw bytes. */
  bytes(u8) {
    this.flush();
    this.chunks.push(u8);
    this.pos += u8.length;
  }
  flush() {
    if (!this.pending.length) return;
    this.chunks.push(encoder.encode(this.pending.join('')));
    this.pending = [];
  }
  /** All bytes as one Uint8Array. */
  toBytes() {
    this.flush();
    const out = new Uint8Array(this.pos);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

/** PDF text string: literal when printable ASCII, else UTF-16BE hex. */
function pdfString(s) {
  const str = String(s);
  if (/^[\x20-\x7e]*$/.test(str)) return `(${str.replace(/[\\()]/g, '\\$&')})`;
  const hex = ['<FEFF'];
  for (let i = 0; i < str.length; i++) hex.push(str.charCodeAt(i).toString(16).padStart(4, '0'));
  hex.push('>');
  return hex.join('');
}

/** PDF date string D:YYYYMMDDHHmmSSZ (UTC). */
function pdfDate(d) {
  const p = (v) => String(v).padStart(2, '0');
  return (
    `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** Zlib-deflate bytes with CompressionStream. */
async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Append path operators for a flat point list mapped by T (points). */
function pushPath(w, pts, closed, T) {
  const n = pts.length >> 1;
  if (n < 1) return;
  const [a, b, c, d, e, f] = T;
  let px = Math.round((a * pts[0] + c * pts[1] + e) * 1000);
  let py = Math.round((b * pts[0] + d * pts[1] + f) * 1000);
  w.str(`${px / 1000} ${py / 1000} m\n`);
  let wrote = false;
  for (let i = 1; i < n; i++) {
    const x = pts[2 * i],
      y = pts[2 * i + 1];
    const qx = Math.round((a * x + c * y + e) * 1000);
    const qy = Math.round((b * x + d * y + f) * 1000);
    if (qx === px && qy === py) continue;
    w.str(`${qx / 1000} ${qy / 1000} l\n`);
    wrote = true;
    px = qx;
    py = qy;
  }
  // A degenerate subpath is painted as a dot when round caps are on.
  if (!wrote) w.str(`${px / 1000} ${py / 1000} l\n`);
  if (closed) w.str('h\n');
}

/**
 * Build one page's content stream. Returns { bytes, alphas } where alphas
 * maps an opacity string to its ExtGState resource name.
 */
function buildContent(items, settings, plot) {
  const w = new ByteWriter();
  const k = PT_PER_MM;
  const T = plot.transform.map((v) => v * k);
  const bg = parseBackground(settings.background);
  const lwOpts = lineweightOptions(settings);
  const baseCap = CAPS[settings.lineCap ?? 'round'] ?? 1;
  const alphas = new Map();
  const cache = new WeakMap();

  const gsName = (alpha) => {
    const key = n3(Math.max(0, Math.min(1, alpha)));
    let name = alphas.get(key);
    if (!name) {
      name = `GA${alphas.size}`;
      alphas.set(key, name);
    }
    return name;
  };

  const descOf = (style) => {
    let r = cache.get(style);
    if (r) return r;
    const [cr, cg, cb] = plotColor(style, settings, bg);
    const col = `${n3(cr / 255)} ${n3(cg / 255)} ${n3(cb / 255)}`;
    const widthPt = lineweightMm(style.lw, lwOpts) * k;
    const dash = dashArray(style.pattern, plot.scale * k, 0.05);
    let d = '[] 0 d';
    let cap = baseCap;
    if (dash) {
      const arr = dash.array.map(n3);
      if (arr.some((v) => v !== '0')) {
        d = `[${arr.join(' ')}] ${n3(dash.offset)} d`;
        if (dash.hasDot) cap = 1;
      }
    }
    const alpha = style.alpha ?? 1;
    r = {
      stroke: `${col} RG`,
      fill: `${col} rg`,
      width: `${n3(Math.max(widthPt, 0.001))} w`,
      dash: d,
      cap,
      gs: alpha < 1 ? gsName(alpha) : null,
      lineKey: '',
      fillKey: '',
    };
    r.lineKey = `${r.stroke}|${r.width}|${r.dash}|${r.cap}|${r.gs}`;
    r.fillKey = `${r.fill}|${r.gs}`;
    cache.set(style, r);
    return r;
  };

  // Current graphics state (null = unknown, so the first use always sets it).
  let curStroke = null,
    curFill = null,
    curWidth = null,
    curDash = '[] 0 d',
    curCap = baseCap,
    curGs = null;
  const setGs = (gs) => {
    if (gs === curGs) return;
    w.str(`/${gs ?? gsName(1)} gs\n`);
    curGs = gs;
  };

  w.str('q\n');
  if (bg) {
    w.str(`${n3(bg[0] / 255)} ${n3(bg[1] / 255)} ${n3(bg[2] / 255)} rg\n`);
    w.str(`0 0 ${n3(plot.pageW * k)} ${n3(plot.pageH * k)} re f\n`);
  }
  const c = plot.clip;
  w.str(`${n3(c.x * k)} ${n3(c.y * k)} ${n3(c.w * k)} ${n3(c.h * k)} re W n\n`);
  w.str(`${baseCap} J 1 j\n`);

  let openKey = '';
  for (const it of items) {
    const ds = descOf(it.style ?? DEFAULT_STYLE);
    if (it.kind === 'line') {
      if (!it.pts || it.pts.length < 2) continue;
      if (openKey !== ds.lineKey) {
        if (openKey) w.str('S\n');
        if (ds.stroke !== curStroke) w.str(`${(curStroke = ds.stroke)}\n`);
        if (ds.width !== curWidth) w.str(`${(curWidth = ds.width)}\n`);
        if (ds.dash !== curDash) w.str(`${(curDash = ds.dash)}\n`);
        if (ds.cap !== curCap) w.str(`${(curCap = ds.cap)} J\n`);
        if (ds.gs !== curGs) setGs(ds.gs);
        openKey = ds.lineKey;
      }
      pushPath(w, it.pts, it.closed, T);
    } else if (it.kind === 'fill') {
      if (!it.rings || !it.rings.length) continue;
      if (openKey) w.str('S\n');
      openKey = '';
      if (ds.fill !== curFill) w.str(`${(curFill = ds.fill)}\n`);
      if (ds.gs !== curGs) setGs(ds.gs);
      for (const ring of it.rings) pushPath(w, ring, true, T);
      w.str('f*\n');
    }
  }
  if (openKey) w.str('S\n');
  w.str('Q\n');
  return { bytes: w.toBytes(), alphas };
}

/**
 * Export several pages to one PDF. pages = [{ items, settings }], where
 * settings are plot settings (see computePlot) plus monochrome, background,
 * lineweights, lineweightScale, uniformWidth, lineCap.
 * docSettings: { compress (default true when available), title,
 * creationDate (Date) }.
 */
export async function exportPdfPages(pages, docSettings = {}) {
  const canCompress = docSettings.compress !== false && typeof CompressionStream === 'function';
  const built = [];
  for (const page of pages) {
    const settings = page.settings ?? {};
    const plot = computePlot(settings, recordedBounds(page.items ?? []));
    const { bytes, alphas } = buildContent(page.items ?? [], settings, plot);
    let data = bytes;
    let compressed = false;
    if (canCompress) {
      try {
        data = await deflate(bytes);
        compressed = true;
      } catch {
        data = bytes;
      }
    }
    built.push({ plot, data, compressed, alphas });
  }

  const w = new ByteWriter();
  const offsets = [0];
  const obj = (num, body) => {
    offsets[num] = w.pos;
    w.str(`${num} 0 obj\n${body}\nendobj\n`);
  };

  w.str('%PDF-1.4\n');
  w.bytes(Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a));

  const kids = built.map((_, i) => `${4 + 2 * i} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${built.length} >>`);
  const date = docSettings.creationDate instanceof Date ? docSettings.creationDate : new Date();
  let info = `<< /Producer (CAD) /CreationDate (${pdfDate(date)})`;
  if (docSettings.title) info += ` /Title ${pdfString(docSettings.title)}`;
  obj(3, info + ' >>');

  built.forEach((pg, i) => {
    const pageNum = 4 + 2 * i;
    const contentNum = pageNum + 1;
    const W = n3(pg.plot.pageW * PT_PER_MM);
    const H = n3(pg.plot.pageH * PT_PER_MM);
    let res = '';
    if (pg.alphas.size) {
      const gs = [];
      for (const [a, name] of pg.alphas) gs.push(`/${name} << /Type /ExtGState /CA ${a} /ca ${a} >>`);
      res = `/ExtGState << ${gs.join(' ')} >>`;
    }
    obj(
      pageNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << ${res} >> /Contents ${contentNum} 0 R >>`,
    );
    offsets[contentNum] = w.pos;
    const filter = pg.compressed ? ' /Filter /FlateDecode' : '';
    w.str(`${contentNum} 0 obj\n<< /Length ${pg.data.length}${filter} >>\nstream\n`);
    w.bytes(pg.data);
    w.str('\nendstream\nendobj\n');
  });

  const count = offsets.length;
  const xref = w.pos;
  w.str(`xref\n0 ${count}\n0000000000 65535 f\r\n`);
  for (let i = 1; i < count; i++) w.str(`${String(offsets[i]).padStart(10, '0')} 00000 n\r\n`);
  w.str(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return w.toBytes();
}

/**
 * Export display-list items to a one-page PDF (Uint8Array). settings are
 * the page settings of exportPdfPages plus its document settings.
 */
export function exportPdf(items, settings = {}) {
  return exportPdfPages([{ items, settings }], settings);
}
