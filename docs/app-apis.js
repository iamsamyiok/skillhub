/* 免费APIs 页面逻辑 */
'use strict';

const APIS_STATIC = !!(window.SKILLHUB_STATIC);
const APIS_BASE = window.SKILLHUB_BASE || '';

const FT_STYLE = {
  '永久': { color: '#3fb950', hint: '无需注册，直接调用' },
  '需注册': { color: '#58a6ff', hint: '需申请 API Key，免费可用' },
  '限定额度': { color: '#d29922', hint: '免费层有配额限制' },
  '混合': { color: '#bc8cff', hint: '多种免费类型并存，详见条目' },
};
const LOW_ACTIVE_DAYS = 183; // 约 6 个月判定低活跃

function fmtStars(n) {
  n = Number(n) || 0;
  if (n >= 10000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const t = Date.parse(dateStr.length === 10 ? dateStr + 'T00:00:00Z' : dateStr);
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86400000);
}

async function fetchApiJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
}

async function loadApiCatalog() {
  if (!APIS_STATIC) return await fetchApiJSON('/api/apis');
  const data = await fetchApiJSON(APIS_BASE + 'data/apis.json');
  return { total: data.items.length, categories: data.categories, freeTypes: data.freeTypes, items: data.items };
}

async function initApisPage() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const catsEl = document.getElementById('cats');
  const ftEl = document.getElementById('ftypes');
  let state = { q: '', category: '', freeType: '' };

  function starsBadge(s) {
    return `<a class="badge" style="color:#8b949e;border-color:#30363d;text-decoration:none" href="${esc(s.repo)}" target="_blank" rel="noopener" title="GitHub 仓库">${esc(s.repo.replace('https://github.com/', ''))} · ${fmtStars(s.stars)}星</a>`;
  }
  function ftBadge(ft) {
    const st = FT_STYLE[ft] || FT_STYLE['混合'];
    return `<span class="badge" style="border-color:${st.color};color:${st.color}" title="${esc(st.hint)}">${esc(ft)}</span>`;
  }
  function lowBadge(s) {
    const d = daysSince(s.pushedAt);
    return d > LOW_ACTIVE_DAYS ? `<span class="badge" style="border-color:#f85149;color:#f85149" title="仓库 ${d} 天未推送，收录内容可能过期">低活跃</span>` : '';
  }

  async function load() {
    const data = await loadApiCatalog();
    const items = (data.items || []).filter((s) => {
      if (state.category && s.category !== state.category) return false;
      if (state.freeType && s.freeType !== state.freeType) return false;
      if (state.q) {
        const hay = `${s.name} ${s.description} ${s.category} ${s.freeType} ${(s.tags || []).join(' ')}`.toLowerCase();
        return hay.includes(state.q.toLowerCase());
      }
      return true;
    });

    document.getElementById('stat-apis').textContent = `${data.total} 个合集`;
    document.getElementById('stat-apis-cats').textContent = `${(data.categories || []).length} 个分类`;
    const verifiedDates = (data.items || []).map((s) => s.verifiedAt).filter(Boolean).sort();
    document.getElementById('stat-apis-entries').textContent = `人工核实于 ${verifiedDates[verifiedDates.length - 1] || '—'}`;

    grid.innerHTML = items.map((s) => `
      <div class="skill-card" data-id="${esc(s.id)}">
        <div class="head">
          <span class="name">${esc(s.name)}</span>
          <span class="cat">${esc(s.category)}</span>
        </div>
        <div class="desc">${esc(s.description)}</div>
        <div class="tags-row">${(s.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <div class="tags-row" style="margin-top:6px">${ftBadge(s.freeType)}${starsBadge(s)}${lowBadge(s)}</div>
        <div class="foot">
          <span class="date">核实于 ${esc(s.verifiedAt || '')}</span>
          <span class="foot-btns">
            <a class="mini-btn" href="${APIS_BASE}apis-md/${encodeURIComponent(s.id)}.md">精选清单</a>
            <a class="mini-btn primary" href="${s.repo}" target="_blank" rel="noopener">GitHub</a>
          </span>
        </div>
      </div>`).join('');

    empty.classList.toggle('hidden', items.length > 0);

    if (!catsEl.dataset.built) {
      const cats = data.categories || [];
      catsEl.innerHTML = `<button class="chip active" data-cat="">全部分类</button>` +
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
    if (!ftEl.dataset.built) {
      const fts = data.freeTypes && data.freeTypes.length ? data.freeTypes : Object.keys(FT_STYLE);
      ftEl.innerHTML = `<button class="chip active" data-ft="">全部免费类型</button>` +
        fts.map((f) => {
          const st = FT_STYLE[f] || {};
          return `<button class="chip" data-ft="${esc(f)}" title="${esc(st.hint || '')}">${esc(f)}</button>`;
        }).join('');
      ftEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip');
        if (!btn) return;
        state.freeType = btn.dataset.ft;
        ftEl.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === btn));
        load();
      });
      ftEl.dataset.built = '1';
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

document.addEventListener('DOMContentLoaded', initApisPage);
