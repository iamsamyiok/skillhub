#!/usr/bin/env node
// SkillHub —— 为人类与 AI Agent 提供技能（skill）浏览/检索/下载/管理的零依赖站点
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = __dirname;
const SKILLS_DIR = path.join(ROOT, 'skills');
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8000);
const BODY_LIMIT = 8 * 1024 * 1024;

// ---------- 数据文件 ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
const META = () => readJson(path.join(DATA_DIR, 'meta.json'), { skills: {} });
const saveMeta = (m) => writeJson(path.join(DATA_DIR, 'meta.json'), m);

// ---------- 认证初始化（首次启动生成，零明文落库） ----------
function scryptHash(secret, salt) {
  return crypto.scryptSync(secret, salt, 32).toString('hex');
}
function ensureAuth() {
  const authFile = path.join(DATA_DIR, 'auth.json');
  const tokenFile = path.join(DATA_DIR, 'tokens.json');
  if (!fs.existsSync(authFile)) {
    const password = crypto.randomBytes(9).toString('base64url');
    const salt = crypto.randomBytes(8).toString('hex');
    writeJson(authFile, { user: 'admin', salt, hash: scryptHash(password, salt), createdAt: new Date().toISOString() });
    const credFile = path.join(DATA_DIR, 'initial-credentials.txt');
    fs.writeFileSync(credFile, `SkillHub 初始管理员（请尽快登录修改密码）\n用户名: admin\n密码: ${password}\n`, { mode: 0o600 });
    console.log(`[init] 已生成管理员账密 → ${credFile}（仅存放一次，600 权限）`);
  }
  if (!fs.existsSync(tokenFile)) {
    const token = 'sk-' + crypto.randomBytes(24).toString('base64url');
    writeJson(tokenFile, { tokens: [{ name: 'default-agent', hash: crypto.createHash('sha256').update(token).digest('hex'), createdAt: new Date().toISOString() }] });
    const tokFile = path.join(DATA_DIR, 'initial-agent-token.txt');
    fs.writeFileSync(tokFile, `SkillHub Agent 管理令牌（用于 X-API-Token 请求头）\n${token}\n`, { mode: 0o600 });
    console.log(`[init] 已生成 Agent 管理令牌 → ${tokFile}（仅存放一次，600 权限）`);
  }
}
const sessions = new Map(); // sid -> { user, exp }
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function authUser(req) {
  const cookies = parseCookies(req);
  const sid = cookies.sh_session;
  if (sid && sessions.has(sid)) {
    const s = sessions.get(sid);
    if (s.exp > Date.now()) return s.user;
    sessions.delete(sid);
  }
  return null;
}
function authToken(req) {
  const token = req.headers['x-api-token'] || '';
  if (!token) return false;
  const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const { tokens = [] } = readJson(path.join(DATA_DIR, 'tokens.json'), { tokens: [] });
  return tokens.some((t) => t.hash === hash);
}
function isManager(req) { return authUser(req) !== null || authToken(req); }

// ---------- SKILL.md frontmatter ----------
function parseFrontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const meta = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0 && !line.startsWith(' ') && !line.startsWith('#')) {
        const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (k && v) meta[k] = v;
      }
    }
  }
  return meta;
}
function skillDir(id) { return path.join(SKILLS_DIR, id); }
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
function listSkillFiles(dir, prefix = '') {
  let out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(full).isDirectory()) out = out.concat(listSkillFiles(full, rel));
    else out.push({ path: rel, size: fs.statSync(full).size });
  }
  return out;
}
function skillDetail(id) {
  const dir = skillDir(id);
  if (!ID_RE.test(id) || !fs.existsSync(path.join(dir, 'SKILL.md'))) return null;
  const md = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const fm = parseFrontmatter(md);
  const meta = META().skills[id] || {};
  return {
    id,
    name: fm.name || id,
    description: fm.description || '',
    version: fm.version || '1.0.0',
    category: meta.category || '未分类',
    tags: meta.tags || [],
    downloads: meta.downloads || 0,
    createdAt: meta.createdAt || null,
    updatedAt: meta.updatedAt || null,
    files: listSkillFiles(dir),
    body: md,
  };
}
function allSkillIds() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR).filter((id) => fs.existsSync(path.join(skillDir(id), 'SKILL.md')));
}

