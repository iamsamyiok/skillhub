from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

from .errors import ErrorCode, RagError

_UNSAFE = re.compile(r"[<>:\"|?*\x00-\x1f]")


def canonicalize(path: str | Path) -> Path:
    p = Path(os.path.abspath(str(path)))
    try:
        p = p.resolve(strict=False)
    except OSError as e:
        raise RagError(ErrorCode.PATH_OUTSIDE_LIBRARY, f"Cannot resolve path: {path}") from e
    if _UNSAFE.search(p.name):
        raise RagError(ErrorCode.PATH_OUTSIDE_LIBRARY, f"Unsafe characters in path: {p.name}")
    return p


def ensure_within_root(path: Path, root: Path) -> Path:
    """Return path resolved under root or raise PATH_OUTSIDE_LIBRARY."""
    root_c = canonicalize(root)
    p = canonicalize(path)
    try:
        rel = p.relative_to(root_c)
    except ValueError as e:
        raise RagError(
            ErrorCode.PATH_OUTSIDE_LIBRARY,
            f"Path is outside the library root: {p.name}",
            suggestion="Put the file inside the library root, or enable copy_into_root.",
            details={"path_name": p.name},
        ) from e
    if rel == Path("."):
        raise RagError(ErrorCode.PATH_OUTSIDE_LIBRARY, "Path points at the library root itself")
    return p


def sha256_file(path: Path, chunk_size: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            block = f.read(chunk_size)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
