from __future__ import annotations

import re
from typing import Any

import zvec

from ..errors import ErrorCode, RagError

_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{3,64}$")


def collection_name(library_id: str) -> str:
    name = re.sub(r"[^A-Za-z0-9_-]", "_", library_id)[:60]
    if not _NAME_RE.match(name):
        name = "lib_" + re.sub(r"[^A-Za-z0-9_-]", "_", library_id)[:54]
    if not _NAME_RE.match(name):
        raise RagError(ErrorCode.INTERNAL_ERROR, f"Cannot derive collection name for '{library_id}'")
    return name


class ZvecLibraryIndex:
    """One zvec collection per library (PRD 9.1).

    Active-version semantics: retrieval callers MUST cross-check hits against
    SQLite (see SearchService) because zvec and sqlite cannot share a transaction.
    """

    def __init__(self, path: str, dimension: int | None):
        import os

        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.path = path
        self.dimension = dimension
        name = collection_name(os.path.basename(os.path.normpath(path)))
        try:
            self._col: zvec.Collection | None = zvec.open(path, zvec.CollectionOption())
        except Exception:
            self._col = None
        if self._col is not None:
            actual = self._detect_dimension()
            vecs = self._col.schema.vectors or []
            if dimension and not vecs:
                raise RagError(
                    ErrorCode.EMBEDDING_DIMENSION_MISMATCH,
                    "Existing index was created without vectors but an embedding "
                    "provider is now configured",
                    retryable=False,
                    suggestion=f"Delete the index directory '{path}' and re-run sync_library to rebuild.",
                )
            if dimension is not None and actual is not None and actual != dimension:
                raise RagError(
                    ErrorCode.EMBEDDING_DIMENSION_MISMATCH,
                    f"Existing index dimension {actual} != configured {dimension}",
                    retryable=False,
                    suggestion="Create a new index version or rebuild the library index.",
                )
            self.dimension = actual if actual is not None else dimension
        else:
            self._create(name)

    def _detect_dimension(self) -> int | None:
        vecs = self._col.schema.vectors or []
        for v in vecs:
            dim = v.get("dimension") if isinstance(v, dict) else getattr(v, "dimension", None)
            if dim:
                return int(dim)
        return None

    def _create(self, name: str) -> None:
        fields = [
            zvec.FieldSchema("chunk_id", zvec.typing.DataType.STRING),
            zvec.FieldSchema("content", zvec.typing.DataType.STRING,
                             index_param=zvec.FtsIndexParam()),
            zvec.FieldSchema("file_id", zvec.typing.DataType.STRING,
                             index_param=zvec.InvertIndexParam()),
            zvec.FieldSchema("relative_path", zvec.typing.DataType.STRING),
            zvec.FieldSchema("content_type", zvec.typing.DataType.STRING,
                             index_param=zvec.InvertIndexParam()),
            zvec.FieldSchema("origin_kind", zvec.typing.DataType.STRING),
            zvec.FieldSchema("model_generated", zvec.typing.DataType.BOOL),
            zvec.FieldSchema("content_hash", zvec.typing.DataType.STRING),
            zvec.FieldSchema("source_hash", zvec.typing.DataType.STRING),
            zvec.FieldSchema("embedding_model", zvec.typing.DataType.STRING),
        ]
        vectors = None
        if self.dimension and self.dimension > 0:
            vectors = [
                zvec.VectorSchema(
                    "embedding",
                    data_type=zvec.typing.DataType.VECTOR_FP32,
                    dimension=self.dimension,
                    index_param=zvec.HnswIndexParam(),
                )
            ]
        schema = zvec.CollectionSchema(name=name, fields=fields, vectors=vectors)
        try:
            self._col = zvec.create_and_open(self.path, schema, zvec.CollectionOption())
        except Exception as e:
            raise RagError(
                ErrorCode.ZVEC_WRITE_FAILED, f"Cannot create zvec collection: {e}"
            ) from e

    @property
    def has_vectors(self) -> bool:
        return bool(self.dimension)

    def upsert_chunks(self, docs: list[dict[str, Any]]) -> None:
        """docs: chunk_id, content, file_id, relative_path, content_type, origin_kind,
        model_generated, content_hash, source_hash, embedding_model, embedding?"""
        if not docs:
            return
        zdocs = []
        for d in docs:
            vectors = None
            if self.has_vectors:
                vec = d.get("embedding")
                if not vec or len(vec) != self.dimension:
                    raise RagError(
                        ErrorCode.EMBEDDING_DIMENSION_MISMATCH,
                        f"chunk {d['chunk_id']}: vector dim mismatch",
                        retryable=False,
                    )
                vectors = {"embedding": vec}
            zdocs.append(
                zvec.Doc(
                    id=d["chunk_id"],
                    vectors=vectors,
                    fields={
                        "chunk_id": d["chunk_id"],
                        "content": d["content"],
                        "file_id": d["file_id"],
                        "relative_path": d["relative_path"],
                        "content_type": d["content_type"],
                        "origin_kind": d["origin_kind"],
                        "model_generated": bool(d.get("model_generated", False)),
                        "content_hash": d["content_hash"],
                        "source_hash": d["source_hash"],
                        "embedding_model": d.get("embedding_model", ""),
                    },
                )
            )
        try:
            statuses = self._col.upsert(zdocs)
            bad = [str(s) for s in statuses if not str(s).startswith('{"code":0}')]
            if bad:
                raise RagError(ErrorCode.ZVEC_WRITE_FAILED, f"zvec upsert errors: {bad[:3]}")
            self._col.flush()
        except RagError:
            raise
        except Exception as e:
            raise RagError(ErrorCode.ZVEC_WRITE_FAILED, f"zvec write failed: {e}") from e

    def delete_chunks(self, chunk_ids: list[str]) -> None:
        if not chunk_ids:
            return
        try:
            for i in range(0, len(chunk_ids), 500):
                self._col.delete(chunk_ids[i : i + 500])
            self._col.flush()
        except Exception as e:
            raise RagError(ErrorCode.ZVEC_WRITE_FAILED, f"zvec delete failed: {e}") from e

    def fetch(self, chunk_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not chunk_ids:
            return {}
        found = self._col.fetch(chunk_ids, include_vector=False)
        return {k: dict(v.fields) for k, v in found.items()}

    def _post(self, docs) -> list[tuple[str, float | None, dict[str, Any]]]:
        return [(d.id, d.score, dict(d.fields)) for d in docs]

    def search_vector(self, vector: list[float], topk: int):
        q = zvec.Query(field_name="embedding", vector=vector)
        return self._post(self._col.query(queries=q, topk=topk))

    def search_full_text(self, text: str, topk: int):
        q = zvec.Query(field_name="content", fts=zvec.Fts(match_string=text))
        return self._post(self._col.query(queries=q, topk=topk))

    def search_hybrid(self, vector: list[float], text: str, topk: int):
        queries = [
            zvec.Query(field_name="embedding", vector=vector),
            zvec.Query(field_name="content", fts=zvec.Fts(match_string=text)),
        ]
        return self._post(
            self._col.query(queries=queries, topk=topk, reranker=zvec.RrfReRanker(rank_constant=60))
        )

    def iter_all_ids(self) -> list[str]:
        ids: list[str] = []
        for doc in self._col.iter_docs(output_fields=[], include_vector=False):
            ids.append(doc.id)
        return ids

    def doc_count(self) -> int:
        return int(self._col.stats.doc_count)

    def close(self) -> None:
        if self._col is not None:
            self._col.close()
            self._col = None
