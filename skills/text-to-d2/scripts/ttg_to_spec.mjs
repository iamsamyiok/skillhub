#!/usr/bin/env node
'use strict';
// TTG 语义 JSON（text-to-diagram 抽取层产出）→ D2 spec（d2-chart 生成层输入）转换桥。
// 语义 → 视觉映射：
//   nodeType: process→rectangle  decision→diamond  role→person  state→oval  note→callout  entity→rectangle
//   linkType: sequence|causal→实线箭头  condition→箭头+必填label  feedback→虚线箭头  association→双向<->
//   graphKind: flowchart→down  causal_graph|collaboration_diagram→right
//   groups → containers（ttg 允许一节点多组，d2-chart 每节点至多一容器：只归第一组，其余出 warning）
//   graphMeta.title → spec.title（渲染为 D2 顶层标题，语法已实测）
//   evidence 抽取层溯源用，不进图

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec, CONNECTION_STYLE_KEYS } from './validate_spec.mjs';
import { jsonToD2 } from './json_to_d2.mjs';

export const NODE_TYPE_SHAPE = {
  process: 'rectangle',
  decision: 'diamond',
  role: 'person',
  state: 'oval',
  note: 'callout',
  entity: 'rectangle'
};

export const GRAPH_KIND_DIRECTION = {
  flowchart: 'down',
  causal_graph: 'right',
  collaboration_diagram: 'right'
};

const VALID_NODE_TYPES = Object.keys(NODE_TYPE_SHAPE);
const VALID_LINK_TYPES = ['sequence', 'condition', 'causal', 'association', 'feedback'];
const VALID_GRAPH_KINDS = ['flowchart', 'causal_graph', 'collaboration_diagram'];

/**
 * TTG JSON → spec。返回 { ok, errors, warnings, spec }。
 * @param {object} ttg 符合 text-to-diagram Schema 的 JSON
 */
export function ttgToSpec(ttg) {
  const errors = [];
  const warnings = [];
  const err = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });

  if (!ttg || typeof ttg !== 'object' || Array.isArray(ttg)) {
    return { ok: false, errors: [{ path: '$', message: 'TTG JSON 必须是对象' }], warnings, spec: null };
  }

  const nodes = Array.isArray(ttg.nodes) ? ttg.nodes : [];
  const links = Array.isArray(ttg.links) ? ttg.links : [];
  const groups = Array.isArray(ttg.groups) ? ttg.groups : [];
  const meta = (typeof ttg.graphMeta === 'object' && ttg.graphMeta) || {};

  // 1. graphMeta
  let chartType;
  if (meta.graphKind !== undefined) {
    if (!VALID_GRAPH_KINDS.includes(meta.graphKind)) {
      err('graphMeta.graphKind', `未知图类 "${meta.graphKind}"，可用：${VALID_GRAPH_KINDS.join(', ')}`);
    }
    chartType = meta.graphKind === 'collaboration_diagram' ? 'architecture' : meta.graphKind === 'causal_graph' ? 'relation' : 'flowchart';
  }

  // 2. nodes：nodeType → shape
  const ids = new Set();
  const specNodes = [];
  nodes.forEach((n, i) => {
    const p = `nodes[${i}]`;
    if (!n || typeof n !== 'object') { err(p, '节点必须是对象'); return; }
    if (typeof n.id !== 'string' || !n.id.length || /\s/.test(n.id)) {
      err(`${p}.id`, `节点 id 非空且不能含空白，当前：${JSON.stringify(n.id)}`); return;
    }
    if (ids.has(n.id)) err(`${p}.id`, `节点 id 重复："${n.id}"`);
    ids.add(n.id);
    let shape = 'rectangle';
    if (n.nodeType !== undefined) {
      if (!VALID_NODE_TYPES.includes(n.nodeType)) {
        err(`${p}.nodeType`, `未知节点类型 "${n.nodeType}"，可用：${VALID_NODE_TYPES.join(', ')}`);
      } else {
        shape = NODE_TYPE_SHAPE[n.nodeType];
      }
    }
    if (typeof n.label !== 'string' || !n.label.length) err(`${p}.label`, 'label 必须是非空字符串');
    else if (n.label.length > 16) warn(`${p}.label`, `label ${n.label.length} 字超过建议上限 16，节点会偏大`);
    specNodes.push({ id: n.id, label: n.label ?? n.id, shape });
  });

  // 3. links：linkType → 箭头/双向/虚线；condition 必带 label（ttg 硬规则）
  const specConns = [];
  links.forEach((l, i) => {
    const p = `links[${i}]`;
    if (!l || typeof l !== 'object') { err(p, '连线必须是对象'); return; }
    for (const k of ['source', 'target']) {
      if (typeof l[k] !== 'string' || !l[k].length) { err(`${p}.${k}`, `连线端点必须是字符串，当前：${JSON.stringify(l[k])}`); }
      else if (!ids.has(l[k])) { err(`${p}.${k}`, `连线引用了不存在的节点："${l[k]}"`); }
    }
    let linkType = 'sequence';
    if (l.linkType !== undefined) {
      if (!VALID_LINK_TYPES.includes(l.linkType)) {
        err(`${p}.linkType`, `未知连线类型 "${l.linkType}"，可用：${VALID_LINK_TYPES.join(', ')}`);
      } else {
        linkType = l.linkType;
      }
    }
    if (linkType === 'condition' && (typeof l.label !== 'string' || !l.label.trim().length)) {
      err(`${p}.label`, 'condition 连线必须写明条件 label（如「通过」「不通过」），否则读者无法判断分支走向');
    }
    if (typeof l.label === 'string' && l.label.length > 20) warn(`${p}.label`, '连线标签偏长（>20 字），建议精简');
    const conn = { from: l.source, to: l.target, label: l.label ?? '' };
    if (linkType === 'association') conn.bidirectional = true;
    if (linkType === 'feedback') conn.style = { 'stroke-dash': '4' };
    specConns.push(conn);
  });

  // 4. groups → containers（首组归属，重复归属 warning）
  const containers = [];
  const owner = new Set();
  groups.forEach((g, i) => {
    const p = `groups[${i}]`;
    if (!g || typeof g !== 'object') { err(p, '分组必须是对象'); return; }
    if (typeof g.id !== 'string' || !g.id.length || /\s/.test(g.id)) { err(`${p}.id`, `分组 id 非空且不能含空白，当前：${JSON.stringify(g.id)}`); return; }
    if (!Array.isArray(g.members)) { err(`${p}.members`, 'members 必须是数组'); return; }
    const kids = [];
    for (const m of g.members) {
      if (!ids.has(m)) { err(`${p}.members`, `分组引用了不存在的节点："${m}"`); continue; }
      if (owner.has(m)) { warn(`${p}.members`, `节点 "${m}" 已归属更早的分组，本组跳过（d2-chart 每节点至多一个容器）`); continue; }
      owner.add(m);
      kids.push(m);
    }
    containers.push({ id: g.id, label: g.label ?? g.id, children: kids });
  });

  const spec = {
    chart_type: chartType,
    direction: GRAPH_KIND_DIRECTION[meta.graphKind] ?? 'right',
    nodes: specNodes,
    connections: specConns,
    containers
  };
  if (typeof meta.title === 'string' && meta.title.trim().length) spec.title = meta.title.trim();
  if (nodes.length && !groups.length && specNodes.length >= 10) {
    warn('$', '节点 ≥10 且未分组：线性长链建议在抽取层按阶段 groups 分组，可读性更好（ttg 泳道经验）');
  }

  return { ok: errors.length === 0, errors, warnings, spec };
}

