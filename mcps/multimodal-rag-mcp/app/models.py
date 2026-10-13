from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class FileRecord:
    file_id: str
    library_id: str
    relative_path: str
    display_name: str
    mime_type: str = "application/octet-stream"
    size_bytes: int = 0
    mtime_ns: int = 0
    source_hash: str = ""
    status: str = "DISCOVERED"
    last_error: str | None = None
    parser_name: str | None = None
    parser_version: str | None = None
    processing_version: str = "v1"
    external_path: str | None = None
    indexed_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ChunkRecord:
    chunk_id: str
    file_id: str
    library_id: str
    content: str
    content_type: str
    origin_kind: str
    chunk_index: int = 0
    page_number: int | None = None
    sheet_name: str | None = None
    slide_number: int | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    line_start: int | None = None
    line_end: int | None = None
    metadata_json: str = "{}"
    content_hash: str = ""
    embedding_model: str = ""
    created_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
