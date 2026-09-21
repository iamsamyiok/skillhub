#!/usr/bin/env node
'use strict';

// cards.mjs — 卡片模式合成器 v2(HyperFrames 理念轻量化落地)
//  v1: 静态卡片截图 + ffmpeg zoompan 假推镜 + 硬切拼接
//  v2 新增(借鉴 HyperFrames 框架,零新依赖):
//    1. 确定性入场动画:每张卡片的元素错峰淡入+滑入(纯 CSS animation + WAAPI currentTime 逐帧seek,
//       不用 GSAP;同款效果,截图完全可复现——确定性逐帧渲染是 HyperFrames 的核心纪律)
//    2. 交叉溶解转场:卡片之间 xfade 0.4s(替代硬切;HF 规则「场景间必须有转场,禁跳切」)
//    3. 溢出自检:截图前扫描元素包围盒,超出视口即告警(HF inspect 的轻量版)
//    4. 对比度审计:主题色 vs 背景的 WCAG 对比度检查(HF validate 的轻量版)
//
// 契约不变:env STORYBOARD/OUT_DIR;配音来自 tts.mjs(OUT/tts/{id}.mp3)
// 产物:OUT/cards/、OUT/final-cards.mp4
//
// 运行: NODE_PATH=$(npm root -g) node cards.mjs
// 环境变量: NO_ANIMATE=1 关闭入场动画(退回 v1 静态模式) | XFADE=0.4 转场时长 | TTS_DIR 覆盖配音目录

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); // NODE_PATH 指向全局 node_modules 时可解析全局 playwright

const ROOT = import.meta.dirname;
const OUT_DIR = process.env.OUT_DIR || path.join(ROOT, 'out');
const OUT = path.join(OUT_DIR, 'cards');
const BOARD = JSON.parse(fs.readFileSync(process.env.STORYBOARD || path.join(ROOT, 'storyboard.json'), 'utf8'));
const TTS = process.env.TTS_DIR || path.join(OUT_DIR, 'tts');
const XFADE = parseFloat(process.env.XFADE ?? '0.4');
const ANIMATE = process.env.NO_ANIMATE !== '1';
const FPS = 30;
const ENTRANCE = 1.2; // 入场动画时长(秒),36 帧

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cfg = BOARD.meta?.cards ?? {};
const A = cfg.accent || '#bc8cff', A2 = cfg.accent2 || '#f78166';
const BG = '#0d0a14', FG = '#e6edf3';
const shots = (BOARD.shots || []).filter((s) => s.card);
if (shots.length === 0) { console.error('分镜表里没有任何 card 字段的分镜'); process.exit(1); }