// ---- CLI：一键链路 ttg.json → spec → D2 → 编译验证 → .d2 + 可选预览页 ----
const isMain = process.argv[1] && basename(process.argv[1]) === 'ttg_to_spec.mjs';
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = process.argv[2];
  if (!src) {
    console.error('用法：node scripts/ttg_to_spec.mjs <ttg.json> [-o 输出前缀] [--preview [输出.html]]');
    process.exit(2);
  }
  const argIs = (flag) => {
    const i = process.argv.indexOf(flag);
    return i < 0 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true);
  };
  const outPrefix = argIs('-o') || src.replace(/\.json$/i, '-spec');
  const wantPreview = argIs('--preview');
  const previewPath = typeof wantPreview === 'string' ? wantPreview : `${outPrefix}-preview.html`;

  let ttg;
  try {
    ttg = JSON.parse(readFileSync(src, 'utf8'));
  } catch (e) {
    console.error(`FAIL：TTG 文件不是合法 JSON：${e.message}`);
    process.exit(2);
  }

  const r = ttgToSpec(ttg);
  for (const w of r.warnings) console.log(`WARN：[${w.path}] ${w.message}`);
  if (!r.ok) {
    console.log('FAIL：TTG JSON 未通过桥校验');
    for (const e of r.errors) console.log(`  - [${e.path}] ${e.message}`);
    process.exit(1);
  }

  const v = validateSpec(r.spec);
  if (!v.ok) {
    console.log('FAIL：spec 校验未通过');
    for (const e of v.errors) console.log(`  - [${e.path}] ${e.message}`);
    process.exit(1);
  }

  const d2 = jsonToD2(r.spec);
  import('@terrastruct/d2').then(async ({ D2 }) => {
    const d2c = new D2();
    try {
      await d2c.compile(d2, { layout: 'dagre' });
    } catch (e) {
      console.log('FAIL：D2 编译未通过');
      try {
        for (const it of JSON.parse(e.message)) console.log(`  - ${(it.errmsg || '').replace(/^index:\d+:\d+:\s*/, '')}`);
      } catch { console.log('  - ' + String(e.message).slice(0, 300)); }
      process.exit(1);
    }
    writeFileSync(`${outPrefix}.json`, JSON.stringify(r.spec, null, 2) + '\n');
    writeFileSync(`${outPrefix}.d2`, d2);
    console.log(`OK：桥转换 + spec 校验 + D2 编译全部通过`);
    console.log(`  spec：${outPrefix}.json`);
    console.log(`  D2 源码：${outPrefix}.d2`);
    if (wantPreview) {
      const { execFileSync } = await import('node:child_process');
      execFileSync(process.execPath, [join(here, 'build_preview.mjs'), `${outPrefix}.d2`, previewPath], { stdio: 'inherit' });
      console.log(`  预览页：${previewPath}（双击离线打开）`);
    }
    process.exit(0);
  });
}
