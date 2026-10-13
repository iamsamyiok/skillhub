from __future__ import annotations

import json
import time
import uuid

from .chunking import ParsedChunk
from .db import Database, utcnow
from .errors import ErrorCode, RagError
from .parsers import PARSER_VERSION, is_supported, parse_file
from .security import sha256_file, sha256_text

PROCESSING_VERSION = "pv1"
MAX_ATTEMPTS = 5


class IngestionPipeline:
    def __init__(self, ctx):
        self.ctx = ctx

    def make_job(self, library_id: str, file_id: str, job_type: str = "index_file") -> str:
        job_id = uuid.uuid4().hex
        self.ctx.db.create_job(
            {
                "job_id": job_id,
                "library_id": library_id,
                "file_id": file_id,
                "job_type": job_type,
                "status": "QUEUED",
                "stage": "QUEUED",
            }
        )
        return job_id

    def process(self, library_id: str, file_id: str, job_id: str,
                force_refresh_models: bool = False) -> None:
        db: Database = self.ctx.db
        lib = self.ctx.library_cfg(library_id)
        f = db.get_file(library_id, file_id=file_id)
        if f is None:
            db.update_job(job_id, status="FAILED", error_code=ErrorCode.FILE_NOT_FOUND,
                          error_message="File record missing", finished_at=utcnow())
            return

        def stage(s: str, **extra):
            db.update_job(job_id, status="PROCESSING", stage=s, **extra)

        try:
            abs_path = lib.root_path / f["relative_path"]
            if not abs_path.is_file():
                raise RagError(ErrorCode.FILE_NOT_FOUND,
                               f"Source file missing: {f['relative_path']}", retryable=False)

            if not is_supported(abs_path):
                self._fail_file(db, f, ErrorCode.UNSUPPORTED_FILE_TYPE,
                                f"Unsupported file type: {abs_path.suffix}")
                db.update_job(job_id, status="FAILED", stage="FAILED",
                              error_code=ErrorCode.UNSUPPORTED_FILE_TYPE,
                              error_message=f"Unsupported file type: {abs_path.suffix}",
                              finished_at=utcnow())
                return

            source_hash = sha256_file(abs_path)
            need_embed = self.ctx.embedding_configured()
            embedding_model = self.ctx.embedding_model_id() if need_embed else ""
            target_version = f"{PROCESSING_VERSION}|{PARSER_VERSION}|{embedding_model}"
            if (not force_refresh_models and f["status"] == "READY"
                    and f["source_hash"] == source_hash
                    and f["processing_version"] == target_version):
                db.update_job(job_id, status="SUCCEEDED", stage="SKIPPED",
                              finished_at=utcnow(),
                              progress_json=json.dumps({"skipped": "already_indexed"}))
                return

            max_chars = self.ctx.cfg.retrieval.chunk_size
            overlap = self.ctx.cfg.retrieval.chunk_overlap

            stage("PARSING")
            parser_name, parsed = parse_file(abs_path, self.ctx,
                                             max_chars=max_chars, overlap=overlap)

            stage("EMBEDDING")
            embeddings: list[list[float]] | None = None
            if need_embed and parsed:
                provider = self.ctx.embedding_provider()
                embeddings = provider.embed([c.content for c in parsed])

            old_chunks = db.get_chunks(file_id)
            old_ids = [c["chunk_id"] for c in old_chunks]
            now = utcnow()
            chunk_rows: list[dict] = []
            zdocs: list[dict] = []
            for i, c in enumerate(parsed):
                chunk_id = self._chunk_id(file_id, c)
                row = {
                    "chunk_id": chunk_id,
                    "file_id": file_id,
                    "library_id": library_id,
                    "content": c.content,
                    "content_type": c.content_type,
                    "origin_kind": c.origin_kind,
                    "chunk_index": i,
                    "page_number": c.page_number,
                    "sheet_name": c.sheet_name,
                    "slide_number": c.slide_number,
                    "start_ms": c.start_ms,
                    "end_ms": c.end_ms,
                    "line_start": c.line_start,
                    "line_end": c.line_end,
                    "metadata_json": json.dumps(c.metadata, ensure_ascii=False),
                    "content_hash": sha256_text(c.content),
                    "embedding_model": embedding_model,
                    "created_at": now,
                }
                chunk_rows.append(row)
                zdocs.append({
                    "chunk_id": chunk_id,
                    "content": c.content,
                    "file_id": file_id,
                    "relative_path": f["relative_path"],
                    "content_type": c.content_type,
                    "origin_kind": c.origin_kind,
                    "model_generated": c.origin_kind == "model_generated",
                    "content_hash": row["content_hash"],
                    "source_hash": source_hash,
                    "embedding_model": embedding_model,
                    "embedding": embeddings[i] if embeddings else None,
                })

            stage("INDEXING")
            index = self.ctx.library_index(library_id)
            index.upsert_chunks(zdocs)

            stage("VERIFYING")
            written = index.fetch([r["chunk_id"] for r in zdocs]) if zdocs else {}
            missing = [r["chunk_id"] for r in zdocs if r["chunk_id"] not in written]
            if missing:
                raise RagError(ErrorCode.INDEX_INCONSISTENT,
                               f"{len(missing)} chunks missing in index after write")

            stage("NORMALIZING")
            db.replace_chunks(file_id, chunk_rows)
            db.upsert_file({
                **f,
                "status": "READY",
                "last_error": None,
                "source_hash": source_hash,
                "parser_name": parser_name,
                "parser_version": PARSER_VERSION,
                "processing_version": target_version,
                "indexed_at": utcnow(),
            })

            active = {r["chunk_id"] for r in chunk_rows}
            stale = [cid for cid in old_ids if cid not in active]
            if stale:
                try:
                    index.delete_chunks(stale)
                except RagError:
                    db.kv_set("reconcile_needed", library_id)
            db.update_job(job_id, status="SUCCEEDED", stage="READY", finished_at=utcnow(),
                          progress_json=json.dumps({"chunks": len(chunk_rows)}))

        except RagError as e:
            self._handle_error(db, f, job_id, e)
        except Exception as e:  # noqa: BLE001
            self._handle_error(db, f, job_id,
                               RagError(ErrorCode.INTERNAL_ERROR, f"{type(e).__name__}: {e}"))

    def _chunk_id(self, file_id: str, c: ParsedChunk) -> str:
        loc = (f"{c.page_number}|{c.sheet_name}|{c.slide_number}|{c.start_ms}|"
               f"{c.end_ms}|{c.line_start}|{c.line_end}|{c.chunk_index}")
        return f"{file_id[:16]}-{sha256_text(loc + '|' + sha256_text(c.content))[:32]}"

    def _fail_file(self, db: Database, f: dict, code: str, msg: str) -> None:
        db.upsert_file({**f, "status": "FAILED", "last_error": f"{code}: {msg}"})

    def _handle_error(self, db: Database, f: dict | None, job_id: str, e: RagError) -> None:
        attempts = (db.get_job(job_id) or {}).get("attempt_count", 0)
        if e.retryable and attempts < MAX_ATTEMPTS:
            db.update_job(job_id, status="RETRY_WAIT", stage="RETRY_WAIT",
                          attempt_count=attempts + 1, error_code=e.code,
                          error_message=e.message[:500])
        else:
            db.update_job(job_id, status="FAILED", stage="FAILED",
                          attempt_count=attempts + 1,
                          error_code=e.code, error_message=e.message[:500],
                          finished_at=utcnow())
            if f is not None:
                self._fail_file(db, f, e.code, e.message)

    def delete_file_index(self, library_id: str, file_id: str) -> None:
        db = self.ctx.db
        chunks = db.get_chunks(file_id)
        index = self.ctx.library_index(library_id)
        if chunks:
            try:
                index.delete_chunks([c["chunk_id"] for c in chunks])
            except RagError:
                db.kv_set("reconcile_needed", library_id)
        db.execute("DELETE FROM chunks WHERE file_id = ?", (file_id,))


