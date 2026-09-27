# -*- coding: utf-8 -*-
"""searxNcrawl MCP 端到端验证: stdio 起 FastMCP, 调 searx 搜索工具"""
import asyncio, os, sys, json, time
from pathlib import Path
ROOT = Path(__file__).parent
os.environ["SEARXNG_URL"] = "http://127.0.0.1:8888"
sys.path.insert(0, str(ROOT / "searxncrawl"))

async def main():
    from fastmcp import Client
    from crawler.mcp_server import mcp
    async with Client(mcp) as c:
        tools = await c.list_tools()
        print("1. MCP 工具清单:", [t.name for t in tools])
        t0 = time.time()
        r = await c.call_tool("searxng_web_search" if any(t.name == "searxng_web_search" for t in tools) else "search",
                              {"query": "TRELLIS 3D generation github", "max_results": 5})
        dt = time.time() - t0
        body = r.content[0].text
        print(f"2. 真实搜索 {dt:.1f}s, 返回 {len(body)} 字符, 前 120:")
        print("   ", body[:120].replace("\n", " | "))
asyncio.run(main())
