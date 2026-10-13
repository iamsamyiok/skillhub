from __future__ import annotations

import json

import pytest

from app.errors import RagError


def _write_md(root, name, text):
    p = root / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


def test_full_text_flow(ctx_factory, tmp_path):
    ctx = ctx_factory(with_embedding=False)
    root = ctx.cfg.libraries[0].root_path
    _write_md(root, "pumps.md", "The main pump uses model PX-300.\n\nSecondary pump is PX-100.\n")
    result = ctx.sync_service.scan("testlib")
    assert result["added"] == 1
    ctx.worker.wait_for_jobs(result["job_ids"], 30)
    job = ctx.db.get_job(result["job_ids"][0])
    assert job["status"] == "SUCCEEDED", job["error_message"]

    hits = ctx.search_service.search("testlib", "PX-300", mode="full_text")
    assert hits["results"], "should hit PX-300"
    assert hits["results"][0]["relative_path"] == "pumps.md"
    assert hits["results"][0]["matched_by"] == "full_text"

    # no hits -> honest empty result
    none = ctx.search_service.search("testlib", "zzz-unfindable-xyz", mode="full_text")
    assert none["results"] == []


def test_hybrid_vector_flow_and_update(ctx_factory):
    ctx = ctx_factory(with_embedding=True)
    root = ctx.cfg.libraries[0].root_path
    _write_md(root, "valves.md", "When valve opening increases, the liquid level rises quickly.\n\nOld secret keyword: zanzibar.\n")
    r1 = ctx.sync_service.scan("testlib")
    ctx.worker.wait_for_jobs(r1["job_ids"], 30)

    hits = ctx.search_service.search("testlib", "valve opening liquid level", mode="hybrid")
    assert hits["results"]
    assert hits["mode"] == "hybrid"
    assert hits["results"][0]["score_type"] == "rrf"

    # update file: old content must disappear
    _write_md(root, "valves.md", "When valve opening increases, the liquid level rises quickly.\n")
    r2 = ctx.sync_service.scan("testlib")
    assert r2["updated"] == 1
    ctx.worker.wait_for_jobs(r2["job_ids"], 30)
    stale = ctx.search_service.search("testlib", "zanzibar", mode="full_text")
    assert stale["results"] == []
    still = ctx.search_service.search("testlib", "valve opening liquid level", mode="hybrid")
    assert still["results"]


def test_get_source_context(ctx_factory):
    ctx = ctx_factory()
    root = ctx.cfg.libraries[0].root_path
    text = "\n\n".join(
        f"Paragraph number {i} contains detailed operational notes about pump {i}."
        for i in range(40)
    )
    _write_md(root, "long.md", text)
    r = ctx.sync_service.scan("testlib")
    ctx.worker.wait_for_jobs(r["job_ids"], 30)
    hits = ctx.search_service.search("testlib", "Paragraph number 5", mode="full_text")
    assert hits["results"]
    chunk_id = hits["results"][0]["chunk_id"]
    file_id = hits["results"][0]["file_id"]
    from app.db import Database  # noqa: F401

    neighbors = _get_context(ctx, chunk_id)
    assert len(neighbors["chunks"]) >= 2
    assert neighbors["file"]["file_id"] == file_id


def _get_context(ctx, chunk_id):
    db = ctx.db
    row = db.get_chunk(chunk_id)
    chunks = db.get_chunks(row["file_id"])
    pos = next(i for i, c in enumerate(chunks) if c["chunk_id"] == chunk_id)
    lo = max(0, pos - 1)
    hi = min(len(chunks), pos + 2)
    file = db.get_file(row["library_id"], file_id=row["file_id"])
    return {
        "file": file,
        "chunks": [
            {"chunk_id": c["chunk_id"], "chunk_index": c["chunk_index"], "content": c["content"]}
            for c in chunks[lo:hi]
        ],
    }


def test_remove_file_keeps_original(ctx_factory):
    ctx = ctx_factory()
    root = ctx.cfg.libraries[0].root_path
    p = _write_md(root, "gone.md", "unique content xylophone")
    r = ctx.sync_service.scan("testlib")
    ctx.worker.wait_for_jobs(r["job_ids"], 30)
    file = ctx.db.get_file("testlib", relative_path="gone.md")
    ctx.pipeline.delete_file_index("testlib", file["file_id"])
    ctx.db.execute("UPDATE files SET status='REMOVED' WHERE file_id=?", (file["file_id"],))
    assert p.exists(), "original file must not be deleted"
    hits = ctx.search_service.search("testlib", "xylophone", mode="full_text")
    assert hits["results"] == []


def test_unsupported_file_marked(ctx_factory):
    ctx = ctx_factory()
    root = ctx.cfg.libraries[0].root_path
    p = root / "run.exe"
    p.write_bytes(b"MZ fake")
    r = ctx.sync_service.scan("testlib")
    assert r["skipped_unsupported"] == 1
    assert r["job_ids"] == []
    stats = ctx.db.file_stats("testlib")
    assert stats.get("UNSUPPORTED") == 1


def test_external_file_policy(ctx_factory, tmp_path):
    ctx = ctx_factory()
    outside = tmp_path / "outside.md"
    outside.write_text("external content", encoding="utf-8")
    with pytest.raises(RagError) as ei:
        ctx.sync_service.add_path("testlib", str(outside))
    assert ei.value.code == "EXTERNAL_FILE_NOT_ALLOWED"

    result = ctx.sync_service.add_path("testlib", str(outside), copy_to_library=True)
    assert result["copied"] is True
    assert result["relative_path"].startswith("imports/")
    ctx.worker.wait_for_jobs([result["job_id"]], 30)
    hits = ctx.search_service.search("testlib", "external content", mode="full_text")
    assert hits["results"]


def test_restart_recovery_and_reconcile(ctx_factory, tmp_path):
    ctx = ctx_factory(with_embedding=True)
    root = ctx.cfg.libraries[0].root_path
    _write_md(root, "persist.md", "Persistent content about turbines and rotors.")
    r = ctx.sync_service.scan("testlib")
    ctx.worker.wait_for_jobs(r["job_ids"], 30)
    ctx.close()

    # reopen: index persists, search works
    from tests.conftest import make_config
    from app.service import AppContext

    cfg = make_config(tmp_path)
    ctx2 = AppContext(cfg)
    fake = __import__("tests.conftest", fromlist=["FakeEmbedder"]).FakeEmbedder()
    ctx2.embedding_configured = lambda: True
    ctx2.embedding_provider = lambda: fake
    hits = ctx2.search_service.search("testlib", "turbines and rotors", mode="hybrid")
    assert hits["results"]

    # reconcile: consistent after clean run
    index = ctx2.library_index("testlib")
    sqlite_ids = set(ctx2.db.all_chunk_ids("testlib"))
    zvec_ids = set(index.iter_all_ids())
    assert sqlite_ids == zvec_ids
    ctx2.close()


def test_idempotent_reindex(ctx_factory):
    ctx = ctx_factory()
    root = ctx.cfg.libraries[0].root_path
    _write_md(root, "same.md", "stable content for idempotency check")
    r1 = ctx.sync_service.scan("testlib")
    ctx.worker.wait_for_jobs(r1["job_ids"], 30)
    r2 = ctx.sync_service.scan("testlib")
    assert r2["added"] == 0 and r2["updated"] == 0 and r2["unchanged"] == 1
    chunks = ctx.db.get_chunks(ctx.db.get_file("testlib", relative_path="same.md")["file_id"])
    assert len(chunks) >= 1
