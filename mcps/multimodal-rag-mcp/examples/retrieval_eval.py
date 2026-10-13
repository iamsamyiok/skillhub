"""Scientific retrieval evaluation against real providers.

Builds a labeled bilingual corpus, indexes it with the configured
[embedding] provider, then compares four retrieval modes:
  full_text / vector / hybrid / hybrid+reranker
Metrics: Recall@5, MRR, avg latency. Also runs robustness checks.

Usage: set provider API key env vars, then
    .venv/Scripts/python.exe examples/retrieval_eval.py
"""
from __future__ import annotations

import json
import os
import shutil
import statistics
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import AppConfig, LibraryConfig, RetrievalConfig, ServerConfig
from app.config import load_config
from app.errors import RagError
from app.service import AppContext

DOCS = {
    "pump_spec.md": (
        "# 主泵规格\n\n主循环泵型号 PUMP-300，电机功率 15 kW，额定流量 120 立方米每小时，"
        "最大工作压力 1.6 MPa。冷却回路使用乙二醇水溶液。\n"
    ),
    "valve_procedure.md": (
        "# 阀门操作规程\n\n当阀门开度增加时，反应釜液位快速上升。操作员必须监视 LIC-101 液位传感器。"
        "液位超过 80% 时应减小开度并上报值班工程师。\n"
    ),
    "safety.md": (
        "# Safety Rules\n\nEmergency shutdown requires pressing the red E-STOP button twice. "
        "Never bypass interlocks during maintenance.\n"
    ),
    "maintenance.md": (
        "# 检修计划\n\n每 2000 小时更换轴承润滑脂，检查机械密封泄漏量应小于 5 滴每分钟。"
        "备件清单包含机械密封套件 MS-200。\n"
    ),
    "report_q3.md": (
        "# Q3 生产报告\n\n第三季度产量 4.2 万吨，同比增长 8%。能耗下降 3%。"
        "下次评审会议定于 10 月 20 日。\n"
    ),
}

QUERIES = [
    ("主泵额定流量是多少", "pump_spec.md"),
    ("阀门开度增加会怎样", "valve_procedure.md"),
    ("液位传感器编号", "valve_procedure.md"),
    ("emergency stop procedure", "safety.md"),
    ("轴承润滑脂更换周期", "maintenance.md"),
    ("机械密封备件型号", "maintenance.md"),
    ("第三季度产量", "report_q3.md"),
    ("maximum working pressure", "pump_spec.md"),
    ("液位超过多少需要减小开度", "valve_procedure.md"),
    ("Q3 energy consumption", "report_q3.md"),
]


def build_ctx(tmp: Path, reranker: bool) -> AppContext:
    cfg = AppConfig(config_path=tmp / "config.toml")
    cfg.server = ServerConfig(state_dir=tmp / "data", default_library_id="eval")
    cfg.retrieval = RetrievalConfig(chunk_size=400, chunk_overlap=50)
    cfg.retrieval.reranker_enabled = reranker
    cfg.embedding = _cfg_embedding()
    cfg.reranker = _cfg_reranker()
    cfg.vision = _cfg_vision()
    cfg.libraries = [LibraryConfig(id="eval", name="Eval", root_path=tmp / "knowledge")]
    return AppContext(cfg)


def _section(name: str):
    real = load_config(Path(__file__).resolve().parents[1] / "config.toml")
    return getattr(real, name)


def _cfg_embedding():
    return _section("embedding")


def _cfg_reranker():
    return _section("reranker")


def _cfg_vision():
    return _section("vision")


def eval_mode(ctx: AppContext, mode: str, k: int = 5):
    recall_hits, rr_sum, latencies = 0, 0.0, []
    for query, expected in QUERIES:
        t0 = time.perf_counter()
        try:
            res = ctx.search_service.search("eval", query, mode=mode, top_k=k)
        except RagError as e:
            return {"error": f"{e.code}: {e.message}"}
        latencies.append((time.perf_counter() - t0) * 1000)
        paths = [r["relative_path"] for r in res["results"]]
        if expected in paths:
            recall_hits += 1
            rr_sum += 1.0 / (paths.index(expected) + 1)
    n = len(QUERIES)
    return {
        "recall@5": round(recall_hits / n, 3),
        "mrr": round(rr_sum / n, 3),
        "avg_ms": round(statistics.mean(latencies), 1),
        "p95_ms": round(sorted(latencies)[int(0.95 * len(latencies)) - 1], 1),
    }


def main() -> int:
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        root = tmp / "knowledge"
        root.mkdir()
        for name, text in DOCS.items():
            (root / name).write_text(text, encoding="utf-8")

        results: dict[str, dict] = {}
        for reranker, modes in ((False, ["full_text", "vector", "hybrid"]),
                                (True, ["hybrid"])):
            ctx = build_ctx(tmp, reranker)
            try:
                scan = ctx.sync_service.scan("eval")
                ctx.worker.wait_for_jobs(scan["job_ids"], 300)
                for mode in modes:
                    label = mode + ("+rerank" if reranker else "")
                    results[label] = eval_mode(ctx, mode)
                    print(f"{label:16s} {json.dumps(results[label], ensure_ascii=False)}")
            finally:
                ctx.close()

        print("\n== robustness: invalid API key ==")
        os.environ["RAG_EVAL_BAD_KEY"] = "sk-invalid-key-robustness-test"
        from app.config import ProviderConfig
        from app.providers.embedding import EmbeddingProvider

        bad_cfg = _cfg_embedding()
        bad_cfg.api_key_env = "RAG_EVAL_BAD_KEY"
        t0 = time.perf_counter()
        try:
            EmbeddingProvider(bad_cfg).embed(["probe"])
            print("FAIL: invalid key was accepted")
            return 1
        except RagError as e:
            dt = time.perf_counter() - t0
            print(f"PASS: {e.code} raised in {dt:.1f}s (retryable={e.retryable})")
            if e.retryable or dt > 30:
                print("FAIL: should fail fast and non-retryable")
                return 1
        finally:
            os.environ.pop("RAG_EVAL_BAD_KEY", None)

        ok = all("error" not in v for v in results.values())
        best = max((v for v in results.values() if "mrr" in v), key=lambda v: v["mrr"])
        print(f"\nbest mode by MRR: {json.dumps(best)}")
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
