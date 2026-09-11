#!/usr/bin/env node
'use strict';
// 验证 health.html 存在且可被 serveStatic 正确提供
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const HEALTH = path.join(PUBLIC_DIR, 'health.html');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('FAIL: ' + msg); }
}

// 1. 文件存在
assert(fs.existsSync(HEALTH), 'health.html 应存在于 public/ 目录');

// 2. 是文件而非目录
assert(fs.statSync(HEALTH).isFile(), 'health.html 应为普通文件');

// 3. 内容为合法 HTML 片段
const content = fs.readFileSync(HEALTH, 'utf8');
assert(content.includes('<title>SkillHub 状态</title>'), '页面 title 应为「SkillHub 状态」');
assert(content.includes('服务正常'), '页面应显示「服务正常」字样');
assert(/setInterval|requestAnimationFrame/.test(content), '页面应用 JS 动态更新');
assert(content.includes('当前时间') || content.includes('时间'), '页面应显示当前时间');
assert(content.includes('style') || content.includes('<style'), '样式应内联 CSS');
assert(/background.*171a2e|background.*linear-gradient/.test(content), '背景色应与深色风格一致');

// 4. 不依赖外部样式表（自包含）
assert(!content.includes('href="/style.css"') && !content.includes('href="style.css"'),
  'health.html 不应引用外部 style.css，保持自包含');

// 5. 不引入任何 <script src 外部脚本
const scriptSrcMatches = content.match(/<script\s+src=["'][^"']+["']/g) || [];
assert(scriptSrcMatches.length === 0, 'health.html 不应引用任何外部 JS 脚本');

// 6. 模拟 server.js 的 serveStatic 路径校验逻辑
function mockServeStatic(file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return fs.readFileSync(full);
}
const served = mockServeStatic('health.html');
assert(served !== null, 'serveStatic 应能正确读取 health.html');
assert(Buffer.isBuffer(served) || typeof served === 'string', 'serveStatic 应返回内容而非 null');

// 7. 不修改 server.js、不新增路由（只是静态文件，自动可用）
const serverPath = path.join(ROOT, 'server.js');
const serverContent = fs.readFileSync(serverPath, 'utf8');
assert(!serverContent.includes('health'), 'server.js 不应包含 health 相关路由（静态文件自动服务）');

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
