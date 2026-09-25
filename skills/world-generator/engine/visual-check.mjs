// Visual validation fallback (layer-3 check aid).
// Full-frame pixel statistics via headless Chromium: catches black frames,
// washed-out frames, single-color scenes and console errors without needing
// image recognition.
//
//   node engine/visual-check.mjs scenes/villa/world.html
//
// Exit code 0 = PASS, 1 = FAIL. Writes JSON verdict to stdout.

import path from 'node:path';
import { chromium } from 'playwright';

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error('usage: node engine/visual-check.mjs <world.html>');
  process.exit(2);
}

// View radii are scene-relative: fit camera first, then scale in.
const VIEWS = {
  top: { phi: Math.PI / 3.6, theta: Math.PI / 4, zoom: 1.0 },
  close: { phi: Math.PI / 4.2, theta: Math.PI / 2.6, zoom: 0.38 },
  side: { phi: Math.PI / 2.6, theta: -Math.PI / 2.4, zoom: 0.55 }
};

// Baselines calibrated on the demo/villa scenes (1600x900, quantized 16-level bins).
const THRESHOLDS = {
  minCenterLum: 15,      // below ~5 is a black frame
  maxCenterLum: 230,     // above ~240 is blown out
  minUniqColors: 20,     // a rendered scene has dozens; empty/solid has 1-6
  minSubjectPct: 25      // dominant hue coverage in the frame centre
};

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto('file://' + path.resolve(htmlPath), { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__WORLD__ && window.__WORLD__.renderer, null, { timeout: 30000 });
await page.waitForTimeout(300);

const results = [];
for (const [name, v] of Object.entries(VIEWS)) {
  const stats = await page.evaluate(vv => {
    const w = window.__WORLD__;
    w.orbit.fitTo(w.worldBox);
    w.orbit.sph.phi = vv.phi;
    w.orbit.sph.theta = vv.theta;
    w.orbit.sph.radius *= vv.zoom;
    w.orbit.update();
    w.renderer.render(w.scene, w.camera);
    const g = w.renderer.getContext();
    const W = g.drawingBufferWidth, H = g.drawingBufferHeight;
    const sw = Math.floor(W * 0.5), sh = Math.floor(H * 0.5);
    const px = new Uint8Array(sw * sh * 4);
    g.readPixels(Math.floor((W - sw) / 2), Math.floor((H - sh) / 2), sw, sh, g.RGBA, g.UNSIGNED_BYTE, px);
    let sum = 0;
    const hueBins = new Map();
    const uniq = new Set();
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], gg = px[i + 1], b = px[i + 2];
      sum += 0.299 * r + 0.587 * gg + 0.114 * b;
      uniq.add((r >> 4) + ',' + (gg >> 4) + ',' + (b >> 4));
      const dominant = r >= gg && r >= b ? 'r' : (gg >= b ? 'g' : 'b');
      hueBins.set(dominant, (hueBins.get(dominant) || 0) + 1);
    }
    const n = sw * sh;
    return {
      avgLum: +(sum / n).toFixed(1),
      uniqColors: uniq.size,
      dominantHuePct: +(Math.max(...hueBins.values()) / n * 100).toFixed(1)
    };
  }, v);
  results.push({ view: name, ...stats });
}
await browser.close();

const issues = [];
if (consoleErrors.length) issues.push(`console errors: ${consoleErrors.length}`);
for (const r of results) {
  if (r.avgLum < THRESHOLDS.minCenterLum) issues.push(`${r.view}: black frame (avgLum ${r.avgLum})`);
  if (r.avgLum > THRESHOLDS.maxCenterLum) issues.push(`${r.view}: blown out (avgLum ${r.avgLum})`);
  if (r.uniqColors < THRESHOLDS.minUniqColors) issues.push(`${r.view}: too few colors (${r.uniqColors}) - scene may be empty`);
}

// subject coverage: at least one view must show a dominant subject region
const subjectOk = results.some(r => r.dominantHuePct >= THRESHOLDS.minSubjectPct);
if (!subjectOk) issues.push('no view shows subject coverage >= 25%');

const verdict = issues.length === 0 ? 'PASS' : 'FAIL';
console.log(JSON.stringify({ file: htmlPath, verdict, issues, results, consoleErrors }, null, 2));
process.exitCode = verdict === 'PASS' ? 0 : 1;
