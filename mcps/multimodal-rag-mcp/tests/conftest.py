from __future__ import annotations

import hashlib
import math
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.config import AppConfig, LibraryConfig, RetrievalConfig, ServerConfig, ProviderConfig  # noqa: E402
from app.service import AppContext  # noqa: E402


class FakeEmbedder:
    """Deterministic 16-dim hashed bag-of-3-grams embedder (test double only)."""

    model = "fake-embed-test"
    dimensions = 16

    def embed(self, texts):
        return [self._one(t) for t in texts]

    def _one(self, text):
        vec = [0.0] * 16
        t = text.lower()
        for i in range(len(t) - 2):
            h = int(hashlib.md5(t[i : i + 3].encode()).hexdigest(), 16)
            vec[h % 16] += 1.0
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


def make_config(tmp_path: Path) -> AppConfig:
    root = tmp_path / "knowledge"
    root.mkdir(parents=True, exist_ok=True)
    cfg = AppConfig(config_path=tmp_path / "config.toml")
    cfg.server = ServerConfig(state_dir=tmp_path / "data", default_library_id="testlib")
    cfg.retrieval = RetrievalConfig(chunk_size=400, chunk_overlap=50)
    cfg.embedding = ProviderConfig()  # not configured by default
    cfg.libraries = [
        LibraryConfig(id="testlib", name="Test Lib", root_path=root)
    ]
    return cfg


@pytest.fixture()
def ctx_factory(tmp_path):
    created = []

    def _make(with_embedding: bool = False) -> AppContext:
        cfg = make_config(tmp_path)
        ctx = AppContext(cfg)
        if with_embedding:
            fake = FakeEmbedder()
            ctx.embedding_configured = lambda: True
            ctx.embedding_provider = lambda: fake
        created.append(ctx)
        return ctx

    yield _make
    for c in created:
        c.close()
