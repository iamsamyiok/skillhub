// svg-edit 单守护进程：HTTP 服务 + 请求监听 二合一
// 平时：托管编辑页、接收 /submit、回传 /output 与 /summary，1 秒轮询 pending_edits/
// 有新请求：等 HTTP 响应送达后打印 reqid 并退出 → 后台任务通知唤醒 agent 接单
// 启动：node daemon.mjs   （agent 处理完请求后需重新启动本进程）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8620;
// 工作区根（原件与版本文件都在这里）：优先 SVG_EDIT_WS 环境变量，缺省为当前工作目录
const WS = process.env.SVG_EDIT_WS || process.cwd();
const BASE = path.join(WS, 'pending_edits');
const OUT = path.join(BASE, 'outputs');
const DONE = path.join(BASE, 'done');
const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'preview.html');
[BASE, OUT, DONE].forEach(d => fs.mkdirSync(d, { recursive: true }));

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const url = u.pathname;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // 托管预览页；?file=xx.svg 时把工作区里的图注入页面（window.__SE_BOOT__）
  if (req.method === 'GET' && (url === '/' || url === '/preview.html')) {
    try {
      let html = fs.readFileSync(PAGE, 'utf8');
      const fname = path.basename(u.searchParams.get('file') || '');
      if (fname.endsWith('.svg') && !fname.includes('..')) {
        const fp = path.join(WS, fname);
        if (fs.existsSync(fp)) {
          const boot = JSON.stringify({ name: fname, svg: fs.readFileSync(fp, 'utf8') });
          html = html.replace('/*__SE_BOOT__*/', 'window.__SE_BOOT__=' + boot + ';');
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) { res.writeHead(500); res.end('preview.html missing'); }
    return;
  }

  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true,"service":"svg-edit-daemon"}');
    return;
  }

  // 提交修改请求 → 落盘，守护进程检测到后退出以唤醒 agent
  if (req.method === 'POST' && url === '/submit') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        if (!Array.isArray(d.selected) || !d.instruction) throw new Error('missing fields');
        const reqid = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
                   + '_' + Math.floor(Math.random() * 900 + 100);
        fs.writeFileSync(path.join(BASE, `req_${reqid}.json`), JSON.stringify({
          reqid, file: d.svg || '', ids: d.selected, instruction: d.instruction, svgText: d.svgText || ''
        }, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, reqid, accepted: true }));
        console.log('[req]', reqid, d.svg || '');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  // agent 改完后把结果 SVG 放到 outputs/<reqid>.svg，页面轮询取走
  const mOut = url.match(/^\/output\/([\w-]+)$/);
  if (req.method === 'GET' && mOut) {
    const fp = path.join(OUT, mOut[1] + '.svg');
    if (fs.existsSync(fp)) { res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }); res.end(fs.readFileSync(fp)); }
    else { res.writeHead(404); res.end('not found'); }
    return;
  }

  // 结果元数据：{outfile: 版本化文件名, summary: 摘要}（agent 写的 outputs/<reqid>.meta.json）
  const mSum = url.match(/^\/summary\/([\w-]+)$/);
  if (req.method === 'GET' && mSum) {
    const fp = path.join(OUT, mSum[1] + '.meta.json');
    if (fs.existsSync(fp)) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(fs.readFileSync(fp)); }
    else { res.writeHead(404); res.end('pending'); }
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () => console.log(`svg-edit daemon on http://127.0.0.1:${PORT}/`));
server.on('error', e => { console.error('ERR', e.message); process.exit(1); });

// 监听新请求：出现即给 HTTP 响应留 600ms 送达时间，然后退出唤醒 agent
const timer = setInterval(() => {
  try {
    const files = fs.readdirSync(BASE).filter(f => /^req_.+\.json$/.test(f)).sort();
    if (files.length) {
      clearInterval(timer);
      setTimeout(() => { console.log('[wake]', files[0]); process.exit(0); }, 600);
    }
  } catch (_) { /* 目录未建好时继续等 */ }
}, 1000);
