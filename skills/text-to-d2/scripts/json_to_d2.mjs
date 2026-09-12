'use strict';
// JSON spec → D2 源码转换器（模板化渲染，替代 LLM 裸写 D2）
// 关键点：容器内节点的连线必须用限定路径 containerId.nodeId，
// 否则 D2 会在顶层隐式创建同名节点（最隐蔽的错法，肉眼难查）。

import { SHAPES, DIRECTIONS } from './validate_spec.mjs';

// label 统一双引号包裹 + 转义，规避 D2 裸文本对冒号/引号/特殊字符的解析坑
function escLabel(label) {
  return '"' + String(label ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function nodeDecl(n) {
  const hasShape = n.shape && SHAPES.includes(n.shape);
  const body = [];
  if (hasShape) body.push(`shape: ${n.shape}`);
  if (n.icon) body.push(`icon: ${escLabel(n.icon)}`);
  return body.length ? `${n.id}: ${escLabel(n.label ?? n.id)} {${body.join('; ')}}` : `${n.id}: ${escLabel(n.label ?? n.id)}`;
}

/**
 * 将校验通过的 spec 渲染为 D2 源码。
 * @param {object} spec 见 SKILL.md 的 JSON 规范
 * @returns {string} D2 源码
 */
export function jsonToD2(spec) {
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const containers = Array.isArray(spec.containers) ? spec.containers : [];
  const conns = Array.isArray(spec.connections) ? spec.connections : [];

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const ownerOf = new Map(); // nodeId -> containerId
  for (const c of containers) for (const child of c.children || []) ownerOf.set(child, c.id);

  // 连线端点：容器内节点 → containerId.nodeId 限定路径
  const ref = (id) => (ownerOf.has(id) ? `${ownerOf.get(id)}.${id}` : id);

  const lines = [];

  // 0. 全局标题（D2 顶层 title 键，语法已实测）
  if (typeof spec.title === 'string' && spec.title.trim().length) {
    lines.push(`title: ${escLabel(spec.title.trim())}`);
  }

  // 1. 方向与全局配置
  if (spec.direction && DIRECTIONS.includes(spec.direction)) {
    lines.push(`direction: ${spec.direction}`);
  }
  const style = (typeof spec.style === 'object' && spec.style) || {};
  const cfg = [];
  if (Number.isInteger(style.theme)) cfg.push(`theme-id: ${style.theme}`);
  if (style.sketch === true) cfg.push('sketch: true');
  if (cfg.length) lines.push(`vars: { d2-config: { ${cfg.join('; ')} } }`);
  if (lines.length) lines.push('');

  // 2. 容器（含归属节点）
  for (const c of containers) {
    const kids = (c.children || []).map((id) => nodeById.get(id)).filter(Boolean);
    lines.push(`${c.id}: ${escLabel(c.label ?? c.id)} {`);
    for (const k of kids) lines.push('  ' + nodeDecl(k));
    if (c.direction && DIRECTIONS.includes(c.direction)) lines.push(`  direction: ${c.direction}`);
    lines.push('}');
    lines.push('');
  }

  // 3. 顶层裸节点（未被任何容器收编）
  for (const n of nodes) {
    if (!ownerOf.has(n.id)) lines.push(nodeDecl(n));
  }
  if (nodes.some((n) => !ownerOf.has(n.id))) lines.push('');

  // 4. 连线
  for (const c of conns) {
    const label = c.label != null && String(c.label).length ? `: ${escLabel(c.label)}` : '';
    // 连线内联样式块要求 style.xxx 形式（D2 语法：a -> b {style.stroke-dash: 4}），值不带引号
    const styleTail = c.style && typeof c.style === 'object' && Object.keys(c.style).length
      ? ` {${Object.entries(c.style).map(([k, v]) => `style.${k}: ${JSON.stringify(String(v)).replace(/^"|"$/g, '')}`).join('; ')}}`
      : '';
    const arrow = c.bidirectional === true ? '<->' : '->';
    lines.push(`${ref(c.from)} ${arrow} ${ref(c.to)}${label}${styleTail}`);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
