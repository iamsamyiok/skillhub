# d2-chart-skill

D2 图表生成 Agent Skill：自然语言 → JSON 中间层 → D2 源码 → 双层校验 → 浏览器本地渲染预览（WASM，离线可用）。

## 为什么有这个 skill

LLM 直接写 D2 源码的错误率很高：括号不匹配、容器作用域漏限定（`SYS.W` 写成 `W` 导致隐式建节点）、shape 名写错、块字符串未闭合。更隐蔽的是 D2 对 `a -> zzz` 会**静默创建新节点**，引用写错肉眼难查。

本 skill 在 LLM 与 D2 之间加一层结构化 JSON 中间层：

```
自然语言 → JSON spec（LLM 产出） → validateSpec 结构校验 → jsonToD2 转换
        → 真实编译器编译验证 → mychart.d2 + 单文件预览页
```

每一层失败都输出结构化错误（行:列 + 人话提示），形成自动修复循环。

## 快速开始

```bash
# 安装依赖（仅 @terrastruct/d2 v0.1.33）
npm install

# 一键生成：spec.json → mychart.d2 + mychart-preview.html
node scripts/generate.mjs spec.json -o mychart --preview

# 已有 D2 文件：直接编译验证 + 出预览页
node scripts/generate.mjs --from-d2 已有图.d2 --preview

# 只校验已有 D2 文件
node scripts/check_d2.mjs mychart.d2

# 跑测试（含真实编译集成测试）
npm test
```

双击 `mychart-preview.html` 即可离线预览：双栏编辑/预览、切换主题与布局、手绘风、导出 SVG/PNG、打印 PDF。

## spec.json 格式

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
    { "id": "SYS", "label": "系统", "children": ["W"] }
  ],
  "style": { "theme": 300, "sketch": false }
}
```

字段约束见 `SKILL.md`（shape 19 种白名单、direction 4 向、chart_type 5 类、每节点至多一个容器、连线必须引用存在的 id、连线 style 键白名单）。

## 目录结构

```
scripts/generate.mjs       一键链路
scripts/validate_spec.mjs  JSON 中间层校验
scripts/json_to_d2.mjs     JSON → D2 转换（容器作用域/转义/样式自动处理）
scripts/check_d2.mjs       D2 语法校验 CLI
scripts/build_preview.mjs  生成单文件内嵌预览页
web/index.html             双栏预览页（http 服务下访问 web/，或用 --preview 生成单文件版）
vendor/d2.browser.js       @terrastruct/d2 浏览器构建（wasm 内嵌，8MB）
test/                      node --test，19 例含真实编译集成
SKILL.md                   Agent Skill 定义（工作流/系统提示词/避坑清单）
```

## 预览页部署方式

- **单文件版**（推荐交付）：`--preview` 生成，双击即用，已内嵌渲染引擎与图表源码；
- **web 服务版**：在项目根起 `python3 -m http.server 8899`，访问 `http://localhost:8899/web/`（库经 `../vendor/d2.browser.js` 加载，改源码即时重渲染）；
- 浏览器对 file:// 的 Worker 有限制时，页面会提示改用 http.server 或 Firefox。

## 已知限制

- 复杂时序图建议改用 Mermaid（D2 时序能力有限）；
- WASM 渲染建议 ≤ 50 节点；高品质 PNG/导出更多格式用本地 d2 CLI；
- `@terrastruct/d2` 的 CJS 入口与其 `"type": "module"` 冲突（官方包 bug），Node 中一律 `import()`。
