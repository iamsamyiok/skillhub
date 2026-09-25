#!/usr/bin/env node
// edit-server.mjs — static file server + edit-request bridge for the world viewer.
// Serves <root> over HTTP and accepts POST /edit-request from the viewer's edit
// mode, persisting each submission as <scene>/edit-requests/ed-<n>.json so the
// agent can pick it up and apply targeted patches.
// Usage: node engine/edit-server.mjs --port 8770 --root /workspace
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
function arg(name, dflt) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const PORT = parseInt(arg('port', '8770'), 10);
const ROOT = path.resolve(arg('root', process.cwd()));
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.md': 'text/markdown; charset=utf-8'
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base) ? p : null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/edit-request') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (!Array.isArray(payload.instance_ids) || !payload.intent) {
          return send(res, 400, JSON.stringify({ ok: false, error: 'instance_ids[] and intent required' }), 'application/json');
        }
        const page = String(payload.scene_page || '');
        const sceneDir = page.includes('/') ? path.dirname(page) : '';
        const dir = safeJoin(ROOT, path.join(sceneDir, 'edit-requests')) || path.join(__dirname, '..', 'edit-requests');
        fs.mkdirSync(dir, { recursive: true });
        const n = fs.readdirSync(dir).length + 1;
        const file = path.join(dir, `ed-${String(n).padStart(3, '0')}.json`);
        fs.writeFileSync(file, JSON.stringify(payload, null, 2));
        console.log(`[edit-request] ${file} :: ${payload.instance_ids.length} objects :: ${payload.intent.slice(0, 80)}`);
        send(res, 200, JSON.stringify({ ok: true, file }), 'application/json');
      } catch (err) {
        send(res, 400, JSON.stringify({ ok: false, error: String(err) }), 'application/json');
      }
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');

  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = safeJoin(ROOT, rel);
  if (!file) return send(res, 403, 'forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found: ' + rel);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Last-Modified': st.mtime.toUTCString(),
      'Cache-Control': 'no-store'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`edit-server: http://localhost:${PORT}/  (root: ${ROOT})`);
  console.log('edit mode: open /scenes/<name>/world.html#edit — submissions land in <scene>/edit-requests/');
});
