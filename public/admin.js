/* SkillHub 管理后台逻辑（零依赖） */
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}

async function refresh() {
  const { items, categories } = await api('/api/skills');
  $('rows').innerHTML = items.map((s) => `
    <tr>
      <td><a href="/skill?id=${esc(s.id)}"><b>${esc(s.name)}</b></a> <code style="font-size:11px;color:#8a92a8">${esc(s.id)}</code></td>
      <td>${esc(s.category)}</td>
      <td>v${esc(s.version)}</td>
      <td>${s.downloads}</td>
      <td>${s.updatedAt ? new Date(s.updatedAt).toLocaleDateString('zh-CN') : '-'}</td>
      <td>
        <button class="btn btn-ghost" style="padding:5px 12px;font-size:12.5px" data-edit="${esc(s.id)}">编辑</button>
        <button class="btn btn-danger" style="padding:5px 12px;font-size:12.5px" data-del="${esc(s.id)}">删除</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">暂无技能</td></tr>';
  $('cat-list').innerHTML = (categories || []).map((c) => `<option value="${esc(c)}">`).join('');
  for (const b of $('rows').querySelectorAll('[data-edit]')) b.addEventListener('click', () => openEditor(b.dataset.edit));
  for (const b of $('rows').querySelectorAll('[data-del]')) b.addEventListener('click', async () => {
    if (!confirm(`确定删除技能「${b.dataset.del}」？此操作不可恢复。`)) return;
    await api('/api/skills/' + b.dataset.del, { method: 'DELETE' });
    refresh();
  });
}

async function openEditor(id) {
  const form = $('ed-form');
  form.reset();
  $('ed-msg').textContent = '';
  $('ed-title').textContent = id ? `编辑技能：${id}` : '新建技能';
  form.id.value = id || '';
  form.id.readOnly = !!id;
  if (id) {
    const s = await api('/api/skills/' + id);
    form.category.value = s.category === '未分类' ? '' : s.category;
    form.tags.value = (s.tags || []).join(', ');
    form.skillmd.value = s.body;
  }
  $('editor').classList.remove('hidden');
}

$('ed-cancel').addEventListener('click', () => $('editor').classList.add('hidden'));
$('ed-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const files = { 'SKILL.md': f.skillmd.value };
  for (const line of f.extra.value.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) {
      const p = line.slice(0, i).trim(), c = line.slice(i + 1).replace(/^ ?/, '');
      if (p) files[p] = c;
    }
  }
  const payload = { id: f.id.value.trim(), category: f.category.value.trim() || undefined, tags: f.tags.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean), files };
  try {
    await api('/api/skills', { method: 'POST', body: JSON.stringify(payload) });
    $('editor').classList.add('hidden');
    refresh();
  } catch (err) { $('ed-msg').textContent = err.message; }
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ user: e.target.user.value, password: e.target.password.value }) });
    enter(r.user);
  } catch (err) { $('login-msg').textContent = err.message; }
});
$('btn-logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); });

$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ password: e.target.password.value }) });
    $('pw-msg').className = 'msg ok'; $('pw-msg').textContent = '密码已更新';
    e.target.reset();
  } catch (err) { $('pw-msg').className = 'msg err'; $('pw-msg').textContent = err.message; }
});

$('btn-token').addEventListener('click', async () => {
  try {
    const r = await api('/api/auth/token', { method: 'POST', body: JSON.stringify({ name: 'agent-' + new Date().toISOString().slice(0, 10) }) });
    $('token-msg').textContent = r.token + '（仅显示这一次，请立即保存）';
  } catch (err) { $('token-msg').className = 'msg err'; $('token-msg').textContent = err.message; }
});

async function enter(user) {
  $('auth').classList.add('hidden');
  $('panel').classList.remove('hidden');
  $('who').textContent = `${user} 已登录`;
  await refresh();
}

/* 初始化：检查既有会话 */
api('/api/auth/me').then((r) => { if (r.user) enter(r.user); }).catch(() => {});
