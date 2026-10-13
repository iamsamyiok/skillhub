"""Minimal retrieval evaluation: builds a tiny library, indexes it in
full_text mode (no API key needed), reports Recall@5 for labeled queries."""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import AppConfig, LibraryConfig, RetrievalConfig, ServerConfig
from app.service import AppContext


DOCS = {
    "pump.md": "The main circulation pump uses model PX-300 with a 15 kW motor.",
    "valve.md": "When the valve opening increases, the reactor liquid level rises quickly.",
    "safety.md": "Emergency shutdown requires pressing the red E-STOP button twice.",
}

QUERIES = [
    ("PX-300 pump model", "pump.md"),
    ("valve opening liquid level", "valve.md"),
    ("emergency stop button", "safety.md"),
    ("pressure sensor reading", "table.xlsx"),
]


def main() -> int:
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        root = tmp / "knowledge"
        root.mkdir()
        for name, text in DOCS.items():
            (root / name).write_text(text, encoding="utf-8")
        import openpyxl

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Sensors"
        ws.append(["sensor", "reading"])
        ws.append(["pressure_01", 101.3])
        wb.save(str(root / "table.xlsx"))

        cfg = AppConfig(config_path=tmp / "config.toml")
        cfg.server = ServerConfig(state_dir=tmp / "data", default_library_id="eval")
        cfg.retrieval = RetrievalConfig(chunk_size=400, chunk_overlap=50)
        cfg.libraries = [LibraryConfig(id="eval", name="Eval", root_path=root)]
        ctx = AppContext(cfg)
        try:
            scan = ctx.sync_service.scan("eval")
            ctx.worker.wait_for_jobs(scan["job_ids"], 60)
            hits = 0
            for query, expected in QUERIES:
                res = ctx.search_service.search("eval", query, mode="full_text", top_k=5)
                got = {r["relative_path"] for r in res["results"]}
                ok = expected in got
                hits += ok
                status = "PASS" if ok else "FAIL"
                print(f"[{status}] '{query}' -> expected {expected}, got {sorted(got) or '[]'}")
            print(f"\nRecall@5: {hits}/{len(QUERIES)}")
            return 0 if hits == len(QUERIES) else 1
        finally:
            ctx.close()


if __name__ == "__main__":
    sys.exit(main())
