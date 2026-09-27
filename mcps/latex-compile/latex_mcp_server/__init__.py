"""LaTeX MCP Server package.

Avoid importing heavy modules with side effects at import time to prevent
`runpy` warnings about partially initialized modules when invoked as
`python -m latex_mcp_server.server` or via the console script.
"""

from importlib import import_module
from typing import Any, Callable


def main(*args: Any, **kwargs: Any) -> Any:  # noqa: D401
	"""Entry-point proxy that lazy-loads the real server.main."""
	server = import_module("latex_mcp_server.server")
	return server.main(*args, **kwargs)

__all__ = ["main"]
