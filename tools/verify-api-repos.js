#!/usr/bin/env node
'use strict';
// 核实免费 API 栏目引用的 GitHub 仓库：可达、未归档、近 12 个月有推送
// 用法: node tools/verify-api-repos.js [--max-days 365] [--warn-days 183] [--timeout 15]
// 退出码: 0 全部通过；1 存在失败项（CI/上架前门禁用）
const fs = require('fs');
const path = require('path');
const https = require('https');
const { allApiIds, apiDetail } = require('../server.js');

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const MAX_DAYS = argOf('--max-days', 365);
const WARN_DAYS = argOf('--warn-days', 183);
const TIMEOUT = argOf('--timeout', 15) * 1000;

function gh(pathname) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: 'api.github.com', path: pathname, method: 'GET', timeout: TIMEOUT, headers: { 'User-Agent': 'skillhub-verify', Accept: 'application/vnd.github+json' } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ code: res.statusCode, body: b }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ code: 0, body: '', err: 'timeout' }); });
    req.on('error', (e) => resolve({ code: 0, body: '', err: e.message }));
    req.end();
  });
}

function daysSince(iso) {
  return Math.floor((Date.now() - Date.parse(iso)) / 86400000);
}

(async () => {
  const ids = allApiIds();
  if (!ids.length) { console.error('apis/ 下没有条目'); process.exit(1); }

  let fail = 0;
  const rows = [];
  for (const id of ids) {
    const d = apiDetail(id);
    const full = d.repo.replace(/^https:\/\/github\.com\//, '');
    const api = await gh(`/repos/${full}`);
    if (api.code !== 200) {
      console.error(`FAIL ${id}: 仓库不可达 HTTP ${api.code} ${api.err || ''}`);
      fail++; rows.push({ id, status: 'FAIL' }); continue;
    }
    const j = JSON.parse(api.body);
    const readme = await gh(`/repos/${full}/readme`);
    const selfDeclared = /低活跃/.test(d.readme); // 条目已自声明低活跃
    const problems = [];
    if (j.archived) problems.push('已归档');
    const days = daysSince(j.pushed_at);
    if (days > MAX_DAYS && !selfDeclared) problems.push(`${days} 天未推送（> ${MAX_DAYS}）`);
    if (readme.code !== 200) problems.push(`README HTTP ${readme.code}`);
    if (problems.length) { console.error(`FAIL ${id} (${full}): ${problems.join('; ')}`); fail++; }
    else if (days > MAX_DAYS && selfDeclared) console.warn(`WARN ${id} (${full}): ${days} 天未推送，条目已标注低活跃（> ${MAX_DAYS}）`);
    else if (days > WARN_DAYS) console.warn(`WARN ${id} (${full}): ${days} 天未推送，建议标注/关注（> ${WARN_DAYS}）`);
    else console.log(`OK   ${id} (${full}) stars=${j.stargazers_count} pushed=${days}天前`);
    rows.push({ id, status: problems.length ? 'FAIL' : days > WARN_DAYS ? 'WARN' : 'OK', stars: j.stargazers_count, days, pushed_at: j.pushed_at });
  }

  console.log(`\n${ids.length - fail}/${ids.length} 通过`);
  if (process.env.VERIFY_JSON) fs.writeFileSync(process.env.VERIFY_JSON, JSON.stringify(rows, null, 2));
  process.exit(fail ? 1 : 0);
})();
