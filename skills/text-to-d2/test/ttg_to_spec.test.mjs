import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ttgToSpec } from '../scripts/ttg_to_spec.mjs';
import { validateSpec } from '../scripts/validate_spec.mjs';
import { jsonToD2 } from '../scripts/json_to_d2.mjs';

const okTtg = {
  graphMeta: { title: '请假审批流', graphKind: 'flowchart', allowCycle: false },
  nodes: [
    { id: 'n1', label: '提交申请', nodeType: 'process' },
    { id: 'n2', label: '材料齐全?', nodeType: 'decision' },
    { id: 'n3', label: '主管', nodeType: 'role' },
    { id: 'n4', label: '已归档', nodeType: 'state' },
    { id: 'n5', label: '时限5个工作日', nodeType: 'note' }
  ],
  links: [
    { source: 'n1', target: 'n2', linkType: 'sequence', evidence: '提交请假申请' },
    { source: 'n2', target: 'n3', linkType: 'condition', label: '齐全' },
    { source: 'n3', target: 'n4', linkType: 'sequence' },
    { source: 'n5', target: 'n2', linkType: 'association' }
  ],
  groups: [{ id: 'g1', label: '受理阶段', kind: 'phase', members: ['n1', 'n2'] }]
};

test('nodeType→shape 语义映射', () => {
  const r = ttgToSpec(okTtg);
  assert.equal(r.ok, true);
  const byId = Object.fromEntries(r.spec.nodes.map((n) => [n.id, n.shape]));
  assert.equal(byId.n1, 'rectangle');
  assert.equal(byId.n2, 'diamond');
  assert.equal(byId.n3, 'person');
  assert.equal(byId.n4, 'oval');
  assert.equal(byId.n5, 'callout');
});

test('graphKind→chart_type 与 direction', () => {
  assert.equal(ttgToSpec(okTtg).spec.direction, 'down');
  assert.equal(ttgToSpec(okTtg).spec.chart_type, 'flowchart');
  const causal = ttgToSpec({ ...okTtg, graphMeta: { ...okTtg.graphMeta, graphKind: 'causal_graph' } });
  assert.equal(causal.spec.chart_type, 'relation');
  assert.equal(causal.spec.direction, 'right');
});

test('condition 必带 label 硬拦截', () => {
  const r = ttgToSpec({
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    links: [{ source: 'a', target: 'b', linkType: 'condition' }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'links[0].label' && /condition/.test(e.message)));
});

test('feedback→虚线、association→双向、sequence→普通箭头', () => {
  const r = ttgToSpec({
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }],
    links: [
      { source: 'a', target: 'b', linkType: 'sequence' },
      { source: 'b', target: 'a', linkType: 'feedback' },
      { source: 'c', target: 'd', linkType: 'association' }
    ]
  });
  assert.equal(r.ok, true);
  const [seq, fb, assoc] = r.spec.connections;
  assert.equal(seq.bidirectional, undefined);
  assert.deepEqual(fb.style, { 'stroke-dash': '4' });
  assert.equal(assoc.bidirectional, true);
});

test('groups 多组归属取首组并告警', () => {
  const r = ttgToSpec({
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    links: [],
    groups: [
      { id: 'g1', label: '一组', members: ['a', 'b'] },
      { id: 'g2', label: '二组', members: ['a'] }
    ]
  });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /已归属更早的分组/.test(w.message)));
  const g2 = r.spec.containers.find((c) => c.id === 'g2');
  assert.deepEqual(g2.children, []);
});

test('members 引用缺失拦截', () => {
  const r = ttgToSpec({
    nodes: [{ id: 'a', label: 'A' }],
    links: [],
    groups: [{ id: 'g1', label: '组', members: ['ghost'] }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /ghost/.test(e.message)));
});

test('title 与 evidence 处理', () => {
  const r = ttgToSpec(okTtg);
  assert.equal(r.spec.title, '请假审批流');
  assert.equal(JSON.stringify(r.spec).includes('evidence'), false);
});

test('未知 nodeType/linkType/graphKind 拦截', () => {
  const r = ttgToSpec({
    graphMeta: { graphKind: 'mindmap' },
    nodes: [{ id: 'a', label: 'A', nodeType: 'button' }],
    links: [{ source: 'a', target: 'a', linkType: 'teleport' }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'graphMeta.graphKind'));
  assert.ok(r.errors.some((e) => e.path === 'nodes[0].nodeType'));
  assert.ok(r.errors.some((e) => e.path === 'links[0].linkType'));
});

test('端到端：桥输出通过 spec 校验与真实 D2 编译', async () => {
  const r = ttgToSpec(okTtg);
  assert.equal(r.ok, true);
  const v = validateSpec(r.spec);
  assert.deepEqual(v.errors, []);
  const d2 = jsonToD2(r.spec);
  const { D2 } = await import('@terrastruct/d2');
  const d2c = new D2();
  const src = d2.includes('<->') ? d2 : jsonToD2({ ...r.spec });
  await d2c.compile(src, { layout: 'dagre' });
  assert.ok(src.includes('title: "请假审批流"'));
  assert.ok(src.includes('<->'));
  process.exit(0); // Go WASM 运行时不会自行退出
});
