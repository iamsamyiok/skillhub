'use strict';
// json_to_d2 转换器测试：结构断言 + 真实 D2 编译集成验证
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonToD2 } from '../scripts/json_to_d2.mjs';
import { validateSpec } from '../scripts/validate_spec.mjs';

const archSpec = {
  chart_type: 'architecture',
  direction: 'right',
  nodes: [
    { id: 'A', label: '用户', shape: 'person' },
    { id: 'B', label: 'Agent', shape: 'hexagon' },
    { id: 'C', label: '渲染器' }
  ],
  connections: [
    { from: 'A', to: 'B', label: '提交文本' },
    { from: 'B', to: 'C' }
  ],
  containers: [{ id: 'Sys', label: 'AI绘图系统', children: ['B', 'C'] }],
  style: { theme: 300 }
};

test('容器内节点连线使用限定路径（防止 D2 隐式建点）', () => {
  const d2 = jsonToD2(archSpec);
  assert.ok(d2.includes('Sys.A') === false); // A 在顶层
  assert.ok(d2.includes('Sys.B') && d2.includes('Sys.C'), '容器内端点必须带容器前缀\n' + d2);
  assert.ok(d2.includes('A -> Sys.B: "提交文本"'));
  assert.ok(d2.includes('Sys.C') && !d2.match(/^B ->/m), '裸 B/C 端点不允许出现');
});

test('direction 与 theme 生成全局配置', () => {
  const d2 = jsonToD2(archSpec);
  assert.ok(d2.includes('direction: right'));
  assert.ok(d2.includes('theme-id: 300'));
});

test('label 一律引号包裹并转义（防冒号/引号解析坑）', () => {
  const d2 = jsonToD2({ nodes: [{ id: 'A', label: '他说: "你好"' }], connections: [] });
  assert.ok(d2.includes('A: "他说: \\"你好\\""'));
});

test('shape 与 icon 输出在节点块内', () => {
  const d2 = jsonToD2({ nodes: [{ id: 'A', label: '云', shape: 'cloud' }], connections: [] });
  assert.ok(d2.includes('{shape: cloud}'));
});

test('sketch 开关生成 sketch-renderer 配置', () => {
  const d2 = jsonToD2({ nodes: [{ id: 'A', label: 'x' }], connections: [], style: { sketch: true } });
  assert.ok(d2.includes('sketch: true'));
});

test('空 spec 输出合法空图', () => {
  const d2 = jsonToD2({ nodes: [], connections: [] });
  assert.equal(typeof d2, 'string');
});

test('连线样式透传', () => {
  const d2 = jsonToD2({
    nodes: [{ id: 'A', label: 'a' }, { id: 'B', label: 'b' }],
    connections: [{ from: 'A', to: 'B', style: { 'stroke-width': '3' } }]
  });
  assert.ok(d2.includes('A -> B {style.stroke-width: 3}'), d2);
});

// ---------- 集成：生成的 D2 必须通过真实编译器 ----------
test('生成的 D2 通过真实 d2 编译（含容器/嵌套/样式/中文字符串）', async () => {
  const { D2 } = await import('@terrastruct/d2');
  const d2c = new D2();
  const cases = [archSpec, {
    chart_type: 'flowchart',
    direction: 'down',
    nodes: [
      { id: 's', label: '开始', shape: 'oval' },
      { id: 'p', label: '处理', shape: 'rectangle' },
      { id: 'd', label: '判断', shape: 'diamond' },
      { id: 'e', label: '结束', shape: 'oval' }
    ],
    connections: [
      { from: 's', to: 'p' },
      { from: 'p', to: 'd' },
      { from: 'd', to: 'e', label: '是' },
      { from: 'd', to: 'p', label: '否' }
    ],
    containers: []
  }, {
    chart_type: 'org',
    nodes: [
      { id: 'ceo', label: 'CEO', shape: 'person' },
      { id: 'cto', label: 'CTO', shape: 'person' },
      { id: 'coo', label: 'COO', shape: 'person' }
    ],
    connections: [
      { from: 'ceo', to: 'cto' },
      { from: 'ceo', to: 'coo' }
    ],
    containers: [{ id: 'eng', label: '技术部', children: ['cto'] }],
    style: { theme: 200, sketch: true }
  }];
  for (const spec of cases) {
    assert.equal(validateSpec(spec).ok, true);
    const src = jsonToD2(spec);
    const { diagram, renderOptions } = await d2c.compile(src, { layout: 'dagre' });
    const svg = await d2c.render(diagram, renderOptions);
    assert.ok(svg.includes('<svg'), '应产出 SVG');
  }
  process.exit(0); // Go WASM 运行时不会自行退出
});
