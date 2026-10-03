#!/usr/bin/env node
// record.mjs — 分镜录制：Playwright 驱动真实页面动作，采集帧序列 + 注入式 overlay 字层
// 借鉴 hyperframes：①overlay 以 start/duration 的 clip 形式声明、注入同一页面渲染；
// ②software-GPU 慢路径显式声明；③采集模式二选一：screencast(默认，吃页面绘制节拍+重采样) / capture(固定节拍主动截帧)。
//
// 用法:
//   node record.mjs <storyboard.json> [--out <dir>] [--only s1,s3] [--fps N] [--mode screencast|capture]
//                   [--quality 75] [--cap-height 720] [--force]
// 契约: shot.overlays[].start/duration 以「该镜首个动作开始」为 t=0（goto 完成后立即注入运行时）
// 产物: <out>/frames/<shotId>/%06d.jpg + frames/_meta.json（fps/尺寸/每镜帧数，增量合并，compose 直接消费）
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/usr/local/lib/node_modules/playwright')); }

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const hasFlag = (k) => argv.includes(k);

const boardPath = argv[0];
if (!boardPath || boardPath.startsWith('--')) { console.error('用法: node record.mjs <storyboard.json> [选项]'); process.exit(2); }
const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
const BOARD_ROOT = path.dirname(path.resolve(boardPath));
const OUT = path.resolve(argOf('--out', path.join(BOARD_ROOT, 'out')));
const MODE = argOf('--mode', 'screencast');
const QUALITY = Number(argOf('--quality', '75'));
const FORCE = hasFlag('--force');
const only = hasFlag('--only') ? argOf('--only', '').split(',').map((s) => s.trim()) : null;

const [W, H] = board.meta.resolution || [1920, 1080];
const FPS = Number(argOf('--fps', board.meta.fps || 12));
// 分辨率策略：软渲染逐帧截图吃 CPU —— 默认 720p 采集，compose 统一放大（worldgen 实战同款）
const CAP_H = Number(argOf('--cap-height', H > 1080 ? 1080 : 720));
const CAP_W = Math.round((CAP_H / H) * W);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s, m) => console.log(`[${s}] ${m}`);

// ---------- 设计令牌（frame.md 思想：视觉决策集中在 design.json，overlay 模板经 CSS 变量取用） ----------
// skill 默认令牌 + 分镜板同目录 design.json 覆盖（浅色页面务必覆写 overlay.ink 为深色）
const DESIGN = (() => {
  const def = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'assets', 'design.json'), 'utf8'));
  const p = path.join(BOARD_ROOT, 'design.json');
  if (fs.existsSync(p)) {
    const ov = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ...def, ...ov, overlay: { ...def.overlay, ...(ov.overlay || {}) }, palette: { ...def.palette, ...(ov.palette || {}) } };
  }
  return def;
})();
const overlayCssVars = (() => {
  const o = DESIGN.overlay || {};
  return [
    o.ink && `--vpx-overlay-ink:${o.ink}`,
    o.shadowColor && `--vpx-overlay-shadow:${o.shadowColor}`,
    o.accent && `--vpx-accent:${o.accent}`,
    o.font && `--vpx-font:${JSON.stringify(o.font)}`,
    o.lowerThird?.bg && `--vpx-l3-bg:${o.lowerThird.bg}`,
    o.lowerThird?.barColor && `--vpx-l3-bar:${o.lowerThird.barColor}`,
    o.titleSize && `--vpx-title-size:${o.titleSize}px`,
    o.titleSubSize && `--vpx-title-sub-size:${o.titleSubSize}px`,
    o.lowerThird?.titleSize && `--vpx-l3-title-size:${o.lowerThird.titleSize}px`,
    o.lowerThird?.subSize && `--vpx-l3-sub-size:${o.lowerThird.subSize}px`,
  ].filter(Boolean).join(';');
})();

