from __future__ import annotations

import pytest

from app.errors import RagError
from app.security import canonicalize, ensure_within_root, sha256_text


def test_escape_is_rejected(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("x")
    with pytest.raises(RagError) as ei:
        ensure_within_root(outside, root)
    assert ei.value.code == "PATH_OUTSIDE_LIBRARY"


def test_inside_root_ok(tmp_path):
    root = tmp_path / "root"
    (root / "sub").mkdir(parents=True)
    p = root / "sub" / "a.txt"
    p.write_text("hi")
    assert ensure_within_root(p, root) == p.resolve()


def test_root_itself_rejected(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    with pytest.raises(RagError):
        ensure_within_root(root, root)


def test_canonicalize_and_hash():
    assert canonicalize("relative/../path").is_absolute()
    assert sha256_text("abc") == sha256_text("abc")
    assert sha256_text("abc") != sha256_text("abd")
