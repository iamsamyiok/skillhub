from __future__ import annotations

import functools
import json
from typing import Any

from mcp.server.mcpserver import MCPServer

from .errors import ErrorCode, RagError


def _json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, default=str)


def mcp_tool(mcp: MCPServer):
    """Register a tool; RagError becomes a machine-readable error JSON result
    instead of a protocol-level exception (PRD 11 / error codes 21)."""

    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                return fn(*args, **kwargs)
            except RagError as e:
                return _json({"error": e.to_dict()})
        return mcp.tool()(wrapper)

    return deco


def build_mcp(ctx) -> MCPServer:
    mcp = MCPServer(
        name=ctx.cfg.server.name,
        instructions="Folder-scoped multimodal RAG knowledge base. All search results are traceable to source files and locations.",
    )

    @mcp_tool(mcp)
    def list_libraries(include_status: bool = True) -> str:
        """List configured knowledge libraries with status counts."""
        out = []
        for lib in ctx.cfg.libraries:
            item: dict[str, Any] = {
                "library_id": lib.id,
                "name": lib.name,
                "enabled": lib.enabled,
            }
            if include_status:
                stats = ctx.db.file_stats(lib.id)
                item.update({
                    "file_count": stats.get("total", 0),
                    "ready_count": stats.get("READY", 0),
                    "failed_count": stats.get("FAILED", 0),
                    "last_sync_at": ctx.db.kv_get(f"last_sync:{lib.id}"),
                })
            if ctx.cfg.server.show_absolute_paths:
                item["root_path"] = str(lib.root_path)
            else:
                item["root_path_display"] = lib.root_path.name
            out.append(item)
        return _json({"libraries": out})

    @mcp_tool(mcp)
    def get_library_info(library_id: str) -> str:
        """Show one library's configuration summary, modality capabilities and statistics."""
        lib = ctx.cfg.library(library_id)
        if lib is None:
            raise RagError(ErrorCode.LIBRARY_NOT_FOUND, f"Unknown library: {library_id}")
        stats = ctx.db.file_stats(lib.id)
        idx = ctx.library_index(lib.id)
        return _json({
            "library_id": lib.id,
            "name": lib.name,
            "root_path_display": lib.root_path.name,
            "enabled": lib.enabled,
            "recursive": lib.recursive,
            "watch_mode": lib.watch_mode,
            "external_file_policy": lib.external_file_policy,
            "file_stats": stats,
            "index_doc_count": idx.doc_count(),
            "vector_index": idx.has_vectors,
            "embedding_model": ctx.embedding_model_id() if ctx.embedding_configured() else None,
            "modalities": {
                "text": True,
                "pdf": True,
                "office": True,
                "image": ctx.vision_configured(),
                "audio": ctx.asr_configured(),
                "video": bool(ctx.ffmpeg_path()),
            },
        })

    @mcp_tool(mcp)
    def search_knowledge(query: str, library_id: str | None = None,
                         top_k: int = 8, mode: str | None = None,
                         content_types: list[str] | None = None,
                         file_types: list[str] | None = None,
                         path_prefix: str | None = None,
                         include_content: bool = True,
                         max_content_chars: int = 2000,
                         include_model_generated: bool = True) -> str:
        """Search a knowledge library (hybrid/vector/full_text). Every hit is traceable
        to its source file and location (page/sheet/slide/timestamp/lines)."""
        lid = library_id or ctx.cfg.server.default_library_id
        ctx.library_cfg(lid)
        return _json(ctx.search_service.search(
            lid, query, mode=mode, top_k=top_k, content_types=content_types,
            file_types=file_types, path_prefix=path_prefix,
            include_content=include_content, max_content_chars=max_content_chars,
            include_model_generated=include_model_generated,
        ))

    @mcp_tool(mcp)
    def get_source_context(library_id: str, chunk_id: str | None = None,
                           file_id: str | None = None,
                           before_chunks: int = 1, after_chunks: int = 1,
                           max_chars: int = 8000) -> str:
        """Return a chunk plus its neighboring chunks from the same file."""
        ctx.library_cfg(library_id)
        db = ctx.db
        if chunk_id:
            row = db.get_chunk(chunk_id)
        elif file_id:
            chunks = db.get_chunks(file_id)
            row = chunks[0] if chunks else None
        else:
            raise RagError(ErrorCode.INTERNAL_ERROR, "Provide chunk_id or file_id")
        if row is None or row["library_id"] != library_id:
            raise RagError(ErrorCode.SOURCE_UNAVAILABLE, "Chunk/file not found in this library")
        chunks = db.get_chunks(row["file_id"])
        pos = next((i for i, c in enumerate(chunks) if c["chunk_id"] == row["chunk_id"]), 0)
        lo = max(0, pos - max(0, min(5, before_chunks)))
        hi = min(len(chunks), pos + max(0, min(5, after_chunks)) + 1)
        selected = chunks[lo:hi]
        file = db.get_file(library_id, file_id=row["file_id"])
        text, total = [], 0
        for c in selected:
            content = c["content"]
            if total + len(content) > max_chars:
                content = content[: max(0, max_chars - total)]
                if content:
                    text.append({"chunk_id": c["chunk_id"], "chunk_index": c["chunk_index"],
                                 "content": content, "truncated": True})
                break
            total += len(content)
            text.append({"chunk_id": c["chunk_id"], "chunk_index": c["chunk_index"],
                         "content": content, "truncated": False})
        return _json({
            "file": {"file_id": row["file_id"], "file_name": file["display_name"],
                     "relative_path": file["relative_path"], "status": file["status"]},
            "current_chunk_id": row["chunk_id"],
            "location": {"page_number": row["page_number"], "sheet_name": row["sheet_name"],
                         "slide_number": row["slide_number"], "start_ms": row["start_ms"],
                         "end_ms": row["end_ms"], "line_start": row["line_start"],
                         "line_end": row["line_end"]},
            "chunks": text,
            "source_exists": (ctx.library_cfg(library_id).root_path / file["relative_path"]).is_file(),
        })

    @mcp_tool(mcp)
    def get_source_file(library_id: str, file_id: str,
                        mode: str = "metadata_only", max_bytes: int = 65536) -> str:
        """Return registered file metadata, a text excerpt, or the local path.
        Only files indexed in this library can be accessed (no arbitrary path reads)."""
        ctx.library_cfg(library_id)
        file = ctx.db.get_file(library_id, file_id=file_id)
        if file is None:
            raise RagError(ErrorCode.FILE_NOT_FOUND, f"Unknown file_id: {file_id}")
        abs_path = ctx.library_cfg(library_id).root_path / file["relative_path"]
        meta = {
            "file_id": file_id, "file_name": file["display_name"],
            "relative_path": file["relative_path"], "mime_type": file["mime_type"],
            "size_bytes": file["size_bytes"], "status": file["status"],
            "source_hash": file["source_hash"], "indexed_at": file["indexed_at"],
            "source_exists": abs_path.is_file(),
            "return_mode": mode,
        }
        if mode == "metadata_only":
            return _json(meta)
        if mode == "text_excerpt":
            if not abs_path.is_file():
                raise RagError(ErrorCode.SOURCE_UNAVAILABLE, "Source file no longer exists")
            data = abs_path.read_bytes()[: max(1, min(max_bytes, 1 << 20))]
            meta["content_bytes"] = len(data)
            meta["text"] = data.decode("utf-8", errors="replace")
            meta["note"] = "Return content may be truncated; encoding is best-effort UTF-8."
            return _json(meta)
        if mode == "file_uri":
            if not abs_path.is_file():
                raise RagError(ErrorCode.SOURCE_UNAVAILABLE, "Source file no longer exists")
            meta["file_uri"] = abs_path.as_uri()
            meta["note"] = "This is a local file URI; only clients on this machine can open it."
            return _json(meta)
        raise RagError(
            ErrorCode.CLIENT_CANNOT_ACCESS_URI,
            "binary_content mode is not enabled in this version",
            suggestion="Use text_excerpt or file_uri.",
        )

    @mcp_tool(mcp)
    def add_file(library_id: str, source_path: str, copy_to_library: bool = False,
                 force_reprocess: bool = False, wait: bool = False,
                 timeout_seconds: int = 120) -> str:
        """Add one file to a library (must be inside the library root unless
        copy_to_library=true and policy allows copying). Returns a job id."""
        result = ctx.sync_service.add_path(
            library_id, source_path, copy_to_library=copy_to_library,
            force_reprocess=force_reprocess,
        )
        timeout_seconds = max(5, min(600, timeout_seconds))
        if wait and result.get("job_id"):
            statuses = ctx.worker.wait_for_jobs([result["job_id"]], timeout_seconds)
            job = ctx.db.get_job(result["job_id"])
            result["wait_status"] = statuses.get(result["job_id"])
            result["error_code"] = job.get("error_code") if job else None
            result["error_message"] = job.get("error_message") if job else None
        return _json(result)

    @mcp_tool(mcp)
    def add_folder(library_id: str, folder_path: str | None = None,
                   recursive: bool = True, max_files: int = 500,
                   wait: bool = False, timeout_seconds: int = 300) -> str:
        """Scan and queue files from a folder inside the library root
        (defaults to the root itself), honoring include/exclude globs."""
        lib = ctx.library_cfg(library_id)
        if folder_path:
            from .security import ensure_within_root, canonicalize

            target = ensure_within_root(canonicalize(folder_path), lib.root_path)
            if target != lib.root_path:
                raise RagError(
                    ErrorCode.INTERNAL_ERROR,
                    "Scanning a subfolder is applied via path_prefix filter; scanning root instead",
                )
        max_files = max(1, min(max_files, ctx.cfg.server.max_import_files))
        result = ctx.sync_service.scan(library_id, max_files=max_files)
        if wait:
            ctx.worker.wait_for_jobs(result["job_ids"], max(5, min(600, timeout_seconds)))
            result["jobs"] = {jid: (ctx.db.get_job(jid) or {}).get("status")
                              for jid in result["job_ids"]}
        return _json(result)

    @mcp_tool(mcp)
    def get_job_status(job_id: str) -> str:
        """Return processing status of a job."""
        job = ctx.db.get_job(job_id)
        if job is None:
            raise RagError(ErrorCode.JOB_NOT_FOUND, f"Unknown job: {job_id}")
        return _json(job)

    @mcp_tool(mcp)
    def sync_library(library_id: str, mode: str = "incremental",
                     delete_missing_from_index: bool = True,
                     max_files: int | None = None, wait: bool = False,
                     timeout_seconds: int = 300) -> str:
        """Detect added/modified/deleted files under the library root and re-index.
        Only index entries are removed for missing files; originals are never deleted."""
        ctx.library_cfg(library_id)
        result = ctx.sync_service.scan(library_id, mode=mode,
                                       delete_missing_from_index=delete_missing_from_index,
                                       max_files=max_files)
        if wait:
            ctx.worker.wait_for_jobs(result["job_ids"], max(5, min(600, timeout_seconds)))
            result["jobs"] = {jid: (ctx.db.get_job(jid) or {}).get("status")
                              for jid in result["job_ids"]}
        return _json(result)

    @mcp_tool(mcp)
    def remove_file(library_id: str, file_id: str | None = None,
                    relative_path: str | None = None) -> str:
        """Remove a file's index entries and metadata. The original file on disk
        is NOT deleted (delete_original is intentionally not offered)."""
        ctx.library_cfg(library_id)
        file = ctx.db.get_file(library_id, file_id=file_id, relative_path=relative_path)
        if file is None:
            raise RagError(ErrorCode.FILE_NOT_FOUND, "File not found in library index")
        ctx.pipeline.delete_file_index(library_id, file["file_id"])
        ctx.db.execute("UPDATE files SET status='REMOVED', updated_at=? WHERE file_id=?",
                       (_now(), file["file_id"]))
        return _json({"removed": file["file_id"], "relative_path": file["relative_path"],
                      "original_deleted": False})

    @mcp_tool(mcp)
    def reindex_file(library_id: str, file_id: str | None = None,
                     relative_path: str | None = None,
                     reason: str | None = None, force_refresh_models: bool = False) -> str:
        """Re-parse and re-index one file (e.g. after parser/model changes)."""
        ctx.library_cfg(library_id)
        file = ctx.db.get_file(library_id, file_id=file_id, relative_path=relative_path)
        if file is None:
            raise RagError(ErrorCode.FILE_NOT_FOUND, "File not found in library index")
        job_id = ctx.pipeline.make_job(library_id, file["file_id"])
        return _json({"job_id": job_id, "file_id": file["file_id"], "reason": reason,
                      "force_refresh_models": force_refresh_models})

    @mcp_tool(mcp)
    def get_index_status(library_id: str | None = None, include_recent_errors: bool = True,
                         recent_limit: int = 10) -> str:
        """Aggregate index statistics: file/chunk counts, pending/failed jobs,
        index model and recent errors."""
        lids = [library_id] if library_id else [l.id for l in ctx.cfg.libraries]
        out = []
        for lid in lids:
            lib = ctx.cfg.library(lid)
            if lib is None:
                continue
            stats = ctx.db.file_stats(lid)
            n_chunks = ctx.db.query_one(
                "SELECT COUNT(*) AS n FROM chunks WHERE library_id = ?", (lid,)
            )["n"]
            pending_jobs = ctx.db.query_one(
                "SELECT COUNT(*) AS n FROM jobs WHERE library_id = ? AND status IN ('QUEUED','RETRY_WAIT','PROCESSING')",
                (lid,),
            )["n"]
            entry: dict[str, Any] = {
                "library_id": lid,
                "file_stats": stats,
                "chunk_count": n_chunks,
                "pending_jobs": pending_jobs,
                "embedding_configured": ctx.embedding_configured(),
                "embedding_model": ctx.embedding_model_id() if ctx.embedding_configured() else None,
            }
            try:
                entry["index_doc_count"] = ctx.library_index(lid).doc_count()
            except RagError:
                entry["index_doc_count"] = None
            if include_recent_errors:
                entry["recent_errors"] = ctx.db.query(
                    "SELECT job_id, file_id, error_code, error_message, updated_at FROM jobs "
                    "WHERE library_id = ? AND status = 'FAILED' ORDER BY updated_at DESC LIMIT ?",
                    (lid, max(1, min(50, recent_limit))),
                )
            out.append(entry)
        return _json({"libraries": out})

    @mcp_tool(mcp)
    def get_service_status() -> str:
        """Service/dependency/provider status. Never returns API keys."""
        import platform

        import zvec as zvec_mod

        return _json({
            "service": ctx.cfg.server.name,
            "version": "0.1.0",
            "python": platform.python_version(),
            "zvec_version": getattr(zvec_mod, "__version__", "0.7.x"),
            "transport": ctx.cfg.server.transport,
            "providers": {
                "embedding": ctx.cfg.embedding.is_configured(),
                "vision": ctx.vision_configured(),
                "asr": ctx.asr_configured(),
                "reranker": ctx.reranker_configured(),
                "ffmpeg": bool(ctx.ffmpeg_path()),
            },
            "libraries": [l.id for l in ctx.cfg.libraries],
        })

    @mcp_tool(mcp)
    def reconcile_index(library_id: str, dry_run: bool = True) -> str:
        """Check SQLite vs zvec consistency (ghost docs / missing docs) and report.
        With dry_run=false, removes zvec docs that have no active SQLite chunk."""
        ctx.library_cfg(library_id)
        index = ctx.library_index(library_id)
        sqlite_ids = set(ctx.db.all_chunk_ids(library_id))
        zvec_ids = set(index.iter_all_ids())
        ghosts = sorted(zvec_ids - sqlite_ids)
        missing = sorted(sqlite_ids - zvec_ids)
        report: dict[str, Any] = {
            "library_id": library_id,
            "sqlite_chunks": len(sqlite_ids),
            "zvec_docs": len(zvec_ids),
            "ghost_docs_in_zvec": len(ghosts),
            "missing_docs_in_zvec": len(missing),
            "consistent": not ghosts and not missing,
            "dry_run": dry_run,
        }
        if not dry_run and ghosts:
            index.delete_chunks(ghosts)
            report["removed_ghost_docs"] = len(ghosts)
            report["consistent"] = not missing
        return _json(report)

    # -- resources (PRD 11.15) -------------------------------------------
    @mcp.resource("rag://libraries")
    def resource_libraries() -> str:
        return list_libraries(include_status=True)

    return mcp


def _now() -> str:
    from .db import utcnow

    return utcnow()