// ---------- 对比度审计(WCAG,借鉴 HF validate) ----------
function luma(hex) {
  const c = hex.replace('#', '');
  const f = (i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4);
}
function contrast(a, b) {
  const [l1, l2] = [luma(a), luma(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
for (const [name, fg, bg, large] of [['正文', FG, BG, false], ['主题色', A, BG, true]]) {
  const r = contrast(fg, bg);
  const need = large ? 3 : 4.5;
  if (r < need) console.error(`⚠ 对比度不足: ${name} ${fg}/${bg} = ${r.toFixed(2)}:1 (需 ${need}:1)`);
  else console.log(`对比度 ✓ ${name} ${r.toFixed(2)}:1`);
}

// ---------- 渲染 HTML(带入场动画) ----------
const animCss = ANIMATE ? `
/* 确定性入场:CSS animation + play-state paused,WAAPI 逐帧 seek currentTime */
.slide [data-anim] { animation: enter 0.6s cubic-bezier(0.22,1,0.36,1) both paused; }
@keyframes enter { from { opacity: 0; transform: translateY(42px); } to { opacity: 1; transform: none; } }
` : '';

function slideHtml(s, idx) {
  const title = esc(s.card.title).replace(/(SkillHub|AI)/g, `<span class="hl">$1</span>`);
  let k = 0;
  const el = (tag, cls, inner) => `<${tag} class="${cls}" ${ANIMATE ? `data-anim style="animation-delay:${(k++) * 0.15}s"` : ''}>${inner}</${tag}>`;
  return `<section class="slide" id="s${s.id}">
    <div class="ai-badge" ${ANIMATE ? `data-anim style="animation-delay:0s"` : ''}>AI 生成</div>
    ${el('div', 'kicker', esc(s.card.kicker))}
    ${el('h1', '', title)}
    ${s.card.sub ? el('div', 'sub', esc(s.card.sub)) : ''}
    ${s.card.hook ? el('div', 'hook', esc(s.card.hook)) : ''}
    ${(s.card.brands || []).length ? el('div', 'brands', s.card.brands.map((b) => `<span class="brand">${esc(b)}</span>`).join('')) : ''}
    ${s.card.decl ? el('div', 'decl', '⚠ ' + esc(s.card.decl)) : ''}
    ${s.card.note ? el('div', 'note', esc(s.card.note)) : ''}
  </section>`;
}

fs.mkdirSync(OUT, { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;font-family:"Microsoft YaHei","PingFang SC",sans-serif}
.slide{width:1920px;height:1080px;background:${BG};color:${FG};position:relative;overflow:hidden;
  padding:110px 120px;display:flex;flex-direction:column;justify-content:center}
.slide::before{content:"";position:absolute;inset:0;
  background:radial-gradient(1000px 560px at 88% -12%, ${A}33, transparent 62%),
             radial-gradient(760px 420px at -8% 112%, ${A2}22, transparent 60%)}
.ai-badge{position:absolute;top:44px;right:48px;padding:10px 24px;border-radius:999px;
  border:2px solid ${A};color:${A};font-size:26px;font-weight:700;letter-spacing:4px;background:${A}14}
.kicker{color:${A};font-size:32px;letter-spacing:8px;margin-bottom:34px;font-weight:700}
h1{font-size:120px;font-weight:900;line-height:1.12}
h1 .hl{color:${A}}
.sub{margin-top:34px;font-size:42px;color:#b8c0cc;line-height:1.5;font-weight:600}
.hook{margin-top:60px;padding:30px 40px;border-left:8px solid ${A2};background:${A2}12;
  font-size:40px;font-weight:700;border-radius:0 16px 16px 0}
.brands{display:flex;gap:20px;flex-wrap:wrap;margin-top:56px}
.brand{padding:14px 30px;border-radius:14px;border:1px solid #303a4d;background:#151221;
  font-family:Consolas,monospace;font-size:34px;color:${A}}
.note{margin-top:26px;font-size:36px;color:#8b93a3}
.decl{display:inline-block;margin-top:40px;padding:16px 34px;border-radius:16px;
  background:${A}24;border:2px solid ${A};font-size:44px;font-weight:900;color:${A}}
${animCss}
</style></head><body>${shots.map(slideHtml).join('\n')}</body></html>`;
fs.writeFileSync(path.join(OUT_DIR, 'cards.html'), html);
console.log(`cards.html 已生成(${shots.length} 张卡片, 动画=${ANIMATE})`);

// ---------- Playwright 截图(入场逐帧 + 定格) ----------
let chromium = null;
for (const m of ['@playwright/test', 'playwright']) {
  try { chromium = require(m).chromium; break; } catch { /* 下一个 */ }
}
if (!chromium) { console.error('找不到 playwright:NODE_PATH=$(npm root -g) node cards.mjs'); process.exit(1); }

const width = BOARD.meta?.resolution?.[0] ?? 1920;
const height = BOARD.meta?.resolution?.[1] ?? 1080;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.goto('file://' + path.join(OUT_DIR, 'cards.html').replace(/\\/g, '/'));
await page.waitForTimeout(600);

const entranceFrames = ANIMATE ? Math.round(ENTRANCE * FPS) : 1;
const warnings = [];
for (let i = 0; i < shots.length; i++) {
  const el = page.locator(`#s${shots[i].id}`);
  // 溢出自检(HF inspect 轻量版):相对卡片自身 1920x1080 舞台判断,页面级坐标会误报非首卡
  const overflow = await el.evaluate((node) => {
    const bad = [];
    const stage = node.getBoundingClientRect();
    for (const child of node.querySelectorAll('[data-anim]')) {
      const r = child.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const rel = { left: r.left - stage.left, right: r.right - stage.left, bottom: r.bottom - stage.top };
      if (rel.right > 1922 || rel.left < -2 || rel.bottom > 1082) bad.push(`${child.className || child.tagName} right=${Math.round(rel.right)} bottom=${Math.round(rel.bottom)}`);
    }
    return bad;
  });
  overflow.forEach((o) => warnings.push(`[${shots[i].id}] 溢出: ${o}`));

  if (ANIMATE) {
    // 确定性逐帧:WAAPI seek(pause 后设 currentTime;delay 已含在动画相位里,逐帧归一化)
    const frameDir = path.join(OUT, `frames-${shots[i].id}`);
    fs.mkdirSync(frameDir, { recursive: true });
    for (let f = 0; f < entranceFrames; f++) {
      const t = (f / FPS) * 1000;
      await el.evaluate((node, time) => {
        node.querySelectorAll('[data-anim]').forEach((n) => {
          const delay = parseFloat(n.style.animationDelay) * 1000 || 0;
          n.getAnimations().forEach((a) => { a.pause(); a.currentTime = Math.max(0, time - delay); });
        });
      }, t);
      await page.locator(`#s${shots[i].id}`).screenshot({ path: path.join(frameDir, `e${String(f).padStart(3, '0')}.png`) });
    }
    // 全入场状态定格帧(v2 保留 slide-XX.png 供 zoompan/封面复用)
    await el.evaluate((node) => {
      node.querySelectorAll('[data-anim]').forEach((n) => n.getAnimations().forEach((a) => { a.pause(); a.currentTime = 5000; }));
    });
    await page.locator(`#s${shots[i].id}`).screenshot({ path: path.join(OUT, `slide-${String(i).padStart(2, '0')}.png`) });
  } else {
    await page.locator(`#s${shots[i].id}`).screenshot({ path: path.join(OUT, `slide-${String(i).padStart(2, '0')}.png`) });
  }
  console.log(`card ${shots[i].id} ✓ (${ANIMATE ? entranceFrames + ' 帧入场 + ' : ''}定格)`);
}
warnings.forEach((w) => console.error('⚠ ' + w));
if (warnings.length) console.error(`共 ${warnings.length} 个布局警告——逐一确认是入场路径还是真溢出`);
await browser.close();

// ---------- 每卡分段:入场帧序列(30fps) + 定格推镜,人声从入场结束后开始 ----------
const segs = [];
for (let i = 0; i < shots.length; i++) {
  const s = shots[i];
  const audio = path.join(TTS, `${s.id}.mp3`);
  if (!fs.existsSync(audio)) { console.error(`缺配音 ${audio},先跑 tts.mjs`); process.exit(1); }
  const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio], { encoding: 'utf8' }).trim());
  const seg = path.join(OUT_DIR, `cseg-${String(i).padStart(2, '0')}.mp4`);

  if (ANIMATE) {
    const holdSec = Math.max(0.5, dur + 0.8 - ENTRANCE);
    const frameDir = path.join(OUT, `frames-${s.id}`);
    const eSeg = seg.replace('.mp4', '.e.mp4');
    const hSeg = seg.replace('.mp4', '.h.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frameDir, 'e%03d.png'),
      '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', eSeg], { stdio: 'inherit' });
    const frames = Math.round(holdSec * FPS);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT, `slide-${String(i).padStart(2, '0')}.png`),
      '-filter_complex', `[0:v]zoompan=z='min(zoom+0.00045,1.10)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${FPS},format=yuv420p[v]`,
      '-map', '[v]', '-t', String(holdSec), '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', hSeg], { stdio: 'inherit' });
    // 合并入场+定格,人声从入场动画结束后起播
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', eSeg, '-i', hSeg, '-i', audio,
      '-filter_complex', `[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a]adelay=${Math.round(ENTRANCE * 1000)}:all=1,apad[a]`,
      '-map', '[v]', '-map', '[a]', '-t', String(ENTRANCE + holdSec),
      '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg], { stdio: 'inherit' });
    fs.rmSync(frameDir, { recursive: true, force: true });
    fs.unlinkSync(eSeg); fs.unlinkSync(hSeg);
    segs.push({ seg, dur: ENTRANCE + holdSec });
  } else {
    const frames = Math.round((dur + 0.8) * FPS);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT, `slide-${String(i).padStart(2, '0')}.png`), '-i', audio,
      '-filter_complex', `[0:v]scale=${width}:${height},zoompan=z='min(zoom+0.00045,1.10)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${FPS},format=yuv420p[v];[1:a]adelay=250:all=1[a]`,
      '-map', '[v]', '-map', '[a]', '-t', String(dur + 0.8),
      '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg], { stdio: 'inherit' });
    segs.push({ seg, dur: dur + 0.8 });
  }
  console.log(`cseg-${String(i).padStart(2, '0')} ✓ ${segs[segs.length - 1].dur.toFixed(1)}s (${s.id})`);
}