class JobWorker:
    def __init__(self, ctx):
        self.ctx = ctx
        self.pipeline = IngestionPipeline(ctx)

    def recover(self) -> int:
        n = 0
        for job in self.ctx.db.jobs_in_status(["PROCESSING"]):
            self.ctx.db.update_job(job["job_id"], status="QUEUED", stage="QUEUED")
            n += 1
        return n

    def run_pending(self, library_id: str | None = None,
                    max_jobs: int | None = None) -> int:
        jobs = self.ctx.db.jobs_in_status(["QUEUED", "RETRY_WAIT"])
        if library_id:
            jobs = [j for j in jobs if j["library_id"] == library_id]
        if max_jobs is not None:
            jobs = jobs[:max_jobs]
        count = 0
        for job in jobs:
            if job["status"] == "RETRY_WAIT" and job.get("attempt_count", 0) >= MAX_ATTEMPTS:
                self.ctx.db.update_job(job["job_id"], status="FAILED", stage="FAILED",
                                       error_code=ErrorCode.API_REQUEST_FAILED,
                                       error_message="max retry attempts reached",
                                       finished_at=utcnow())
                continue
            self.ctx.db.update_job(
                job["job_id"], status="PROCESSING",
                started_at=job.get("started_at") or utcnow(),
                attempt_count=job.get("attempt_count", 0) + 1,
            )
            if job.get("file_id"):
                self.pipeline.process(job["library_id"], job["file_id"], job["job_id"])
            else:
                self.ctx.db.update_job(job["job_id"], status="FAILED",
                                       error_code=ErrorCode.INTERNAL_ERROR,
                                       error_message="Job has no file_id", finished_at=utcnow())
            count += 1
        return count

    def wait_for_jobs(self, job_ids: list[str], timeout_seconds: float) -> dict[str, str]:
        deadline = time.monotonic() + timeout_seconds
        pending = set(job_ids)
        result: dict[str, str] = {}
        while pending and time.monotonic() < deadline:
            self.run_pending()
            for jid in list(pending):
                job = self.ctx.db.get_job(jid)
                if job and job["status"] in ("SUCCEEDED", "FAILED"):
                    result[jid] = job["status"]
                    pending.discard(jid)
            if pending:
                time.sleep(0.05)
        for jid in pending:
            job = self.ctx.db.get_job(jid)
            result[jid] = job["status"] if job else "UNKNOWN"
        return result
