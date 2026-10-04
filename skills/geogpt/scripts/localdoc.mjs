import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** 实测 1.8 万字输入正常（≈24s），18 万字服务端挂死。默认预算卡在安全区内。 */
export const DEFAULT_MAX_CHARS = 12000;
const TARGET_CHUNK = 500;

/** 扩展名/魔数是二进制文档就别硬解，交给外部转 Markdown。 */
const BINARY_HINTS = [
  { re: /^%PDF-/, ext: 'pdf', tool: 'PDF' },
  { re: /^PK\x03\x04/, ext: 'docx/xlsx/pptx/zip', tool: 'Office' },
  { re: /^\xD0\xCF\x11\xE0/, ext: 'doc/xls/ppt', tool: '老版 Office' },
  { re: /^OggS|^fLaC|^\xFF\xD8/, ext: '音视频/图片', tool: '媒体' },
];

function looksBinary(text) {
  const head = text.slice(0, 8);
  const hit = BINARY_HINTS.find((b) => b.re.test(head));
  if (hit) return `二进制文档（疑似 ${hit.ext}）`;
  // 大量控制字符说明不是文本
  const ctrl = (head.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
  return ctrl > 2 ? '非文本内容' : '';
}

function decode(path) {
  const buf = readFileSync(path);
  let text = buf.toString('utf8').replace(/^\uFEFF/, '');
  if ((text.match(/\uFFFD/g) || []).length > 3) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf);
      if ((gbk.match(/\uFFFD/g) || []).length < (text.match(/\uFFFD/g) || []).length) text = gbk;
    } catch { /* 无 gbk 支持就用 utf8 结果 */ }
  }
  return text.replace(/\r\n?/g, '\n');
}

function splitSentences(s, max) {
  const out = [];
  let cur = '';
  for (const part of s.split(/(?<=[。！？；!?.;])\s*|\n+/)) {
    if (!part) continue;
    if ((cur + part).length > max && cur) { out.push(cur); cur = part; } else cur += part;
    if (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** 段落聚合成 ~TARGET_CHUNK 的块，超长段落按句子硬切。记录起始偏移保持原文顺序。 */
export function chunkText(text, file) {
  const paras = text.split(/\n\s*\n/).map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  const pieces = [];
  for (const p of paras) {
    if (p.length <= TARGET_CHUNK * 1.5) pieces.push(p);
    else pieces.push(...splitSentences(p, TARGET_CHUNK));
  }
  const chunks = [];
  let offset = 0;
  for (const p of pieces) {
    const last = chunks[chunks.length - 1];
    // 标题总是起新块，避免一个块混进多个小节稀释召回精度
    if (last && !/^#{1,6} /.test(p) && last.text.length + p.length + 2 <= TARGET_CHUNK) {
      last.text += `\n\n${p}`;
    } else {
      chunks.push({ file, idx: offset++, text: p });
    }
  }
  for (const c of chunks) c.total = chunks.length;
  return chunks;
}

function label(c, n) {
  return `[本地${n}] ${c.file}（${c.total === 1 ? '全文' : `第 ${c.idx + 1}/${c.total} 段`}）`;
}

/** 英文词 + 中文 bigram，够召回用，不引分词库。 */
export function terms(query) {
  const map = new Map();
  for (const w of query.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g) || []) map.set(w, 2);
  for (const run of query.match(/[\u4e00-\u9fa5]+/g) || []) {
    if (run.length === 1) map.set(run, 1);
    for (let i = 0; i + 2 <= run.length; i++) map.set(run.slice(i, i + 2), 1);
  }
  return [...map].map(([term, weight]) => ({ term, weight }));
}

function score(chunk, qs) {
  const lower = chunk.text.toLowerCase();
  let s = 0;
  for (const { term, weight } of qs) {
    let i = lower.indexOf(term);
    let n = 0;
    while (i >= 0 && n < 4) { n++; i = lower.indexOf(term, i + term.length); }
    s += n * weight;
  }
  if (s === 0) return 0;
  return s / Math.sqrt(chunk.text.length / 400 + 1);
}

/**
 * 选段：整篇很短就全量注入，否则按相关度取 top-k、按原文顺序拼接，总量不超过 maxChars。
 * 返回 '' 表示没有可用材料。
 */
export function selectChunks(chunks, query, { k = 6, maxChars = DEFAULT_MAX_CHARS } = {}) {
  if (!chunks.length) return '';
  // 预算要含标签，否则 200 段的小标签就能把总量顶穿
  const entries = chunks.map((c, i) => ({ c, text: `${label(c, i + 1)}\n${c.text}` }));
  const all = entries.map((e) => e.text).join('\n\n');
  if (entries.length <= 12 && all.length <= maxChars) return all;

  const qs = terms(query);
  const ranked = entries.map((e) => ({ e, s: score(e.c, qs) })).sort((a, b) => b.s - a.s);
  const picked = [];
  let used = 0;
  for (const { e, s } of ranked) {
    if (s === 0) break;
    if (used + e.text.length > maxChars) continue;
    used += e.text.length;
    picked.push(e);
    if (picked.length >= k) break;
  }
  if (!picked.length) return '';
  picked.sort((a, b) => (a.c.file === b.c.file ? a.c.idx - b.c.idx : a.c.file.localeCompare(b.c.file)));
  return picked.map((e, i) => `${label(e.c, i + 1)}\n${e.c.text}`).join('\n\n');
}

/** 读取并切片。二进制/无扩展名文件给出明确提示而不是硬塞乱码。 */
export function loadDocs(paths) {
  const chunks = [];
  const notes = [];
  for (const p of paths) {
    let text;
    try {
      text = decode(p);
    } catch (e) {
      notes.push(`${basename(p)} 读取失败：${e.message}`);
      continue;
    }
    const why = looksBinary(text);
    if (why) {
      notes.push(`${basename(p)} 是${why}，先转成 Markdown/txt 再喂：PDF/Office 可用 markitdown 或 convert-documents-to-markdown 技能`);
      continue;
    }
    chunks.push(...chunkText(text, basename(p)));
  }
  return { chunks, notes };
}
