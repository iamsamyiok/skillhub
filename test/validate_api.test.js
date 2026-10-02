#!/usr/bin/env node
'use strict';
// 验证免费 API 栏目：条目 frontmatter、正文结构、meta.json 同步、静态资源接线
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { allApiIds, apiDetail, parseFrontmatter } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const APIS_DIR = path.join(ROOT, 'apis');
const META_PATH = path.join(ROOT, 'data', 'meta.json');
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const FT_ENUM = ['永久', '需注册', '限定额度', '混合'];

console.log('=== 免费API栏目验证 ===\n');

const ids = allApiIds();
assert(ids.length >= 12, `条目数量应不少于 12，当前 ${ids.length}`);
console.log(`[PASS] 条目数量 = ${ids.length}`);

const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
assert(meta.apis, 'meta.json 缺少 apis 段');

for (const id of ids) {
  assert(ID_RE.test(id), `id 非法: ${id}`);
  const md = fs.readFileSync(path.join(APIS_DIR, id, 'README.md'), 'utf8');
  const fm = parseFrontmatter(md);

  for (const k of ['name', 'version', 'category', 'tags', 'description', 'repo', 'stars', 'pushedAt', 'verifiedAt', 'freeType']) {
    assert(fm[k], `${id}: frontmatter 缺少 ${k}`);
  }
  assert(fm.name === id, `${id}: name 应等于目录名`);
  assert(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(fm.repo), `${id}: repo 非法 ${fm.repo}`);
  assert(Number(fm.stars) >= 0, `${id}: stars 非法`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(fm.pushedAt), `${id}: pushedAt 应为 YYYY-MM-DD`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(fm.verifiedAt), `${id}: verifiedAt 应为 YYYY-MM-DD`);
  assert(FT_ENUM.includes(fm.freeType), `${id}: freeType 非法 ${fm.freeType}`);
  assert(fm.description.length <= 200, `${id}: description 过长(${fm.description.length})`);
  assert(!fm.description.includes('\n'), `${id}: description 必须单行`);

  // 正文结构：引用头 + 图例 + 表单章节（大仓含分类导航）
  assert(md.includes('> 引用仓库：'), `${id}: 缺少引用头`);
  assert(md.includes('免费类型图例'), `${id}: 缺少免费类型图例`);
  assert(/## (分类导航|.{2,12}表单)/.test(md), `${id}: 缺少表单章节`);
  assert(md.includes('| API | 分类 | 描述 | 免费类型 | 链接 |'), `${id}: 表头应为五列`);
  // 表内免费类型必须是合法枚举
  const rows = md.split('\n').filter((l) => l.startsWith('| ') && !l.includes('---') && !l.includes('| API |'));
  for (const r of rows) {
    const cells = r.split('|').map((c) => c.trim());
    const ft = cells[4];
    if (ft) assert(FT_ENUM.some((e) => ft.startsWith(e)), `${id}: 表内免费类型非法 "${ft}"`);
  }

  // 限定额度主基调的条目，正文应出现额度说明（括号）
  if (fm.freeType === '限定额度') {
    assert(/额度|限额|次|点数|\(/.test(md), `${id}: 限定额度条目应有额度说明`);
  }

  // meta.json 同步
  const m = meta.apis[id];
  assert(m, `meta.json 缺少 ${id}`);
  assert(m.repo === fm.repo, `${id}: meta.repo 与 frontmatter 不一致`);
  assert(String(m.stars) === String(fm.stars) || m.stars === Number(fm.stars), `${id}: meta.stars 不一致`);
  assert(m.freeType === fm.freeType, `${id}: meta.freeType 不一致`);
  assert(m.category === fm.category, `${id}: meta.category 不一致`);

  // server 详情
  const d = apiDetail(id);
  assert(d && d.readme.length > 300, `${id}: apiDetail 异常`);
  assert(d.freeType === fm.freeType, `${id}: apiDetail.freeType 异常`);
}
console.log(`[PASS] ${ids.length} 个条目 frontmatter/正文/meta.json/apiDetail 全部合法`);

// 分类与免费类型覆盖
const cats = [...new Set(Object.values(meta.apis).map((s) => s.category))];
assert(cats.length >= 3, `分类应不少于 3，当前 ${cats.length}`);
console.log(`[PASS] 分类 = ${cats.join(' / ')}`);

// 静态资源接线
for (const f of ['public/apis.html', 'public/app-apis.js']) {
  assert(fs.existsSync(path.join(ROOT, f)), `${f} 不存在`);
}
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
assert(serverSrc.includes("'/apis': 'apis.html'"), 'server.js PAGES 未注册 /apis');
assert(/route\('GET', \/\^\\\/api\\\/apis/.test(serverSrc), 'server.js 缺少 /api/apis 路由');
assert(/route\('POST', \/\^\\\/api\\\/apis/.test(serverSrc), 'server.js 缺少 POST /api/apis 路由');
const expSrc = fs.readFileSync(path.join(ROOT, 'export-static.js'), 'utf8');
assert(expSrc.includes("'apis.html'"), 'export-static.js 未处理 apis.html');
assert(expSrc.includes('apis.json'), 'export-static.js 未导出 apis.json');
console.log('[PASS] server.js / export-static.js / 页面资源接线完整');

// 导航入口
const idx = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
assert(idx.includes('href="/apis"'), 'index.html 缺少免费APIs导航');
console.log('[PASS] 全站导航含免费APIs入口');

console.log('\n=== 全部通过 ===');
