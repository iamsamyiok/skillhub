#!/usr/bin/env node
// lint.mjs — storyboard 静态门禁（借鉴 hyperframes：每条历史坑一条规则，错误阻断、警告提示）
// 用法: node lint.mjs <storyboard.json> [--design assets/design.json] [--live]
// 退出码: 0 通过 / 1 存在 error
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argOf = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const boardPath = process.argv[2];
if (!boardPath) { console.error('用法: node lint.mjs <storyboard.json> [--design assets/design.json] [--live]'); process.exit(2); }
const root = path.dirname(path.resolve(boardPath));
const LIVE = process.argv.includes('--live');
const designPath = argOf('--design', path.join(SKILL_ROOT, 'assets', 'design.json'));

const errors = [];
const warns = [];
const err = (code, msg) => errors.push(`${code} ${msg}`);
const warn = (code, msg) => warns.push(`${code} ${msg}`);

const ACTION_TYPES = new Set(['goto', 'click', 'fill', 'press', 'wait', 'direct', 'dragCanvas', 'dragSlider', 'pickInstance']);
const NEEDS_SEL = new Set(['click', 'fill', 'dragSlider']);
const FPS_WHITELIST = new Set([6, 12, 15, 24, 30]);

let board;
try {
  board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
} catch (e) {
  console.error(`E000 storyboard 解析失败: ${e.message}`);
  process.exit(1);
}

