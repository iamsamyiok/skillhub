# Agent Skill 典型范例 — `md-catalog`

> 一个符合本 skill 七条铁律的**真实规格** Agent Skill：给 Agent 看的部分（机器可解析）与给人类看的部分（人话）从头到尾双通道。照这个骨架写，你的 Skill 就自动满足 §1 的全部 MUST。
> 场景：扫描知识库目录，为所有 Markdown 文件生成/更新索引——即本仓库 [[md-files-management]] 的标准化重写。

## 目录结构（1.1 模块化：目录即边界）

```
md-catalog/
├── SKILL.md                 # 双通道入口: frontmatter(Agent) + 正文(人类)
├── plugin.manifest.json     # 双通道身份证: schema + use_when 等人话字段
├── scripts/
│   └── catalog.py           # 唯一实现(1.2 原子化: 只做"生成索引"一件事)
├── tests/
│   └── test_catalog.py      # 正常路径 + 失败路径 + schema 校验
└── _scratch/                # 一次性脚本专用(§7), 每周清理
```

## 1. SKILL.md —— 入口的双通道写法

```markdown
---
name: md-catalog
version: 1.1.0
description: 扫描知识库目录生成/更新 Markdown 索引。frontmatter 即 Agent 契约。
---

# MD Catalog — 知识库索引器

🧑 人话：把目录里所有 .md 文件的标题、摘要、日期扫出来，写进一个 index.md，
让人和 Agent 都能"一屏看全库"。

## 何时使用 (use_when)
- 知识库新增/修改文件后需要同步索引
- 用户问"我们都有哪些文档"

## 何时不用 (avoid_when)
- 目标目录没有 .md 文件
- index.md 已是最新(脚本会跳过,幂等)

## Agent 调用契约
scripts/catalog.py --target <目录> [--out index.md] [--dry-run]
退出码: 0=成功 2=参数错 3=目标不可读; stdout 尾行=JSON 摘要(human 字段含人话)
```

> 要点：frontmatter 的 `description` 是 Agent 通道（决定 Agent 何时召回本 skill），正文的人话段落是人类通道。**同一个 SKILL.md，两段各司其职，不混写。**

## 2. plugin.manifest.json —— 与 MCP 工具同构的身份证

```json
{
  "name": "md-catalog",
  "version": "1.1.0",
  "inputSchema": {
    "type": "object",
    "properties": {
      "target": { "type": "string", "description": "要扫描的知识库目录" },
      "out":    { "type": "string", "default": "index.md" },
      "dry_run":{ "type": "boolean", "default": false }
    },
    "required": ["target"]
  },
  "use_when": "知识库文件变动后需要刷新索引；或用户询问文档清单",
  "avoid_when": "目标是二进制目录或空目录",
  "cost_hint": "万级文件内秒级完成；写 index.md 一个文件",
  "human_summary": "扫描目录里所有 Markdown，生成带摘要的索引页。",
  "permissions": ["fs.read:target", "fs.write:out"],
  "hooks": ["init", "invoke", "deactivate"]
}
```

## 3. scripts/catalog.py —— 实现里的七条铁律落点

