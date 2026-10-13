from __future__ import annotations

import logging
import sys


def setup_logging(level: str = "INFO") -> None:
    # stdio transport: logs MUST go to stderr; stdout carries MCP protocol only.
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    # third-party HTTP clients are noisy at INFO and leak request URLs into logs
    for noisy in ("httpx", "httpcore", "openai"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
