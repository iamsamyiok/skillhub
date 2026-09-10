/* 密钥/用户信息配置生成器：全部本地拼装，零网络上传 */
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* 技能 → 所需变量预设（label, key, placeholder, 默认值） */
const PRESETS = [
  {
    id: 'image-analysis', label: '识图理解（AGNES 识图）', note: '识图服务凭据',
    vars: [
      ['AGNES_API_KEY', 'AGNES API Key', 'sk-...'],
      ['AGNES_BASE_URL', '服务地址', 'https://api.agnes-ai.cn/v1', 'https://api.agnes-ai.cn/v1'],
      ['AGNES_MODEL', '模型名', 'agnes-2.5-flash', 'agnes-2.5-flash'],
    ],
  },
  {
    id: 'page-visual-review', label: '前端视觉审查（同 AGNES 识图）', note: '与识图理解共用凭据',
    vars: [
      ['AGNES_API_KEY', 'AGNES API Key', 'sk-...'],
      ['AGNES_BASE_URL', '服务地址', 'https://api.agnes-ai.cn/v1', 'https://api.agnes-ai.cn/v1'],
      ['AGNES_MODEL', '模型名', 'agnes-2.5-flash', 'agnes-2.5-flash'],
    ],
  },
  {
    id: 'text-to-diagram', label: '文本转图示（发布 npm 用）', note: '仅发布到 npm 时需要',
    vars: [['NPM_TOKEN', 'npm 发布令牌', 'npm_...']],
  },
  {
    id: 'github', label: 'GitHub / Git 用户信息', note: '推送与身份配置',
    vars: [
      ['GITHUB_TOKEN', 'GitHub 访问令牌', 'ghp_... 或 github_pat_...'],
      ['GIT_USER_NAME', 'Git 用户名', 'your-name'],
      ['GIT_USER_EMAIL', 'Git 邮箱', 'you@example.com'],
    ],
  },
  {
    id: 'custom-llm', label: '通用大模型（自定义 .env）', note: '面向你自己的项目代码（USER_ 前缀）',
    vars: [
      ['USER_LLM_API_KEY', 'API Key', 'your-api-key'],
      ['USER_LLM_BASE_URL', 'Base URL', 'https://api.example.com/v1'],
      ['USER_LLM_MODEL', '模型名', 'model-name'],
    ],
  },
];

const selected = new Set(['image-analysis', 'github']);
const values = {}; // key -> value

function allVars() {
  const seen = new Map();
  for (const p of PRESETS) if (selected.has(p.id)) for (const v of p.vars) if (!seen.has(v[0])) seen.set(v[0], v);
  return [...seen.values()];
}

function renderPicks() {
  $('skill-picks').innerHTML = PRESETS.map((p) =>
    `<button class="chip ${selected.has(p.id) ? 'active' : ''}" data-p="${p.id}" title="${esc(p.note)}">${esc(p.label)}</button>`).join('');
  for (const b of $('skill-picks').querySelectorAll('[data-p]')) b.addEventListener('click', () => {
    const id = b.dataset.p;
    selected.has(id) ? selected.delete(id) : selected.add(id);
    renderPicks(); renderFields(); renderPreview();
  });
}

function renderFields() {
  const vars = allVars();
  $('fields').innerHTML = vars.map(([key, label, ph, def]) => `
    <div class="field"><label>${esc(label)} <code style="font-size:11px;color:#8a92a8">${esc(key)}</code></label>
      <input type="password" data-key="${esc(key)}" value="${esc(values[key] ?? def ?? '')}" placeholder="${esc(ph)}"
             autocomplete="off" style="border:1px solid var(--line);border-radius:9px;padding:8px 12px;font:inherit;width:100%">
    </div>`).join('') + (window.__custom || []).map(([key, val]) => `
    <div class="field" style="display:flex;gap:8px;align-items:center">
      <code style="font-size:12px;min-width:130px">${esc(key)}</code>
      <input type="password" data-key="${esc(key)}" value="${esc(val)}" placeholder="值" autocomplete="off"
             style="flex:1;border:1px solid var(--line);border-radius:9px;padding:8px 12px;font:inherit">
      <button class="btn btn-danger" data-del="${esc(key)}" style="padding:5px 10px">×</button>
    </div>`).join('');
  for (const inp of $('fields').querySelectorAll('[data-key]')) inp.addEventListener('input', () => {
    values[inp.dataset.key] = inp.value; renderPreview();
  });
  for (const b of $('fields').querySelectorAll('[data-del]')) b.addEventListener('click', () => {
    window.__custom = (window.__custom || []).filter(([k]) => k !== b.dataset.del);
    renderFields(); renderPreview();
  });
}

function collect() {
  const out = {};
  for (const inp of $('fields').querySelectorAll('[data-key]')) if (inp.value.trim()) out[inp.dataset.key] = inp.value.trim();
  return out;
}

function buildContent() {
  const kv = collect();
  const fmt = document.querySelector('input[name=fmt]:checked').value;
  const keys = Object.keys(kv);
  if (!keys.length) return '# 填写左侧变量后，这里会实时生成配置内容';
  const lines = keys.map((k) => (fmt === 'export' ? `export ${k}="${kv[k]}"` : `${k}=${kv[k]}`));
  const head = fmt === 'export'
    ? '# SkillHub 生成的凭据文件（chmod 600，勿提交 git）\n# 用法: source ~/.secrets/credentials.env\n'
    : '# SkillHub 生成的环境文件（勿提交 git）\n';
  return head + '\n' + lines.join('\n') + '\n';
}

function buildGit() {
  const kv = collect();
  if (!kv.GIT_USER_NAME && !kv.GIT_USER_EMAIL) return '';
  const n = kv.GIT_USER_NAME || 'your-name', e = kv.GIT_USER_EMAIL || 'you@example.com';
  return `git config --global user.name  "${n}"\ngit config --global user.email "${e}"`;
}

function renderPreview() {
  $('preview').textContent = buildContent();
  const g = buildGit();
  $('git-cmds').classList.toggle('hidden', !g);
  if (g) $('git-preview').textContent = g;
}

$('ck-add').addEventListener('click', () => {
  const k = $('ck-name').value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (!k) return;
  window.__custom = window.__custom || [];
  if (!window.__custom.some(([x]) => x === k)) window.__custom.push([k, '']);
  $('ck-name').value = '';
  renderFields(); renderPreview();
});
document.querySelectorAll('input[name=fmt]').forEach((r) => r.addEventListener('change', renderPreview));

$('btn-copy').addEventListener('click', async (e) => {
  await navigator.clipboard.writeText(buildContent());
  $('setup-msg').className = 'msg ok'; $('setup-msg').textContent = '已复制到剪贴板 ✓';
  setTimeout(() => ($('setup-msg').textContent = ''), 2000);
});
$('btn-download').addEventListener('click', () => {
  const blob = new Blob([buildContent()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'credentials.env';
  a.click(); URL.revokeObjectURL(a.href);
});
$('btn-git').addEventListener('click', () => { const g = buildGit(); if (g) { $('git-cmds').classList.remove('hidden'); $('git-preview').textContent = g; } });
$('btn-git-copy')?.addEventListener('click', async () => { await navigator.clipboard.writeText(buildGit()); });

renderPicks(); renderFields(); renderPreview();