// ---------- ZIP 打包（Windows 最常见格式，store 模式零依赖） ----------
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
function zipOf(entries) {
  const now = dosDateTime(new Date());
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 name flag
    local.writeUInt16LE(0, 8);           // method: store
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, data);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // version made by
    central.writeUInt16LE(20, 6);        // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);        // extra
    central.writeUInt16LE(0, 32);        // comment
    central.writeUInt16LE(0, 34);        // disk number
    central.writeUInt16LE(0, 36);        // internal attrs
    central.writeUInt32LE(0, 38);        // external attrs
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---------- tar.gz 打包 ----------
function tarGz(files) {
  const blocks = [];
  for (const rel of files) {
    const content = fs.readFileSync(path.join(SKILLS_DIR, rel.id, rel.path));
    const name = `${rel.id}/${rel.path}`;
    const header = Buffer.alloc(512);
    header.write(name.slice(0, 100), 0);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(content.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
    header.write('        ', 148); // checksum placeholder
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    let sum = 0;
    for (const b of header) sum += b;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

// ---------- 工具 ----------
function send(res, code, body, headers = {}) {
  const buf = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...headers });
  res.end(buf);
}
function notFound(res, msg = 'not found') { send(res, 404, { error: msg }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > BODY_LIMIT) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8', '.sh': 'text/x-shellscript; charset=utf-8' };

// ---------- 动态索引（AI 可读） ----------
function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
function llmsTxt(req) {
  const base = baseUrl(req);
  const lines = ['# SkillHub', '', `> 面向人类与 AI Agent 的技能（skill）下载站。Agent 可直接 GET ${base}/api/skills 检索元数据，GET /api/skills/{id}/download 下载 ZIP 包（追加 ?format=tgz 得 tar.gz），GET /api/skills/{id} 获取含 SKILL.md 全文的详情。`, ''];
  const ids = allSkillIds();
  if (ids.length) {
    lines.push('## Skills', '');
    for (const id of ids) {
      const s = skillDetail(id);
      if (s) lines.push(`- [${s.name}](${base}/api/skills/${id}): ${s.description.slice(0, 160)}`);
    }
    lines.push('');
  }
  lines.push('## Manage', '', `- 登录后台（人类）: ${base}/admin`, '- 管理 API（Agent，Header X-API-Token）: POST /api/skills 新建或更新、DELETE /api/skills/{id} 删除', `- Agent 接入指南: ${base}/ai`, '');
  return lines.join('\n');
}
function skillsTxt(req) {
  const base = baseUrl(req);
  const lines = ['# name | category | version | description | download', ''];
  for (const id of allSkillIds()) {
    const s = skillDetail(id);
    if (s) lines.push(`${s.name} | ${s.category} | ${s.version} | ${s.description.replace(/\|/g, '，')} | ${base}/api/skills/${id}/download`);
  }
  return lines.join('\n') + '\n';
}

// ---------- 路由 ----------
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }

// 技能列表（检索：q 关键词 / category 分类）
route('GET', /^\/api\/skills(\?.*)?$/, (req, res, url) => {
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const cat = url.searchParams.get('category') || '';
  const items = [];
  for (const id of allSkillIds()) {
    const s = skillDetail(id);
    if (!s) continue;
    if (cat && s.category !== cat) continue;
    if (q) {
      const hay = `${s.name} ${s.description} ${s.category} ${(s.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    items.push({ id: s.id, name: s.name, description: s.description, version: s.version, category: s.category, tags: s.tags, downloads: s.downloads, updatedAt: s.updatedAt });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  const categories = [...new Set(Object.values(META().skills).map((s) => s.category).filter(Boolean))].sort();
  send(res, 200, { total: items.length, categories, items });
});

// 技能详情（含 SKILL.md 全文与文件清单）
route('GET', /^\/api\/skills\/([\w.-]+)$/, (req, res, url, m) => {
  const s = skillDetail(m[1]);
  if (!s) return notFound(res, 'skill not found');
  send(res, 200, s);
});

// 技能下载（默认 ZIP（Windows 友好）；?format=tgz → tar.gz；均计数）
route('GET', /^\/api\/skills\/([\w.-]+)\/download$/, (req, res, url, m) => {
  const s = skillDetail(m[1]);
  if (!s) return notFound(res, 'skill not found');
  const wantTgz = url.searchParams.get('format') === 'tgz';
  const buf = wantTgz
    ? tarGz(s.files.map((f) => ({ id: s.id, path: f.path })))
    : zipOf(s.files.map((f) => ({ name: `${s.id}/${f.path}`, data: fs.readFileSync(path.join(SKILLS_DIR, s.id, f.path)) })));
  const meta = META();
  if (meta.skills[s.id]) meta.skills[s.id].downloads = (meta.skills[s.id].downloads || 0) + 1;
  saveMeta(meta);
  const filename = wantTgz ? `${s.id}.tar.gz` : `${s.id}.zip`;
  send(res, 200, buf, {
    'Content-Type': wantTgz ? 'application/gzip' : 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Access-Control-Allow-Origin': '*',
  });
});

// 技能内原始文件
route('GET', /^\/api\/skills\/([\w.-]+)\/files\/(.+)$/, (req, res, url, m) => {
  const id = m[1], rel = m[2];
  if (!skillDetail(id)) return notFound(res, 'skill not found');
  const full = path.join(skillDir(id), rel);
  if (!full.startsWith(skillDir(id) + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return notFound(res, 'file not found');
  send(res, 200, fs.readFileSync(full), { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
});

// 新建 / 更新技能（管理）
route('POST', /^\/api\/skills$/, async (req, res) => {
  if (!isManager(req)) return send(res, 401, { error: '需要登录（cookie）或 X-API-Token' });
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch { return send(res, 400, { error: 'JSON 解析失败' }); }
  const id = String(body.id || body.name || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+/, '').slice(0, 64);
  if (!ID_RE.test(id)) return send(res, 400, { error: 'id 非法（小写字母数字开头，含 -._）' });
  if (!body.files || !body.files['SKILL.md']) return send(res, 400, { error: 'files 必须包含 SKILL.md' });
  const dir = skillDir(id);
  const existed = fs.existsSync(path.join(dir, 'SKILL.md'));
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(body.files)) {
    const norm = path.normalize(rel).replace(/^([.][.](\/|\\|$))+/, '');
    const full = path.join(dir, norm);
    if (!full.startsWith(dir + path.sep)) return send(res, 400, { error: `文件路径非法: ${rel}` });
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : String(content));
  }
  const fm = parseFrontmatter(String(body.files['SKILL.md']));
  const meta = META();
  const prev = meta.skills[id] || {};
  meta.skills[id] = {
    category: body.category || prev.category || '未分类',
    tags: Array.isArray(body.tags) ? body.tags : prev.tags || [],
    downloads: prev.downloads || 0,
    createdAt: prev.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveMeta(meta);
  send(res, existed ? 200 : 201, { ok: true, id, name: fm.name || id, updated: existed });
});

// 删除技能（管理）
route('DELETE', /^\/api\/skills\/([\w.-]+)$/, (req, res, url, m) => {
  if (!isManager(req)) return send(res, 401, { error: '需要登录（cookie）或 X-API-Token' });
  const id = m[1];
  if (!skillDetail(id)) return notFound(res, 'skill not found');
  fs.rmSync(skillDir(id), { recursive: true, force: true });
  const meta = META();
  delete meta.skills[id];
  saveMeta(meta);
  send(res, 200, { ok: true, id });
});

// 人类登录
route('POST', /^\/api\/auth\/login$/, async (req, res) => {
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch { return send(res, 400, { error: 'JSON 解析失败' }); }
  const auth = readJson(path.join(DATA_DIR, 'auth.json'), null);
  if (!auth) return send(res, 500, { error: '认证未初始化' });
  const hash = scryptHash(String(body.password || ''), auth.salt);
  const ok = body.user === auth.user && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(auth.hash));
  if (!ok) return send(res, 401, { error: '用户名或密码错误' });
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { user: auth.user, exp: Date.now() + 7 * 24 * 3600 * 1000 });
  send(res, 200, { ok: true, user: auth.user }, { 'Set-Cookie': `sh_session=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` });
});
route('POST', /^\/api\/auth\/logout$/, (req, res) => {
  const sid = parseCookies(req).sh_session;
  if (sid) sessions.delete(sid);
  send(res, 200, { ok: true }, { 'Set-Cookie': 'sh_session=; HttpOnly; Path=/; Max-Age=0' });
});
route('GET', /^\/api\/auth\/me$/, (req, res) => send(res, 200, { user: authUser(req), agentToken: authToken(req) }));
// 修改密码（需已登录）
route('POST', /^\/api\/auth\/password$/, async (req, res) => {
  const user = authUser(req);
  if (!user) return send(res, 401, { error: '请先登录' });
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch { return send(res, 400, { error: 'JSON 解析失败' }); }
  if (!body.password || String(body.password).length < 8) return send(res, 400, { error: '新密码至少 8 位' });
  const authFile = path.join(DATA_DIR, 'auth.json');
  const auth = readJson(authFile, null);
  auth.salt = crypto.randomBytes(8).toString('hex');
  auth.hash = scryptHash(String(body.password), auth.salt);
  writeJson(authFile, auth);
  send(res, 200, { ok: true });
});
// 生成新 agent token（需已登录）
route('POST', /^\/api\/auth\/token$/, async (req, res) => {
  const user = authUser(req);
  if (!user) return send(res, 401, { error: '请先登录' });
  let body = {};
  try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch {}
  const token = 'sk-' + crypto.randomBytes(24).toString('base64url');
  const tokenFile = path.join(DATA_DIR, 'tokens.json');
  const data = readJson(tokenFile, { tokens: [] });
  data.tokens.push({ name: String(body.name || 'agent').slice(0, 40), hash: crypto.createHash('sha256').update(token).digest('hex'), createdAt: new Date().toISOString() });
  writeJson(tokenFile, data);
  send(res, 200, { ok: true, token, note: '令牌仅本次返回，请立即保存' });
});

// AI 可读索引
route('GET', /^\/llms\.txt$/, (req, res) => send(res, 200, llmsTxt(req), { 'Content-Type': 'text/plain; charset=utf-8' }));
route('GET', /^\/skills\.txt$/, (req, res) => send(res, 200, skillsTxt(req), { 'Content-Type': 'text/plain; charset=utf-8' }));
route('GET', /^\/robots\.txt$/, (req, res) => send(res, 200, 'User-agent: *\nAllow: /\n', { 'Content-Type': 'text/plain; charset=utf-8' }));

// 静态文件 + 页面路由
const PAGES = { '/': 'index.html', '/skill': 'skill.html', '/admin': 'admin.html', '/ai': 'ai.html' };
function serveStatic(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return notFound(res);
  send(res, 200, fs.readFileSync(full), { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-API-Token',
      });
      return res.end();
    }
    for (const { method, pattern, handler } of routes) {
      if (req.method !== method) continue;
      const m = pattern.exec(pathname);
      if (m) return await handler(req, res, url, m);
    }
    if (req.method === 'GET') {
      if (PAGES[pathname]) return serveStatic(res, PAGES[pathname]);
      if (!pathname.includes('..')) return serveStatic(res, pathname.slice(1));
    }
    notFound(res);
  } catch (e) {
    console.error('[error]', req.method, pathname, e.message);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

ensureAuth();
if (require.main === module) {
  server.listen(PORT, () => {
    const ids = allSkillIds();
    console.log(`SkillHub 已启动 → http://localhost:${PORT}（${ids.length} 个技能：${ids.join(', ')}）`);
    console.log(`AI 入口：/llms.txt、/skills.txt、/api/skills；管理：/admin`);
  });
}
module.exports = { server, skillDetail, allSkillIds, zipOf, tarGz, parseFrontmatter };
