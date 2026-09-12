---
name: d2-chart
description: D2 图表生成：自然语言转 D2 图表，JSON 中间层防错设计（LLM 产 spec、脚本转换、结构校验 + 编译器验证双层拦截），浏览器本地 WASM 渲染，产单文件离线预览页，可导出 SVG/PNG/PDF。适用于流程图、系统架构图、关系图、组织架构图、简单 ER 图。当用户要求画图、画架构图/流程图/拓扑图、生成 D2 源码、把描述转成图表时使用。d2 diagram, chart generation, architecture diagram
---

# Skill：D2 图表生成器

你的职责：接收用户自然语言描述，生成 D2 lang 图表，并产出一个浏览器本地打开即渲染的预览页。

## 核心原则（必读）

1. **你绝不直接写 D2 源码**。先输出结构化 JSON（中间层），再用本 skill 的脚本转换。
   - 这是防错设计：LLM 裸写 D2 的高频错误（括号不匹配、容器作用域漏限定、shape 写错）全部由脚本规避；
   - D2 中 `a -> zzz` 会静默创建新节点，引用写错肉眼难查——JSON 校验层会在生成前拦住。
2. **渲染在浏览器本地完成**（WASM），无需后端、无需联网。
3. **有错误自动修复**：脚本会输出结构化错误（行:列 + 人话），按提示修正 JSON/spec 后重跑。

## 四步工作流

### Step 1 判断图表类型

| 用户意图 | chart_type | 说明 |
|---|---|---|
| 过程、步骤、流水线、判断分支 | `flowchart` | 流程图 |
| 软件模块、服务、组件、部署 | `architecture` | 架构图（D2 最强项，优先用容器分组） |
| 实体之间关联、网络拓扑 | `relation` | 关系图 |
| 汇报关系、层级从属 | `org` | 组织架构图 |
| 数据实体、表关系 | `er` | 简单 ER |
| 复杂时序（多参与者往返消息） | — | **一律告知用户改用 Mermaid**；`sequence` 已被校验层硬拦截，产出会误导用户 |

### Step 2 提取结构化 JSON（中间层）

```json
{
  "chart_type": "architecture",
  "direction": "right",
  "nodes": [
    { "id": "U", "label": "用户", "shape": "person" },
    { "id": "W", "label": "Web 前端" }
  ],
  "connections": [
    { "from": "U", "to": "W", "label": "提交文本", "style": { "stroke-dash": "4" } }
  ],
  "containers": [
    { "id": "SYS", "label": "系统", "children": ["W"], "direction": "right" }
  ],
  "style": { "theme": 300, "sketch": false }
}
```

字段规范（脚本会逐条校验，违反即报错）：
- `node.id`：简短唯一，**无空格**（大写缩写或短单词）；
- `shape` 白名单（19 种，全部经编译器实测）：`rectangle, square, circle, diamond, person, cloud, cylinder, hexagon, queue, oval, page, document, parallelogram, stored_data, package, callout, code, text, step`；
  - **没有 `database`/`component`**：数据库/存储用 `cylinder`，服务/组件用 `rectangle` 或 `package`；
- `node.icon`（可选）：必须是 `http(s)://` 远程图标 URL；注意**离线单文件预览页不显示 icon**，交付预览时优先省略；
- `direction`：`right / left / up / down`，默认 `right`；`containers[].direction` 同枚举，控制容器内部布局；
- `containers[].children`：引用存在的 node id，每个节点最多归属一个容器；
- `connections` 的 `from/to`：必须引用存在的节点或容器 id（连到容器 id 即指向整组）；
- `connections[].style` 键白名单：`stroke, stroke-width, stroke-dash, fill, font-size, font-color, animated, bold, italic, underline, opacity`；
- `style.theme`：整数主题 id，实测常用：`0` 默认（白底蓝强调）、`1` 中性灰、`4` Flagship（蓝调）、`100` Earth Tones（米棕暖色）、`200` 深色（推荐深色场景/截图）、`300` 极简黑白、`302` Origami 折纸（灰阶）；
- `style.sketch`：`true` 开启手绘风。

先自检再落盘：label 保留用户原词（中文亦可）；连线标签 ≤ 8 字；节点 4~20 个为宜，超过时先和用户确认要不要拆分层/精简。

### Step 3 生成 D2 源码（脚本，非你手写）

把 Step 2 的 JSON 存为文件（如 `spec.json`），执行：

```bash
node scripts/generate.mjs spec.json -o mychart --preview
```

- 成功：输出 `mychart.d2`（D2 源码）+ `mychart-preview.html`（7.8MB 单文件，内嵌渲染引擎，双击离线可用，自动渲染）
- 失败：打印逐条错误 → 修正 spec.json → 重跑（这就是自动修复循环）

用户手头已有 `.d2` 文件时（LLM 不产 spec，直接验证+出预览页）：

```bash
node scripts/generate.mjs --from-d2 已有图.d2 --preview
```

只要 D2 源码时省略 `--preview`；只想校验手头已有的 D2 文件：

```bash
node scripts/check_d2.mjs mychart.d2
```

### Step 4 交付

- 告知用户：双击 `mychart-preview.html` 即可离线预览；
- 网页内可编辑源码（Ctrl+Enter 重渲染）、切换主题/布局/手绘风、导出 SVG/PNG、打印为 PDF；
- 若浏览器打开后长时间无响应，页面会提示：用 `python3 -m http.server` 起本地服务访问，或改用 Firefox（个别浏览器对 file:// 的 Worker 有限制）。
- 展示生成的 D2 源码给用户（便于二次修改）；用户手改后的源码也能粘进网页直接渲染。

## 避坑清单（历史真实踩坑）

1. **容器作用域**：容器内节点的连线必须写 `SYS.W` 限定路径——脚本已自动处理，但如果你绕过脚本手写 D2 必错；
2. **shape 表不可凭记忆**：D2 没有 `database`/`component`（本文档白名单全部经编译器实测）——数据库用 `cylinder`，组件用 `rectangle`/`package`；
3. **d2-config 键名**：手绘开关是 `sketch: true`（不是 sketch-renderer）——脚本已处理；
4. **连线内联样式**：必须 `style.xxx: 值` 形式且值不带引号——脚本已处理；
5. **块字符串**：`|#` 必须以 `#|` 闭合——脚本对 label 自动引号包裹，绕开此语法；
6. **大图性能**：上百节点 WASM 渲染明显变慢，建议 ≤ 50 节点；导出 PNG 品质一般，高质量用本地 CLI `d2`（`go install` 或官网安装）。

## 项目结构与脚本

```
scripts/generate.mjs     # 一键链路：spec → 校验 → D2 → 编译验证 → .d2 + 预览页（也支持 --from-d2）
scripts/validate_spec.mjs  # JSON 中间层校验（导出 validateSpec；sequence 拦截、style 键白名单）
scripts/json_to_d2.mjs     # JSON → D2 转换（导出 jsonToD2）
scripts/check_d2.mjs       # D2 源码语法校验 CLI（exit 0/1）
scripts/build_preview.mjs  # 生成单文件内嵌预览页（--preview 自动调用）
web/index.html             # 双栏预览页模板（http 服务下直接访问 web/）
vendor/d2.browser.js       # @terrastruct/d2 v0.1.33 浏览器构建（wasm 内嵌）
test/                      # node --test test/*.test.mjs（含真实编译集成测试）
```

依赖：`npm install`（仅 `@terrastruct/d2`）。注意该包的 CJS 入口与其 `"type": "module"` 冲突（官方包 bug），Node 中一律用 `import()`。