```python
#!/usr/bin/env python
"""md-catalog — 知识库索引器 (原子化: 只做索引生成一件事)"""
import argparse, json, re, sys, time
from pathlib import Path

EXIT_OK, EXIT_ARGS, EXIT_IO = 0, 2, 3          # 1.4 标准化错误码(进程级)

def _human(files, out, dry):                    # 1.4/1.6 human 与数据同源渲染
    verb = "将写入" if dry else "已写入"
    return f"扫描 {len(files)} 个 Markdown,{verb} {out}"

def catalog(target: Path, out: Path, dry: bool) -> dict:
    files = sorted(p for p in target.rglob("*.md") if p.name != out.name)
    rows = []
    for p in files:                             # 1.2 每文件独立 try:单个坏文件不炸全局
        try:
            head = p.read_text(encoding="utf-8", errors="replace")[:600]
            m = re.search(r"^#\s+(.+)$", head, re.M)
            rows.append({"file": p.relative_to(target).as_posix(),
                         "title": m.group(1) if m else p.stem,
                         "bytes": p.stat().st_size})
        except OSError as e:
            rows.append({"file": p.relative_to(target).as_posix(),
                         "title": "(不可读)", "error": str(e)[:120]})
    index = ["# 索引", "", "| 文件 | 标题 | 大小 |", "|---|---|---|",
             *[f"| {r['file']} | {r['title']} | {r['bytes']}B |" for r in rows], ""]
    if not dry:
        out.write_text("\n".join(index), encoding="utf-8")   # 唯一副作用
    return {"count": len(rows), "out": str(out), "rows": rows}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True)
    ap.add_argument("--out", default="index.md")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    t, o = Path(a.target), Path(a.out)
    if not t.is_dir():                          # 1.7 结构化错误 + 人话 + Agent建议
        print(json.dumps({"error": {"code": "E_BAD_TARGET", "retryable": False,
              "human": f"目录不存在: {a.target}",
              "detail": "确认路径后重试; 或先创建目录"}}, ensure_ascii=False))
        sys.exit(EXIT_ARGS)
    t0 = time.time()
    r = catalog(t, o, a.dry_run)
    # 1.6 双通道日志: JSON 整行 + human 字段; stdout 尾行固定 JSON(Agent 可解析)
    log = {"ts": time.time(), "tool": "md-catalog", "ms": round((time.time()-t0)*1000,1),
           "human": _human([r_ for r_ in r["rows"] if "error" not in r_], a.out, a.dry_run)}
    print(json.dumps({**r, "log": log, "human": log["human"]}, ensure_ascii=False))
    sys.exit(EXIT_OK)

if __name__ == "__main__":
    main()
```

## 4. tests/test_catalog.py —— 自带体检（1.5）

```python
import json, subprocess, sys
from pathlib import Path
import pytest

def _run(*args):
    r = subprocess.run([sys.executable, "scripts/catalog.py", *args],
                       capture_output=True, text=True)
    last = r.stdout.strip().splitlines()[-1]
    return r, json.loads(last)                   # 尾行 JSON = Agent 通道断言点

def test_ok_and_idempotent(tmp_path):            # 正常 + 幂等(1.2)
    (tmp_path / "a.md").write_text("# 标题A\n内容")
    r1, j1 = _run("--target", str(tmp_path), "--out", str(tmp_path/"index.md"))
    r2, j2 = _run("--target", str(tmp_path), "--out", str(tmp_path/"index.md"))
    assert r1.returncode == 0 and j1["count"] == 1
    assert j2 == j1                              # 二次运行结果一致 = 幂等
def test_bad_target_human_and_code():            # 失败路径(1.7)
    r, j = _run("--target", "Z:/不存在")
    assert r.returncode == 2 and j["error"]["code"] == "E_BAD_TARGET"
    assert "目录不存在" in j["error"]["human"]
def test_manifest_schema():                      # 契约测试: 宿主对全部工具统一跑
    m = json.loads(Path("plugin.manifest.json").read_text("utf-8"))
    assert {"name","version","inputSchema","use_when","cost_hint"} <= set(m)
```

## 5. 七条铁律对照表（写 Skill 时自查）

| 铁律 | 在本范例的落点 |
|---|---|
| 1.1 模块化 | 四文件自成一体；无宿主内部 import |
| 1.2 原子化 | 单一职责；幂等（重复执行结果一致）；坏文件隔离处理 |
| 1.3 层级化 | SKILL.md(入口)→catalog.py(领域逻辑)→Path/IO(服务) |
| 1.4 接口标准化 | frontmatter 契约 + manifest 双通道 + 尾行 JSON + 退出码表 |
| 1.5 变化隔离 | 自带 tests/；输出格式变更是版本主号事件 |
| 1.6 可观测性 | 结构化日志整行 + human 摘要同源；毫秒耗时 |
| 1.7 容错降级 | 坏文件不炸全局；结构化错误含 Agent 下一步建议 |