// ---------- overlay 组合契约：{{var}} 与 {{#var}}..{{/var}} 子集渲染 ----------
const OVERLAY_BOOT = `(function(){
  var root = document.createElement('div');
  root.id = '__vpx_root';
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden' + (window.__vpx_vars ? ';' + window.__vpx_vars : '');
  root.style.zoom = window.__vpx_scale || 1;
  document.documentElement.appendChild(root);
  var t0 = performance.now();
  (window.__vpx_clips || []).forEach(function(c){
    var el = null;
    setTimeout(function(){
      el = document.createElement('div');
      el.style.cssText = 'position:absolute;inset:0';
      el.innerHTML = c.html;
      root.appendChild(el);
    }, Math.max(0, c.start * 1000 - (performance.now() - t0)));
    setTimeout(function(){ if (el) el.remove(); }, c.start * 1000 + c.duration * 1000);
  });
})();`;

function renderTpl(tpl, vars) {
  return tpl
    .replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, inner) => (vars[k] ? inner.replace(/\{\{(\w+)\}\}/g, (m2, k2) => (vars[k2] != null ? String(vars[k2]) : m2)) : ''))
    .replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

async function mountOverlays(page, shot) {
  const clips = [];
  for (const o of shot.overlays || []) {
    const p = [path.resolve(BOARD_ROOT, o.template), path.join(import.meta.dirname, '..', 'assets', 'templates', o.template)].find((x) => fs.existsSync(x));
    if (!p) throw new Error(`overlay 模板未找到: ${o.template}`);
    clips.push({ start: o.start, duration: o.duration, html: renderTpl(fs.readFileSync(p, 'utf8'), o.vars || {}) });
  }
  await page.evaluate(({ clips, scale, boot, vars }) => {
    window.__vpx_clips = clips;
    window.__vpx_scale = scale;
    window.__vpx_vars = vars;
    const s = document.createElement('script');
    s.textContent = boot;
    document.documentElement.appendChild(s);
  }, { clips, scale: CAP_W / W, boot: OVERLAY_BOOT, vars: overlayCssVars });
}

// ---------- 动作解释器 ----------
async function waitReady(page, a, timeoutMs) {
  const isWorld = /world\.html/.test(a.url || '');
  const ready = a.ready || (isWorld ? 'window.__WORLD__ && window.__WORLD__.renderer' : null);
  if (ready) await page.waitForFunction(ready, null, { timeout: timeoutMs }).catch(() => { throw new Error(`就绪标记超时(${timeoutMs}ms)`); });
  if (isWorld) await page.waitForFunction('window.__WORLD__ && window.__WORLD__.texturesReady && window.__WORLD__.texturesReady.done', null, { timeout: 120000 }).catch(() => log('_', '贴图等待超时，继续（程序化外观兜底）'));
  await sleep(a.settleMs ?? (isWorld ? 1500 : 1200));
}

