#!/usr/bin/env node
// snapshot.mjs — 快速画面抽查：预算重放近似 seek 到第 t 秒 → 截帧
// 借鉴 hyperframes 的 snapshot 步骤思想（低成本验证画面再决定是否整段录制）。
// 与 hyperframes 可 seek 组合的本质差异要清楚：我们的页面是活应用（WebGL 每帧演化、无内部时间轴），
// 不可回放、不可 seek，这里做的是"预算重放"——只执行消耗到目标时刻为止的动作，是近似快照。
// 因此同一张快照跨次运行可能有细微漂移；要求逐帧精确请走 record.mjs 全程录制。
//
// 用法: node snapshot.mjs <storyboard.json> [--out <dir>] [--at 0.5,2,4] [--shot id1,id2]
// 产物: <out>/snapshots/<shotId>@<t>s.jpg
// 说明: 动作解释器是 record.mjs 的最小子集（有意保持独立，快照不需要帧管线/重采样/overlay 生命周期）
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/usr/local/lib/node_modules/playwright')); }

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const boardPath = argv[0];
if (!boardPath || boardPath.startsWith('--')) { console.error('用法: node snapshot.mjs <storyboard.json> [--out <dir>] [--at 0.5,2,4] [--shot id1,id2]'); process.exit(2); }
const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
const OUT = path.resolve(argOf('--out', path.join(path.dirname(path.resolve(boardPath)), 'out')));
const AT = (argOf('--at', '0.5,2,4')).split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0);
const ONLY = argOf('--shot') ? argOf('--shot').split(',') : null;
const CAP_W = 1280, CAP_H = 720;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(page, shot) {
  const url = shot.actions.find((a) => a.type === 'goto')?.url;
  const isWorld = /world\.html/.test(url || '');
  await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  // worldgen 页面契约：__WORLD__.renderer 存在且 texturesReady.done 后纹理齐；普通页面 load 即可
  if (isWorld) {
    await page.waitForFunction(() => {
      const w = window.__WORLD__;
      return w && w.renderer && (!w.texturesReady || w.texturesReady.done);
    }, { timeout: 120000 }).catch(() => console.error('  [warn] 等待渲染器超时，继续截图'));
  }
  await page.waitForTimeout(isWorld ? 800 : 500);
}

// 预算重放：elapsed 达到 budget 后停止执行后续动作
async function replay(page, shot, budgetSec) {
  let elapsed = 0;
  for (const a of shot.actions || []) {
    if (a.type === 'goto') { await waitReady(page, shot); elapsed += 1.0; continue; }
    if (elapsed >= budgetSec) break;
    const ms = a.ms || 0;
    const dur = Math.min(ms, (budgetSec - elapsed) * 1000);
    if (dur > 0) await sleep(dur);
    elapsed += dur / 1000;
    if (elapsed >= budgetSec) break;
    switch (a.type) {
      case 'click': await page.locator(a.sel || 'body').first().click({ timeout: 5000 }).catch(() => {}); elapsed += 0.2; break;
      case 'fill': await page.locator(a.sel).first().fill(a.text ?? '', { timeout: 5000 }).catch(() => {}); elapsed += 0.2; break;
      case 'press': await page.keyboard.press(a.key || 'Enter'); elapsed += 0.1; break;
      case 'direct': await page.evaluate(a.js); elapsed += 0.1; break;
      case 'dragCanvas': {
        const box = await page.locator('canvas').first().boundingBox();
        if (box) {
          const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
          await page.mouse.move(cx + (a.dx || 0) / 2, cy + (a.dy || 0) / 2);
          await page.mouse.down();
          await page.mouse.move(cx + (a.dx || 0), cy + (a.dy || 0), { steps: Math.min(20, Math.max(3, (a.ms || 600) / 30)) });
          await page.mouse.up();
        }
        elapsed += 0.3;
        break;
      }
      case 'dragSlider': {
        const loc = page.locator(a.sel).first();
        const box = await loc.boundingBox().catch(() => null);
        if (box) {
          const xFor = (frac) => box.x + box.width * (a.min ?? 0) + (a.max ?? 1 - (a.min ?? 0)) * box.width * frac;
          await page.mouse.move(xFor(0), box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(xFor(a.to ?? 0.5), box.y + box.height / 2, { steps: 15 });
          await page.mouse.up();
        }
        elapsed += 0.3;
        break;
      }
      default: break;
    }
    await page.waitForTimeout(150);
  }
  return elapsed;
}

const LAUNCH_ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-driver-bug-workarounds'];
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
const ctx = await browser.newContext({ viewport: { width: CAP_W, height: CAP_H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const outDir = path.join(OUT, 'snapshots');
fs.mkdirSync(outDir, { recursive: true });

let n = 0;
for (const shot of board.shots) {
  if (ONLY && !ONLY.includes(shot.id)) continue;
  for (const t of AT) {
    const tpl = 'about:blank';
    await page.goto(tpl, { waitUntil: 'load' }).catch(() => {});
    const before = Date.now();
    await replay(page, shot, t);
    const file = path.join(outDir, `${shot.id}@${t}s.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    console.log(`[${shot.id}@${t}s] ${(Date.now() - before) / 1000 | 0}s -> ${path.basename(file)}`);
    n++;
  }
}
await browser.close();
console.log(`快照完成：${n} 张 -> ${outDir}`);
