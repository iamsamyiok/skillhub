from __future__ import annotations

import fnmatch
import json
import uuid
from pathlib import Path

from .db import Database, utcnow
from .errors import ErrorCode, RagError
from .parsers import file_type_of, is_supported
from .security import canonicalize, ensure_within_root, sha256_file

MIME_FALLBACK = "application/octet-stream"


def _glob_match(rel_posix: str, patterns: list[str]) -> bool:
    for pat in patterns:
        p = pat.replace("\\", "/")
        if fnmatch.fnmatch(rel_posix, p):
            return True
        if fnmatch.fnmatch(rel_posix, p.rstrip("/*") + "/*") or p.rstrip("/*") == "**":
            return True
        if p.startswith("**/") and fnmatch.fnmatch(rel_posix, p[3:]):
            return True
    return False


class SyncService:
    def __init__(self, ctx):
        self.ctx = ctx

    def scan(self, library_id: str, *, mode: str = "incremental",
             delete_missing_from_index: bool = True, max_files: int | None = None) -> dict:
        db: Database = self.ctx.db
        lib = self.ctx.library_cfg(library_id)
        root = canonicalize(lib.root_path)
        if not root.is_dir():
            raise RagError(ErrorCode.FILE_NOT_FOUND,
                           f"Library root does not exist: {lib.root_path.name}",
                           suggestion="Create the folder or fix root_path in config.")

        discovered: list[tuple[Path, str]] = []
        for path in root.rglob("*"):
            rel = path.relative_to(root)
            rel_posix = rel.as_posix()
            if not _glob_match(rel_posix, lib.include_globs):
                continue
            if _glob_match(rel_posix, lib.exclude_globs):
                continue
            if path.is_file():
                if not lib.follow_symlinks and path.is_symlink():
                    continue
                discovered.append((path, rel_posix))
                if max_files is not None and len(discovered) >= max_files:
                    break

        added, updated, unchanged, skipped_unsupported = 0, 0, 0, 0
        job_ids: list[str] = []
        seen_paths: set[str] = set()
        for abs_path, rel_posix in discovered:
            seen_paths.add(rel_posix)
            stat = abs_path.stat()
            existing = db.get_file(library_id, relative_path=rel_posix)
            if existing and mode == "incremental":
                if (existing["size_bytes"] == stat.st_size
                        and existing["mtime_ns"] == stat.st_mtime_ns
                        and existing["status"] == "READY"):
                    unchanged += 1
                    continue
            if not is_supported(abs_path):
                skipped_unsupported += 1
                if not existing:
                    db.upsert_file({
                        "file_id": self._file_id(library_id, rel_posix),
                        "library_id": library_id,
                        "relative_path": rel_posix,
                        "display_name": abs_path.name,
                        "mime_type": MIME_FALLBACK,
                        "size_bytes": stat.st_size,
                        "mtime_ns": stat.st_mtime_ns,
                        "status": "UNSUPPORTED",
                        "last_error": f"Unsupported file type: {abs_path.suffix}",
                        "processing_version": "pv1",
                    })
                continue
            if existing is None:
                file_id = self._file_id(library_id, rel_posix)
                db.upsert_file({
                    "file_id": file_id,
                    "library_id": library_id,
                    "relative_path": rel_posix,
                    "display_name": abs_path.name,
                    "mime_type": MIME_FALLBACK,
                    "size_bytes": stat.st_size,
                    "mtime_ns": stat.st_mtime_ns,
                    "status": "DISCOVERED",
                    "processing_version": "pv1",
                })
                added += 1
            else:
                file_id = existing["file_id"]
                db.upsert_file({
                    **existing,
                    "size_bytes": stat.st_size,
                    "mtime_ns": stat.st_mtime_ns,
                    "status": "STALE" if existing["status"] == "READY" else existing["status"],
                })
                updated += 1
            job_ids.append(self.ctx.pipeline.make_job(library_id, file_id))

        removed = 0
        if delete_missing_from_index:
            for f in db.list_files(library_id):
                if f["relative_path"] not in seen_paths and f["status"] != "REMOVED":
                    self.ctx.pipeline.delete_file_index(library_id, f["file_id"])
                    db.execute("UPDATE files SET status = 'REMOVED', updated_at = ? WHERE file_id = ?",
                               (utcnow(), f["file_id"]))
                    removed += 1

        db.kv_set(f"last_sync:{library_id}", utcnow())
        return {
            "library_id": library_id,
            "mode": mode,
            "discovered": len(discovered),
            "added": added,
            "updated": updated,
            "unchanged": unchanged,
            "removed": removed,
            "skipped_unsupported": skipped_unsupported,
            "job_ids": job_ids,
        }

    @staticmethod
    def _file_id(library_id: str, rel_posix: str) -> str:
        import hashlib

        h = hashlib.sha256(f"{library_id}|{rel_posix}".encode("utf-8")).hexdigest()
        return h[:32]

    def add_path(self, library_id: str, source_path: str, *,
                 copy_to_library: bool = False, force_reprocess: bool = False) -> dict:
        lib = self.ctx.library_cfg(library_id)
        src = canonicalize(source_path)
        if not src.is_file():
            raise RagError(ErrorCode.FILE_NOT_FOUND, f"File not found: {src.name}")
        root = canonicalize(lib.root_path)
        in_root = True
        try:
            ensure_within_root(src, root)
        except RagError:
            in_root = False

        if in_root:
            rel_posix = src.relative_to(root).as_posix()
            actual_rel = rel_posix
            copied = False
        else:
            if lib.external_file_policy == "reject" or not copy_to_library:
                raise RagError(
                    ErrorCode.EXTERNAL_FILE_NOT_ALLOWED,
                    f"File is outside the library root and copy_to_library=false",
                    retryable=False,
                    suggestion="Move the file into the root, or call with copy_to_library=true.",
                )
            if lib.external_file_policy != "copy_into_root":
                raise RagError(
                    ErrorCode.EXTERNAL_FILE_NOT_ALLOWED,
                    "allow_reference policy is not enabled in this version",
                    retryable=False,
                )
            imports_dir = root / "imports"
            imports_dir.mkdir(parents=True, exist_ok=True)
            dest = imports_dir / src.name
            stem, suf = src.stem, src.suffix
            n = 1
            while dest.exists():
                dest = imports_dir / f"{stem}_{n}{suf}"
                n += 1
            import shutil

            shutil.copy2(src, dest)
            actual_rel = dest.relative_to(root).as_posix()
            copied = True

        max_bytes = self.ctx.cfg.server.max_file_size_mb * (1 << 20)
        abs_path = root / actual_rel
        if abs_path.stat().st_size > max_bytes:
            raise RagError(ErrorCode.FILE_TOO_LARGE,
                           f"File exceeds max_file_size_mb ({self.ctx.cfg.server.max_file_size_mb})")
        if not is_supported(abs_path):
            raise RagError(ErrorCode.UNSUPPORTED_FILE_TYPE,
                           f"Unsupported file type: {abs_path.suffix or '(none)'}")

        file_id = self._file_id(library_id, actual_rel)
        stat = abs_path.stat()
        db: Database = self.ctx.db
        existing = db.get_file(library_id, relative_path=actual_rel)
        if existing and not force_reprocess and existing["status"] == "READY":
            if existing["source_hash"] == sha256_file(abs_path):
                return {"status": "already_indexed", "file_id": existing["file_id"],
                        "relative_path": actual_rel, "source_path": str(src), "copied": copied}
        db.upsert_file({
            "file_id": file_id,
            "library_id": library_id,
            "relative_path": actual_rel,
            "display_name": abs_path.name,
            "mime_type": MIME_FALLBACK,
            "size_bytes": stat.st_size,
            "mtime_ns": stat.st_mtime_ns,
            "status": "DISCOVERED",
            "processing_version": "pv1",
        })
        job_id = self.ctx.pipeline.make_job(library_id, file_id)
        return {"status": "queued", "job_id": job_id, "file_id": file_id,
                "relative_path": actual_rel, "source_path": str(src), "copied": copied}