// overlay 模板解析顺序：相对 storyboard → 相对 skill assets/templates
function resolveTemplate(tpl) {
  const cands = [path.resolve(root, tpl), path.join(SKILL_ROOT, 'assets', 'templates', tpl)];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

// ---- meta ----
if (!board.meta) err('E001', '缺 meta 段');
if (board.meta) {
  const [w, h] = board.meta.resolution || [];
  if (!w || !h) err('E002', 'meta.resolution 缺失或非法（应为 [宽, 高]）');
  if (!board.meta.fps) err('E003', 'meta.fps 缺失');
  else if (!FPS_WHITELIST.has(board.meta.fps)) warn('W101', `meta.fps=${board.meta.fps} 不在 6/12/15/24/30 内，需与录制帧率一致`);
  if (!board.meta.title) warn('W102', 'meta.title 缺失，成片无标题元数据');
  const card = board.meta.endCard;
  if (card && (!Array.isArray(card) || card.length > 2)) err('E004', 'meta.endCard 应为最多 2 行的字符串数组');
  if (board.meta.bgm) {
    if (!fs.existsSync(path.resolve(root, board.meta.bgm))) err('E005', `meta.bgm 文件不存在: ${board.meta.bgm}`);
  }
}

// ---- design 令牌 ----
if (!fs.existsSync(designPath)) warn('W103', `设计令牌缺失(${designPath})，compose 将退回内建默认值`);
else { try { JSON.parse(fs.readFileSync(designPath, 'utf8')); } catch (e) { err('E006', `design.json 解析失败: ${e.message}`); } }

// ---- shots ----
const shots = board.shots || [];
if (!shots.length) err('E010', 'shots 为空');
const seen = new Set();
shots.forEach((s, ai) => {
  const tag = s.id || `shots[${ai}]`;
  if (!s.id) err('E011', `${tag}: 缺 id`);
  else if (seen.has(s.id)) err('E012', `${s.id}: id 重复`);
  else if (!/^[a-zA-Z0-9_-]{1,32}$/.test(s.id)) err('E013', `${s.id}: id 只允许字母数字下划线连字符(<=32)`);
  seen.add(s.id);

  const narr = String(s.narration || '').trim();
  if (!narr) warn('W110', `${tag}: narration 为空，该镜将无配音`);
  else {
    if (narr.length > 300) err('E014', `${tag}: narration ${narr.length} 字 > 300`);
    // 朗读时长估算(≈4.5字/秒) vs minSec —— 解说被掐断的预防针
    const est = narr.length / 4.5 + 1.0;
    const min = s.minSec || 8;
    if (est > min + 2) warn('W111', `${tag}: 估算朗读 ${est.toFixed(1)}s > minSec ${min}s + 2s，末句可能被定格截断`);
    for (const sent of narr.split(/(?<=[。!?!?])/)) {
      if (sent.trim().length > 120) err('E015', `${tag}: 单句 ${sent.trim().length} 字 > 120（TTS 按句生成，长句有截断风险，请拆句）`);
    }
  }
  if (s.minSec != null && (s.minSec < 1 || s.minSec > 60)) err('E016', `${tag}: minSec=${s.minSec} 应在 1~60`);

  const acts = s.actions || [];
  if (!acts.length) err('E017', `${tag}: actions 为空`);
  let hasGoto = false;
  acts.forEach((a, ai2) => {
    const at = `${tag}.actions[${ai2}]`;
    if (!ACTION_TYPES.has(a.type)) err('E018', `${at}: 未知动作类型 ${a.type}`);
    if (a.type === 'goto') {
      hasGoto = true;
      if (!/^https?:\/\//.test(a.url || '')) err('E019', `${at}: url 非法(${a.url})`);
    }
    if (NEEDS_SEL.has(a.type) && !a.sel) err('E020', `${at}: ${a.type} 缺 sel`);
    if (a.type === 'fill' && !a.text) err('E021', `${at}: fill 缺 text`);
    if (a.type === 'pickInstance' && !a.assetId) err('E022', `${at}: pickInstance 缺 assetId`);
    if (a.type === 'wait' && !(a.ms > 0)) err('E023', `${at}: wait 缺 ms`);
  });
  if (!hasGoto) warn('W112', `${tag}: 无 goto，将依赖上一镜残留页面（首镜必须是 goto）`);
  if (s.timeoutMs && s.timeoutMs < acts.reduce((acc, a) => acc + (a.ms || 0) + 3000, 8000)) warn('W113', `${tag}: timeoutMs 疑似小于动作总时长，录制可能中途超时`);

  for (const o of s.overlays || []) {
    const ot = `${tag}.overlay`;
    if (!o.template) { err('E030', `${ot}: 缺 template`); continue; }
    const resolved = resolveTemplate(o.template);
    if (!resolved) err('E033', `${ot}: 模板未找到（试过 ${o.template} 与 skill assets/templates/）`);
    if (!(o.start >= 0)) err('E031', `${ot}: start 缺失或负数`);
    if (!(o.duration > 0)) err('E032', `${ot}: duration 缺失或非正`);
    if (o.start >= 0 && o.duration > 0) {
      const upper = (s.minSec || 8) + 15;
      if (o.start + o.duration > upper) warn('W114', `${ot}: 结束于 ${(o.start + o.duration).toFixed(1)}s，超过该镜常规上限 ${upper}s（定格补齐可能截断出场）`);
    }
  }
});

// ---- live 抽查（浏览器可达性 + selector 冒烟，依赖目标站点，默认关闭）----
if (LIVE) {
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { ({ chromium } = require('/usr/local/lib/node_modules/playwright')); }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const urls = [...new Set(shots.flatMap((s) => (s.actions || []).filter((a) => a.type === 'goto').map((a) => a.url)))];
  for (const u of urls) {
    try {
      await page.goto(u, { waitUntil: 'load', timeout: 60000 });
      const sels = shots.flatMap((s) => (s.actions || []).filter((a) => a.url === u && NEEDS_SEL.has(a.type)).map((a) => a.sel));
      for (const sel of sels) {
        const ok = await page.locator(sel).first().waitFor({ state: 'attached', timeout: 8000 }).then(() => true, () => false);
        if (!ok) err('E040', `${u}: selector 未命中 ${sel}`);
      }
      console.log(`[live] ${u} OK(${sels.length} selector)`);
    } catch (e) {
      err('E041', `${u}: 打开失败 ${e.message.split('\n')[0]}`);
    }
  }
  await browser.close();
}

console.log(`\n=== lint ${board.meta?.title || path.basename(boardPath)} ===`);
for (const e of errors) console.error(`ERROR ${e}`);
for (const w of warns) console.warn(`WARN  ${w}`);
console.log(`${shots.length} shots, ${errors.length} errors, ${warns.length} warnings`);
process.exit(errors.length ? 1 : 0);