async function runActions(page, shot) {
  let overlayMounted = false;
  for (const a of shot.actions || []) {
    switch (a.type) {
      case 'goto': {
        await page.goto(a.url, { waitUntil: 'load', timeout: shot.timeoutMs || 240000 });
        await waitReady(page, a, shot.timeoutMs || 180000);
        // 帧时钟保活：静态页面无重绘时 screencast 不吐帧、时长坍缩（P9）；
        // 注入 2px 无限动画元素强制合成器持续出帧，wait 期间时钟照走
        await page.addStyleTag({ content: '@keyframes __vpxPulse{0%{transform:translateZ(0)}100%{transform:translateZ(0.001px)}}#__vpxPulse{position:fixed;right:0;bottom:0;width:2px;height:2px;pointer-events:none;z-index:2147482147;animation:__vpxPulse 200ms infinite alternate}' }).catch(() => {});
        await page.evaluate(() => { if (!document.getElementById('__vpxPulse')) { const d = document.createElement('div'); d.id = '__vpxPulse'; document.documentElement.appendChild(d); } }).catch(() => {});
        if (!overlayMounted && shot.overlays?.length) { await mountOverlays(page, shot); overlayMounted = true; }
        break;
      }
      case 'click': {
        const box = await page.locator(a.sel).first().boundingBox().catch(() => null);
        if (!box) { if (a.optional) break; throw new Error(`元素未找到: ${a.sel}`); }
        await page.locator(a.sel).first().click({ timeout: 15000 });
        await sleep(a.pauseMs ?? 700);
        break;
      }
      case 'fill': {
        const el = page.locator(a.sel).first();
        const visible = await el.count() && !!(await el.boundingBox().catch(() => null));
        if (!visible) { if (a.optional) break; throw new Error(`元素未找到: ${a.sel}`); }
        await el.click();
        await el.fill('');
        await page.keyboard.type(a.text, { delay: a.delayMs ?? 34 });
        await sleep(a.pauseMs ?? 500);
        break;
      }
      case 'press': { await page.keyboard.press(a.key); await sleep(a.pauseMs ?? 300); break; }
      case 'direct': { await page.evaluate(a.js); await sleep(a.pauseMs ?? 600); break; }
      case 'wait': { await sleep(a.ms); break; }
      case 'dragCanvas': {
        const cx = CAP_W / 2, cy = CAP_H / 2 - (a.cyOffset || 30);
        await page.mouse.move(cx - a.dx / 2, cy - a.dy / 2);
        await page.mouse.down();
        const steps = a.steps || 25;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          await page.mouse.move(cx - a.dx / 2 + a.dx * ease, cy - a.dy / 2 + a.dy * ease);
          await sleep(a.stepMs ?? 45);
        }
        await page.mouse.up();
        await sleep(a.pauseMs ?? 200);
        break;
      }
      case 'dragSlider': {
        const box = await page.locator(a.sel).first().boundingBox();
        if (!box) throw new Error(`滑块未找到: ${a.sel}`);
        const st = await page.evaluate((sel) => {
          const s = document.querySelector(sel);
          return { v: parseFloat(s.value), min: parseFloat(s.min), max: parseFloat(s.max) };
        }, a.sel);
        const xFor = (v) => box.x + ((v - st.min) / (st.max - st.min)) * box.width;
        const cy = box.y + box.height / 2;
        await page.mouse.move(xFor(st.v), cy);
        await page.mouse.down();
        const steps = a.steps || 22;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          await page.mouse.move(xFor(st.v) + (xFor(a.to) - xFor(st.v)) * ease, cy);
          await sleep(a.stepMs ?? 60);
        }
        await page.mouse.up();
        await sleep(a.pauseMs ?? 1800);
        break;
      }
      case 'pickInstance': {
        const pt = await page.evaluate(({ assetId, index }) => {
          const w = window.__WORLD__;
          const list = [...w.instances.values()].filter((i) => i.asset_id === assetId);
          const inst = list[index || 0];
          if (!inst || !inst._object) return { err: 'instance not found: ' + assetId };
          const box = new THREE.Box3().setFromObject(inst._object);
          const c = box.getCenter(new THREE.Vector3());
          const ndc = c.clone().project(w.camera);
          if (ndc.z > 1) return { err: 'behind camera: ' + inst.instance_id };
          return { x: ((ndc.x + 1) / 2) * window.innerWidth, y: ((1 - ndc.y) / 2) * window.innerHeight, id: inst.instance_id };
        }, { assetId: a.assetId, index: a.index });
        if (pt.err) throw new Error(pt.err);
        await page.mouse.move(pt.x, pt.y);
        await page.mouse.down();
        await sleep(90);
        await page.mouse.up();
        await sleep(a.pauseMs ?? 900);
        break;
      }
      default: throw new Error(`未知动作: ${a.type}`);
    }
  }
}

