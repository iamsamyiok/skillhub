// Runtime probe: verify patch property overrides inside a packed world.html.
//   node engine/probe-props.mjs scenes/prop-test/world.html
// Prints JSON state (no pixels needed) for layer-3 style validation.
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const htmlPath = process.argv[2];
if (!htmlPath) { console.error('usage: node engine/probe-props.mjs <world.html>'); process.exit(2); }

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__WORLD__ && window.__WORLD__.renderer
  && window.__WORLD__.texturesReady && window.__WORLD__.texturesReady.done, null, { timeout: 150000 });
await page.waitForTimeout(500);

const r = await page.evaluate(() => {
  const w = window.__WORLD__;
  const by = new Map([...w.instances.entries()]);
  const out = { matOverrides: window.__MAT_OVERRIDES__, photoBound: window.__PHOTO_BOUND__, perInstance: {} };
  for (const inst of by.values()) {
    if (!inst.material && inst.scale === undefined && inst.visible === undefined && !inst.user_data) continue;
    const o = inst._object;
    const rec = { scale: o.scale.toArray().map(v => +v.toFixed(2)), visible: o.visible };
    if (inst.user_data) rec.user_data = o.userData.user;
    if (inst.material) {
      const probe = [];
      o.traverse(m => {
        if (!m.isMesh) return;
        const mat = m.material;
        probe.push({
          surface: m.userData.surface || null,
          water: !!mat.userData.waterUpgraded,
          color: mat.color ? mat.color.getHexString() : null,
          metalness: mat.metalness === undefined ? null : +mat.metalness.toFixed(2),
          roughness: mat.roughness === undefined ? null : +mat.roughness.toFixed(2),
          opacity: mat.opacity === undefined ? null : +mat.opacity.toFixed(2),
          emissiveIntensity: mat.emissiveIntensity === undefined ? null : +mat.emissiveIntensity.toFixed(2)
        });
      });
      const uniq = [];
      for (const p of probe) if (!uniq.some(q => JSON.stringify(q) === JSON.stringify(p))) uniq.push(p);
      rec.materialState = uniq.slice(0, 6);
    }
    out.perInstance[inst.instance_id] = rec;
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
console.log('pageErrors:', errs.length ? errs : 'none');
await browser.close();
