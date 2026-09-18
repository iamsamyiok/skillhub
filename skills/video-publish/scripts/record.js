'use strict';

// video/record.js — Playwright 分镜自动录屏（虚拟光标 + 逐帧截图）
// 用法: node video/record.js [--only s1,s3]
// 前置: 端口 3777 有 kg --demo 实例（build.sh 自动拉起）
// 说明: 软渲染下 recordVideo 时间戳失真，改为 12fps 逐帧截图（时长与真实时间严格对齐）

const path = require('path');
const fs = require('fs');
const { chromium } = require('/usr/local/lib/node_modules/playwright');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'out');
const FRAME_FPS = 12;
const BOARD = JSON.parse(fs.readFileSync(path.join(ROOT, 'storyboard.json'), 'utf8'));
// 软渲染下实测 screencast 约 2.6fps@720p，录制分辨率降为 720p（compose 统一放大到 1080p）
const [W, H] = [1280, 720];

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1].split(',').map((s) => s.trim()) : null;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 虚拟光标（Playwright 鼠标不渲染，注入 DOM 元素呈现轨迹与点击涟漪） ----------
const CURSOR_HTML = `<div id="_vcursor" style="position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform .12s ease-out">
  <svg width="34" height="34" viewBox="0 0 34 34">
    <circle cx="17" cy="17" r="6" fill="rgba(255,190,60,.95)" stroke="#fff" stroke-width="2"/>
    <circle cx="17" cy="17" r="13" fill="none" stroke="rgba(255,190,60,.55)" stroke-width="2.5"/>
  </svg>
</div>
<div id="_vripple" style="position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;opacity:0"></div>`;

async function installCursor(page) {
  await page.evaluate((html) => {
    document.body.insertAdjacentHTML('beforeend', html);
  }, CURSOR_HTML);
}

async function vMove(page, x, y) {
  await page.evaluate(({ x, y }) => {
    const c = document.getElementById('_vcursor');
    if (c) c.style.transform = `translate(${x - 17}px,${y - 17}px)`;
  }, { x, y });
  await sleep(140);
}

async function ripple(page, x, y) {
  await page.evaluate(({ x, y }) => {
    const r = document.getElementById('_vripple');
    if (!r) return;
    r.style.cssText += `;width:12px;height:12px;border:3px solid rgba(255,190,60,.9);border-radius:50%;transform:translate(${x - 9}px,${y - 9}px);opacity:1;transition:none`;
    requestAnimationFrame(() => {
      r.style.transition = 'all .45s ease-out';
      r.style.width = '52px';
      r.style.height = '52px';
      r.style.transform = `translate(${x - 29}px,${y - 29}px)`;
      r.style.opacity = '0';
    });
  }, { x, y });
  await sleep(320);
}