// ---------- 拼接:xfade 交叉溶解(HF 规则:禁跳切) ----------
const final = path.join(OUT_DIR, 'final-cards.mp4');
if (segs.length === 1 || XFADE <= 0) {
  const list = path.join(OUT_DIR, 'cards-concat.txt');
  fs.writeFileSync(list, segs.map((s) => `file '${s.seg.replace(/\\/g, '/')}'`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', final], { stdio: 'inherit' });
} else {
  // 视频 xfade + 音频 acrossfade,逐级串联;offset 逐级累减(每次转场吃掉 d 秒)
  const d = XFADE;
  const args = [];
  segs.forEach((s, i) => { args.push('-i', s.seg); });
  let filter = '', prev = '[0:v]', prevA = '[0:a]';
  let off = segs[0].dur - d;
  for (let i = 1; i < segs.length; i++) {
    const outV = i === segs.length - 1 ? '[vout]' : `[vx${i}]`;
    const outA = i === segs.length - 1 ? '[aout]' : `[ax${i}]`;
    filter += `${prev}[${i}:v]xfade=transition=fade:duration=${d}:offset=${off.toFixed(3)}${i === segs.length - 1 ? ',format=yuv420p' : ''}${outV};`;
    filter += `${prevA}[${i}:a]acrossfade=d=${d}${outA};`;
    prev = outV; prevA = outA;
    if (i < segs.length - 1) off += segs[i].dur - d;
  }
  const fc = path.join(OUT_DIR, 'xfade.txt');
  fs.writeFileSync(fc, filter);
  execFileSync('ffmpeg', [...args,
    '-filter_complex_script', fc, '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', final], { stdio: 'inherit' });
  fs.unlinkSync(fc);
}
const size = (fs.statSync(final).size / 1048576).toFixed(1);
const total = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', final], { encoding: 'utf8' }).trim());
console.log(`成片完成 → ${final} (${size}MB, ${total.toFixed(1)}s, ${segs.length} 段, 转场=${XFADE}s, 动画=${ANIMATE})`);
