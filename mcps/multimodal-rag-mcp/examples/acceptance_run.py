"""Real-provider multimodal acceptance run (stdio MCP client).

Usage: set RAG_VISION_API_KEY in env, then
    .venv/Scripts/python.exe examples/acceptance_run.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

BASE = Path(__file__).resolve().parents[1]


async def main() -> int:
    params = StdioServerParameters(
        command=str(BASE / ".venv" / "Scripts" / "python.exe"),
        args=["-m", "app", "serve", "--config", str(BASE / "config.toml")],
        cwd=str(BASE),
        # MCP stdio clients pass a filtered default env; forward everything
        # so RAG_VISION_API_KEY etc. reach the server (Claude Desktop does the
        # same via its "env" config block).
        env=dict(os.environ),
    )
    files = ["valves.md", "diagram.png", "scanned.pdf", "demo.mp4"]
    queries = [
        ("PUMP-300 额定流量", "text hit"),
        ("scanned page pressure", "scan-OCR hit"),
        ("test pattern diagram", "video/diagram frame hit"),
    ]
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as s:
            await s.initialize()
            r = await s.call_tool("get_service_status", {})
            print("== service ==", r.content[0].text)
            for f in files:
                t0 = time.time()
                r = await s.call_tool("add_file", {
                    "library_id": "default",
                    "source_path": str(BASE / "knowledge" / f),
                    "wait": True, "timeout_seconds": 300,
                })
                d = json.loads(r.content[0].text)
                status = d.get("wait_status") or d.get("status")
                print(f"ADD {f}: {status} err={d.get('error_code')} ({time.time()-t0:.1f}s)")
                if d.get("error_message"):
                    print("   msg:", d["error_message"][:200])
            for q, label in queries:
                r = await s.call_tool("search_knowledge", {
                    "library_id": "default", "query": q, "mode": "full_text", "top_k": 5,
                })
                data = json.loads(r.content[0].text)
                print(f"SEARCH '{q}' ({label}): {len(data['results'])} hits warn={data['warnings']}")
                for hit in data["results"][:3]:
                    loc = hit["page_number"] or hit["start_ms"] or ""
                    print(f"   - {hit['relative_path']} [{hit['content_type']}/{hit['origin_kind']}]"
                          f" loc={loc} :: {hit['content'][:70].replace(chr(10), ' ')}")
            r = await s.call_tool("get_index_status", {"library_id": "default"})
            print("== index ==", r.content[0].text[:400])
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
