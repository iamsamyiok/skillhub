"""Comprehensive verification pass over the running MCP server (real providers).

Usage:
    set RAG_EMBEDDING_API_KEY / RAG_VISION_API_KEY / RAG_ASR_API_KEY
    .venv/Scripts/python.exe examples/verify_full.py

Checks: providers, idempotent re-import, modify+sync staleness, source
context/file modes, remove keeps original, reconcile consistency, error
paths, and restart persistence in a fresh server process.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from contextlib import AsyncExitStack
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

BASE = Path(__file__).resolve().parents[1]
RESULTS: list[tuple[bool, str, str]] = []


def record(ok: bool, name: str, detail: str = "") -> None:
    RESULTS.append((ok, name, detail))
    line = f"[{'PASS' if ok else 'FAIL'}] {name}"
    if detail:
        line += f" :: {detail}"
    print(line)


def parse(res) -> dict:
    return json.loads(res.content[0].text)


def server_params() -> StdioServerParameters:
    return StdioServerParameters(
        command=str(BASE / ".venv" / "Scripts" / "python.exe"),
        args=["-m", "app", "serve", "--config", str(BASE / "config.toml")],
        cwd=str(BASE),
        env=dict(os.environ),
    )


async def run_checks() -> None:
    async with AsyncExitStack() as stack:
        read, write = await stack.enter_async_context(stdio_client(server_params()))
        async with ClientSession(read, write) as s:
            await s.initialize()

            # 1) providers
            d = parse(await s.call_tool("get_service_status", {}))
            record(all([
                d["providers"]["embedding"], d["providers"]["vision"],
                d["providers"]["asr"], d["providers"]["reranker"],
                d["providers"]["ffmpeg"],
            ]), "all providers configured", str(d["providers"]))

            # 2) idempotent re-import
            d = parse(await s.call_tool("add_file", {
                "library_id": "default",
                "source_path": str(BASE / "knowledge" / "valves.md"),
                "wait": True,
            }))
            record(d.get("status") == "already_indexed",
                   "idempotent re-import", str(d.get("status")))

            # 3) modify + sync: old content gone, new content hits
            md = BASE / "knowledge" / "valves.md"
            original = md.read_text(encoding="utf-8")
            try:
                # v1: contains the old marker only
                md.write_text(original.replace("阀门控制规程", "阀门控制规程 ZYXOLD99"),
                              encoding="utf-8")
                await s.call_tool("sync_library", {"library_id": "default", "wait": True})

                # v2: old marker removed, new marker added
                md.write_text(original.replace("阀门控制规程", "阀门控制规程 q7NEW42"),
                              encoding="utf-8")
                await s.call_tool("sync_library", {"library_id": "default", "wait": True})

                d = parse(await s.call_tool("search_knowledge", {
                    "library_id": "default", "query": "ZYXOLD99",
                    "mode": "full_text", "top_k": 5}))
                # exact-term FTS must not hit; hybrid/vector may return semantic
                # neighbors for a nonsense token, but no chunk may CONTAIN it
                old_gone_fts = len(d["results"]) == 0
                d = parse(await s.call_tool("search_knowledge", {
                    "library_id": "default", "query": "q7NEW42",
                    "mode": "hybrid", "top_k": 5}))
                old_in_content = any("ZYXOLD99" in (r["content"] or "") for r in d["results"])
                old_gone = old_gone_fts and not old_in_content
                record(any(r["relative_path"] == "valves.md" for r in d["results"]),
                       "modified file: new content hits", f"hits={len(d['results'])}")
                record(old_gone, "modified file: old content gone",
                       f"fts_hits=0:{old_gone_fts}, stale_in_content={old_in_content}")
            finally:
                md.write_text(original, encoding="utf-8")
                await s.call_tool("sync_library", {"library_id": "default", "wait": True})

            # 4) video hit carries timestamp; context retrieval works
            d = parse(await s.call_tool("search_knowledge", {
                "library_id": "default", "query": "test pattern color bars",
                "mode": "hybrid", "top_k": 3,
                "content_types": ["video_frame_caption"]}))
            if d["results"]:
                hit = d["results"][0]
                record(hit["start_ms"] is not None,
                       "video hit carries timestamp", str(hit["start_ms"]))
                d2 = parse(await s.call_tool("get_source_context", {
                    "library_id": "default", "chunk_id": hit["chunk_id"]}))
                record(d2["file"]["file_id"] == hit["file_id"] and d2["chunks"],
                       "get_source_context works")
            else:
                record(False, "video hit carries timestamp", "no video hits")

            # 5) get_source_file modes
            d = parse(await s.call_tool("search_knowledge", {
                "library_id": "default", "query": "阀门控制规程",
                "mode": "hybrid", "top_k": 1}))
            fid = d["results"][0]["file_id"]
            m = parse(await s.call_tool("get_source_file",
                                        {"library_id": "default", "file_id": fid}))
            record(m["return_mode"] == "metadata_only" and m["source_exists"],
                   "source_file metadata_only")
            m = parse(await s.call_tool("get_source_file", {
                "library_id": "default", "file_id": fid,
                "mode": "text_excerpt", "max_bytes": 256}))
            record("阀门" in m.get("text", ""), "source_file text_excerpt")
            m = parse(await s.call_tool("get_source_file", {
                "library_id": "default", "file_id": fid, "mode": "file_uri"}))
            record(m.get("file_uri", "").startswith("file:///"),
                   "source_file file_uri")

            # 6) error paths -> structured JSON, not crashes
            e = parse(await s.call_tool("search_knowledge",
                                        {"library_id": "nope", "query": "x"}))
            record(e.get("error", {}).get("error_code") == "LIBRARY_NOT_FOUND",
                   "error: unknown library")
            exe = BASE / "knowledge" / "bad.exe"
            exe.write_bytes(b"MZ")
            try:
                e = parse(await s.call_tool("add_file", {
                    "library_id": "default", "source_path": str(exe), "wait": True}))
                code = (e.get("error") or {}).get("error_code") or e.get("error_code")
                record(code == "UNSUPPORTED_FILE_TYPE", "error: unsupported type")
            finally:
                exe.unlink()
                await s.call_tool("sync_library", {"library_id": "default", "wait": True})
            e = parse(await s.call_tool("add_file", {
                "library_id": "default", "source_path": str(BASE / "README.md"),
                "wait": True}))
            record((e.get("error") or {}).get("error_code") == "EXTERNAL_FILE_NOT_ALLOWED",
                   "error: outside root rejected")
            e = parse(await s.call_tool("get_job_status", {"job_id": "nonexistent"}))
            record(e.get("error", {}).get("error_code") == "JOB_NOT_FOUND",
                   "error: unknown job")

            # 7) remove keeps original; re-sync restores index
            d = parse(await s.call_tool("search_knowledge", {
                "library_id": "default", "query": "阀门控制规程",
                "mode": "hybrid", "top_k": 1}))
            fid = d["results"][0]["file_id"]
            d = parse(await s.call_tool("remove_file",
                                        {"library_id": "default", "file_id": fid}))
            record(d.get("original_deleted") is False
                   and (BASE / "knowledge" / "valves.md").exists(),
                   "remove keeps original file")
            await s.call_tool("sync_library", {"library_id": "default", "wait": True})
            d = parse(await s.call_tool("search_knowledge", {
                "library_id": "default", "query": "阀门控制规程",
                "mode": "hybrid", "top_k": 3}))
            record(any(r["relative_path"] == "valves.md" for r in d["results"]),
                   "re-sync restores index")

            # 8) reconcile consistent
            d = parse(await s.call_tool("reconcile_index",
                                        {"library_id": "default", "dry_run": True}))
            record(d["consistent"], "reconcile consistent",
                   f"ghosts={d['ghost_docs_in_zvec']} missing={d['missing_docs_in_zvec']}")

    # 9) restart persistence: brand-new server process, same index
    async with stdio_client(server_params()) as (r2, w2):
        async with ClientSession(r2, w2) as s2:
            await s2.initialize()
            d = parse(await s2.call_tool("search_knowledge", {
                "library_id": "default", "query": "阀门开度 液位",
                "mode": "hybrid", "top_k": 3}))
            record(len(d["results"]) >= 1,
                   "restart persistence: search works in fresh process",
                   f"hits={len(d['results'])}")


async def main() -> int:
    await run_checks()
    failed = [name for ok, name, _ in RESULTS if not ok]
    print(f"\n==== {len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed ====")
    if failed:
        print("FAILED:", ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
