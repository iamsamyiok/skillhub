# -*- coding: utf-8 -*-
"""doc.summarize — 单文件摘要(原子化: 只摘要, 不改文件)"""
from contracts import render, ToolError
from pathlib import Path
import re

def run(req: dict, ctx) -> dict:
    p = Path((req.get("file") or "").strip())
    if not p.is_file():
        raise ToolError("E_BAD_FILE", human=f"文件不存在: {p}",
                        detail="先用 doc.scan 确认文件清单再取路径")
    maxc = int(req.get("max_chars") or 400)
    text = p.read_text(encoding="utf-8", errors="replace")
    h1 = re.search(r"^#\s+(.+)$", text, re.M)
    h2 = [m.group(1) for m in re.finditer(r"^##\s+(.+)$", text, re.M)][:6]
    body = re.sub(r"^#.*$", "", text, flags=re.M)
    body = re.sub(r"[\|`>*#\-\[\]]", "", body)
    body = re.sub(r"\s+", " ", body).strip()[:maxc]
    return render({"file": p.name, "title": h1.group(1) if h1 else p.stem,
                   "sections": h2, "excerpt": body,
                   "bytes": p.stat().st_size},
                  f"《{h1.group(1) if h1 else p.stem}》共{len(h2)}个小节,已提取前{maxc}字摘要")
