BUILD_TIMESTAMP = "2025-08-15 17:04:53"
import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional
try:  # Python 3.10+ importlib.metadata
    from importlib.metadata import version as _pkg_version
except Exception:  # pragma: no cover
    def _pkg_version(_: str) -> str:
        return "0.0.0"

from .functions import latex_ops
from .ts_bridge import TypeScriptBridge


def send(message: Dict[str, Any]):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def receive() -> Dict[str, Any]:
    line = sys.stdin.readline()
    if not line:
        raise EOFError
    return json.loads(line)


class ToolRegistry:
    def __init__(self):
        # tools[name] = { 'handler': callable, 'description': str, 'schema': dict }
        self.tools: Dict[str, Dict[str, Any]] = {}

    def register(self, name: str, func, description: str, schema: Optional[Dict[str, Any]] = None):
        self.tools[name] = {
            "handler": func,
            "description": description.strip(),
            "schema": schema or {"type": "object", "properties": {}, "required": []},
        }

    def call(self, name: str, params: Dict[str, Any]):
        if name not in self.tools:
            raise KeyError(f"Unknown tool: {name}")
        return self.tools[name]["handler"](params)

    def list_for_spec(self):
        spec_list = []
        for name, meta in sorted(self.tools.items()):
            spec_list.append(
                {
                    "name": name,
                    "description": meta["description"],
                    "inputSchema": meta["schema"],
                }
            )
        return spec_list

    def list_names(self):
        return sorted(list(self.tools.keys()))


def build_registry(workspace: Path) -> ToolRegistry:
    reg = ToolRegistry()

    reg.register(
        "list_tex_files",
        lambda _: {"files": latex_ops.list_tex_files(workspace)},
        description="List all .tex files under the LaTeX workspace (relative paths).",
        schema={"type": "object", "properties": {}, "required": []},
    )
    reg.register(
        "read_file",
        lambda p: latex_ops.read_file(workspace, p["path"], p.get("max_bytes", 50_000)),
        description="Read a text/binary-safe slice of a file given a relative path inside the workspace.",
        schema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative path to file."},
                "max_bytes": {"type": "integer", "description": "Max number of bytes to return", "minimum": 1},
            },
            "required": ["path"],
        },
    )
    reg.register(
        "extract_bibliography",
        lambda p: {
            "ok": True,
            "entries": latex_ops.extract_bibliography(workspace, p["path"])
        },
        description="Parse a BibTeX file and return structured entry metadata including download URLs (DOI, arXiv).",
        schema={
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Relative .bib file path."}},
            "required": ["path"],
        },
    )
    reg.register(
        "download_bibliography",
        lambda p: {
            "ok": True,
            "downloaded": latex_ops.download_bibliography(
                workspace, p.get("force", False), p.get("limit")
            )
        },
        description="Download PDFs for bibliography entries listed in resources/cited_papers/index.json.",
        schema={
            "type": "object",
            "properties": {
                "force": {"type": "boolean", "description": "Redownload even if file exists"},
                "limit": {"type": "integer", "description": "Max number of new downloads"}
            },
            "required": [],
        },
    )
    reg.register(
        "compile_latex",
        lambda p: latex_ops.compile_latex(
            workspace, p.get("main_tex", "main.tex"), p.get("passes", 1)
        ),
        description="Run LaTeX compilation (pdflatex/xelatex via latexmk) on the main document and return success plus log snippet.",
        schema={
            "type": "object",
            "properties": {
                "main_tex": {"type": "string", "description": "Entry point .tex (default main.tex)"},
                "passes": {"type": "integer", "description": "Number of compile passes (>=1)", "minimum": 1},
            },
            "required": [],
        },
    )
    reg.register(
        "read_pdf",
        lambda p: latex_ops.read_pdf(
            workspace,
            p["path"],
            p.get("max_pages", 5),
            p.get("max_chars", 50_000),
        ),
        description="Extract text & metadata from a PDF using pypdf with page/char limits (stores JSON artifact).",
        schema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative path to PDF file."},
                "max_pages": {"type": "integer", "description": "Max pages to extract", "minimum": 1},
                "max_chars": {"type": "integer", "description": "Max characters to return", "minimum": 100},
            },
            "required": ["path"],
        },
    )
    reg.register(
        "read_pdf_from_citation",
        lambda p: latex_ops.read_pdf_from_citation(
            workspace,
            p["citation_key"],
            p.get("max_pages", 5),
            p.get("max_chars", 50_000),
        ),
        description="Resolve a citation key via resources/cited_papers/index.json to its PDF and extract text (auto-download if needed).",
        schema={
            "type": "object",
            "properties": {
                "citation_key": {"type": "string", "description": "BibTeX citation key to resolve."},
                "max_pages": {"type": "integer", "description": "Max pages to extract", "minimum": 1},
                "max_chars": {"type": "integer", "description": "Max characters to return", "minimum": 100},
            },
            "required": ["citation_key"],
        },
    )

    ts_dist = Path(__file__).parent / "ts_dist"
    bridge = TypeScriptBridge(ts_dist)
    bridge.register_ts_tool("summarize_text", "summarizeText")
    bridge.register_ts_tool("suggest_bib_key", "suggestBibKey")

    def _maybe(call_name: str):
        wrapper = bridge.make_wrapper(call_name)

        def _runner(params: Dict[str, Any]):
            if not bridge.available():
                return {"ok": False, "error": "TypeScript runtime unavailable (install Node.js)"}
            try:
                result = wrapper(params)
                return {"ok": True, "result": result}
            except Exception as e:  # pragma: no cover
                return {"ok": False, "error": str(e)}

        return _runner

    reg.register(
        "summarize_text",
        _maybe("summarize_text"),
        description="Produce a concise natural language summary of provided LaTeX / text content.",
        schema={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Raw text to summarize."},
                "max_sentences": {"type": "integer", "description": "Approximate max sentences in summary", "minimum": 1},
            },
            "required": ["text"],
        },
    )
    reg.register(
        "suggest_bib_key",
        _maybe("suggest_bib_key"),
        description="Suggest a stable BibTeX key based on authors/year/title metadata.",
        schema={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Paper title"},
                "authors": {"type": "array", "items": {"type": "string"}, "description": "List of author surnames"},
                "year": {"type": "integer", "description": "Publication year"},
            },
            "required": ["title"],
        },
    )

    return reg