// ---------- 逐帧录制器（CDP screencast：合成器事件驱动推帧，动作并发执行） ----------
// 软渲染下逐次截图约 1.3s/帧，screencast 实测约 2.6fps@720p；收帧后按时间戳重采样到 FRAME_FPS
function startFrames(page, context, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const frames = []; // {buf, t}
  let stopped = false;
  let session = null;
  const t0 = Date.now();
  (async () => {
    session = await context.newCDPSession(page);
    session.on('Page.screencastFrame', async (ev) => {
      frames.push({ buf: Buffer.from(ev.data, 'base64'), t: Date.now() - t0 });
      try { await session.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch (_) {}
    });
    await session.send('Page.startScreencast', { format: 'jpeg', quality: 75, everyNthFrame: 1 });
  })().catch((e) => console.error('screencast 启动失败:', e.message));
  return {
    async stop() {
      stopped = true;
      await sleep(400);
      if (session) session.send('Page.stopScreencast').catch(() => {}); // 页面可能已关闭，忽略
      if (frames.length < 2) throw new Error(`收帧过少: ${frames.length}`);
      // 重采样到 FRAME_FPS：每个槽位取时间上最近的前置帧
      const durMs = frames[frames.length - 1].t;
      const slots = Math.max(2, Math.floor((durMs / 1000) * FRAME_FPS));
      let fi = 0;
      for (let s = 0; s < slots; s++) {
        const t = (s / FRAME_FPS) * 1000;
        while (fi < frames.length - 1 && frames[fi + 1].t <= t) fi++;
        fs.writeFileSync(path.join(dir, `${String(s + 1).padStart(6, '0')}.jpg`), frames[fi].buf);
      }
      return slots;
    },
  };
}

// ---------- 动作解释器 ----------
async function findSelectorPoint(page, sel) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`元素未找到: ${sel}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function runActions(page, actions, ctx) {
  for (const a of actions) {
    switch (a.type) {
      case 'goto': {
        const url = a.url.replace(/\{([^}]+)\}/g, (_, name) => ctx.ids.get(name) ?? '');
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        await sleep(1200);
        break;
      }
      case 'click': {
        const p = await findSelectorPoint(page, a.sel);
        await vMove(page, p.x, p.y);
        await page.locator(a.sel).first().click({ timeout: 15000 });
        await ripple(page, p.x, p.y);
        break;
      }
      case 'clickTab': {
        const p = await findSelectorPoint(page, `[data-tab="${a.tab}"]`);
        await vMove(page, p.x, p.y);
        await page.locator(`[data-tab="${a.tab}"]`).first().click();
        await ripple(page, p.x, p.y);
        await sleep(a.tab === 'version' ? 4000 : 1200);
        break;
      }
      case 'fill': {
        const el = page.locator(a.sel).first();
        await el.click();
        await el.fill('');
        await page.keyboard.type(a.text, { delay: 22 });
        if (a.pauseMs) await sleep(a.pauseMs);
        break;
      }
      case 'press': {
        await page.keyboard.press(a.key);
        break;
      }
      case 'wait': {
        await sleep(a.ms);
        break;
      }
      case 'dragCanvas': {
        const cx = W / 2, cy = H / 2 - 30;
        await vMove(page, cx - a.dx / 2, cy - a.dy / 2);
        await page.mouse.down();
        const steps = a.steps || 25;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          await page.mouse.move(cx - a.dx / 2 + a.dx * ease, cy - a.dy / 2 + a.dy * ease);
          await sleep(45);
        }
        await page.mouse.up();
        await sleep(a.pauseMs || 200);
        break;
      }
      case 'waitAgentDone': {
        const deadline = Date.now() + (a.timeoutMs || 420000);
        let done = false;
        while (Date.now() < deadline) {
          done = await page.evaluate(() => {
            const b = document.getElementById('agent-send');
            return b && !b.disabled;
          });
          if (done) break;
          await sleep(2000);
        }
        if (!done) throw new Error('waitAgentDone 超时');
        await sleep(800);
        break;
      }
      case 'waitAskDone': {
        const deadline = Date.now() + (a.timeoutMs || 180000);
        let done = false;
        while (Date.now() < deadline) {
          done = await page.evaluate(() => {
            const s = document.getElementById('a-status');
            return s && s.textContent.startsWith('完成');
          });
          if (done) break;
          await sleep(2000);
        }
        if (!done) throw new Error('waitAskDone 超时');
        await sleep(800);
        break;
      }
      case 'diffPick': {
        await page.waitForSelector('#v-list .ver-item input[type=checkbox]', { timeout: 20000 });
        for (const idx of a.indexes) {
          const boxes = await page.locator('#v-list .ver-item input[type=checkbox]').all();
          if (boxes[idx]) {
            const b = await boxes[idx].boundingBox();
            if (!b) { console.log(`[debug] checkbox ${idx} boundingBox 为 null`); continue; }
            await vMove(page, b.x + b.width / 2, b.y + b.height / 2);
            await boxes[idx].click({ timeout: 15000 });
            await ripple(page, b.x + b.width / 2, b.y + b.height / 2);
            console.log(`[debug] 点击 checkbox ${idx} → checked:`, await boxes[idx].evaluate((el) => el.checked));
          } else console.log(`[debug] checkbox ${idx} 不存在，共`, boxes.length);
        }
        await sleep(2500);
        break;
      }
      default:
        throw new Error(`未知动作类型: ${a.type}`);
    }
  }
}

// ---------- 主流程 ----------
(async () => {
  // 拉取实体名→id 映射（分镜占位符 {太阳} 等）
  const graph = await (await fetch('http://localhost:3777/api/graph')).json();
  const ids = new Map(graph.entities.map((e) => [e.name, String(e.id)]));
  console.log(`实体映射: ${ids.size} 个（太阳=${ids.get('太阳')} 水星=${ids.get('水星')}）`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  for (const shot of BOARD.shots) {
    if (only && !only.includes(shot.id)) continue;
    const frameDir = path.join(OUT_DIR, 'frames', shot.id);
    if (fs.existsSync(frameDir) && fs.readdirSync(frameDir).length) { console.log(`[${shot.id}] 帧已存在，跳过（删除可重录）`); continue; }
    console.log(`[${shot.id}] ${shot.name} 录制中…`);
    const t0 = Date.now();
    const context = await browser.newContext({ viewport: { width: W, height: H } });
    const page = await context.newPage();
    const rec = startFrames(page, context, frameDir);
    try {
      await page.goto('http://localhost:3777/', { waitUntil: 'load', timeout: 30000 });
      await installCursor(page);
      await runActions(page, shot.actions, { ids });
    } catch (e) {
      await rec.stop();
      await context.close();
      console.error(`[${shot.id}] 失败: ${e.message}`);
      await browser.close();
      process.exit(1);
    }
    const n = await rec.stop();
    await context.close();
    console.log(`[${shot.id}] 完成 ${n} 帧 / ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  await browser.close();
  console.log('全部分镜录制完成 →', path.join(OUT_DIR, 'frames'));
})();
