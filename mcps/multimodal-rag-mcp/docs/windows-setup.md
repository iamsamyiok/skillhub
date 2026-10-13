# Windows 部署指南

## 1. 前置条件

- Python 3.10+（实测 3.11）
- 可选：FFmpeg（视频处理）；各云端 API Key（Embedding / Vision / ASR）

## 2. 安装

```powershell
cd C:\Tools\multimodal-rag-mcp
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .[dev]
```

## 3. 初始化配置

```powershell
Copy-Item config.example.toml config.toml
notepad config.toml   # 修改 [[libraries]].root_path 指向你的知识库文件夹
```

设置环境变量（当前会话或系统级）：

```powershell
$env:RAG_EMBEDDING_API_KEY = "sk-..."   # 仅当使用向量检索
$env:RAG_VISION_API_KEY = "sk-..."      # 仅当索引图片/扫描 PDF
$env:RAG_ASR_API_KEY = "sk-..."         # 仅当索引音频/视频
```

## 4. 体检

```powershell
.\.venv\Scripts\python.exe -m app doctor --config config.toml
```

必需项全部 ok 即可运行；可选 Provider 未配置只影响对应模态。

## 5. 连接 MCP 客户端

见 README「MCP 客户端接入」。注意 Claude Desktop 修改配置文件后需完全重启客户端。

## 6. 常用流程

1. Agent 调 `sync_library`（或 `add_file`）导入文件；
2. `get_job_status` 等待 SUCCEEDED；
3. `search_knowledge` 检索；
4. `get_source_context` 回查原文上下文。

## 7. 数据目录

- `data\metadata.db`：SQLite 权威元数据（可备份）
- `data\indexes\<library_id>\`：zvec 索引（可删除重建）
- `knowledge\`：你的原始文件，服务只读，永不删除