def event_loop(registry: ToolRegistry):
    while True:
        try:
            msg = receive()
        except EOFError:
            break
        except Exception as e:
            send({"jsonrpc": "2.0", "error": {"code": -32700, "message": str(e)}})
            continue
        method = msg.get("method")
        if method == "initialize":
            send(
                {
                    "jsonrpc": "2.0",
                    "id": msg.get("id"),
                    "result": {
                        "protocolVersion": "0.1",
                        "serverInfo": {
                            "name": "latex-mcp-server",
                            "version": _pkg_version("latex-mcp-server"),
                        },
                        "capabilities": {
                            "tools": {"list": True, "call": True},
                        },
                    },
                }
            )
            continue
        if method == "notifications/initialized":
            continue
        if msg.get("method") == "ping":
            send({"jsonrpc": "2.0", "id": msg.get("id"), "result": {"pong": True}})
            continue
        if method in ("listTools", "getTools"):
            send(
                {
                    "jsonrpc": "2.0",
                    "id": msg.get("id"),
                    "result": {"tools": registry.list_names()},
                }
            )
            continue
        if method == "tools/list":
            send(
                {
                    "jsonrpc": "2.0",
                    "id": msg.get("id"),
                    "result": {"tools": registry.list_for_spec()},
                }
            )
            continue
        if method == "callTool":
            params = msg.get("params", {})
            tool = params.get("name")
            tool_params = params.get("arguments", {})
            try:
                result = registry.call(tool, tool_params)
                send({"jsonrpc": "2.0", "id": msg.get("id"), "result": result})
            except Exception as e:
                send(
                    {
                        "jsonrpc": "2.0",
                        "id": msg.get("id"),
                        "error": {"code": -32603, "message": str(e)},
                    }
                )
            continue
        if method == "tools/call":
            params = msg.get("params", {})
            name = params.get("name")
            arguments = params.get("arguments", {})
            try:
                result = registry.call(name, arguments)
                # Option 2 — send both JSON and text
                text_out = ""
                if isinstance(result, dict):
                    text_out = result.get("text", json.dumps(result, ensure_ascii=False))
                else:
                    text_out = str(result)
                send(
                    {
                        "jsonrpc": "2.0",
                        "id": msg.get("id"),
                        "result": {
                            "content": [
                                {"type": "json", "data": result},
                                {"type": "text", "text": text_out}
                            ]
                        },
                    }
                )
            except Exception as e:
                send(
                    {
                        "jsonrpc": "2.0",
                        "id": msg.get("id"),
                        "error": {"code": -32603, "message": str(e)},
                    }
                )
            continue
        unknown = msg.get("method")
        print(f"[stderr] Unknown method requested: {unknown}", file=sys.stderr)
        send(
            {
                "jsonrpc": "2.0",
                "id": msg.get("id"),
                "error": {"code": -32601, "message": "Method not found"},
            }
        )


def main(argv: Any = None):
    parser = argparse.ArgumentParser(description="LaTeX MCP Server")
    parser.add_argument("--workspace", type=str, default=os.getcwd(), help="Path to LaTeX root")
    args = parser.parse_args(argv)
    workspace = Path(args.workspace).resolve()
    if not workspace.exists():
        print(f"Workspace does not exist: {workspace}", file=sys.stderr)
        sys.exit(1)
    try:
        print(f"Build timestamp: {BUILD_TIMESTAMP}", file=sys.stderr)
    except Exception:
        print("Build timestamp not available", file=sys.stderr)
    registry = build_registry(workspace)
    for name in registry.list_names():
        desc = registry.tools[name]["description"]
        print(f"Tool: {name} - {desc}", file=sys.stderr)
    event_loop(registry)


if __name__ == "__main__":  # pragma: no cover
    main()
