/* ==========================================================================
   capture.mjs — agent 视觉通道（3d-edit 自验证用）
   背景标签页 rAF 暂停时 take_screenshot 不可用：页面内 CITY.shot() 出 dataURL，
   fetch POST 到本服务落盘 PNG，再用 Read 目检。零依赖。
   v1.1：同时支持二进制落盘 —— 页面 CITY.saveGlb() 导出的 GLB 直接 POST 过来存 .glb
   用法：node capture.mjs [outDir] [--port 8941]
     页面侧（PNG）：await fetch('http://127.0.0.1:8941/', { method:'POST',
                headers:{'x-name':'wide'}, body: CITY.shot(1280,800) })
     页面侧（GLB）：await CITY.saveGlb('scene')   ← kit v1.1 模板自动回传，或手动：
                fetch('/', { method:'POST', headers:{'x-name':'scene.glb','x-kind':'raw'},
                             body: glbArrayBuffer })
   落盘 <outDir>/wide.png / <outDir>/scene.glb。Ctrl-C 结束。
   ==========================================================================*/
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = k => { const i = args.indexOf('--' + k); return i < 0 ? '' : args[i + 1]; };
const OUT = resolve(args.find(a => !a.startsWith('--') && isNaN(+a)) || '.');
const port = +(flag('port') || 8941);
mkdirSync(OUT, { recursive: true });

createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type,x-name,x-kind');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(200); return res.end('capture ok'); }
  const chunks = [];
  req.on('data', ch => chunks.push(ch));
  req.on('end', () => {
    const raw = req.headers['x-name'] || 'shot';
    const kind = req.headers['x-kind'] || '';
    if (kind === 'raw' || /\.(?:glb|gltf|bin)$/i.test(raw)) {          // 二进制通道：GLB 等
      const name = raw.replace(/[^\w.-]/g, '_');
      writeFileSync(OUT + '/' + name, Buffer.concat(chunks));
      console.log('saved', name, Buffer.concat(chunks).byteLength, 'bytes');
      res.writeHead(200); res.end('saved ' + name);
      return;
    }
    // dataURL 通道：CITY.shot() 的 PNG base64（'x-name' 带不带扩展名都行）
    const name = raw.replace(/[^\w.-]/g, '_').replace(/\.(?:png|jpe?g)$/i, '') + '.png';
    const body = Buffer.concat(chunks).toString('utf8');
    writeFileSync(OUT + '/' + name, Buffer.from(body.split(',')[1] || body, 'base64'));
    console.log('saved', name);
    res.writeHead(200); res.end('saved ' + name);
  });
}).listen(port, '127.0.0.1', () => console.log(`capture on http://127.0.0.1:${port}/ → ${OUT} (PNG dataURL + GLB binary)`));
