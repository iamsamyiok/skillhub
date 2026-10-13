from __future__ import annotations

import shutil
from pathlib import Path

from .config import AppConfig, LibraryConfig, load_config
from .db import Database, utcnow
from .errors import ErrorCode, RagError
from .indexing import ZvecLibraryIndex
from .pipeline import IngestionPipeline, JobWorker
from .providers.asr import AsrProvider
from .providers.embedding import EmbeddingProvider
from .providers.reranker import RerankerProvider
from .providers.vision import VisionProvider
from .search import SearchService
from .sync import SyncService


class AppContext:
    """Wires config, database, providers, indexes and services together."""

    def __init__(self, cfg: AppConfig):
        self.cfg = cfg
        state = cfg.state_path
        (state / "indexes").mkdir(parents=True, exist_ok=True)
        self.db = Database(state / "metadata.db")
        self.pipeline = IngestionPipeline(self)
        self.worker = JobWorker(self)
        self.sync_service = SyncService(self)
        self.search_service = SearchService(self)
        self._indexes: dict[str, ZvecLibraryIndex] = {}
        self._embedder: EmbeddingProvider | None = None
        self._vision: VisionProvider | None = None
        self._asr: AsrProvider | None = None
        self._reranker: RerankerProvider | None = None
        self._register_libraries()
        self.worker.recover()

    @classmethod
    def from_config_file(cls, path: str | Path) -> "AppContext":
        return cls(load_config(path))

    def close(self) -> None:
        for idx in self._indexes.values():
            try:
                idx.close()
            except Exception:  # noqa: BLE001
                pass
        self.db.close()

    # -- libraries -------------------------------------------------------
    def _register_libraries(self) -> None:
        for lib in self.cfg.libraries:
            existing = self.db.query_one(
                "SELECT library_id FROM libraries WHERE library_id = ?", (lib.id,)
            )
            if existing:
                self.db.execute(
                    "UPDATE libraries SET name=?, root_path=?, enabled=?, updated_at=? "
                    "WHERE library_id=?",
                    (lib.name, str(lib.root_path), 1 if lib.enabled else 0, utcnow(), lib.id),
                )
            else:
                self.db.execute(
                    "INSERT INTO libraries (library_id, name, root_path, config_json, enabled, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (lib.id, lib.name, str(lib.root_path), "{}", 1 if lib.enabled else 0,
                     utcnow(), utcnow()),
                )

    def library_cfg(self, library_id: str) -> LibraryConfig:
        lib = self.cfg.library(library_id)
        if lib is None:
            raise RagError(ErrorCode.LIBRARY_NOT_FOUND, f"Unknown library: {library_id}",
                           retryable=False)
        if not lib.enabled:
            raise RagError(ErrorCode.LIBRARY_DISABLED, f"Library is disabled: {library_id}",
                           retryable=False)
        return lib

    # -- providers --------------------------------------------------------
    def embedding_configured(self) -> bool:
        return self.cfg.embedding.is_configured()

    def embedding_model_id(self) -> str:
        return f"{self.cfg.embedding.provider}:{self.cfg.embedding.model}"

    def embedding_provider(self) -> EmbeddingProvider:
        if self._embedder is None:
            self._embedder = EmbeddingProvider(self.cfg.embedding)
        return self._embedder

    def vision_configured(self) -> bool:
        return bool(self.cfg.vision.enabled and self.cfg.vision.is_configured())

    def vision_provider(self) -> VisionProvider:
        if self._vision is None:
            self._vision = VisionProvider(self.cfg.vision)
        return self._vision

    def asr_configured(self) -> bool:
        return bool(self.cfg.asr.enabled and self.cfg.asr.is_configured())

    def asr_provider(self) -> AsrProvider:
        if self._asr is None:
            self._asr = AsrProvider(self.cfg.asr)
        return self._asr

    def reranker_configured(self) -> bool:
        return self.cfg.reranker.is_configured()

    def reranker_provider(self) -> RerankerProvider:
        if self._reranker is None:
            self._reranker = RerankerProvider(self.cfg.reranker)
        return self._reranker

    def ffmpeg_path(self) -> str | None:
        if self.cfg.video.ffmpeg_path and Path(self.cfg.video.ffmpeg_path).is_file():
            return self.cfg.video.ffmpeg_path
        return shutil.which("ffmpeg")

    # -- indexes -----------------------------------------------------------
    def library_index(self, library_id: str) -> ZvecLibraryIndex:
        if library_id in self._indexes:
            return self._indexes[library_id]
        self.library_cfg(library_id)
        dim = None
        if self.embedding_configured():
            cfg = self.cfg.embedding
            dim = cfg.dimensions if cfg.dimensions > 0 else None
            if dim is None:
                dim = self.embedding_provider().dimensions
        idx = ZvecLibraryIndex(str(self.cfg.state_path / "indexes" / library_id), dim)
        self._indexes[library_id] = idx
        return idx