// ---------- 采集器 ----------
function startScreencast(session, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const t0 = Date.now();
  session.on('Page.screencastFrame', async (ev) => {
    frames.push({ buf: Buffer.from(ev.data, 'base64'), t: Date.now() - t0 });
    try { await session.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch { /* ack 失败不影响收帧 */ }
  });
  return session.send('Page.startScreencast', { format: 'jpeg', quality: QUALITY, everyNthFrame: 1, maxWidth: CAP_W, maxHeight: CAP_H }).then(() => ({
    async stop() {
      await sleep(400);
      session.send('Page.stopScreencast').catch(() => {});
      if (frames.length < 2) throw new Error(`收帧过少: ${frames.length}`);
      const durMs = frames[frames.length - 1].t;
      const slots = Math.max(2, Math.floor((durMs / 1000) * FPS));
      let fi = 0;
      for (let sIdx = 0; sIdx < slots; sIdx++) {
        const t = (sIdx / FPS) * 1000;
        while (fi < frames.length - 1 && frames[fi + 1].t <= t) fi++;
        fs.writeFileSync(path.join(dir, `${String(sIdx + 1).padStart(6, '0')}.jpg`), frames[fi].buf);
      }
      return slots;
    },
  }));
}

function startCapture(session, dir) {
  fs.mkdirSync(dir, { recursive: true });
  let running = true;
  let n = 0;
  const tick = 1000 / FPS;
  (async () => {
    while (running) {
      const t0 = Date.now();
      try {
        const shot = await session.send('Page.captureScreenshot', { format: 'jpeg', quality: QUALITY });
        fs.writeFileSync(path.join(dir, `${String(++n).padStart(6, '0')}.jpg`), Buffer.from(shot.data, 'base64'));
      } catch { running = false; break; }
      await sleep(Math.max(0, tick - (Date.now() - t0)));
    }
  })();
  return { async stop() { running = false; await sleep(tick + 150); return n; } };
}

// ---------- 主流程 ----------
(async () => {
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const metaPath = path.join(OUT, 'frames', '_meta.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : { shots: {} };
  Object.assign(meta, { fps: FPS, width: CAP_W, height: CAP_H, mode: MODE });
  const boardT0 = Date.now();
  const browser = await chromium.launch({
    headless: true,
    // 声明软 GPU：swiftshader 慢但可移植（hyperframes 同款提示：screenshot + software gpu 是慢路径）
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  for (const shot of board.shots) {
    if (only && !only.includes(shot.id)) continue;
    const frameDir = path.join(OUT, 'frames', shot.id);
    if (!FORCE && fs.existsSync(frameDir) && fs.readdirSync(frameDir).some((f) => f.endsWith('.jpg'))) {
      log(shot.id, '帧已存在，跳过（--force 重录）');
      continue;
    }
    fs.rmSync(frameDir, { recursive: true, force: true });
    log(shot.id, `${shot.name || ''} 录制中…（${MODE} @${FPS}fps ${CAP_W}x${CAP_H}）`);
    const t0 = Date.now();
    const context = await browser.newContext({ viewport: { width: CAP_W, height: CAP_H }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => log(shot.id, `[pageerror] ${e.message}`));
    const session = await context.newCDPSession(page);
    const rec = MODE === 'capture' ? startCapture(session, frameDir) : await startScreencast(session, frameDir);
    try {
      await runActions(page, shot);
      // overlay 时序契约：start/duration 相对该镜首动作；动作结束后若 overlay 未演完则顺延补齐
      const elapsed = (Date.now() - t0) / 1000;
      const tail = Math.max(0, ...(shot.overlays || []).map((o) => o.start + o.duration), 0.3) - elapsed;
      if (tail > 0) await sleep(tail * 1000);
    } catch (e) {
      await context.close();
      await sleep(500);
      // 失败清理：残帧会被「帧已存在即跳过」误当成品，必须清掉
      fs.rmSync(frameDir, { recursive: true, force: true });
      console.error(`[${shot.id}] 失败: ${e.message}（已清理残帧，可直接重跑）`);
      await browser.close();
      process.exit(1);
    }
    const n = await rec.stop();
    await context.close();
    meta.shots[shot.id] = { frames: n, seconds: +(n / FPS).toFixed(2) };
    log(shot.id, `完成 ${n} 帧 / ${meta.shots[shot.id].seconds}s`);
  }

  await browser.close();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`录制完成(${((Date.now() - boardT0) / 1000).toFixed(1)}s) → ${path.join(OUT, 'frames')}`);
})();
