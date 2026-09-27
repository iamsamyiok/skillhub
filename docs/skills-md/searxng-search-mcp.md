---
name: searxng-search-mcp
version: 1.0.0
category: MCP Server
tags: [MCP, SearXNG, 隐私搜索, Windows, 本地部署, searxNcrawl]
description: 在 Windows 上部署本机 SearXNG + searxNcrawl MCP 的完整安装包（含全部踩坑修复：PyPI 假包识别、Windows 非法路径解包、pwd stub、JSON 403 白名单）。实测：单查询中位 1.4s 聚合 4-5 引擎、5 并发 15 查询 100% 成功、常驻内存 99MB。公共实例在国内不可用(429/SSL 阻断)，本方案=本机实例+代理出站。
---

# searxng-search-mcp — Windows 本机隐私搜索栈

🧑 **人话**：让 AI Agent 拥有不 limiter、不上传查询记录的网页搜索能力。SearXNG 聚合
Google/Bing/DDG/Brave/Qwant，出站走本机 clash 代理；searxNcrawl 把它包装成 MCP 工具。

## 实测数据（2026-09-27, 本机）

| 指标 | 数值 |
|---|---|
| 单查询延迟 | 中位 1.40s / 最大 2.48s（聚合 4-5 引擎） |
| 并发 | 5 并发 15 查询：成功率 100% |
| 常驻内存 | ~99MB / 空闲 CPU≈0 |

## 安装（scripts/install.md 有逐步命令）

1. `python -m venv searx-venv` → 装 SearXNG 官方源码(**禁 PyPI 假包**) → 依赖
2. `scripts/windows-pwd-stub.py` 复制进 venv 的 site-packages(Unix pwd 模块兜底)
3. `scripts/searx-settings.yml` → 本目录(改 secret_key; 出站代理按需)
4. `python scripts/start-searxng.py` → http://127.0.0.1:8888
5. `pip install crawl4ai` + 克隆 searxNcrawl → MCP 三工具(search/crawl/crawl_site)

## 验证

`python scripts/test-searxncrawl.py` → MCP client 调 search 返回 JSON 结果即成功。

## 接入 Agent

见 scripts/README.md 的 mcpServers 配置模板。

## 踩坑记录(Windows 全部亲测)

1. PyPI `searxng` 0.1.2 是假包(MCP server 同名) — 必须官方 GitHub 源码
2. 官方源码 21 个 Windows 非法路径文件(:socket) — pip git+ 安装必炸, 需 zip 过滤解包
3. `searx/valkeydb.py import pwd` — venv sitecustomize stub 兜底(见 scripts/windows-pwd-stub.py)
4. JSON API 403 — 默认 search.formats 只有 html, settings 加 json
5. 公共实例(searx.be 等)国内 429/SSL 阻断 — 本机实例+代理出站是唯一稳定路线
6. searxNcrawl 链式依赖 crawl4ai → playwright(搜索不需要浏览器)
