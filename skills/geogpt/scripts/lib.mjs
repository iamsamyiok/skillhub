import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

export const QUOTA = { rpm: 1000, rpd: 300000, tpm: 1_000_000, tpd: 100_000_000 };
export const DEFAULT_MODEL = 'GeoGPT-R1-Preview';
let cfgRaw = {};

export function fail(msg) {
  console.error(`[geogpt] ${msg}`);
  process.exit(1);
}

/** Qoder 启动时抓到的进程 env 可能没有后设的用户级变量，Windows 下直接查注册表兜底。 */
function winUserToken() {
  if (process.platform !== 'win32') return '';
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'GEOGPT_TOKEN'], { encoding: 'utf8' });
    const m = out.match(/GEOGPT_TOKEN\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)/);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

function resolveToken() {
  const fromCfg = cfgRaw.token && cfgRaw.token !== 'REPLACE_ME' ? cfgRaw.token : '';
  if (process.env.GEOGPT_TOKEN) return [process.env.GEOGPT_TOKEN, '环境变量 GEOGPT_TOKEN'];
  if (fromCfg) return [fromCfg, 'config.json'];
  const reg = winUserToken();
  if (reg) return [reg, 'Windows 用户级环境变量 GEOGPT_TOKEN'];
  fail('缺少 access_token。\n'
    + '  1) 申请密钥：https://geogpt.zero2x.org.cn/cn/developer/api-keys（注册后创建 API Key）\n'
    + '  2) Windows:  powershell -Command "[Environment]::SetEnvironmentVariable(\'GEOGPT_TOKEN\',\'sk-你的密钥\',\'User\')"\n'
    + '     macOS/Linux:  export GEOGPT_TOKEN=sk-你的密钥   （写进 ~/.bashrc 或 ~/.zshrc 可长期生效）\n'
    + '  3) 或把技能目录下 config.json 的 REPLACE_ME 换成密钥（自行保管，不要提交到仓库）');
}

function loadConfig() {
  const file = join(SKILL_DIR, 'config.json');
  if (existsSync(file)) {
    try {
      cfgRaw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      fail(`config.json 解析失败：${e.message}`);
    }
  }
  const [token, source] = resolveToken();
  return { token, source, base: (cfgRaw.base || 'https://geogpt.zero2x.org.cn').replace(/\/+$/, '') };
}

const cfg = loadConfig();

export const BASE = cfg.base;
export const TOKEN_SOURCE = cfg.source;
export function maskToken() {
  return `${cfg.token.slice(0, 5)}***`;
}

export function authHeaders(withJson = false) {
  return {
    Authorization: `Bearer ${cfg.token}`,
    ...(withJson ? { 'Content-Type': 'application/json' } : {}),
  };
}

/** 官方信封：HTTP 200 也可能带 code:"0001"，必须逐层判。 */
async function jsonRequest(path, init, timeoutMs) {
  const body = await raw(path, init, timeoutMs);
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    fail(`${path} 返回非 JSON：${body.slice(0, 200)}`);
  }
  if (json.code !== '00000') {
    fail(`${path} 业务失败 code=${json.code} msg=${json.msg ?? ''} data=${String(json.data).slice(0, 300)} traceId=${json.traceId ?? ''}`);
  }
  return json.data;
}

async function raw(path, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.base + path, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) fail(`${path} HTTP ${res.status}：${text.slice(0, 300)}`);
    return text;
  } catch (e) {
    if (e.name === 'AbortError') fail(`${path} 超时（${Math.round(timeoutMs / 1000)}s）`);
    fail(`${path} 请求失败：${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export function newSession(timeoutMs = 30000) {
  return jsonRequest('/be-api/service/api/geoChat/generate', { headers: authHeaders() }, timeoutMs);
}

/** data: 后的内容被 JSON 转义了多层，循环剥到对象为止。 */
function unwrap(payload) {
  let obj = JSON.parse(payload);
  let guard = 0;
  while (typeof obj === 'string' && guard++ < 5) obj = JSON.parse(obj);
  return obj;
}

/**
 * 流式问答。产出 ['reasoning'|'content', text]。
 * 实测格式：OpenAI chunk + 双层转义，结束标记 [DONE]（官方文档写的 <end></end> 已过期）。
 */
export async function* streamAsk({ sessionId, text, module = DEFAULT_MODEL, timeoutMs = 300000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.base + '/be-api/service/api/geoChat/sendMsg', {
      method: 'POST',
      headers: authHeaders(true),
      signal: ctrl.signal,
      body: JSON.stringify({ text, sessionId, module }),
    });
    if (!res.ok) fail(`sendMsg HTTP ${res.status}：${(await res.text()).slice(0, 300)}`);

    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        let obj;
        try {
          obj = unwrap(payload);
        } catch {
          continue;
        }
        const delta = obj?.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.reasoning_content) yield ['reasoning', delta.reasoning_content];
        if (delta.content) yield ['content', delta.content];
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') fail(`sendMsg 超时（${Math.round(timeoutMs / 1000)}s）`);
    fail(`sendMsg 失败：${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 一次问答，返回 { answer, reasoning } */
export async function ask(opts) {
  let answer = '';
  let reasoning = '';
  for await (const [kind, piece] of streamAsk(opts)) {
    if (kind === 'content') answer += piece;
    else reasoning += piece;
  }
  return { answer, reasoning };
}

/**
 * 公共库检索。实测：中文查询 0 命中，必须英文；final 为扁平对象数组，分数在 metadata.score。
 */
export async function ragCommon(query, { topK = 5, scoreThreshold = 0.2, minScore = 0, expandSwitch = false, timeoutMs = 90000 } = {}) {
  const data = await jsonRequest(
    '/be-api/service/api/rag/top_k_common',
    {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ query, topK, ragSwitch: 'chat_common', scoreThreshold, expandSwitch }),
    },
    timeoutMs,
  );
  const hits = (data?.final || []).map((h) => (Array.isArray(h) ? h[0] : h));
  return { vectorTime: data?.vector_time, hits: hits.filter((h) => (h.metadata?.score ?? 0) >= minScore) };
}

/**
 * 个人库/团队库检索。实测：final 为 [文档块, 分数] 二元组但外层分数恒为 0，
 * 判据只能用 metadata.distance（越大越接近：相关≈0.42，无关≈0.05）。中英文均可。
 */
export async function ragPersonal(query, { topK = 5, pathList = [], isTeam = false, minDistance = 0, timeoutMs = 90000 } = {}) {
  const data = await jsonRequest(
    '/be-api/service/api/rag/top_k',
    {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ query, pathList, topK, isTeam }),
    },
    timeoutMs,
  );
  const hits = (data?.final || []).map((h) => (Array.isArray(h) ? h[0] : h));
  return { vectorTime: data?.vector_time, hits: hits.filter((h) => (h.metadata?.distance ?? 0) >= minDistance) };
}

export function clip(s, n) {
  s = (s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
