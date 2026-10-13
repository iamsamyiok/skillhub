"""Publish multimodal-rag-mcp into iamsamyiok/skillhub (mcps category).

Steps: clone repo -> copy sources into mcps/<id>/ -> write docs/mcps-md/<id>.md
-> insert entry into docs/data/mcps.json -> build docs/downloads/<id>.{zip,tar.gz}
-> commit & push to main (deploy-pages.yml auto-deploys).

Requires GH_TOKEN in env. Read/write scope on iamsamyiok/skillhub only.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tarfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

SRC = Path(r"C:\Users\Administrator\Desktop\multimodal-rag-mcp")
WORK = Path(os.environ.get("PUB_WORK", SRC.parent / "skillhub-publish"))
REPO_URL = "https://github.com/iamsamyiok/skillhub.git"
ID = "multimodal-rag-mcp"
NAME = "多模态 RAG 知识库"
DESC = "文件夹即知识库·向量/全文/混合检索·证据回查"
VERSION = "0.1.0"

EXCLUDE_DIRS = {".venv", ".git", "__pycache__", ".pytest_cache", "data",
                "knowledge", "node_modules"}
EXCLUDE_FILES = {"config.toml", ".env"}
GIT_PROXY = "http://127.0.0.1:7890"  # local Clash; github.com needs proxy here


def run(cmd: list[str], cwd: Path | None = None) -> None:
    env = os.environ.copy()
    subprocess.run(cmd, cwd=cwd, check=True, env=env,
                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def clone() -> Path:
    repo = WORK / "skillhub"
    if (repo / ".git").exists():
        return repo
    if repo.exists():
        shutil.rmtree(repo)
    WORK.mkdir(parents=True, exist_ok=True)
    token = os.environ["GH_TOKEN"]
    url = f"https://x-access-token:{token}@github.com/iamsamyiok/skillhub.git"
    run(["git", "-c", f"http.proxy={GIT_PROXY}", "clone",
         "--depth", "1", url, str(repo)])
    return repo


def copy_sources(repo: Path) -> int:
    dest = repo / "mcps" / ID
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    n = 0
    for item in SRC.rglob("*"):
        rel = item.relative_to(SRC)
        if any(part in EXCLUDE_DIRS for part in rel.parts):
            continue
        if item.is_file():
            if item.name in EXCLUDE_FILES:
                continue
            target = dest / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)
            n += 1
    return n


MD_TEMPLATE = """# {name}

{desc}。基于 Zvec 的本地多模态知识库 MCP Server：文件夹即知识库，支持向量/全文/混合检索，每条结果可回查到源文件与具体位置（页码/工作表/幻灯片/时间戳/行号）。

## 工具列表

- `list_libraries` / `get_library_info` - 知识库列表与配置摘要
- `search_knowledge` - 向量/全文/混合检索（RRF 融合，可选云端重排）
- `get_source_context` - 命中片段与相邻上下文
- `get_source_file` - 元数据 / 文本摘录 / 本地文件 URI
- `add_file` / `add_folder` / `sync_library` - 导入与增量同步
- `remove_file` / `reindex_file` - 移除索引（不删原件）/ 重新处理
- `get_job_status` / `get_index_status` - 任务与索引状态
- `reconcile_index` - SQLite 与向量库一致性核对
- `get_service_status` - 服务与依赖状态

## 安装

```bash
# 下载并解压
curl -L https://iamsamyiok.github.io/skillhub/downloads/{id}.zip -o {id}.zip
unzip {id}.zip

# 安装依赖（需要 Python 3.10+）
cd {id} && python -m venv .venv
.venv/Scripts/python -m pip install -e .        # Windows
# .venv/bin/python -m pip install -e .           # Linux/macOS
```

## 配置

复制 `config.example.toml` 为 `config.toml`，修改 `[[libraries]]` 的 `root_path` 指向你的知识库文件夹。

### Claude Desktop

编辑 MCP 配置：

