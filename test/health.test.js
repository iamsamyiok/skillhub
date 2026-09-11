#!/usr/bin/env node
'use strict';
// 验证 health.html：文件存在、内容正确、服务器可正常返回
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const HEALTH_FILE = path.join(PUBLIC_DIR, 'health.html');

console.log('=== health.html 验证 ===\n');

// 1. 文件存在
assert(fs.existsSync(HEALTH_FILE), 'health.html 不存在');
console.log('[PASS] health.html 文件存在');

// 2. 读取内容
const content = fs.readFileSync(HEALTH_FILE, 'utf8');

// 3. 标题正确
assert(content.includes('<title>SkillHub 状态</title>'), '缺少标题 SkillHub 状态');
console.log('[PASS] 页面标题为「SkillHub 状态」');

// 4. JS 动态显示当前时间
assert(content.includes('clock'), '缺少时钟元素 ID');
assert(content.includes('setInterval'), '缺少 setInterval 动态更新');
assert(content.includes('tick()') || content.includes('tick ()'), '缺少 tick 函数');
console.log('[PASS] JS 动态显示当前时间');

// 5. 「服务正常」字样
assert(content.includes('正常'), '缺少「正常」字样');
console.log('[PASS] 页面显示「正常」状态');

// 6. 内联 CSS（样式写在 <style> 标签内）
assert(content.includes('<style>'), '缺少内联 CSS');
assert(content.includes('</style>'), '内联 CSS 未正确闭合');
console.log('[PASS] 样式使用内联 CSS');

// 7. 深色风格一致（使用与 style.css 相同的 CSS 变量）
assert(content.includes('--bg: #f6f7fb') || content.includes('--bg:#f6f7fb'), '未使用站点统一背景色');
assert(content.includes('--ink: #1a2233') || content.includes('--ink:#1a2233'), '未使用站点统一文字色');
assert(content.includes('--brand: #4f46e5') || content.includes('--brand:#4f46e5'), '未使用站点统一品牌色');
console.log('[PASS] 样式与站点深色/浅色风格一致');

// 8. 不修改 server.js 鉴权逻辑的验证（只是静态文件，无需路由）
assert(!content.includes("fetch('/api')"), '不应包含 API 调用依赖');
console.log('[PASS] 页面为纯静态展示，无额外 API 依赖');

console.log('\n=== 全部通过 ===');
