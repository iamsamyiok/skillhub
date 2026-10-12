#!/usr/bin/env node
// align-daemon.mjs — pre-align 交互看板守护进程
// 用法: node align-daemon.mjs <align-input.json> [--port 8640] [--out <align-output.json>]
// 流程: Agent 写 align-input.json -> 后台任务启动本守护 -> present_files 打开看板
//       -> 用户网页提交 -> 落盘 align-output.json -> 守护自行退出唤醒 Agent

import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const positional = args.find(a => !a.startsWith('--'));

const inPath = positional ? path.resolve(positional) : path.resolve(here, '../align-input.json');
const outPath = path.resolve(flag('--out', path.join(path.dirname(inPath), 'align-output.json')));
const PORT = parseInt(flag('--port', '8640'), 10);

if (existsSync(outPath)) {
  console.log('[align] output already exists, refusing to start: ' + outPath);
  console.log('[align] delete it first if you want a fresh round.');
  process.exit(0);
}
if (!existsSync(inPath)) {
  console.error('[align] input not found: ' + inPath);
  process.exit(1);
}

const board = readFileSync(path.join(here, '../assets/align-board.html'), 'utf8');
const input = readFileSync(inPath, 'utf8');
JSON.parse(input); // fail fast on bad JSON

const page = board.replace(
  '<script>',
  '<script>window.__ALIGN_BOOT__=' + JSON.stringify(JSON.parse(input)).replace(/</g, '\\u003c') + ';</script>\n<script>'
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page);
  }
  if (req.method === 'GET' && url.pathname === '/input.json') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(input);
  }
  if (req.method === 'POST' && url.pathname === '/submit') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        writeFileSync(outPath, JSON.stringify(payload, null, 2));
        console.log('[align] saved: ' + outPath);
        console.log('[align] mode=' + (payload.mode || 'custom') + ' answers=' + Object.keys(payload.answers || {}).length);
        console.log('[align] ROUND_COMPLETE');
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, saved: outPath }));
        setTimeout(() => { console.log('[align] daemon exiting, agent picks up result automatically'); server.close(() => process.exit(0)); }, 300);
      } catch (e) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }
  res.writeHead(404, CORS);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[align] board:   http://127.0.0.1:' + PORT + '/');
  console.log('[align] input:   ' + inPath);
  console.log('[align] output:  ' + outPath + '  (created on submit, then daemon exits)');
});
