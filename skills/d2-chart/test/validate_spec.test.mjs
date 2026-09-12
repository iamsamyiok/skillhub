'use strict';
// validate_spec 校验器测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../scripts/validate_spec.mjs';

const okSpec = {
  chart_type: 'architecture',
  direction: 'right',
  nodes: [
    { id: 'A', label: '用户', shape: 'person' },
    { id: 'B', label: 'Agent', shape: 'hexagon' }
  ],
  connections: [{ from: 'A', to: 'B', label: '提交文本' }],
  containers: [{ id: 'Sys', label: 'AI绘图系统', children: ['B'] }],
  style: { theme: 300, sketch: false }
};

test('合法 spec 通过校验', () => {
  const r = validateSpec(okSpec);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('节点 id 重复被拦截', () => {
  const r = validateSpec({ ...okSpec, nodes: [{ id: 'A', label: 'x' }, { id: 'A', label: 'y' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.message.includes('重复')));
});

test('连接引用不存在的节点被拦截（D2 隐式建点 bug 的前置防线）', () => {
  const r = validateSpec({ ...okSpec, connections: [{ from: 'A', to: 'NOPE' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.message.includes('NOPE')));
});

test('节点 id 含空白被拦截', () => {
  const r = validateSpec({ ...okSpec, nodes: [{ id: 'my node', label: 'x' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path.includes('id') && e.message.includes('空白')));
});

test('非法 shape 被拦截并列出可用值', () => {
  const r = validateSpec({ ...okSpec, nodes: [{ id: 'A', label: 'x', shape: 'cube' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].message.includes('cube'));
});

test('children 引用不存在节点被拦截', () => {
  const r = validateSpec({ ...okSpec, containers: [{ id: 'C', label: 'c', children: ['ghost'] }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.message.includes('ghost')));
});

test('节点重复归属两个容器被拦截', () => {
  const r = validateSpec({
    ...okSpec,
    containers: [
      { id: 'C1', label: 'c1', children: ['B'] },
      { id: 'C2', label: 'c2', children: ['B'] }
    ]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.message.includes('重复归属')));
});

test('容器 id 与节点 id 冲突被拦截', () => {
  const r = validateSpec({ ...okSpec, containers: [{ id: 'A', label: 'c', children: [] }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.message.includes('冲突')));
});

test('非法 direction 被拦截', () => {
  const r = validateSpec({ ...okSpec, direction: 'diagonal' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'direction'));
});

test('非法 theme 类型被拦截', () => {
  const r = validateSpec({ ...okSpec, style: { theme: 'dark' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'style.theme'));
});

test('非对象输入整体拒绝', () => {
  assert.equal(validateSpec(null).ok, false);
  assert.equal(validateSpec([1]).ok, false);
  assert.equal(validateSpec('x').ok, false);
});

test('chart_type=sequence 硬拦截并提示 Mermaid', () => {
  const r = validateSpec({ ...okSpec, chart_type: 'sequence' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'chart_type' && /Mermaid/.test(e.message)));
});

test('未知 chart_type 拒绝并列出可用类型', () => {
  const r = validateSpec({ ...okSpec, chart_type: 'mindmap' });
  assert.equal(r.ok, false);
  const e = r.errors.find((x) => x.path === 'chart_type');
  assert.ok(e && /mindmap/.test(e.message) && /er/.test(e.message));
});

test('连线 style 键白名单拦截拼写错误', () => {
  const r = validateSpec({
    nodes: [{ id: 'a' }, { id: 'b' }],
    connections: [{ from: 'a', to: 'b', style: { 'stoke-width': '3', animated: 'true' } }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'connections[0].style.stoke-width'));
  assert.ok(!r.errors.some((e) => e.path.includes('animated')));
});

test('连线 style 非对象拒绝', () => {
  const r = validateSpec({
    nodes: [{ id: 'a' }, { id: 'b' }],
    connections: [{ from: 'a', to: 'b', style: 'red' }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'connections[0].style'));
});

test('icon 必须是 http(s) URL', () => {
  const bad = validateSpec({ nodes: [{ id: 'a', icon: '/icons/a.png' }] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.path === 'nodes[0].icon'));
  const good = validateSpec({ nodes: [{ id: 'a', icon: 'https://example.com/a.png' }] });
  assert.equal(good.ok, true);
});

test('容器 direction 非法拒绝', () => {
  const r = validateSpec({
    nodes: [{ id: 'a' }],
    containers: [{ id: 'C', children: ['a'], direction: 'sideways' }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'containers[0].direction'));
});
