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

    grid.innerHTML = items.map((s) => `
      <div class="skill-card">
        <div class="head">
          <span class="name">${esc(s.name)}</span>
          <span class="ver">v${esc(s.version)}</span>
          <span class="cat">${esc(s.category)}</span>
        </div>
        <div class="desc">${esc(s.description)}</div>
        <div class="tags-row">${(s.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <div class="foot">
          <span class="date">运行时: ${esc(s.runtime || 'node')}</span>
          <span class="foot-btns">
            <a class="mini-btn" href="${SBASE}mcps-md/${s.id}.md">README</a>
            <a class="mini-btn primary" href="${STATIC ? SBASE + 'downloads/' + s.id + '.zip' : '/api/mcps/' + encodeURIComponent(s.id) + '/download'}" download>下载</a>
            <a class="mini-btn" href="${STATIC ? SBASE + 'api/mcps/' + s.id + '/config' : '/api/mcps/' + encodeURIComponent(s.id) + '/config'}">配置</a>
          </span>
        </div>
      </div>`).join('');

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
