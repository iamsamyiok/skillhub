// E2E test for the viewer edit loop: button-gated edit mode (mutually exclusive
// with other controls), #edit deep link, click multi-select, intent submission,
// edit-server persistence, and --edit-save versioned snapshots.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:8000';
const SCENE = 'villa';
const dir = path.join('scenes', SCENE, 'edit-requests');
fs.rmSync(dir, { recursive: true, force: true });

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

// 1) normal mode: edit button visible, editbar hidden
await page.goto(`${BASE}/scenes/${SCENE}/world.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('!!window.__WORLD__ && window.__WORLD__.texturesReady && window.__WORLD__.texturesReady.done', null, { timeout: 90000 });
const btnVisible = await page.isVisible('#btn-edit');
const barHidden = !(await page.isVisible('#editbar'));
console.log('edit button visible:', btnVisible, '| editbar hidden:', barHidden);

// 2) click 编辑 -> enters edit mode, other buttons hidden, editbar collapsed-visible
await page.click('#btn-edit');
await page.waitForTimeout(300);
const othersHidden = await page.evaluate(() =>
  [...document.querySelectorAll('#views button:not(#btn-edit)')].every(b => b.style.display === 'none'));
const barStillHidden = !(await page.isVisible('#editbar'));
console.log('enter edit: others hidden:', othersHidden, '| bar still hidden until selection:', barStillHidden);

// 3) pick two instances
const targets = await page.evaluate(() => {
  const W = window.__WORLD__;
  const ids = ['inst_zone_lawn_tree_round_v1_001', 'inst_zone_pool_patio_umbrella_v1_001'];
  const out = [];
  for (const id of ids) {
    const inst = W.instances.get ? W.instances.get(id) : W.instances[id];
    if (!inst) continue;
    const box = new THREE.Box3().setFromObject(inst._object);
    const c = box.getCenter(new THREE.Vector3());
    const v = c.clone().project(W.camera);
    out.push({ id, x: (v.x + 1) / 2 * 1600, y: (1 - v.y) / 2 * 900 });
  }
  return out;
});
for (const t of targets) {
  await page.mouse.click(t.x, t.y);
  await page.waitForTimeout(300);
}
const chipCount = await page.locator('#edit-chips .chip').count();
console.log('chips after 2 clicks:', chipCount);

// 4) submit
await page.fill('#edit-intent', 'e2e 测试：把选中的对象整体向东移动 1.5 米');
await page.click('#edit-submit');
await page.waitForFunction("document.getElementById('edit-status').textContent.includes('已提交')", null, { timeout: 10000 });
console.log('status:', (await page.textContent('#edit-status')).slice(0, 24), '...');
await page.waitForTimeout(300);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const payload = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
console.log('request file:', files[0], '| ids:', payload.instance_ids.length);

// 5) exit edit via button -> controls restored, bar hidden
await page.click('#btn-edit');
await page.waitForTimeout(300);
const restored = await page.evaluate(() =>
  [...document.querySelectorAll('#views button:not(#btn-edit)')].every(b => b.style.display !== 'none'));
const barHidden2 = !(await page.isVisible('#editbar'));
console.log('exit edit: buttons restored:', restored, '| bar hidden:', barHidden2);

// 6) #edit deep link lands directly in edit state
await page.goto('about:blank');
await page.goto(`${BASE}/scenes/${SCENE}/world.html#edit`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('!!window.__WORLD__ && window.__WORLD__.texturesReady && window.__WORLD__.texturesReady.done', null, { timeout: 90000 });
const deepActive = await page.evaluate(() =>
  document.getElementById('btn-edit').classList.contains('active') &&
  document.getElementById('btn-edit').textContent === '退出编辑');
const deepOthersHidden = await page.evaluate(() =>
  [...document.querySelectorAll('#views button:not(#btn-edit)')].every(b => b.style.display === 'none'));
const deepBarHidden = !(await page.isVisible('#editbar'));
console.log('deep link #edit: mode active:', deepActive, '| others hidden:', deepOthersHidden, '| bar waits for selection:', deepBarHidden);

console.log('console errors:', errors.length, errors.slice(0, 3));
await browser.close();

// 7) --edit-save versioned snapshot chain (agent side, single process flow)
const sd = path.join('scenes', SCENE);
fs.rmSync(path.join(sd, 'edit-state.json'), { force: true });
execSync(`node engine/index.mjs --scene ${sd} --patch patch-1.json --edit-save`, { stdio: 'pipe' });
execSync(`node engine/index.mjs --scene ${sd} --patch patch-1.json --edit-save`, { stdio: 'pipe' });
execSync(`node engine/index.mjs --scene ${sd} --patch patch-1.json --edit-save --new-session`, { stdio: 'pipe' });
const vers = fs.readdirSync(sd).filter(f => /^world_E[\d.]+\.html$/.test(f)).sort();
console.log('version snapshots:', vers);

const ok = btnVisible && barHidden && othersHidden && barStillHidden && chipCount === 2 &&
  payload.instance_ids.length === 2 && restored && barHidden2 && deepActive && deepOthersHidden && deepBarHidden &&
  errors.length === 0 && vers.join(',') === 'world_E1.1.html,world_E1.2.html,world_E2.1.html';
console.log(ok ? 'E2E PASS' : 'E2E FAIL');
process.exit(ok ? 0 : 1);
