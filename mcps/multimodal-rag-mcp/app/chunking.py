from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ParsedChunk:
    content: str
    content_type: str = "text"          # per PRD 7.1 vocabulary
    origin_kind: str = "extracted_text"  # original_text | extracted_text | model_generated
    page_number: int | None = None
    sheet_name: str | None = None
    slide_number: int | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    line_start: int | None = None
    line_end: int | None = None
    chunk_index: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


def chunk_text(
    text: str,
    *,
    max_chars: int = 1200,
    overlap: int = 150,
    track_lines: bool = False,
) -> list[ParsedChunk]:
    """Paragraph-aware chunking with character overlap; optional line tracking."""
    if not text or not text.strip():
        return []
    text = text.strip()
    if len(text) <= max_chars:
        chunk = ParsedChunk(content=text)
        if track_lines:
            chunk.line_start, chunk.line_end = 1, text.count("\n") + 1
        return [chunk]

    paragraphs = [p for p in text.split("\n\n") if p.strip()]
    chunks: list[ParsedChunk] = []
    buf: list[str] = []
    buf_len = 0

    def flush() -> None:
        nonlocal buf, buf_len
        if buf:
            content = "\n\n".join(buf).strip()
            if content:
                chunks.append(ParsedChunk(content=content))
            buf, buf_len = [], 0

    for para in paragraphs:
        if len(para) > max_chars:
            flush()
            start = 0
            while start < len(para):
                piece = para[start : start + max_chars]
                chunks.append(ParsedChunk(content=piece.strip()))
                start += max_chars - overlap if start + max_chars < len(para) else max_chars
            continue
        if buf_len + len(para) + 2 > max_chars and buf:
            flush()
        buf.append(para)
        buf_len += len(para) + 2
    flush()

    if track_lines:
        cursor = 0
        text_nl = text
        for c in chunks:
            idx = text_nl.find(c.content[:64], cursor)
            if idx >= 0:
                before = text_nl[:idx]
                c.line_start = before.count("\n") + 1
                c.line_end = c.line_start + c.content.count("\n")
                cursor = idx + len(c.content)
    for i, c in enumerate(chunks):
        c.chunk_index = i
    return chunks
