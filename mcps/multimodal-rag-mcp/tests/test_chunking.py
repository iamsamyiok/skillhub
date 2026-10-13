from __future__ import annotations

from app.chunking import chunk_text


def test_short_text_single_chunk():
    chunks = chunk_text("hello world")
    assert len(chunks) == 1
    assert chunks[0].content == "hello world"


def test_paragraph_split_and_overlap():
    paras = [f"para {i} " + "x" * 80 for i in range(12)]
    text = "\n\n".join(paras)
    chunks = chunk_text(text, max_chars=300, overlap=50)
    assert len(chunks) > 2
    assert all(len(c.content) <= 310 for c in chunks)
    for a, b in zip(chunks, chunks[1:]):
        assert a.content != b.content


def test_line_tracking_for_code():
    lines = [f"line {i}" for i in range(1, 31)]
    text = "\n".join(lines)
    chunks = chunk_text(text, max_chars=80, overlap=0, track_lines=True)
    assert len(chunks) > 1
    assert chunks[0].line_start == 1
    assert chunks[-1].line_end == 30
    for c in chunks:
        assert c.line_end >= c.line_start
