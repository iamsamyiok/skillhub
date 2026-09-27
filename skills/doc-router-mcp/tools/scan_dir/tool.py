# -*- coding: utf-8 -*-
"""doc.scan — 目录扫描(原子化: 只列清单, 不读全文)"""
from contracts import render, ToolError
from pathlib import Path
import re

def run(req: dict, ctx) -> dict:
    target = Path((req.get("target") or "").strip())
    if not target.is_dir():
        raise ToolError("E_BAD_TARGET", human=f"目录不存在: {target}",
                        detail="确认路径; Windows 传绝对路径如 C:/Users/.../docs")
    rows = []
    for p in sorted(target.rglob("*.md")):
        try:
            head = p.read_text(encoding="utf-8", errors="replace")[:400]
            m = re.search(r"^#\s+(.+)$", head, re.M)
            rows.append({"file": p.relative_to(target).as_posix(),
                         "title": m.group(1) if m else p.stem,
                         "bytes": p.stat().st_size})
        except OSError as e:
            rows.append({"file": p.relative_to(target).as_posix(),
                         "title": "(不可读)", "error": str(e)[:100]})
    n = len(rows)
    return render({"count": n, "rows": rows, "truncated": n > 5},
                  f"共找到 {n} 个 Markdown 文件" + ("(默认仅展示前5条, meta.with_detail=true 看全量)" if n > 5 else ""))
