from __future__ import annotations

from ..config import ProviderConfig
from ..errors import ErrorCode, RagError
from .http import HttpCaller


class RerankerProvider:
    """OpenAI-style /rerank client (SiliconFlow BAAI/bge-reranker-v2-m3 verified)."""

    def __init__(self, cfg: ProviderConfig):
        if not cfg.is_configured():
            raise RagError(
                ErrorCode.CONFIG_INVALID,
                "Reranker provider is not fully configured",
                retryable=False,
            )
        self.cfg = cfg
        self.model = cfg.model
        self._caller = HttpCaller(cfg.timeout_seconds, cfg.max_retries, "reranker")

    def rerank(self, query: str, documents: list[str]) -> list[tuple[int, float]]:
        """Returns [(original_index, relevance_score)] sorted by score desc."""
        url = self.cfg.base_url.rstrip("/") + "/rerank"
        headers = {"Authorization": f"Bearer {self.cfg.api_key()}"}
        resp = self._caller.post_json(
            url, headers, {"model": self.model, "query": query, "documents": documents}
        )
        results = resp.get("results")
        if not isinstance(results, list):
            raise RagError(ErrorCode.API_REQUEST_FAILED, "Rerank response missing results",
                           retryable=False)
        out = []
        for item in results:
            try:
                out.append((int(item["index"]), float(item["relevance_score"])))
            except (KeyError, TypeError, ValueError) as e:
                raise RagError(ErrorCode.API_REQUEST_FAILED,
                               "Rerank result malformed", retryable=False) from e
        out.sort(key=lambda t: t[1], reverse=True)
        return out
