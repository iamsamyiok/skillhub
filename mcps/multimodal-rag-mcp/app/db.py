from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .errors import ErrorCode, RagError


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


SCHEMA_VERSION = 1

_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS libraries (
    library_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    file_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    external_path TEXT,
    display_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    mtime_ns INTEGER NOT NULL DEFAULT 0,
    source_hash TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'DISCOVERED',
    last_error TEXT,
    parser_name TEXT,
    parser_version TEXT,
    processing_version TEXT NOT NULL DEFAULT 'v1',
    indexed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (library_id, relative_path)
);
CREATE INDEX IF NOT EXISTS idx_files_lib_status ON files (library_id, status);

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    library_id TEXT NOT NULL,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL,
    origin_kind TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    page_number INTEGER,
    sheet_name TEXT,
    slide_number INTEGER,
    start_ms INTEGER,
    end_ms INTEGER,
    line_start INTEGER,
    line_end INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT NOT NULL,
    embedding_model TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files (file_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks (file_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_lib ON chunks (library_id);

CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    file_id TEXT,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'QUEUED',
    stage TEXT NOT NULL DEFAULT '',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    error_code TEXT,
    error_message TEXT,
    progress_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);

CREATE TABLE IF NOT EXISTS model_cache (
    cache_key TEXT PRIMARY KEY,
    operation TEXT NOT NULL,
    model_id TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT
);
"""


class Database:
    """Thread-safe SQLite wrapper; single shared connection + lock.

    SQLite is the authoritative metadata store (PRD 7.2/8.7).
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(
            str(self.path), check_same_thread=False
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self.migrate()

    def migrate(self) -> None:
        with self._lock, self._conn:
            self._conn.executescript(_DDL)
            row = self._conn.execute(
                "SELECT MAX(version) AS v FROM schema_migrations"
            ).fetchone()
            current = row["v"] or 0
            if current < SCHEMA_VERSION:
                self._conn.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                    (SCHEMA_VERSION, utcnow()),
                )

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # -- generic helpers -------------------------------------------------
    def execute(self, sql: str, params: tuple | dict = ()) -> None:
        with self._lock, self._conn:
            self._conn.execute(sql, params)

    def query(self, sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def query_one(self, sql: str, params: tuple | dict = ()) -> dict[str, Any] | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def transaction(self):
        return _Txn(self)

    # -- kv ---------------------------------------------------------------
    def kv_get(self, key: str) -> str | None:
        row = self.query_one("SELECT value FROM kv WHERE key = ?", (key,))
        return row["value"] if row else None

    def kv_set(self, key: str, value: str) -> None:
        self.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    # -- files ------------------------------------------------------------
    def upsert_file(self, rec: dict[str, Any]) -> None:
        now = utcnow()
        defaults = {
            "external_path": None,
            "mime_type": "application/octet-stream",
            "size_bytes": 0,
            "mtime_ns": 0,
            "source_hash": "",
            "status": "DISCOVERED",
            "last_error": None,
            "parser_name": None,
            "parser_version": None,
            "processing_version": "pv1",
            "indexed_at": None,
        }
        defaults.update(rec)
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO files (
                    file_id, library_id, relative_path, external_path, display_name,
                    mime_type, size_bytes, mtime_ns, source_hash, status, last_error,
                    parser_name, parser_version, processing_version, indexed_at,
                    created_at, updated_at
                ) VALUES (
                    :file_id, :library_id, :relative_path, :external_path, :display_name,
                    :mime_type, :size_bytes, :mtime_ns, :source_hash, :status, :last_error,
                    :parser_name, :parser_version, :processing_version, :indexed_at,
                    :created_at, :updated_at
                )
                ON CONFLICT (library_id, relative_path) DO UPDATE SET
                    size_bytes = excluded.size_bytes,
                    mtime_ns = excluded.mtime_ns,
                    source_hash = excluded.source_hash,
                    status = excluded.status,
                    last_error = excluded.last_error,
                    updated_at = excluded.updated_at
                """,
                {
                    **defaults,
                    "created_at": rec.get("created_at") or now,
                    "updated_at": now,
                },
            )

    def get_file(self, library_id: str, *, file_id: str | None = None,
                 relative_path: str | None = None) -> dict[str, Any] | None:
        if file_id:
            return self.query_one(
                "SELECT * FROM files WHERE library_id = ? AND file_id = ?",
                (library_id, file_id),
            )
        if relative_path:
            return self.query_one(
                "SELECT * FROM files WHERE library_id = ? AND relative_path = ?",
                (library_id, relative_path.replace("\\", "/")),
            )
        raise RagError(ErrorCode.INTERNAL_ERROR, "get_file requires file_id or relative_path")

    def list_files(self, library_id: str, status: str | None = None) -> list[dict[str, Any]]:
        if status:
            return self.query(
                "SELECT * FROM files WHERE library_id = ? AND status = ? ORDER BY relative_path",
                (library_id, status),
            )
        return self.query(
            "SELECT * FROM files WHERE library_id = ? ORDER BY relative_path", (library_id,)
        )

    def file_stats(self, library_id: str) -> dict[str, int]:
        rows = self.query(
            "SELECT status, COUNT(*) AS n FROM files WHERE library_id = ? GROUP BY status",
            (library_id,),
        )
        stats = {r["status"]: r["n"] for r in rows}
        stats["total"] = sum(stats.values())
        return stats

    # -- chunks ------------------------------------------------------------
    def replace_chunks(self, file_id: str, chunks: list[dict[str, Any]]) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM chunks WHERE file_id = ?", (file_id,))
            self._conn.executemany(
                """
                INSERT INTO chunks (
                    chunk_id, file_id, library_id, content, content_type, origin_kind,
                    chunk_index, page_number, sheet_name, slide_number, start_ms, end_ms,
                    line_start, line_end, metadata_json, content_hash, embedding_model,
                    created_at
                ) VALUES (
                    :chunk_id, :file_id, :library_id, :content, :content_type, :origin_kind,
                    :chunk_index, :page_number, :sheet_name, :slide_number, :start_ms, :end_ms,
                    :line_start, :line_end, :metadata_json, :content_hash, :embedding_model,
                    :created_at
                )
                """,
                chunks,
            )

    def get_chunks(self, file_id: str) -> list[dict[str, Any]]:
        return self.query(
            "SELECT * FROM chunks WHERE file_id = ? ORDER BY chunk_index", (file_id,)
        )

    def get_chunk(self, chunk_id: str) -> dict[str, Any] | None:
        return self.query_one("SELECT * FROM chunks WHERE chunk_id = ?", (chunk_id,))

    def all_chunk_ids(self, library_id: str) -> list[str]:
        rows = self.query(
            "SELECT chunk_id FROM chunks WHERE library_id = ?", (library_id,)
        )
        return [r["chunk_id"] for r in rows]

    # -- jobs ---------------------------------------------------------------
    def create_job(self, job: dict[str, Any]) -> str:
        now = utcnow()
        self.execute(
            """
            INSERT INTO jobs (
                job_id, library_id, file_id, job_type, status, stage, attempt_count,
                progress_json, created_at, updated_at
            ) VALUES (
                :job_id, :library_id, :file_id, :job_type, :status, :stage, :attempt_count,
                :progress_json, :created_at, :updated_at
            )
            """,
            {
                "job_id": job["job_id"],
                "library_id": job["library_id"],
                "file_id": job.get("file_id"),
                "job_type": job["job_type"],
                "status": job.get("status", "QUEUED"),
                "stage": job.get("stage", ""),
                "attempt_count": job.get("attempt_count", 0),
                "progress_json": job.get("progress_json", "{}"),
                "created_at": now,
                "updated_at": now,
            },
        )
        return job["job_id"]

    def update_job(self, job_id: str, **fields: Any) -> None:
        if not fields:
            return
        fields["updated_at"] = utcnow()
        cols = ", ".join(f"{k} = :{k}" for k in fields)
        self.execute(f"UPDATE jobs SET {cols} WHERE job_id = :job_id", {"job_id": job_id, **fields})

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        return self.query_one("SELECT * FROM jobs WHERE job_id = ?", (job_id,))

    def jobs_in_status(self, statuses: list[str]) -> list[dict[str, Any]]:
        marks = ",".join("?" for _ in statuses)
        return self.query(
            f"SELECT * FROM jobs WHERE status IN ({marks}) ORDER BY created_at", tuple(statuses)
        )


class _Txn:
    def __init__(self, db: Database):
        self.db = db

    def __enter__(self):
        self.db._lock.acquire()
        return self.db._conn

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self.db._conn.commit()
            else:
                self.db._conn.rollback()
        finally:
            self.db._lock.release()
        return False
