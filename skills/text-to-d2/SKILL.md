---
name: text-to-d2
description: 文本转 D2 图表（text-to-d2）：融合语义抽取与视觉交付——从长文本抽取逻辑结构（判断/条件/因果/角色/泳道分组，支持 evidence 溯源），自动映射为 shape 语义化 D2 图表，浏览器本地 WASM 渲染，产单文件离线交互预览页，可导出 SVG/PNG/PDF。适用于把文档/流程说明/事故分析/方案描述转成精美架构图、流程图、因果图。当用户要求把一段文字/文档转成图、画流程图/架构图/因果图时使用。text to diagram, d2, architecture diagram, flowchart
---

# Skill: text-to-d2（文本转 D2 图表）

融合两个前任 skill 的优势：**text-to-diagram 的语义抽取规范**（类型决策表、条件分支规则、泳道分组）+ **d2-chart 的生成与交付链**（双层校验、shape 白名单、本地渲染、离线预览页）。

你负责 Step 1/2（理解文本、抽取语义 JSON）；Step 3/4 由脚本完成（转换、校验、渲染）。你**不直接写 D2 源码**。

## 工作流

### Step 1 判断可行性

- 文本含真实流程/结构/因果 → 继续；
- 纯概念罗列、无可抽取关系 → 输出 `{"error":"cannot_extract_graph","reason":"..."}`；
- **复杂时序**（多参与者往返消息）→ 建议用户改用 Mermaid，本 skill 时序场景已硬拦截；
- 用户要的是单张架构/关系图（无长文本）→ 跳过抽取规范直接给简版 TTG JSON 也行。

### Step 2 语义抽取（产 TTG JSON）

```json
{
  "graphMeta": { "title": "整图标题", "graphKind": "flowchart|causal_graph|collaboration_diagram", "allowCycle": true },
  "nodes": [
    { "id": "n1", "label": "≤12字短标签", "nodeType": "process|decision|entity|role|state|note", "description": "可选，供人复核，不进图" }
  ],
  "links": [
    { "source": "n1", "target": "n2", "linkType": "sequence|condition|causal|association|feedback", "label": "条件/触发原因", "evidence": "可选，原文子串" }
  ],
  "groups": [
    { "id": "g1", "label": "阶段/集群名", "kind": "phase|cluster", "members": ["n1", "n2"] }
  ]
}
```

**三条硬规则**（桥会拦截，违反即失败）：
1. 出度 ≥2（有向流转，association 不计）的节点必须 `nodeType: "decision"`；
2. `condition` 连线**必须**带 label 写明条件（「通过」「不通过」）；
3. `label ≤ 12 字`（硬上限 16），长句进 `description`。

**类型决策表**：动作/步骤→`process`；判断/分支→`decision`；事物/数据→`entity`；谁在干→`role`；结果/状态→`state`；备注→`note`。
**关系选择**：先后→`sequence`；条件分支→`condition`（必带 label）；A 导致 B→`causal`；相关无流向→`association`；回环→`feedback`（需 `allowCycle: true`）。
**分组经验**：节点 ≥10 且主干线性时按阶段 `groups` 分组（泳道），可读性远高于长链。节点数控制在 6–20。
**诚实原则**：忠于原文，不编造节点与关系；`evidence` 必须是原文真实子串，拿不准就省略。

### Step 3 一键转换生成（脚本完成）

把 TTG JSON 存为 `graph.ttg.json`，执行：

```bash
node scripts/ttg_to_spec.mjs graph.ttg.json -o mychart --preview
```

脚本自动完成：桥转换（语义→视觉映射）→ spec 结构校验 → D2 生成 → 真实编译器验证 → 输出 `mychart.json`（spec 中间层）+ `mychart.d2` + `mychart-preview.html`（7.8MB 单文件，内嵌引擎，双击离线可用）。

语义 → 视觉映射（桥自动处理）：

| 抽取层语义 | 视觉呈现 |
|---|---|
| `process` / `entity` | rectangle |
| `decision` | diamond（菱形判断） |
| `role` | person |
| `state` | oval |
| `note` | callout |
| `condition` | 箭头 + 必填条件标签 |
| `feedback` | 虚线箭头 |
| `association` | 双向连线 `<->` |
| `groups` | 容器分组框（每节点至多一组，多组时桥取首组并告警） |
| `graphMeta.title` | D2 顶层标题 |

- 失败：逐条打印 `[路径] 错误` + 修复提示 → 修正 TTG JSON → 重跑（自动修复循环）；
- WARN 行（如长标签、未分组长链）不阻塞，但建议采纳。

### Step 4 交付

- 告知用户：双击 `mychart-preview.html` 离线预览；网页内可改源码（Ctrl+Enter 重渲染）、切主题/布局/手绘风、导出 SVG/PNG、打印 PDF；
- 打开无响应时页面会提示：`python3 -m http.server` 起本地服务或改用 Firefox（个别浏览器对 file:// 的 Worker 有限制）；
- 高要求场景（对外汇报）：导出 SVG 后可用 page-visual-review skill 做识图审查（文字重叠、连线压字、对比度），major 问题回改后重导；
- 仅需校验已有 D2 文件：`node scripts/check_d2.mjs file.d2`。

## 避坑清单（全部经编译器实测）

1. **shape 表不可凭记忆**：D2 没有 `database`/`component`——数据库用 `cylinder`（手动场景），组件用 `rectangle`/`package`；
2. **容器作用域**：容器内节点连线必须 `SYS.W` 限定路径——桥自动处理，手写 D2 必错；
3. **连线样式**：必须 `style.xxx: 值` 形式且值不带引号；
4. **手绘开关**：d2-config 里是 `sketch: true`；
5. **大图性能**：WASM 渲染建议 ≤ 50 节点；高品质 PNG 用本地 d2 CLI。

## 项目结构与脚本

```
scripts/ttg_to_spec.mjs   # 语义桥：TTG JSON → spec → 校验 → D2 → 编译验证（一键，--preview 出预览页）
scripts/generate.mjs      # 直接从 spec 生成（跳过抽取层；也支持 --from-d2）
scripts/validate_spec.mjs # spec 结构校验
scripts/json_to_d2.mjs    # spec → D2（title/双向/容器作用域/样式自动处理）
scripts/check_d2.mjs      # D2 语法校验 CLI
scripts/build_preview.mjs # 单文件内嵌预览页生成
web/index.html            # 双栏预览页（http 服务下访问 web/）
vendor/d2.browser.js      # @terrastruct/d2 v0.1.33 浏览器构建（wasm 内嵌）
test/                     # node --test test/*.test.mjs（含真实编译集成测试）
```

依赖：`npm install`（仅 `@terrastruct/d2`；其 CJS 入口与 `"type": "module"` 冲突，Node 中一律 `import()`）。
