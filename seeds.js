#!/usr/bin/env node
// 一次性种子导入：把工作区现有 skill 复制进 SkillHub 数据目录
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SKILLS_DIR = path.join(ROOT, 'skills');
const META_FILE = path.join(ROOT, 'data', 'meta.json');

const SEEDS = [
  { from: '/workspace/.opencode/skills/text-to-diagram', category: '开发工具', tags: ['图表', '可视化', 'cli'] },
  { from: '/workspace/.opencode/skills/fe-visual-review', category: '前端开发', tags: ['识图', 'QA', '视觉审查'] },
  { from: '/workspace/.opencode/skills/oss-scout', category: '研究分析', tags: ['开源选型', 'github'] },
  { from: '/workspace/.agents/skills/use-tinyfish', category: '网络与搜索', tags: ['搜索', '浏览器', '抓取'] },
];

fs.mkdirSync(SKILLS_DIR, { recursive: true });
const meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, 'utf8')) : { skills: {} };
meta.skills = meta.skills || {};

for (const seed of SEEDS) {
  const mdPath = path.join(seed.from, 'SKILL.md');
  if (!fs.existsSync(mdPath)) { console.error('跳过（无 SKILL.md）:', seed.from); continue; }
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(mdPath, 'utf8'));
  const name = fm && /name:\s*(\S+)/.exec(fm[1]) ? RegExp.$1 : path.basename(seed.from);
  const id = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const dest = path.join(SKILLS_DIR, id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(seed.from, dest, { recursive: true });
  meta.skills[id] = { category: seed.category, tags: seed.tags, downloads: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  console.log(`导入 ${id} ← ${seed.from}`);
}
fs.mkdirSync(path.dirname(META_FILE), { recursive: true });
fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
console.log('种子导入完成');
