// Night-render + GLB-export probe for the photo-textured world.html
import { createRequire } from 'node:module';
const require = createRequire('/workspace/package.json');
const { chromium } = require('playwright');
import path from 'node:path';

const html = process.argv[2];
if (!html) { console.error('usage: node night-glb-probe.mjs <world.html>'); process.exit(2); }

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('file://' + path.resolve(html), { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__WORLD__ && window.__WORLD__.texturesReady && window.__WORLD__.texturesReady.done, null, { timeout: 150000 });

// --- night probe ---
const night = await page.evaluate(() => {
  const w = window.__WORLD__;
  w.setTimeOfDay(22);
  w.renderer.render(w.scene, w.camera);
  const g = w.renderer.getContext();
  const W = g.drawingBufferWidth, H = g.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
  let sum = 0; const uniq = new Set();
  for (let i = 0; i < px.length; i += 4) {
    sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    uniq.add((px[i] >> 4) + ',' + (px[i + 1] >> 4) + ',' + (px[i + 2] >> 4));
  }
  return { avgLum: +(sum / (W * H)).toFixed(1), uniqColors: uniq.size };
});

// --- GLB export probe ---
const t0 = Date.now();
await page.evaluate(() => window.__WORLD__.setTimeOfDay(14));
const glbPromise = page.waitForEvent('download', { timeout: 120000 });
await page.click('#btn-glb');
const dl = await glbPromise;
const target = '/tmp/opencode/probe-export.glb';
await dl.saveAs(target);
const fs = await import('node:fs');
const stat = fs.statSync(target);

console.log(JSON.stringify({
  night, glb: { mb: +(stat.size / 1e6).toFixed(1), sec: +((Date.now() - t0) / 1000).toFixed(1) },
  errors: errors.length, firstError: errors[0] || null
}, null, 1));
await browser.close();
