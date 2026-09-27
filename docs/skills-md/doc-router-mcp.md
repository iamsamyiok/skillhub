---
name: doc-router-mcp
version: 1.0.0
category: MCP Server
tags: [MCP, 知识库, 语义路由, 双通道, 文档索引, coding-principles]
description: 知识库语义路由 MCP server——coding-principles v2.1 的实战参考实现。针对四大社区痛点：P1 工具过载(单入口语义路由, Agent 只见 1 个工具)、P2 输出冗长(双模输出, 默认 compact)、P3 无状态长任务(任务句柄+轮询)、P4 描述投毒(manifest sha256 锁定, 每次执行前校验)。Python 3.10+ / mcp sdk。
---

# doc-router-mcp — 知识库语义路由 MCP

🧑 **人话**：给 Agent 装一个"文档库前台"。Agent 只认识一个工具 `doc_q`，后台三个能力
(扫描目录/摘要单文件/重建索引)由宿主按 capability 路由——加新能力不改 Agent 侧任何配置。

## 快速运行

```bash
pip install "mcp[cli]" pytest
python scripts/server.py        # stdio MCP server
python -m pytest tests/ -q      # 契约测试(7项, 含 rug-pull 模拟)
```

## 接入 Claude / ZCode

```json
{"mcpServers": {"doc-router": {"command": "python",
  "args": ["scripts/server.py"], "cwd": "<本技能目录>"}}}
```

## 能力点 (capability)

| capability | 功能 | 长任务 |
|---|---|---|
| doc.scan | 列目录 Markdown 清单(标题/大小) | 否 |
| doc.summarize | 单文件摘要(标题/小节/首段) | 否 |
| doc.reindex | 重建知识库 index.md | **是(返回 task_id)** |

## 痛点对策速览

P1 单入口路由 · P2 默认 compact + meta.with_detail 全量 · P3 task_id 句柄 · P4 manifest sha256 完整性锁定(变更即停用)。
设计依据与七铁律落点见 [coding-principles skill](https://github.com/iamsamyiok/skillhub/tree/main/skills/coding-principles)。
