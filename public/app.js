/* SkillHub 首页与详情页逻辑（零依赖；动态 API 与静态 Pages 双模式） */
'use strict';

/* 静态模式：window.SKILLHUB_STATIC=true 且 window.SKILLHUB_BASE='./'（由 flags.js 注入） */
const STATIC = !!(window.SKILLHUB_STATIC);
const SBASE = window.SKILLHUB_BASE || '';

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/* ---------- 数据访问层（双模式） ---------- */
async function loadCatalog() {
  if (!STATIC) {
    const data = await fetchJSON('/api/skills');
    return data;
  }
  const data = await fetchJSON(SBASE + 'data/skills.json');
  return {
    total: data.items.length,
    categories: data.categories,
    items: data.items,
    raw: data,
  };
}
async function filterList(state) {
  if (!STATIC) {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    return fetchJSON('/api/skills' + (params.toString() ? '?' + params : ''));
  }
  const cat = await loadCatalog();
  const q = state.q.toLowerCase();
  const items = cat.raw.items.filter((s) => {
    if (state.category && s.category !== state.category) return false;
    if (q) {
      const hay = `${s.name} ${s.description} ${s.category} ${(s.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return { total: items.length, categories: cat.categories, items };
}
async function fetchDetail(id) {
  if (!STATIC) return fetchJSON('/api/skills/' + encodeURIComponent(id));
  const cat = await fetchJSON(SBASE + 'data/skills.json');
  const s = cat.items.find((x) => x.id === id);
  if (!s) throw new Error('not found');
  s.body = await (await fetch(SBASE + 'skills-md/' + id + '.md')).text();
  return s;
}
function rawMdUrl(id) {
  return STATIC ? SBASE + 'skills-md/' + encodeURIComponent(id) + '.md' : `/api/skills/${encodeURIComponent(id)}/files/SKILL.md`;
}
function downloadUrl(id, tgz) {
  if (STATIC) return SBASE + 'downloads/' + encodeURIComponent(id) + (tgz ? '.tar.gz' : '.zip');
  return `/api/skills/${encodeURIComponent(id)}/download` + (tgz ? '?format=tgz' : '');
}
function skillPageUrl(id) {
  return (STATIC ? SBASE : '/') + 'skill.html?id=' + encodeURIComponent(id);
}

/* ---------- 首页 ---------- */
async function initHome() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const catsEl = document.getElementById('cats');
  let state = { q: '', category: '' };

  async function load() {
    const data = await filterList(state);
    document.getElementById('stat-skills').textContent = `${data.total} 个技能`;
    grid.innerHTML = data.items.map((s) => `
      <div class="skill-card">
        <div class="head">
          <span class="name">${esc(s.name)}</span>
          <span class="ver">v${esc(s.version)}</span>
        </div>
        <div class="desc${s.description.length > 90 ? ' clamped' : ''}">${esc(s.description)}</div>
        ${(s.tags || []).length ? `<div class="tags-row">${s.tags.map((t) => `<button class="tag-btn" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
        <div class="foot">
          <span>${esc(s.category)}</span>
          <span>↓ ${s.downloads}</span>
          ${s.updatedAt ? `<span>${new Date(s.updatedAt).toLocaleDateString('zh-CN')}</span>` : ''}
          <span class="foot-btns">
            <a class="mini-btn" href="${skillPageUrl(s.id)}">详情</a>
            <a class="mini-btn primary" href="${downloadUrl(s.id)}" download>下载 ZIP</a>
          </span>
        </div>
      </div>`).join('');
    for (const b of grid.querySelectorAll('[data-tag]')) b.addEventListener('click', () => {
      state.q = b.dataset.tag;
      state.category = '';
      document.getElementById('q').value = state.q;
      catsEl.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.cat === ''));
      load();
    });
    empty.classList.toggle('hidden', data.items.length > 0);
    if (!catsEl.dataset.built) {
      catsEl.innerHTML = `<button class="chip active" data-cat="">全部</button>` +
        data.categories.map((c) => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
      catsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip');
        if (!btn) return;
        state.category = btn.dataset.cat;
        catsEl.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === btn));
        load();
      });
      catsEl.dataset.built = '1';
    }
  }

  let timer;
  document.getElementById('q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 250);
  });
  document.getElementById('go').addEventListener('click', () => { state.q = document.getElementById('q').value.trim(); load(); });
  await load();
}

/* ---------- 详情页 ---------- */
async function initSkill() {
  const id = new URLSearchParams(location.search).get('id');
  const root = document.getElementById('detail');
  if (!id) { root.innerHTML = '<div class="empty">缺少 id 参数</div>'; return; }
  let s;
  try { s = await fetchDetail(id); }
  catch { root.innerHTML = '<div class="empty">技能不存在或已被删除</div>'; return; }
  document.title = `${s.name} · SkillHub`;

  const dlUrl = downloadUrl(s.id);
  const tgzUrl = downloadUrl(s.id, true);
  const origin = STATIC ? location.origin + location.pathname.replace(/[^/]*$/, '') : location.origin;
  const curlCmd = `curl -sL ${origin}${dlUrl.replace(/^\.\//, '')} -o ${s.id}.zip && unzip ${s.id}.zip`;
  const agentTip = `# 让你的 AI Agent 安装此技能\n` +
    (STATIC
      ? `# 本站为静态镜像，完整 API 请自托管仓库（见 GitHub README）\n`
      : `curl -sL ${location.origin}/skills.txt   # 检索全部技能\n`) +
    `curl -sL ${origin}${dlUrl.replace(/^\.\//, '')} -o ${s.id}.zip && unzip ${s.id}.zip          # ZIP（Windows 右键即可解压）\n` +
    `curl -sL ${origin}${tgzUrl.replace(/^\.\//, '')} -o ${s.id}.tar.gz && tar xzf ${s.id}.tar.gz  # tar.gz（Linux/macOS）`;

  root.innerHTML = `
    <div class="crumb"><a href="/">SkillHub</a> / ${esc(s.category)} / ${esc(s.name)}</div>
    <div class="detail-head">
      <h1>${esc(s.name)} <span class="ver" style="font-size:13px;color:var(--brand);background:#eef0ff;border-radius:7px;padding:3px 9px;font-weight:600">v${esc(s.version)}</span></h1>
      <p class="detail-desc">${esc(s.description)}</p>
      <div class="meta-row">
        <span>分类 <b>${esc(s.category)}</b></span>
        <span>下载 <b>${s.downloads}</b> 次</span>
        <span>文件 <b>${s.files.length}</b> 个</span>
        ${s.updatedAt ? `<span>更新 <b>${new Date(s.updatedAt).toLocaleDateString('zh-CN')}</b></span>` : ''}
        ${(s.tags || []).length ? `<span>${s.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : ''}
      </div>
      <div class="action-row">
        <a class="btn btn-primary" href="${dlUrl}" download>下载 ZIP</a>
        <button class="btn btn-ghost" id="copy-zip-url">复制下载链接</button>
        <a class="btn btn-ghost" href="${tgzUrl}" download>tar.gz</a>
        <a class="btn btn-ghost" href="${rawMdUrl(s.id)}" target="_blank">查看 SKILL.md 原文</a>
        <button class="btn btn-ghost" id="copy-curl">复制 Agent 安装命令</button>
      </div>
      <div class="agent-snippet">${esc(agentTip)}</div>
      <div class="file-list">
        <b style="font-size:13.5px">文件清单</b>
        ${s.files.map((f) => `<div class="file"><code>./${esc(f.path)}</code><span class="size">${fmtSize(f.size)}</span></div>`).join('')}
      </div>
    </div>
    <div class="md-body" id="md">加载中…</div>`;

  document.getElementById('copy-zip-url').addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(dlUrl);
    e.target.textContent = '已复制 ✓';
    setTimeout(() => (e.target.textContent = '复制下载链接'), 1500);
  });

  document.getElementById('copy-curl').addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(curlCmd);
    e.target.textContent = '已复制 ✓';
    setTimeout(() => (e.target.textContent = '复制 Agent 安装命令'), 1500);
  });

  const r = await fetch(rawMdUrl(s.id));
  if (!r.ok) {
    document.getElementById('md').innerHTML = '<div class="empty">SKILL.md 加载失败（' + r.status + '），可点击上方“查看 SKILL.md 原文”重试。</div>';
    return;
  }
  const md = await r.text();
  const markedOpts = { breaks: true, gfm: true };
  const html = window.marked ? marked.parse(md, markedOpts) : '<pre>' + esc(md) + '</pre>';
  document.getElementById('md').innerHTML = window.DOMPurify ? DOMPurify.sanitize(html) : html;
}

/* 页面分发 */
if (document.getElementById('grid')) initHome().catch(console.error);
if (document.getElementById('detail')) initSkill().catch(console.error);
