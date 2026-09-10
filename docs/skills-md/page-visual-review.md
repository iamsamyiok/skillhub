---
name: page-visual-review
version: 1.1.0
description: 前端界面视觉审查 skill：给网页 URL 或截图，用 AGNES agnes-2.5-flash 识图模型以资深前端 QA 视角全方位审查（美观/结构/可用性/一致性四维评分 + 16 类 LLM 生成页面高频缺陷模式库 + 响应式三视口对比 + 放大微观复查），输出精确、Agent 可直接执行修复的结构化问题报告与改进建议。适用于：Agent 生成前端后的自检、页面验收、布局问题排查、美化改进。
---

# page-visual-review — 前端界面视觉审查

解决"大模型看不到自己写的页面长什么样"的问题：代码写完 ≠ 页面没问题。本 skill 截图真实渲染结果，用识图模型对照 **LLM 生成页面高频缺陷模式库** 逐项排查，产出结构化报告（位置三要素 + 证据 + 影响 + 可执行修复 + 置信度 + 四维评分 + 优先级改进建议），供用户阅读或直接交给编码 Agent 修复。

## 何时使用

- Agent 生成/修改 HTML 页面后的自检（强烈建议成为前端任务的固定收尾步骤）
- 用户反馈"页面看起来不对"但描述模糊时，先跑本 skill 定位问题
- 页面验收、美化改进前的现状评估

## 审查能力

**16 类 LLM 生成页面高频缺陷模式**：定位重叠、文字截断、布局塌陷（flex/grid）、低对比、间距失衡、风格不一致、配色混乱、层级混乱、图片变形、层叠异常、占位残留（lorem/TODO）、表单可用性、小点击目标、滚动异常、空状态缺失、对齐混乱。每条问题标注命中的模式名。

**响应式对比**（--responsive）：桌面 1440 / 平板 768 / 手机 390 三视口一次审查，专抓"只在窄屏出现"的溢出/塌陷/挤压。

**放大复查**（--thorough）：2x2 分块放大 1.6x 二次扫查微观缺陷（按钮叠字、小字号、基线错位）。

**四维评分 + 改进建议**：美观/结构/可用性/一致性各 0-10 分；3-6 条按优先级排序的可执行美化建议。

## 前置条件

- 凭据：`~/.secrets/credentials.env` 中的 `AGNES_API_KEY` / `AGNES_BASE_URL` / `AGNES_MODEL`（脚本自动读取）
- 截图：`~/.cache/ms-playwright` 下的 chrome-headless-shell（自动查找）；`--thorough` 需要全局 sharp
- 无需其他依赖

## 用法

```bash
# LLM 生成页面推荐组合：响应式 + 放大复查
node 当前工作区/.opencode/skills/page-visual-review/bin/fe-review.cjs <URL> \
  --responsive --thorough --json /tmp/fe-report.json --out /tmp/fe-report.md
```

选项：

| 选项 | 说明 |
|------|------|
| `--responsive` | 三视口（1440/768/390）一次对比审查，响应式问题标 viewport |
| `--thorough` | 2x2 分块放大复查微观缺陷（多 4 次调用） |
| `--out <file.md>` / `--json <file.json>` | 输出文件 |
| `--viewport <WxH>` | 单视口尺寸，默认 1440x900 |
| `--height <px>` | 截图窗口高度（长页面调大，如 3000） |
| `--wait <ms>` | 截图前等待（默认 1200ms） |
| `--focus <提示>` | 额外关注点 |
| `--lang zh/en` / `--quiet` / `--timeout <sec>` | 语言/静默/超时（默认 180s） |

也可直接传已有截图路径。全程约 1-3 分钟、4-13k tokens（视选项）。

## 报告结构（JSON）

```
verdict: pass | warn | fail
scores: { beauty, structure, usability, consistency }   — 0-10
issues[]:
  id / severity / category
  llm_pattern: 命中的缺陷模式名（见上）
  viewport: 出问题的视口或 all
  location: {region, element, text 可见原文, hint}
  evidence / impact
  fix: {how, css_hint}
  confidence: high|medium|low
checks[]: 维度逐项 pass|warn|fail
suggestions[]: {priority, area 美观|结构|交互|内容, suggestion, how}
positive[]
```

## Agent 修复工作流（关键）

1. **审查**：`fe-review.cjs <URL> --responsive --thorough --json report.json`
2. **读 JSON 修复**：按 severity 排序处理；`location.text` 原文 grep 源码定位；`llm_pattern` 直接对应修法（如 flex_collapse → 加 min-width:0/word-break）；`fix.css_hint` 给具体 CSS
3. **复测**：重跑审查直到无 critical/major（评分与建议作为美化迭代输入）
4. confidence=low 的问题先人工确认再改

## 注意

- AGNES 免费档约 20 RPM、响应偏慢（单次 10-60s 正常），多页审查串行
- 长页面判断：截图前先看页面 scrollHeight，超过 2000px 自动加 `--height 3000` 再截；SPA 截图空白加大 `--wait`
- 失败重试：脚本失败或超时（超过 `--timeout`）自动重试一次；连续两次失败要告知用户，并给出已完成的截图与部分报告，绝不静默吞错
- 视觉层审查：逻辑错误、接口数据、交互行为问题不在覆盖范围
- 误报模式：图表（SVG 时间线等非交互 UI）场景下 interaction"点击目标过小"多为噪声；<4px 文字重影可能漏检（--thorough 可显著缓解）；深色主题下"低对比"类问题误报率高，confidence=low 的对比度问题先人工确认再改

