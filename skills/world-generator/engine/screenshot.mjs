// Screenshot tool for visual validation (layer-3 check aid).
//   node engine/screenshot.mjs scenes/demo/world.html out.png [--view top|close|side]
import path from 'node:path';
import { chromium } from 'playwright';

const [htmlPath, outPath, viewFlag, viewName] = process.argv.slice(2);
if (!htmlPath || !outPath) {
  console.error('usage: node engine/screenshot.mjs <world.html> <out.png> [--view top|close|side]');
  process.exit(2);
}
const view = viewFlag === '--view' ? (viewName || 'top') : 'top';
const absPath = path.resolve(htmlPath);

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('file://' + absPath, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__WORLD__ && window.__WORLD__.renderer
  && window.__WORLD__.texturesReady && window.__WORLD__.texturesReady.done, null, { timeout: 150000 });
await page.waitForTimeout(300);

const views = {
  top: { zoom: 1.0, phi: Math.PI / 3.6, theta: Math.PI / 4 },
  close: { zoom: 0.38, phi: Math.PI / 4.2, theta: Math.PI / 2.6 },
  side: { zoom: 0.55, phi: Math.PI / 2.6, theta: -Math.PI / 2.4 }
};

await page.evaluate(v => {
  const w = window.__WORLD__;
  w.orbit.fitTo(w.worldBox);
  w.orbit.sph.phi = v.phi;
  w.orbit.sph.theta = v.theta;
  w.orbit.sph.radius *= v.zoom;
  w.orbit.update();
}, views[view]);

await page.waitForTimeout(600);
const hud = await page.evaluate(() => ({
  title: document.querySelector('#hud-top .title')?.textContent,
  sub: document.querySelector('#hud-top .sub')?.textContent
}));
await page.screenshot({ path: outPath });
console.log(JSON.stringify({ view, hud, consoleErrors: errors }, null, 2));
await browser.close();
