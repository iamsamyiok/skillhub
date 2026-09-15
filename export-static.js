#!/usr/bin/env node
// 静态导出：把 SkillHub 导出为 GitHub Pages 可直接服务的 docs/ 站点（含预打包下载）
// 用法: node export-static.js [--site-url https://user.github.io/skillhub] [--repo-url https://github.com/user/skillhub]
'use strict';
const fs = require('fs');
const path = require('path');
const { skillDetail, allSkillIds, zipOf, tarGz, parseFrontmatter } = require('./server.js');

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SITE_URL = (argOf('--site-url', '')).replace(/\/$/, '');
const REPO_URL = (argOf('--repo-url', '')).replace(/\/$/, '');
const ROOT = __dirname;
const OUT = path.join(ROOT, 'docs');

fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ['data', 'skills-md', 'downloads', 'css']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

/* 资源直接复制 */
for (const f of ['style.css', 'app.js', 'setup.js']) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(OUT, f));

/* flags：静态模式 */
fs.writeFileSync(path.join(OUT, 'flags.js'), "window.SKILLHUB_STATIC = true;\nwindow.SKILLHUB_BASE = './';\n");

/* HTML 路径重写（绝对 → 相对；admin → 仓库链接） */
function rewrite(html) {
  return html
    .replace(/href="\/style\.css"/g, 'href="./style.css"')
    .replace(/src="\/(flags|app|setup)\.js"/g, 'src="./$1.js"')
    .replace(/href="\//g, 'href="./')
    .replace(/href="\.\/"/g, 'href="./index.html"')
    .replace(/href="\.\/skill\?id=/g, 'href="./skill.html?id=')
    .replace(/href="\.\/ai"/g, 'href="./ai.html"')
    .replace(/href="\.\/setup"/g, 'href="./setup.html"')
    .replace(/href="\.\/admin"/g, REPO_URL ? `href="${REPO_URL}#自托管"` : 'href="./index.html"')
    .replace(/href="\.\/llms\.txt"/g, 'href="./llms.txt"')
    .replace(/href="\.\/skills\.txt"/g, 'href="./skills.txt"')
    .replace(/curl \/skills\.txt/g, '下载本页同目录的 skills.txt');
}

/* 数据：catalog */
const items = [];
for (const id of allSkillIds()) {
  const s = skillDetail(id);
  items.push({ id: s.id, name: s.name, description: s.description, version: s.version, category: s.category, tags: s.tags, downloads: s.downloads, updatedAt: s.updatedAt, files: s.files });
}
const categories = [...new Set(items.map((s) => s.category))].sort();
fs.writeFileSync(path.join(OUT, 'data', 'skills.json'), JSON.stringify({ total: items.length, categories, items }, null, 2));

/* 每个 skill：md 原文 + 预打包 zip/tgz */
for (const s of items.map((x) => skillDetail(x.id))) {
  fs.writeFileSync(path.join(OUT, 'skills-md', `${s.id}.md`), s.body);
  fs.writeFileSync(path.join(OUT, 'downloads', `${s.id}.zip`), zipOf(s.files.map((f) => ({ name: `${s.id}/${f.path}`, data: fs.readFileSync(path.join(ROOT, 'skills', s.id, f.path)) }))));
  fs.writeFileSync(path.join(OUT, 'downloads', `${s.id}.tar.gz`), tarGz(s.files.map((f) => ({ id: s.id, path: f.path }))));
}

/* 机器索引（绝对地址优先，便于 Agent 直接取用） */
const base = SITE_URL || '.';
{
  const lines = ['# SkillHub', '', `> 面向人类与 AI Agent 的技能（skill）下载站（GitHub Pages 静态镜像）。下载 ${base}/downloads/{id}.zip（Windows）或 {id}.tar.gz；SKILL.md 原文 ${base}/skills-md/{id}.md。完整 API 与管理功能请自托管本仓库。`, ''];
  if (items.length) {
    lines.push('## Skills', '');
    for (const s of items) lines.push(`- [${s.name}](${base}/skills-md/${s.id}.md): ${s.description.slice(0, 160)}\n  - 下载: ${base}/downloads/${s.id}.zip`);
    lines.push('');
  }
  if (REPO_URL) lines.push('## Source', '', `- 仓库（自托管 node server.js）: ${REPO_URL}`, '');
  fs.writeFileSync(path.join(OUT, 'llms.txt'), lines.join('\n'));
}
{
  const lines = ['# name | category | version | description | zip | tar.gz', ''];
  for (const s of items) lines.push(`${s.name} | ${s.category} | ${s.version} | ${s.description.replace(/\|/g, '，')} | ${base}/downloads/${s.id}.zip | ${base}/downloads/${s.id}.tar.gz`);
  fs.writeFileSync(path.join(OUT, 'skills.txt'), lines.join('\n') + '\n');
}

/* 页面 */
for (const f of ['index.html', 'skill.html', 'ai.html', 'setup.html']) {
  fs.writeFileSync(path.join(OUT, f), rewrite(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')));
}

/* Agent 首屏内联：抓首页 HTML 的 Agent 不执行 JS，也能在第一时间拿到全部清单。
   两层：body 开头 JSON 数据块（程序解析）+ hero 后纯文本清单（markdown 化抓取可读）。 */
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const agentItems = items.map((s) => ({
  id: s.id, name: s.name, description: s.description, version: s.version,
  category: s.category, tags: s.tags, downloads: s.downloads, updatedAt: s.updatedAt,
  md: `${base}/skills-md/${s.id}.md`, zip: `${base}/downloads/${s.id}.zip`, tgz: `${base}/downloads/${s.id}.tar.gz`,
}));
const agentJson = JSON.stringify({ total: agentItems.length, categories, site: base || '.', skills: agentItems }).replace(/<\//g, '<\\/');
const agentPre = [
  `ALL SKILLS (${agentItems.length}) — 本清单静态内联于首页，无需 JS。`,
  `机器索引: ${base}/llms.txt · ${base}/skills.json · ${base}/skills.txt`,
  `下载: ${base}/downloads/{id}.zip · SKILL.md 原文: ${base}/skills-md/{id}.md`,
  '',
  ...agentItems.map((s) => `- ${s.id} | ${s.category} | v${s.version} | ${String(s.description || '').replace(/\s+/g, ' ').slice(0, 150)}\n  md: ${s.md} · zip: ${s.zip}`),
].join('\n');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
fs.writeFileSync(path.join(OUT, 'index.html'), rewrite(indexHtml)
  /* hero 统计内联为构建期真实值（JS 会在运行时覆盖，占位符仅兜底） */
  .replace('— 个技能', `${agentItems.length} 个技能`)
  .replace('— 个分类', `${categories.length} 个分类`)
  .replace('<body>', `<body>\n<script type="application/json" id="skills-data">${agentJson}</script>`)
  /* Agent 清单对人类默认折叠（<details>）：机器照读 JSON 数据块，首屏保持干净 */
  .replace('<main class="wrap">', `<details class="agent-index"><summary class="wrap">Agent 完整技能清单（ALL SKILLS ${agentItems.length}）<code>skills.json</code><code>llms.txt</code></summary><div class="wrap"><pre>${esc(agentPre)}</pre></div></details>\n<main class="wrap">`));

/* AGENTS.md（Agent 框架自动发现）与根级 skills.json（便于发现的纯数据端点） */
fs.writeFileSync(path.join(OUT, 'AGENTS.md'), [
  '# SkillHub — Agent Guide', '',
  `- 完整技能清单（JSON）: ${base}/skills.json`,
  `- 完整技能清单（文本）: ${base}/llms.txt · ${base}/skills.txt`,
  `- 下载安装: ${base}/downloads/{id}.zip（解压到 ~/.claude/skills/ 或项目 .claude/skills/）`,
  `- SKILL.md 原文: ${base}/skills-md/{id}.md`,
  '', `共 ${agentItems.length} 个 skill: ${agentItems.map((s) => s.id).join(', ')}`, '',
].join('\n'));
fs.writeFileSync(path.join(OUT, 'skills.json'), JSON.stringify({ total: agentItems.length, categories, site: base || '.', skills: agentItems }, null, 2));

/* robots */
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n# Machine-readable skill index: /llms.txt /skills.json /skills.txt /AGENTS.md\n');
/* 静态站说明 */
fs.writeFileSync(path.join(OUT, 'README-static.md'), '# 本目录为 GitHub Pages 静态站点\n由 `node export-static.js` 生成，勿手工编辑。数据来源：仓库根 `skills/` 与 `data/meta.json`。\n');

console.log(`静态导出完成 → ${OUT}（${items.length} 个技能，${SITE_URL || '相对路径模式'}）`);
