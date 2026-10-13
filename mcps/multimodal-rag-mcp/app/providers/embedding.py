from __future__ import annotations

import math

from ..config import ProviderConfig
from ..errors import ErrorCode, RagError
from .http import HttpCaller


class EmbeddingProvider:
    """OpenAI-compatible /embeddings client (PRD 12). Cloud-first; no local model."""

    def __init__(self, cfg: ProviderConfig):
        if not cfg.is_configured():
            raise RagError(
                ErrorCode.EMBEDDING_PROVIDER_NOT_CONFIGURED,
                "Embedding provider is not fully configured",
                retryable=False,
                suggestion="Set provider/base_url/model in [embedding] and the API key env var.",
            )
        self.cfg = cfg
        self.model = cfg.model
        self._dim = cfg.dimensions or 0
        self._caller = HttpCaller(cfg.timeout_seconds, cfg.max_retries, "embedding")

    @property
    def dimensions(self) -> int:
        if not self._dim:
            self.embed(["dimension probe"])
        return self._dim

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        cfg = self.cfg
        url = cfg.base_url.rstrip("/") + "/embeddings"
        headers = {"Authorization": f"Bearer {cfg.api_key()}"}
        out: list[list[float]] = []
        for i in range(0, len(texts), max(1, cfg.batch_size)):
            batch = texts[i : i + cfg.batch_size]
            resp = self._caller.post_json(
                url, headers, {"model": self.model, "input": batch}
            )
            data = resp.get("data")
            if not isinstance(data, list) or len(data) != len(batch):
                raise RagError(
                    ErrorCode.API_REQUEST_FAILED,
                    "Embedding response shape mismatch",
                    retryable=False,
                )
            data.sort(key=lambda d: d.get("index", 0))
            for item in data:
                vec = item.get("embedding")
                self._validate_vec(vec)
                if self._dim and len(vec) != self._dim:
                    raise RagError(
                        ErrorCode.EMBEDDING_DIMENSION_MISMATCH,
                        f"Embedding dim {len(vec)} != configured {self._dim}",
                        retryable=False,
                    )
                if not self._dim:
                    self._dim = len(vec)
                out.append(vec)
        return out

    def _validate_vec(self, vec) -> None:
        if not isinstance(vec, list) or not vec:
            raise RagError(
                ErrorCode.API_REQUEST_FAILED, "Empty embedding vector", retryable=False
            )
        for v in vec:
            if not isinstance(v, (int, float)) or not math.isfinite(v):
                raise RagError(
                    ErrorCode.API_REQUEST_FAILED,
                    "Embedding vector contains non-finite values",
                    retryable=False,
                )
