---
name: toutiao-mcp
version: 1.0.0
category: MCP Server
tags: [MCP, 今日头条, Toutiao, 内容发布, 自媒体, Node.js]
description: 今日头条内容管理 MCP server——自动登录、图文/微头条发布、数据分析、报告生成。基于 TypeScript + MCP SDK，支持 Cookie 持久化。来源: freedom2022/toutiao-mcp (GitHub)。
---

# toutiao-mcp — 今日头条内容管理 MCP

🧑 **人话**：让 AI Agent 帮你发头条——登录一次（Cookie 持久化），之后就能发微头条、发图文、查阅读量、生成报告。

## 快速运行

```bash
# 安装依赖
npm install

# 首次登录（打开浏览器扫码/输验证码，Cookie 自动保存）
npm run login

# 启动 MCP server (stdio)
npm run dev
# 或构建后运行
npm run build && npm start
```

## 接入 Claude / ZCode

```json
{"mcpServers": {"toutiao-mcp": {"command": "node", "args": ["dist/index.js"], "cwd": "<本技能目录>"}}}
```

## MCP 工具清单

| 工具 | 功能 |
|---|---|
| login_with_credentials | 用户名密码登录(Selenium) |
| check_login_status | 检查登录状态 |
| publish_article | 发布图文文章 |
| publish_micro_post | 发布微头条 |
| get_article_list | 获取文章列表 |
| delete_article | 删除文章 |
| get_account_overview | 账户概览数据 |
| get_article_stats | 文章详细统计 |
| generate_report | 自动生成报告 |

## 来源

https://github.com/freedom2022/toutiao-mcp (GitHub)
