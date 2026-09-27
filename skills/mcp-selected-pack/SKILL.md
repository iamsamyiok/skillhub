---
name: mcp-selected-pack
version: 1.0.0
category: MCP Server
tags: [MCP, 精选包, GitHub, Playwright, Fetch, Memory, Context7, AntV, 双通道]
description: 用户从 100 个精选 MCP 中勾选的 19 项打包——10 项立即可用(npx/uvx 零配置, 已实测可启动) + 9 项需 API 钥的配置模板。含可直接导入 ZCode/Claude 的 mcpServers-config.json 与中文说明。来源: skillhub mcp-picker 勾选流程。
---

# mcp-selected-pack — 勾选精选 MCP 打包

🧑 **人话**：这是从 100 个候选里勾出的 19 项 MCP 的"装机包"。10 项开箱即用，
其余 9 项各需要自己平台的 API 钥（清单在 install-plan.json，钥到手填进配置即可）。

## 立即可用（10 项，均已实测可启动）

| 工具 | 干什么 | 启动方式 |
|---|---|---|
| server-memory | 持久记忆(知识图谱) | npx |
| server-sequential-thinking | 顺序思考(分步推理) | npx |
| mcp-server-fetch | 网页抓取转 Markdown | uvx |
| mcp-server-git | Git 仓库读写 | uvx |
| mcp-server-time | 时间/时区查询 | uvx |
| @playwright/mcp | 驱动本机浏览器 | npx |
| @antv/mcp-server-chart | 文字生成图表 | npx |
| @upstash/context7-mcp | 最新库文档注入 | npx |
| server-github | GitHub(建议换官方远程版) | npx |
| github-remote | GitHub 官方远程 MCP | npx mcp-remote |

## 需 API 钥（9 组，钥变量见 install-plan.json）

Browserbase(云浏览器) · Octagon(深度调研) · Allyson(SVG动画) · ScreenshotMCP(截图) ·
Stripe(支付) · LaTeX(需装TeX) · Cua(已有computer-use插件覆盖) · 4EVERLAND · AWS Bedrock KB

## 接入

把 mcpServers-config.json 内容合入 ZCode/Claude 的 MCP 配置即可。
钥类工具: 钥存入 vault 后按 needs_key 补 env 字段。

## 来源

skillhub mcp-picker 勾选流程（100 精选 → 勾选 → 打包），2026-09-27。
