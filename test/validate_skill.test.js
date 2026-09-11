#!/usr/bin/env node
'use strict';
// 验证 book-to-skill v1.1.0 改动：文件存在、校验脚本通过、模板完整、meta.json 同步
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'book-to-skill');
const SCRIPT_PATH = path.join(SKILL_DIR, 'scripts', 'validate_skill.py');
const TEMPLATE_PATH = path.join(SKILL_DIR, 'templates', 'SKILL.template.md');
const META_PATH = path.join(ROOT, 'data', 'meta.json');

console.log('=== book-to-skill v1.1.0 验证 ===\n');

// 1. validate_skill.py 存在
assert(fs.existsSync(SCRIPT_PATH), 'validate_skill.py 不存在');
console.log('[PASS] validate_skill.py 存在');

// 2. SKILL.template.md 存在
assert(fs.existsSync(TEMPLATE_PATH), 'SKILL.template.md 不存在');
console.log('[PASS] SKILL.template.md 存在');

// 3. validate_skill.py 对 book-to-skill 目录校验通过
const result = execSync(`python3 "${SCRIPT_PATH}" "${SKILL_DIR}"`, { encoding: 'utf8' }).trim();
assert(result === 'OK', `校验脚本输出不符合预期: ${result}`);
console.log('[PASS] validate_skill.py 校验通过（输出 OK）');

// 4. SKILL.md version 为 1.1.0
const skillMd = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
assert(skillMd.includes('version: 1.1.0'), 'SKILL.md version 不是 1.1.0');
console.log('[PASS] SKILL.md version = 1.1.0');

// 5. SKILL.md 包含 category 和 tags 必填字段
assert(/category:\s*.+/m.test(skillMd), 'SKILL.md 缺少 category 字段');
assert(/tags:\s*\[/m.test(skillMd), 'SKILL.md 缺少 tags 字段');
console.log('[PASS] SKILL.md 含 category 和 tags 字段');

// 6. SKILL.md 包含工作流相关步骤（第6步校验说明）
assert(skillMd.includes('validate_skill.py'), 'SKILL.md 未引用 validate_skill.py');
assert(skillMd.includes('第 6 步'), 'SKILL.md 未新增第 6 步校验流程');
console.log('[PASS] SKILL.md 包含 validate_skill.py 引用与第 6 步说明');

// 7. 模板包含 frontmatter 占位符与各章节骨架
const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
for (const placeholder of ['name:', 'version:', 'description:', 'category:', 'tags:']) {
  assert(template.includes(placeholder), `模板缺少 frontmatter 占位符: ${placeholder}`);
}
assert(template.includes('工作流'), '模板缺少工作流章节');
assert(template.includes('质量检查清单'), '模板缺少质量检查清单');
console.log('[PASS] SKILL.template.md 包含完整骨架与 frontmatter 占位符');

// 8. meta.json 中 book-to-skill version 为 1.1.0
const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
assert(meta.skills['book-to-skill'].version === '1.1.0', 'meta.json 中 book-to-skill version 不是 1.1.0');
console.log('[PASS] data/meta.json 中 book-to-skill version = 1.1.0');

// 9. validate_skill.py 对无效 SKILL.md 应失败（回归测试）
const tmpBad = path.join('/tmp', 'book-to-skill-bad-' + Date.now());
fs.mkdirSync(tmpBad, { recursive: true });
fs.writeFileSync(path.join(tmpBad, 'SKILL.md'), '---\nname: bad\n---\nno body here\n');
try {
  execSync(`python3 "${SCRIPT_PATH}" "${tmpBad}"`, { encoding: 'utf8', stdio: 'pipe' });
  assert(false, '对无效 SKILL.md 应 exit 1');
} catch (e) {
  assert(e.status !== 0, '对无效 SKILL.md 应 exit 1');
  console.log('[PASS] validate_skill.py 对无效输入正确 exit 1');
} finally {
  fs.rmSync(tmpBad, { recursive: true });
}

console.log('\n=== 全部通过 ===');
