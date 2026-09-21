#!/usr/bin/env node
'use strict';

// cards.mjs — 卡片模式合成器:HTML 卡片 → Playwright 截图 → 推镜段 → 合成成片
// 适合「产品宣传/榜单盘点/知识解说」类视频:不需要录屏,一张卡片一个分镜
// 契约:env STORYBOARD/OUT_DIR;配音来自 tts.mjs 产物(OUT/tts/{id}.mp3)
// 产物:OUT/cards.html、OUT/cards/slide-XX.png、OUT/final-cards.mp4
//
// storyboard 约定(卡片模式用到的字段):
//   meta: { cards: { accent:"#bc8cff", accent2:"#f78166", aiBadge:true } }
//   shots[].card: { kicker, title, sub, hook, note?, brands?[] }
//   (title 中 SkillHub/AI 自动高亮 accent 色)
//
// 运行: NODE_PATH=<全局node_modules> node cards.mjs
//   (需要全局 @playwright/test 或 playwright + chromium;Windows 例:
//    NODE_PATH="C:\Users\<you>\AppData\Roaming\npm\node_modules")
//
// 实战经验(2026-09 两支成片验证):
//   - zoompan 慢推(每帧 +0.00045,上限 1.10)避免静态卡片感;30fps
//   - 音频 adelay 250ms 起,结尾 +0.8s 尾气;成片必须 -ar 44100 -ac 2(B站标准)+ faststart
//   - 每张卡做完先 vision/截图自查(文字截断/中文渲染),再进合成

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

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cfg = BOARD.meta?.cards ?? {};
const A = cfg.accent || '#bc8cff', A2 = cfg.accent2 || '#f78166';
const shots = (BOARD.shots || []).filter((s) => s.card);

if (shots.length === 0) { console.error('分镜表里没有任何 card 字段的分镜——卡片模式需要 shots[].card'); process.exit(1); }

const css = `
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;font-family:"Microsoft YaHei","PingFang SC",sans-serif}
.slide{width:1920px;height:1080px;background:#0d0a14;color:#e6edf3;position:relative;overflow:hidden;
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
`;

function slideHtml(s) {
  const title = esc(s.card.title).replace(/(SkillHub|AI)/g, `<span class="hl">$1</span>`);
  return `<section class="slide" id="s${s.id}">
    ${cfg.aiBadge === false ? '' : '<div class="ai-badge">AI 生成</div>'}
    <div class="kicker">${esc(s.card.kicker)}</div>
    <h1>${title}</h1>
    ${s.card.sub ? `<div class="sub">${esc(s.card.sub)}</div>` : ''}
    ${s.card.hook ? `<div class="hook">${esc(s.card.hook)}</div>` : ''}
    ${(s.card.brands || []).length ? `<div class="brands">${s.card.brands.map((b) => `<span class="brand">${esc(b)}</span>`).join('')}</div>` : ''}
    ${s.card.decl ? `<div class="decl">⚠ ${esc(s.card.decl)}</div>` : ''}
    ${s.card.note ? `<div class="note">${esc(s.card.note)}</div>` : ''}
  </section>`;
}

// ---------- 1. 渲染 HTML ----------
fs.mkdirSync(OUT, { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${shots.map(slideHtml).join('\n')}</body></html>`;
fs.writeFileSync(path.join(OUT_DIR, 'cards.html'), html);
console.log(`cards.html 已生成(${shots.length} 张卡片)`);

// ---------- 2. Playwright 截图 ----------
let chromium = null;
for (const m of ['@playwright/test', 'playwright']) {
  try { chromium = require(m).chromium; break; } catch { /* 下一个 */ }
}
if (!chromium) {
  console.error('找不到 playwright:用 NODE_PATH 指向全局 node_modules 后重试(NODE_PATH=$(npm root -g) node cards.mjs)');
  process.exit(1);
}
const width = BOARD.meta?.resolution?.[0] ?? 1920;
const height = BOARD.meta?.resolution?.[1] ?? 1080;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.goto('file://' + path.join(OUT_DIR, 'cards.html').replace(/\\/g, '/'));
await page.waitForTimeout(600);
for (let i = 0; i < shots.length; i++) {
  await page.locator(`#s${shots[i].id}`).screenshot({ path: path.join(OUT, `slide-${String(i).padStart(2, '0')}.png`) });
  console.log(`slide-${String(i).padStart(2, '0')} ✓ (${shots[i].id})`);
}
await browser.close();

// ---------- 3. 每卡一段:推镜 + 配音 ----------
const segs = [];
for (let i = 0; i < shots.length; i++) {
  const s = shots[i];
  const seg = path.join(OUT_DIR, `cseg-${String(i).padStart(2, '0')}.mp4`);
  const audio = path.join(TTS, `${s.id}.mp3`);
  if (!fs.existsSync(audio)) { console.error(`缺配音 ${audio},先跑 tts.mjs`); process.exit(1); }
  const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio], { encoding: 'utf8' }).trim());
  const total = dur + 0.8;
  const frames = Math.round(total * 30);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT, `slide-${String(i).padStart(2, '0')}.png`), '-i', audio,
    '-filter_complex',
    `[0:v]scale=${width}:${height},zoompan=z='min(zoom+0.00045,1.10)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=30,format=yuv420p[v];[1:a]adelay=250:all=1[a]`,
    '-map', '[v]', '-map', '[a]', '-t', String(total),
    '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg], { stdio: 'inherit' });
  segs.push(seg);
  console.log(`cseg-${String(i).padStart(2, '0')} ✓ ${total.toFixed(1)}s (${s.id})`);
}

// ---------- 4. 拼接成片(B站标准:44.1kHz 立体声 + faststart) ----------
const list = path.join(OUT_DIR, 'cards-concat.txt');
fs.writeFileSync(list, segs.map((s) => `file '${s.replace(/\\/g, '/')}'`).join('\n'));
const final = path.join(OUT_DIR, 'final-cards.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
  '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', final], { stdio: 'inherit' });
const size = (fs.statSync(final).size / 1048576).toFixed(1);
console.log(`成片完成 → ${final} (${size}MB, ${(fs.existsSync(final) ? '' : '')}${segs.length} 段)`);
