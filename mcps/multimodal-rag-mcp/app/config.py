from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import ErrorCode, RagError


@dataclass
class ServerConfig:
    name: str = "multimodal-rag-mcp"
    log_level: str = "INFO"
    transport: str = "stdio"
    default_library_id: str = "default"
    max_concurrent_jobs: int = 2
    max_file_size_mb: int = 500
    max_import_files: int = 500
    max_result_chars: int = 8000
    state_dir: Path = Path("./data")
    original_file_policy: str = "keep_in_place"
    show_absolute_paths: bool = False


@dataclass
class RetrievalConfig:
    default_mode: str = "hybrid"
    vector_top_k: int = 20
    full_text_top_k: int = 20
    final_top_k: int = 8
    fusion: str = "rrf"
    reranker_enabled: bool = False
    chunk_size: int = 1200
    chunk_overlap: int = 150


@dataclass
class ProviderConfig:
    provider: str = ""
    base_url: str = ""
    api_key_env: str = ""
    model: str = ""
    timeout_seconds: int = 60
    max_retries: int = 3
    # embedding only
    dimensions: int = 0
    batch_size: int = 32
    # vision/asr/video toggles
    enabled: bool = True
    mode: str = "cloud"

    def api_key(self) -> str | None:
        if not self.provider or not self.api_key_env:
            return None
        return os.environ.get(self.api_key_env) or None

    def is_configured(self) -> bool:
        return bool(self.provider and self.base_url and self.model and self.api_key())


@dataclass
class VideoConfig:
    enabled: bool = True
    ffmpeg_path: str = ""
    scene_detection: bool = True
    max_frames_per_minute: int = 6
    max_frames_per_video: int = 300
    max_video_minutes: int = 240


@dataclass
class PrivacyConfig:
    upload_original_files: bool = False
    send_text_to_cloud: bool = True
    send_images_to_vision_api: bool = True
    send_audio_to_asr_api: bool = True
    send_video_frames_to_vision_api: bool = True
    redact_secrets_from_logs: bool = True


@dataclass
class LibraryConfig:
    id: str
    name: str
    root_path: Path
    enabled: bool = True
    recursive: bool = True
    watch_mode: str = "manual"
    include_globs: list[str] = field(default_factory=lambda: ["**/*"])
    exclude_globs: list[str] = field(
        default_factory=lambda: ["**/.git/**", "**/node_modules/**", "**/~$*", "**/.DS_Store"]
    )
    follow_symlinks: bool = False
    external_file_policy: str = "copy_into_root"


@dataclass
class AppConfig:
    config_path: Path
    server: ServerConfig = field(default_factory=ServerConfig)
    retrieval: RetrievalConfig = field(default_factory=RetrievalConfig)
    embedding: ProviderConfig = field(default_factory=ProviderConfig)
    llm: ProviderConfig = field(default_factory=ProviderConfig)
    vision: ProviderConfig = field(default_factory=ProviderConfig)
    asr: ProviderConfig = field(default_factory=ProviderConfig)
    reranker: ProviderConfig = field(default_factory=ProviderConfig)
    video: VideoConfig = field(default_factory=VideoConfig)
    privacy: PrivacyConfig = field(default_factory=PrivacyConfig)
    libraries: list[LibraryConfig] = field(default_factory=list)

    def library(self, library_id: str) -> LibraryConfig | None:
        for lib in self.libraries:
            if lib.id == library_id:
                return lib
        return None

    @property
    def state_path(self) -> Path:
        p = Path(self.server.state_dir)
        return p if p.is_absolute() else (self.config_path.parent / p).resolve()


def _bind(cls: type, data: dict[str, Any], section: str):
    kwargs = {}
    known = {f for f in cls.__dataclass_fields__}
    unknown = set(data) - known
    if unknown:
        raise RagError(
            ErrorCode.CONFIG_INVALID,
            f"Unknown keys in [{section}]: {sorted(unknown)}",
            suggestion="Remove unknown keys or update the config template.",
        )
    for k, v in data.items():
        cur = getattr(cls, k, None)
        kwargs[k] = Path(v) if isinstance(cur, Path) else v
    return cls(**kwargs)


def _provider(cls_kwargs: dict[str, Any]) -> ProviderConfig:
    return _bind(ProviderConfig, cls_kwargs, "provider")


def load_config(path: str | Path) -> AppConfig:
    cfg_path = Path(path).resolve()
    if not cfg_path.is_file():
        raise RagError(
            ErrorCode.CONFIG_INVALID,
            f"Config file not found: {cfg_path}",
            suggestion="Copy config.example.toml and edit it.",
        )
    with open(cfg_path, "rb") as f:
        raw = tomllib.load(f)
    cfg = AppConfig(config_path=cfg_path)
    if "server" in raw:
        cfg.server = _bind(ServerConfig, raw["server"], "server")
    if "retrieval" in raw:
        cfg.retrieval = _bind(RetrievalConfig, raw["retrieval"], "retrieval")
    for name in ("embedding", "llm", "vision", "asr", "reranker"):
        if name in raw:
            setattr(cfg, name, _provider(raw[name]))
    if "video" in raw:
        cfg.video = _bind(VideoConfig, raw["video"], "video")
    if "privacy" in raw:
        cfg.privacy = _bind(PrivacyConfig, raw["privacy"], "privacy")

    libs_raw = raw.get("libraries", [])
    if not libs_raw:
        raise RagError(
            ErrorCode.CONFIG_INVALID,
            "No [[libraries]] defined in config.",
            suggestion="Add at least one [[libraries]] entry.",
        )
    seen: set[str] = set()
    for i, lib in enumerate(libs_raw):
        lc = _bind(LibraryConfig, dict(lib), "libraries")
        if not lc.id or lc.id in seen:
            raise RagError(ErrorCode.CONFIG_INVALID, f"Duplicate/empty library id at index {i}")
        seen.add(lc.id)
        root = Path(lc.root_path)
        if not root.is_absolute():
            root = cfg_path.parent / root
        lc.root_path = root.resolve()
        cfg.libraries.append(lc)

    if cfg.server.default_library_id not in seen:
        raise RagError(
            ErrorCode.CONFIG_INVALID,
            f"default_library_id '{cfg.server.default_library_id}' is not a configured library",
        )
    if cfg.server.transport not in ("stdio", "streamable-http"):
        raise RagError(ErrorCode.CONFIG_INVALID, f"Unsupported transport: {cfg.server.transport}")
    return cfg
