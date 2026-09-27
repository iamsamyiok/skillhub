/* MCPs 页面逻辑 */
'use strict';

const STATIC = !!(window.SKILLHUB_STATIC);
const SBASE = window.SKILLHUB_BASE || '';

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
}

async function loadMcpCatalog() {
  if (!STATIC) {
    const data = await fetchJSON('/api/mcps');
    return data;
  }
  const data = await fetchJSON(SBASE + 'data/mcps.json');
  return {
    total: data.items.length,
    categories: data.categories,
    items: data.items,
    raw: data,
  };
}

async function initMcpsPage() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const catsEl = document.getElementById('cats');
  let state = { q: '', category: '' };

  async function load() {
    const data = await loadMcpCatalog();
    renderKeyGuide(data.raw.items);
    const items = state.q || state.category
      ? data.raw.items.filter((s) => {
          if (state.category && s.category !== state.category) return false;
          if (state.q) {
            const hay = `${s.name} ${s.description} ${s.category} ${(s.tags || []).join(' ')}`.toLowerCase();
            return hay.includes(state.q.toLowerCase());
          }
          return true;
        })
      : data.raw.items;

    document.getElementById('stat-mcps').textContent = `${items.length} 个 MCP`;
    const cats = data.categories || [];
    if (cats.length) document.getElementById('stat-mcp-cats').textContent = `${cats.length} 个分类`;

    grid.innerHTML = items.map((s) => {
      const envKeys = Object.keys(s.env || {});
      const needsKey = envKeys.length > 0;
      const keyBadges = needsKey ? `<span class="badge" style="border-color:#d29922;color:#d29922;cursor:pointer" onclick="showKeyGuide('${esc(s.id)}')" title="点击查看取钥指引">🔑 需要密钥×${envKeys.length}</span>` : '';
      const keyRow = needsKey ? `<div class="keyline" style="margin-top:6px;font-size:12.5px;color:#d29922">需要: ${envKeys.map(k => `<code style="background:#0d1117;padding:1px 6px;border-radius:4px">${esc(k)}</code>`).join(' ')} <a href="#" style="color:#58a6ff" onclick="showKeyGuide('${esc(s.id)}');return false">怎么取?</a></div>` : '';
      return `
      <div class="skill-card" data-needskey="${needsKey ? 1 : 0}" data-id="${esc(s.id)}">
        <div class="head">
          <span class="name">${esc(s.name)}</span>
          <span class="ver">v${esc(s.version)}</span>
          <span class="cat">${esc(s.category)}</span>
        </div>
        <div class="desc">${esc(s.description)}</div>
        <div class="tags-row">${(s.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${keyBadges}</div>
        ${keyRow}
        <div class="foot">
          <span class="date">运行时: ${esc(s.runtime || 'node')}</span>
          <span class="foot-btns">
            <a class="mini-btn" href="${SBASE}mcps-md/${s.id}.md">README</a>
            <a class="mini-btn primary" href="${STATIC ? SBASE + 'downloads/' + s.id + '.zip' : '/api/mcps/' + encodeURIComponent(s.id) + '/download'}" download>下载</a>
            <a class="mini-btn" href="${STATIC ? SBASE + 'api/mcps/' + s.id + '/config' : '/api/mcps/' + encodeURIComponent(s.id) + '/config'}">配置</a>
          </span>
        </div>
      </div>`;}).join('');

    empty.classList.toggle('hidden', items.length > 0);
    
    if (!catsEl.dataset.built) {
      catsEl.innerHTML = `<button class="chip active" data-cat="">全部</button>` +
        cats.map((c) => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
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

  function renderKeyGuide(items) {
    const needs = items.filter((s) => Object.keys(s.env || {}).length > 0);
    document.getElementById('stat-mcp-needskey').textContent = `🔑 需要密钥: ${needs.length} 个`;
    const body = document.getElementById('keyguide-body');
    if (!needs.length) { body.innerHTML = '<span style="color:var(--mut)">当前全部 MCP 均无需密钥。</span>'; return; }
    body.innerHTML = needs.map((s) => {
      const envs = s.env || {};
      return `<div style="margin:8px 0;padding:8px 0;border-bottom:1px dashed #3a3222">
        <b>${esc(s.name)}</b> <span style="color:var(--mut);font-size:12px">(${esc(s.id)})</span><br>
        ${Object.entries(envs).map(([k, v]) => `
          <span style="font-size:12.5px">环境变量 <code style="background:#0d1117;padding:1px 6px;border-radius:4px;color:#79c0ff">${esc(k)}</code>
          — ${esc(String(v).replace(/^\$\{/, '').replace(/\}$/, ''))}</span>`).join('<br>')}
      </div>`;
    }).join('') + '<div style="color:var(--mut);font-size:12px;margin-top:6px">钥到手后: 存入本地密钥文件(勿进 git), 再把变量填进 MCP 配置的 env 字段。</div>';
  }
  window.showNeedsKey = function () {
    const g = document.getElementById('keyguide');
    g.classList.toggle('hidden');
    if (!g.classList.contains('hidden')) g.scrollIntoView({ behavior: 'smooth' });
  };
  window.showKeyGuide = function (id) {
    const g = document.getElementById('keyguide');
    g.classList.remove('hidden');
    g.scrollIntoView({ behavior: 'smooth' });
    g.style.boxShadow = '0 0 0 2px #d29922';
    setTimeout(() => { g.style.boxShadow = ''; }, 1200);
  };
  window.__mcpFilterNeedsKey = function () {
    document.querySelectorAll('.skill-card').forEach((c) => {
      c.style.display = c.dataset.needskey === '1' ? '' : 'none';
    });
  };

  let timer;
  document.getElementById('q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 250);
  });
  document.getElementById('go').addEventListener('click', () => { state.q = document.getElementById('q').value.trim(); load(); });
  
  await load();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.addEventListener('DOMContentLoaded', initMcpsPage);
