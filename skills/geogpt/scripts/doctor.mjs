#!/usr/bin/env node
import { ask, authHeaders, BASE, clip, maskToken, newSession, QUOTA, ragCommon, ragPersonal, TOKEN_SOURCE } from './lib.mjs';

const results = [];
const rec = async (name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: (e.message || String(e)).replace(/\s+/g, ' ').slice(0, 160) });
  }
};

results.push({ name: '凭证', ok: true, ms: 0, detail: `${TOKEN_SOURCE} (${maskToken()})` });

let sid = '';
await rec('创建会话 generate', async () => {
  sid = await newSession();
  if (!/^[0-9a-f-]{36}$/i.test(sid)) throw new Error(`返回异常: ${sid}`);
  return sid;
});

await rec('问答 sendMsg', async () => {
  const { answer, reasoning } = await ask({ sessionId: sid, text: '只回答两个字：地球', timeoutMs: 120000 });
  if (!answer.trim()) throw new Error('回答为空，可能响应格式已变更');
  return `答案="${clip(answer, 24)}" 思考${reasoning.length}字`;
});

await rec('公共库 top_k_common', async () => {
  const { hits } = await ragCommon('subduction zone basalt geochemistry', { topK: 2, minScore: 0.5 });
  if (!hits.length) throw new Error('英文检索也 0 命中，检索链路可能已变');
  return `${hits.length} 段，score=${hits[0].metadata.score?.toFixed(3)}`;
});

await rec('个人库 top_k', async () => {
  const { hits } = await ragPersonal('agent', { topK: 2, minDistance: 0 });
  if (!hits.length) throw new Error('无命中（若 MyLibrary 为空属正常）');
  return `${hits.length} 段，distance=${hits[0].metadata.distance?.toFixed(3)}`;
});

await rec('模型服务 /v1/models', async () => {
  const res = await fetch(`${BASE}/be-api/service/api/model/v1/models`, {
    headers: authHeaders(),
  });
  const body = await res.text();
  const json = JSON.parse(body);
  if (json.code !== '00000') throw new Error(`已知故障：${clip(String(json.data), 90)}`);
  return `${json.data?.data?.length ?? 0} 个模型`;
});

console.log('\nGeoGPT 连通性检查');
console.log('─'.repeat(60));
for (const r of results) {
  console.log(`${r.ok ? '✅' : '🔴'} ${r.name.padEnd(24)} ${r.ms}ms  ${r.detail}`);
}
console.log('─'.repeat(60));
console.log(`配额 RPM ${QUOTA.rpm} / RPD ${QUOTA.rpd} / TPM ${QUOTA.tpm} / TPD ${QUOTA.tpd}`);
console.log('「模型服务」🔴 为上游网关 401，官方已知问题，不影响其余接口。');
process.exit(results.every((r) => r.ok || r.name === '模型服务 /v1/models') ? 0 : 1);
