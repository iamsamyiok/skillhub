from __future__ import annotations

import argparse
import json
import sys

from .config import load_config
from .logging_setup import setup_logging
from .service import AppContext


def main() -> int:
    parser = argparse.ArgumentParser(prog="app", description="Multimodal RAG MCP server")
    parser.add_argument("command", nargs="?", default="serve",
                        choices=["serve", "doctor"], help="serve (default) or doctor")
    parser.add_argument("--config", default="config.toml", help="Path to config.toml")
    args = parser.parse_args()

    cfg = load_config(args.config)
    setup_logging(cfg.server.log_level)
    ctx = AppContext(cfg)
    try:
        if args.command == "doctor":
            from .doctor import run_doctor

            report = run_doctor(ctx)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0 if report["required_ok"] else 1
        from .mcp_server import build_mcp

        mcp = build_mcp(ctx)
        mcp.run(transport=cfg.server.transport)
        return 0
    finally:
        ctx.close()


if __name__ == "__main__":
    sys.exit(main())
