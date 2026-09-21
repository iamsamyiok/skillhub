#!/usr/bin/env node
'use strict';

// gen-storyboard.mjs — 一句话主题 → LLM 起草分镜表(MoneyPrinterTurbo 式一键成稿)
// 产物是「草稿」:narration 的口径、事实、锐评必须由 Agent/人工复核后再投产
//
// 用法:
//   node gen-storyboard.mjs --topic "安利 SkillHub 技能库" --shots 7 --out storyboard.draft.json \
//        --facts "31个技能;14个分类;网址 iamsamyiok.github.io/skillhub"
//
// 环境变量(密钥只走环境变量,严禁写死):
//   LLM_API_KEY   (必填;与 AGNES_API_KEY 兼容——两个名字都认)
//   LLM_BASE_URL  默认 https://api.agnes-ai.cn/v1
//   LLM_MODEL     默认 agnes-2.5-flash
//   CARDS_DEFAULT 默认 on(生成卡片模式字段;off 则只出 narration+minSec 的录屏模式骨架)

import fs from 'fs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const topic = arg('topic');
if (!topic) { console.error('用法: node gen-storyboard.mjs --topic "主题" [--shots 7] [--out storyboard.draft.json] [--facts "已核实的事实,分号分隔"]'); process.exit(1); }
const nShots = parseInt(arg('shots', '7'), 10);
const out = arg('out', 'storyboard.draft.json');
const facts = arg('facts', '');
const wantCards = arg('cards', 'on') !== 'off';

const KEY = process.env.LLM_API_KEY || process.env.AGNES_API_KEY;
if (!KEY) { console.error('缺少 LLM_API_KEY(或 AGNES_API_KEY)环境变量'); process.exit(1); }
const BASE = (process.env.LLM_BASE_URL || 'https://api.agnes-ai.cn/v1').replace(/\/$/, '');
const MODEL = process.env.LLM_MODEL || 'agnes-2.5-flash';

const cardsHint = wantCards ? `
每个分镜还要带 card 对象(卡片模式视觉字段):
"card": { "kicker":"左上角小标(6字内)", "title":"大标题(12字内,可含 SkillHub/AI 会被自动高亮)", "sub":"副标题(20字内)", "hook":"金句条(20字内,要有梗)", "note":"(仅最后一个分镜)补充行", "brands":["可选,等宽字体徽章词,3~5个"] }` : '';

const prompt = `你是爆款科技短视频编导。为主题「${topic}」写一个 ${nShots} 个分镜的口播脚本。
${facts ? `以下事实必须严格采用,不得编造:${facts}\n` : ''}
结构要求:第1镜是钩子(用数字/悬念冷开场,禁止"大家好");中间分镜每镜只讲一个点;最后一镜要包含"本视频由 AI 生成"的声明并引导三连。
每镜 narration 40~110 字,口语化短句,像人说话;相邻镜之间不重复上镜结尾。
输出严格的 JSON(不要 markdown 代码块,不要解释),结构:
{"meta": {"title": "视频标题(30字内)"}, "shots": [
  {"id": "00", "title": "镜名(4字内)", "minSec": 8, "narration": "口播稿"${cardsHint ? ',' + cardsHint.slice(1) : ''}
]}
保留 id 为两位数字符串;minSec 按 narration 字数/5 估算。`;

console.log(`请求 ${MODEL} 起草分镜表…`);
const res = await fetch(`${BASE}/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: MODEL, temperature: 0.7, max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  }),
});
if (!res.ok) { console.error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1); }
const data = await res.json();
let text = data.choices?.[0]?.message?.content ?? '';
text = text.replace(/```json|```/g, '').trim();
const m = text.match(/\{[\s\S]*\}/);
if (!m) { console.error('响应中没找到 JSON:', text.slice(0, 200)); process.exit(1); }

let board;
try { board = JSON.parse(m[0]); } catch (e) { console.error('JSON 解析失败:', e.message, '\n原文:', m[0].slice(0, 300)); process.exit(1); }
if (!Array.isArray(board.shots) || board.shots.length === 0) { console.error('响应缺少 shots 数组'); process.exit(1); }

// 补齐缺省字段
board.shots.forEach((s, i) => {
  s.id = String(s.id ?? i).padStart(2, '0');
  s.minSec = s.minSec ?? Math.max(6, Math.round((s.narration || '').length / 5));
  if (wantCards && !s.card) s.card = { kicker: s.title || `P${i + 1}`, title: (s.narration || '').slice(0, 12), sub: '', hook: '' };
});
if (wantCards && !board.meta?.cards) board.meta.cards = { accent: '#bc8cff', accent2: '#f78166', aiBadge: true };

fs.writeFileSync(out, JSON.stringify(board, null, 2));
console.log(`草稿已写入 ${out}(${board.shots.length} 镜)`);
console.log('⚠ 草稿仅是起点:narration 的事实与口径、card 文案必须逐镜复核后再投产(自由发挥处最容易编造)');
