# -*- coding: utf-8 -*-
"""server.py — MCP stdio 入口(L5): 只做协议翻译, 冻结
P1: Agent 只见 3 个工具(doc_q 语义路由入口 / task.poll 任务查询 / doc_status 宿主状态)
    —— 实际能力点(capabilities)由宿主持有, 工具描述 token 从 O(N工具) 降到 O(1)
"""
import asyncio, json, logging
from mcp.server import Server
from mcp.types import Tool, TextContent
from harness import Harness, ToolError
from pathlib import Path

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(message)s")   # 生产换 JSON handler
H = Harness(Path(__file__).parent / "tools")
H.load_all()

srv = Server("doc-router")

@srv.list_tools()
async def _list():
    # 刻意极小: 每个工具描述 ≤40 token (P1 对策)
    return [
        Tool(name="doc_q",
             description="文档知识库统一入口。capability 取值: doc.scan(列目录清单)/doc.summarize(单文件摘要)/doc.reindex(重建索引,长任务)。先选 capability 再传参数。",
             inputSchema={"type": "object", "properties": {
                 "capability": {"type": "string",
                                "enum": ["doc.scan", "doc.summarize", "doc.reindex"]},
                 "target": {"type": "string"}, "file": {"type": "string"},
                 "max_chars": {"type": "integer"}, "out": {"type": "string"},
                 "meta": {"type": "object"}},
                 "required": ["capability"]}),
        Tool(name="task_poll",
             description="查询长任务状态。task_id 来自 doc_q(doc.reindex) 返回的句柄。",
             inputSchema={"type": "object",
                          "properties": {"task_id": {"type": "string"}},
                          "required": ["task_id"]}),
        Tool(name="doc_status",
             description="宿主健康状态与能力点路由表(排障用)。",
             inputSchema={"type": "object", "properties": {}}),
    ]

@srv.call_tool()
async def _call(name, args):
    try:
        if name == "doc_q":
            out = await H.route(args or {})
        elif name == "task_poll":
            out = H.poll((args or {}).get("task_id", ""))
        elif name == "doc_status":
            caps = {c: {"tool": n, "status": H.slots[n]["health"].status,
                        "use_when": H.slots[n]["mf"].use_when}
                    for c, n in sorted(H.by_cap.items())}
            out = {"result": {"capabilities": caps,
                              "recent_events": H.recent_events(5),
                              "human": f"{len(caps)} 个能力点在线"},
                   "human": f"宿主正常,{len(caps)} 能力点"}
        else:
            out = {"error": {"code": "E_NO_TOOL", "retryable": False,
                             "human": f"未知工具 {name}",
                             "detail": "可用: doc_q / task_poll / doc_status"}}
        text = json.dumps(out, ensure_ascii=False)
        if "human" in out:                       # 人类通道摘要置顶(1.4)
            text = f"[{out['human']}]\n{text}"
        return [TextContent(type="text", text=text)]
    except ToolError as e:                       # 1.7 结构化错误兜底
        return [TextContent(type="text", text=json.dumps(e.payload, ensure_ascii=False))]

async def _spawn_bridge():                       # P3: reindex 声明为长任务
    orig = H.route
    async def patched(req):
        if (req or {}).get("capability") == "doc.reindex" and not (req.get("meta") or {}).get("sync"):
            import tools.reindex_kb.tool as m
            def sync(): return m.run(req, None)
            return H.spawn_task("doc.reindex", asyncio.to_thread(sync))
        return await orig(req)
    H.route = patched

async def _main():
    await _spawn_bridge()
    from mcp.server.stdio import stdio_server
    async with stdio_server() as (r, w):
        await srv.run(r, w, srv.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(_main())