```json
{{
  "mcpServers": {{
    "multimodal-rag": {{
      "command": "C:\\\\path\\\\to\\\\{id}\\\\.venv\\\\Scripts\\\\python.exe",
      "args": ["-m", "app", "serve", "--config",
               "C:\\\\path\\\\to\\\\{id}\\\\config.toml"],
      "env": {{
        "RAG_EMBEDDING_API_KEY": "your-api-key-here",
        "RAG_VISION_API_KEY": "your-api-key-here",
        "RAG_ASR_API_KEY": "your-api-key-here"
      }}
    }}
  }}
}}
```

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `RAG_EMBEDDING_API_KEY` | Embedding API 密钥（BAAI/bge-m3 等） | 未配置时自动降级全文检索 |
| `RAG_VISION_API_KEY` | 视觉模型密钥（图片/扫描PDF/视频帧） | 未配置时对应模态不可用 |
| `RAG_ASR_API_KEY` | 语音识别密钥（音频/视频音轨） | 未配置时跳过转写 |

## 特性

- 文件夹即知识库：路径严格限制在根目录内，防目录穿越
- 多模态：Markdown/代码/CSV/JSON/HTML/PDF/DOCX/PPTX/XLSX/图片/音频/视频
- 证据可追溯：每条结果带源文件、位置字段与内容哈希
- 幂等与可恢复：重复导入自动跳过，崩溃重启自动恢复任务
- 删除只移除索引，永不删除原始文件
"""


def write_md(repo: Path) -> None:
    md = MD_TEMPLATE.format(id=ID, name=NAME, desc=DESC)
    (repo / "docs" / "mcps-md" / f"{ID}.md").write_text(md, encoding="utf-8")


def update_json(repo: Path) -> None:
    path = repo / "docs" / "data" / "mcps.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    items = [i for i in data["items"] if i["id"] != ID]
    entry = {
        "id": ID,
        "name": NAME,
        "description": DESC,
        "version": VERSION,
        "category": "MCP Server",
        "tags": ["mcp", ID, "python"],
        "downloads": 0,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00.000Z"),
        "runtime": "python",
        "entry": "-m app",
        "env": {
            "RAG_EMBEDDING_API_KEY": "${RAG_EMBEDDING_API_KEY}",
            "RAG_VISION_API_KEY": "${RAG_VISION_API_KEY}",
            "RAG_ASR_API_KEY": "${RAG_ASR_API_KEY}",
        },
    }
    items.append(entry)
    items.sort(key=lambda i: i["id"])
    data["items"] = items
    data["total"] = len(items)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def build_archives(repo: Path) -> None:
    src = repo / "mcps" / ID
    dl = repo / "docs" / "downloads"
    dl.mkdir(parents=True, exist_ok=True)
    zip_path = dl / f"{ID}.zip"
    tar_path = dl / f"{ID}.tar.gz"
    for p in (zip_path, tar_path):
        if p.exists():
            p.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(src.rglob("*")):
            if f.is_file():
                zf.write(f, arcname=str(Path(ID) / f.relative_to(src)))
    with tarfile.open(tar_path, "w:gz") as tf:
        for f in sorted(src.rglob("*")):
            if f.is_file():
                tf.add(f, arcname=str(Path(ID) / f.relative_to(src)))


def commit_push(repo: Path) -> None:
    run(["git", "config", "user.name", "iamsamyiok"], cwd=repo)
    run(["git", "config", "user.email", "iamsamyiok@users.noreply.github.com"], cwd=repo)
    run(["git", "add", "-A"], cwd=repo)
    status = subprocess.run(["git", "status", "--porcelain"], cwd=repo,
                            capture_output=True, text=True)
    if not status.stdout.strip():
        print("nothing to commit")
        return
    run(["git", "commit", "-m",
         f"feat(mcps): publish {ID} {VERSION}"], cwd=repo)
    run(["git", "-c", f"http.proxy={GIT_PROXY}", "push", "origin", "main"], cwd=repo)


def main() -> None:
    repo = clone()
    n = copy_sources(repo)
    print(f"copied {n} files into mcps/{ID}")
    write_md(repo)
    update_json(repo)
    build_archives(repo)
    commit_push(repo)
    print("published. Pages deploy should start automatically (push to main).")


if __name__ == "__main__":
    main()
