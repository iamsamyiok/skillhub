from __future__ import annotations

import json
import time
from typing import Any

from .errors import ErrorCode, RagError


class SearchService:
    def __init__(self, ctx):
        self.ctx = ctx

    def search(self, library_id: str, query: str, *, mode: str | None = None,
               top_k: int = 8, content_types: list[str] | None = None,
               file_types: list[str] | None = None, path_prefix: str | None = None,
               include_content: bool = True, max_content_chars: int = 2000,
               include_model_generated: bool = True) -> dict[str, Any]:
        if not query or not query.strip():
            raise RagError(ErrorCode.INTERNAL_ERROR, "query must be non-empty")
        top_k = max(1, min(50, top_k))
        started = time.monotonic()
        cfg = self.ctx.cfg
        mode = mode or cfg.retrieval.default_mode
        warnings: list[str] = []
        db = self.ctx.db

        has_embed = self.ctx.embedding_configured()
        if mode in ("vector", "hybrid") and not has_embed:
            warnings.append("Embedding provider not configured; falling back to full_text mode.")
            mode = "full_text"

        index = self.ctx.library_index(library_id)
        vector_topk = max(top_k, cfg.retrieval.vector_top_k)
        fts_topk = max(top_k, cfg.retrieval.full_text_top_k)

        if mode == "vector":
            vec = self.ctx.embedding_provider().embed([query])[0]
            raw = index.search_vector(vec, vector_topk)
            matched_default = "vector"
        elif mode == "full_text":
            raw = index.search_full_text(query, fts_topk)
            matched_default = "full_text"
        else:
            vec = self.ctx.embedding_provider().embed([query])[0]
            raw = index.search_hybrid(vec, query, max(vector_topk, fts_topk))
            matched_default = "hybrid"

        reranked = False
        if (self.ctx.cfg.retrieval.reranker_enabled
                and self.ctx.reranker_configured() and len(raw) > 1):
            try:
                reranker = self.ctx.reranker_provider()
                docs = [fields.get("content", "") for _, _, fields in raw]
                order = reranker.rerank(query, docs)
                raw = [(raw[i][0], score, raw[i][2]) for i, score in order]
                reranked = True
            except RagError as e:
                warnings.append(f"Reranker failed ({e.code}); using fusion order.")

        results: list[dict[str, Any]] = []
        seen: set[str] = set()
        total_candidates = len(raw)
        for chunk_id, score, fields in raw:
            if chunk_id in seen:
                continue
            row = db.get_chunk(chunk_id)
            if row is None:
                continue  # stale/ghost doc in zvec; SQLite is authoritative (PRD 8.7)
            file = db.get_file(library_id, file_id=row["file_id"])
            if file is None or file["status"] != "READY":
                continue
            if not include_model_generated and row["origin_kind"] == "model_generated":
                continue
            if content_types and row["content_type"] not in content_types:
                continue
            if file_types and file["relative_path"].rsplit(".", 1)[-1].lower() not in {t.lower() for t in file_types}:
                continue
            if path_prefix and not row["relative_path"].startswith(path_prefix.replace("\\", "/")):
                continue
            rel_path = file["relative_path"]
            seen.add(chunk_id)
            score_type = {"vector": "similarity", "full_text": "bm25",
                          "hybrid": "rrf"}.get(mode, "unknown")
            if reranked:
                score_type = "reranker_relevance"
            content = row["content"] if include_content else ""
            if include_content and len(content) > max_content_chars:
                content = content[:max_content_chars] + "…"
            try:
                chunk_meta = json.loads(row.get("metadata_json") or "{}")
            except ValueError:
                chunk_meta = {}
            results.append({
                "result_id": f"{library_id}:{chunk_id}",
                "library_id": library_id,
                "file_id": row["file_id"],
                "chunk_id": chunk_id,
                "file_name": file["display_name"],
                "relative_path": rel_path,
                "content": content,
                "content_type": row["content_type"],
                "origin_kind": row["origin_kind"],
                "model_generated": row["origin_kind"] == "model_generated",
                "score": score,
                "score_type": score_type,
                "matched_by": "reranker" if reranked else matched_default,
                "page_number": row["page_number"],
                "sheet_name": row["sheet_name"],
                "slide_number": row["slide_number"],
                "start_ms": row["start_ms"],
                "end_ms": row["end_ms"],
                "line_start": row["line_start"],
                "line_end": row["line_end"],
                "source_exists": (self.ctx.library_cfg(library_id).root_path / rel_path).is_file(),
                "source_hash": file["source_hash"],
                "metadata": chunk_meta,
                "get_context_tool": "get_source_context",
            })
            if len(results) >= top_k:
                break

        if not results and not raw:
            warnings.append("No candidates found. The library may not be indexed yet; try add_file/sync_library first.")
        return {
            "query": query,
            "library_id": library_id,
            "mode": mode,
            "results": results,
            "total_candidates": total_candidates,
            "warnings": warnings,
            "elapsed_ms": int((time.monotonic() - started) * 1000),
        }
