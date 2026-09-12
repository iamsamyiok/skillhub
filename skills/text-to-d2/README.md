# text-to-d2

文本转 D2 图表：融合 **text-to-diagram**（语义抽取规范）与 **d2-chart**（生成与交付链）的新 skill。

**链路**：长文本 → TTG 语义 JSON（LLM 抽取）→ 语义桥转换 → spec 校验 → D2 生成 → 真实编译器验证 → 单文件离线交互预览页（WASM 渲染，导出 SVG/PNG/PDF）。

## 快速开始

```bash
npm install          # 仅 @terrastruct/d2

# 一键：TTG 语义 JSON → spec + D2 + 预览页
node scripts/ttg_to_spec.mjs graph.ttg.json -o mychart --preview

# 已有 spec（跳过抽取层）
node scripts/generate.mjs spec.json -o mychart --preview

# 校验已有 D2 文件
node scripts/check_d2.mjs mychart.d2

# 测试（32 例，含真实编译集成）
npm test
```

## TTG 语义 Schema（抽取层产出）

```json
{
  "graphMeta": { "title": "标题", "graphKind": "flowchart", "allowCycle": false },
  "nodes": [
    { "id": "n1", "label": "≤12字", "nodeType": "process|decision|entity|role|state|note" }
  ],
  "links": [
    { "source": "n1", "target": "n2", "linkType": "sequence|condition|causal|association|feedback", "label": "条件必填" }
  ],
  "groups": [
    { "id": "g1", "label": "阶段", "kind": "phase|cluster", "members": ["n1"] }
  ]
}
```

三条硬规则（桥强制）：出度 ≥2 必须 `decision`；`condition` 必带 label；`label ≤ 12 字`。

## 语义 → 视觉映射（桥自动处理）

| 抽取语义 | 视觉呈现 |
|---|---|
| process / entity | rectangle |
| decision | diamond |
| role | person |
| state | oval |
| note | callout |
| condition | 箭头 + 必填条件标签 |
| feedback | 虚线箭头 |
| association | 双向 `<->` |
| groups | 容器分组框 |
| graphMeta.title | D2 顶层标题 |

## 与两个前任 skill 的关系

- 继承 text-to-diagram：类型决策表、condition 硬规则、泳道分组经验、evidence 溯源、`cannot_extract_graph` 失败协议
- 继承 d2-chart：双层校验（结构 + 编译器）、实测 shape 白名单、容器作用域限定路径、单文件离线预览页
- 复杂时序场景：硬拦截并提示 Mermaid（两个前任的共识）
