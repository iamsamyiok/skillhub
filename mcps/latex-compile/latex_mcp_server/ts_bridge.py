import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Callable


class TypeScriptBridge:
    """Simple bridge to invoke pre-built TypeScript functions via Node.

    Functions are registered by name and mapped to TypeScript exports. The bridge
    spawns `node` with `index.js <function> <json-args>` and expects a single-line
    JSON object on stdout: {"ok": true, "result": ...} or {"ok": false, "error": ...}.
    """

    def __init__(self, dist_dir: Path):
        self.dist_dir = dist_dir
        self.index_js = dist_dir / "index.js"
        self.map: Dict[str, str] = {}
        self.node_path = shutil.which("node")

    def available(self) -> bool:
        return bool(self.node_path) and self.index_js.exists()

    def register_ts_tool(self, public_name: str, ts_export: str):
        self.map[public_name] = ts_export

    def call(self, public_name: str, payload: Dict[str, Any]) -> Any:
        if public_name not in self.map:
            raise KeyError(f"TS tool not registered: {public_name}")
        if not self.available():
            raise RuntimeError("TypeScript bridge unavailable (node or index.js missing)")
        fn = self.map[public_name]
        args_json = json.dumps(payload)
        try:
            proc = subprocess.run(
                [self.node_path, str(self.index_js), fn, args_json],
                capture_output=True,
                text=True,
                check=False,
            )
        except OSError as e:  # pragma: no cover
            raise RuntimeError(f"Failed to execute node: {e}") from e
        if proc.returncode != 0:
            raise RuntimeError(f"Node process failed: {proc.stderr.strip() or proc.stdout.strip()}")
        line = proc.stdout.strip().splitlines()[-1] if proc.stdout else ""
        try:
            data = json.loads(line)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Invalid JSON from TS: {line!r}") from e
        if not data.get("ok"):
            raise RuntimeError(data.get("error", "Unknown TypeScript error"))
        return data.get("result")

    def make_wrapper(self, public_name: str) -> Callable[[Dict[str, Any]], Any]:
        def _wrapper(params: Dict[str, Any]) -> Any:
            return self.call(public_name, params)

        _wrapper.__name__ = f"ts_{public_name}"
        return _wrapper
