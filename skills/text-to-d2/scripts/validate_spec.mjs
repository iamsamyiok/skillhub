'use strict';
// D2 图表 JSON 中间层校验器
// 在 JSON → D2 转换前拦截结构性错误：id 重复、引用缺失、非法 shape/方向。
// 注意：D2 对 a -> zzz 会隐式创建节点不报错，引用完整性只能在这里校验。

// 以下 shape 清单经 @terrastruct/d2 v0.1.33 编译器逐一实测（凭记忆的官方 shape 表不可靠：
// 例如 database / component 均不存在——数据库用 cylinder，服务/组件用 rectangle 或 package）
export const SHAPES = [
  'rectangle', 'square', 'circle', 'diamond', 'person', 'cloud',
  'cylinder', 'hexagon', 'queue', 'oval',
  'page', 'document', 'parallelogram', 'stored_data',
  'package', 'callout', 'code', 'text', 'step'
];

export const DIRECTIONS = ['right', 'left', 'up', 'down'];

export const CHART_TYPES = ['flowchart', 'architecture', 'relation', 'org', 'er'];

// 连线 style 键白名单（D2 connection style 常用键；非法键会直通编译器报晦涩错）
export const CONNECTION_STYLE_KEYS = [
  'stroke', 'stroke-width', 'stroke-dash', 'fill',
  'font-size', 'font-color', 'animated', 'bold', 'italic', 'underline', 'opacity'
];

// 语义 → 视觉映射表由 ttg_to_spec.mjs 定义；本层只关心结构合法性

// id 合法性：非空、无空白（D2 键不允许裸空格；转换器按原样输出）
export function validId(id) {
  return typeof id === 'string' && id.length > 0 && !/\s/.test(id);
}

/**
 * 校验图表 spec JSON，返回 { ok, errors: [{ path, message }] }
 * @param {object} spec
 */
export function validateSpec(spec) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { ok: false, errors: [{ path: '$', message: 'spec 必须是 JSON 对象' }] };
  }

  // chart_type（sequence 一律拦截：转换器产普通流程图会误导用户，官方也建议时序用 Mermaid）
  if (spec.chart_type !== undefined && !CHART_TYPES.includes(spec.chart_type)) {
    err('chart_type', `未知图表类型 "${spec.chart_type}"，可用：${CHART_TYPES.join(', ')}`);
  }
  if (spec.chart_type === 'sequence') {
    err('chart_type', '时序图场景请改用 Mermaid（skill 约定：复杂时序不产出 D2，避免误导用户）');
  }

  // direction
  if (spec.direction !== undefined && !DIRECTIONS.includes(spec.direction)) {
    err('direction', `方向 "${spec.direction}" 非法，可用：${DIRECTIONS.join(', ')}`);
  }

  // title（可选，渲染为 D2 顶层标题）
  if (spec.title !== undefined && (typeof spec.title !== 'string' || !spec.title.trim().length)) {
    err('title', 'title 必须是非空字符串');
  }

  // nodes
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  if (spec.nodes !== undefined && !Array.isArray(spec.nodes)) err('nodes', 'nodes 必须是数组');
  const ids = new Set();
  nodes.forEach((n, i) => {
    const p = `nodes[${i}]`;
    if (!n || typeof n !== 'object') { err(p, '节点必须是对象'); return; }
    if (!validId(n.id)) { err(`${p}.id`, `节点 id 非空且不能含空白，当前：${JSON.stringify(n.id)}`); return; }
    if (ids.has(n.id)) err(`${p}.id`, `节点 id 重复："${n.id}"`);
    ids.add(n.id);
    if (n.shape !== undefined && !SHAPES.includes(n.shape)) {
      err(`${p}.shape`, `非法 shape "${n.shape}"，可用：${SHAPES.join(', ')}`);
    }
    if (n.icon !== undefined && (typeof n.icon !== 'string' || !/^https?:\/\//.test(n.icon))) {
      err(`${p}.icon`, 'icon 必须是 http(s) 远程 URL（本地路径在离线单文件预览页中无法显示）');
    }
    if (n.label !== undefined && typeof n.label !== 'string') err(`${p}.label`, 'label 必须是字符串');
  });

  // containers
  const containers = Array.isArray(spec.containers) ? spec.containers : [];
  if (spec.containers !== undefined && !Array.isArray(spec.containers)) err('containers', 'containers 必须是数组');
  const cIds = new Set();
  const nodeOwner = new Map(); // nodeId -> containerId
  containers.forEach((c, i) => {
    const p = `containers[${i}]`;
    if (!c || typeof c !== 'object') { err(p, '容器必须是对象'); return; }
    if (!validId(c.id)) { err(`${p}.id`, `容器 id 非空且不能含空白，当前：${JSON.stringify(c.id)}`); return; }
    if (cIds.has(c.id)) err(`${p}.id`, `容器 id 重复："${c.id}"`);
    if (ids.has(c.id)) err(`${p}.id`, `容器 id 与节点 id 冲突："${c.id}"`);
    cIds.add(c.id);
    if (c.direction !== undefined && !DIRECTIONS.includes(c.direction)) {
      err(`${p}.direction`, `容器内布局方向 "${c.direction}" 非法，可用：${DIRECTIONS.join(', ')}`);
    }
    if (!Array.isArray(c.children)) { err(`${p}.children`, 'children 必须是数组'); return; }
    c.children.forEach((child) => {
      if (!ids.has(child)) {
        err(`${p}.children`, `children 引用了不存在的节点："${child}"`);
      } else if (nodeOwner.has(child)) {
        err(`${p}.children`, `节点 "${child}" 已属于容器 "${nodeOwner.get(child)}"，不能重复归属`);
      } else {
        nodeOwner.set(child, c.id);
      }
    });
  });

  // connections
  const conns = Array.isArray(spec.connections) ? spec.connections : [];
  if (spec.connections !== undefined && !Array.isArray(spec.connections)) err('connections', 'connections 必须是数组');
  conns.forEach((c, i) => {
    const p = `connections[${i}]`;
    if (!c || typeof c !== 'object') { err(p, '连接必须是对象'); return; }
    for (const k of ['from', 'to']) {
      if (!validId(c[k])) { err(`${p}.${k}`, `连接端点必须是合法 id，当前：${JSON.stringify(c[k])}`); }
      else if (!ids.has(c[k]) && !cIds.has(c[k])) {
        err(`${p}.${k}`, `连接引用了不存在的节点："${c[k]}"`);
      }
    }
    if (c.style !== undefined) {
      if (typeof c.style !== 'object' || c.style === null || Array.isArray(c.style)) {
        err(`${p}.style`, 'style 必须是对象');
      } else {
        for (const k of Object.keys(c.style)) {
          if (!CONNECTION_STYLE_KEYS.includes(k)) {
            err(`${p}.style.${k}`, `非法连线样式键 "${k}"，可用：${CONNECTION_STYLE_KEYS.join(', ')}`);
          }
        }
      }
    }
  });

  // style
  if (spec.style !== undefined) {
    if (typeof spec.style !== 'object' || spec.style === null || Array.isArray(spec.style)) {
      err('style', 'style 必须是对象');
    } else {
      if (spec.style.theme !== undefined && !Number.isInteger(spec.style.theme)) {
        err('style.theme', `theme 必须是整数（D2 主题 id，如 0 / 200 / 300），当前：${JSON.stringify(spec.style.theme)}`);
      }
      if (spec.style.sketch !== undefined && typeof spec.style.sketch !== 'boolean') {
        err('style.sketch', 'sketch 必须是布尔值');
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
