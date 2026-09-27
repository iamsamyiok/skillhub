# searxng-stack — 本机隐私搜索栈 (SearXNG + searxNcrawl MCP)

实测数据 (2026-09-27): 单查询中位 1.4s (聚合4-5引擎) / 5并发15查询成功率 100% / 常驻内存 ~99MB / 空闲 CPU≈0

## 组成
- searx-venv/    隔离环境 (SearXNG 官方源码安装, Windows pwd stub 兼容)
- searxng-src/   SearXNG 源码 (master 快照, 含 21 个 Windows 非法路径文件已剔除)
- searx-settings.yml  配置: 127.0.0.1:8888 / 出站走 clash(127.0.0.1:7890) / json format 白名单
- searxncrawl/   searxNcrawl MCP (FastMCP: search/crawl/crawl_site)
- start-searxng.py 启动器 (源码路径+配置路径注入)
- test-searxncrawl.py MCP 端到端验证

## 开机自启
已注册计划任务 SearXNG-Local (登录时启动)

## 接入 Agent (MCP)
```json
{"mcpServers": {"searx-search": {"command": "<绝对路径>/searx-venv/Scripts/python.exe",
  "args": ["-m", "crawler.mcp_server"], "cwd": "<绝对路径>/searxncrawl",
  "env": {"SEARXNG_URL": "http://127.0.0.1:8888"}}}}
```

## 踩坑记录 (Windows 专属)
1. PyPI 的 searxng 0.1.2 是假包(MCP server) — 必须从 GitHub 官方源码安装
2. 官方源码含 21 个 Windows 非法路径文件(:socket 等) — pip git+ 安装直接失败, 需 zip 解包过滤
3. searx/valkeydb.py import pwd(Unix) — venv sitecustomize.py stub 兜底
4. JSON API 403 = 默认 search.formats 只有 html — settings 加 json 白名单
5. botdetection 对无反代头的直连报警 — limiter:false 时仅日志不影响
6. searxNcrawl 依赖 crawl4ai(会连带装 playwright 浏览器, 搜索功能不需要浏览器)
