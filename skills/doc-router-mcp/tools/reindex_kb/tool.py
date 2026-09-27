# -*- coding: utf-8 -*-
"""doc.reindex — 长任务: P3 演示(通过 spawn 钩子由宿主受理, 工具体为同步生成器)"""
from contracts import render, ToolError
from pathlib import Path
import re

def run(req: dict, ctx) -> dict:
    # 宿主对声明了 long_running 的工具会把本调用转成任务; 此处实现同步逻辑
    target = Path((req.get("target") or "").strip())
    out = Path(req.get("out") or target / "index.md")
    if not target.is_dir():
        raise ToolError("E_BAD_TARGET", human=f"目录不存在: {target}",
                        detail="确认路径后重试")
    files = sorted(target.rglob("*.md"))
    lines = ["# 知识库索引", ""]
    for p in files:
        try:
            head = p.read_text(encoding="utf-8", errors="replace")[:300]
            m = re.search(r"^#\s+(.+)$", head, re.M)
            lines.append(f"- [{p.name}]({p.relative_to(target).as_posix()}) — {m.group(1) if m else p.stem}")
        except OSError:
            lines.append(f"- {p.name} — (不可读)")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return render({"files": len(files), "out": str(out)},
                  f"索引已重建: {len(files)} 个文档 → {out.name}")
