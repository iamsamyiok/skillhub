from __future__ import annotations

import asyncio
import json


def test_tools_registered(ctx_factory):
    ctx = ctx_factory()
    from app.mcp_server import build_mcp

    mcp = build_mcp(ctx)
    tools = asyncio.run(mcp.list_tools())
    names = {t.name for t in tools}
    expected = {
        "list_libraries", "get_library_info", "search_knowledge", "get_source_context",
        "get_source_file", "add_file", "add_folder", "get_job_status", "sync_library",
        "remove_file", "reindex_file", "get_index_status", "get_service_status",
        "reconcile_index",
    }
    assert expected <= names, f"missing tools: {expected - names}"


def test_list_libraries_output(ctx_factory):
    ctx = ctx_factory()
    from app.mcp_server import build_mcp

    mcp = build_mcp(ctx)
    tools = {t.name: t for t in asyncio.run(mcp.list_tools())}
    result = asyncio.run(mcp.call_tool("list_libraries", {"include_status": True}))
    raw = result.content[0].text
    data = json.loads(raw)
    assert data["libraries"][0]["library_id"] == "testlib"
