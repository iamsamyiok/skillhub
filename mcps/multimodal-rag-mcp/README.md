# Multimodal RAG MCP Server

文件夹即知识库的多模态 RAG 检索服务器。通过 MCP（Model Context Protocol）向 Claude Desktop、Cursor 等 Agent 客户端提供：文件导入、增量同步、向量/全文/混合检索、可追溯的原文证据（页码 / 工作表 / 幻灯片 / 时间戳 / 行号）。

- 检索核心：Zvec 0.7.0（向量 HNSW + jieba 全文 + RRF 混合融合）
- 元数据权威：SQLite（文件 / chunk / 任务 / 缓存 / schema 迁移）
- 解析：Markdown、TXT、代码、CSV/JSON/XML/YAML、HTML、PDF（pypdf，扫描页走视觉 API）、DOCX/PPTX/XLSX、图片（视觉 API）、音频（ASR API）、视频（FFmpeg + ASR + 视觉 API）
- 云端优先、本地可选：Embedding / Vision / ASR 均为 OpenAI 兼容 HTTP API，未配置时服务照常启动并明确降级为全文检索

## 安装（Windows）

```powershell
cd C:\path\to\multimodal-rag-mcp
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .[dev]
Copy-Item config.example.toml config.toml   # 编辑 [[libraries]].root_path
.\.venv\Scripts\python.exe -m app doctor --config config.toml
```

Linux/macOS：相同命令（`.venv/bin/python`）。视频处理需系统安装 FFmpeg。

## 配置要点

- `root_path` 相对路径按 config.toml 所在目录解析。
- API Key 只从环境变量读取（见 `.env.example`），不要写进配置文件、代码或日志。
- 未配置 `[embedding]` 时：服务可启动，`search` 以 `full_text` 模式运行并在 `warnings` 中明示降级。
- 配置后向量维度从 API 实际响应探测，并与已有索引维度校验（不匹配报 `EMBEDDING_DIMENSION_MISMATCH`）。

### 已实测的供应商：Agnes AI（api.agnes-ai.cn）

- `agnes-2.5-flash` 支持 **chat 与视觉输入**（图片/扫描 PDF OCR/视频关键帧描述已用真实 API 验收通过）。
- 该端点**当前没有 embedding 模型**（`/embeddings` 返回 400：服务端未开启 `--is-embedding`），因此使用此供应商时向量检索不可用，服务自动以全文模式运行。
- 配置方式：`config.toml` 的 `[vision]` 填 `base_url = "https://api.agnes-ai.cn/v1"`、`model = "agnes-2.5-flash"`，并设置环境变量 `RAG_VISION_API_KEY`。
- 一键验收：`$env:RAG_VISION_API_KEY="..."` 后运行 `.venv\Scripts\python.exe examples\acceptance_run.py`。

### 已实测的供应商：硅基流动 SiliconFlow（api.siliconflow.cn）——推荐

免费模型全家桶（2026-10 实测）：

| 能力 | 模型 | 实测结果 |
|---|---|---|
| Embedding | `BAAI/bge-m3`（1024 维） | ✅ 中文/英文向量检索，Recall@5 = 1.0 |
| 视觉 | `Qwen/Qwen3-VL-8B-Instruct` | ✅ 图片描述 + 扫描 PDF OCR + 视频关键帧（图片边长需 ≥28px） |
| ASR | `FunAudioLLM/SenseVoiceSmall` | ✅ `/audio/transcriptions` 端点正常 |
| Reranker | `BAAI/bge-reranker-v2-m3` | ✅ `/rerank` 已接入，检索模式 `hybrid+rerank` |
| Chat（备用） | `Qwen/Qwen2.5-7B-Instruct`、`THUDM/GLM-4-9B-0414` | ✅ 免费 |

`config.toml` 模板已按上述模型预填 `[embedding]/[vision]/[asr]/[reranker]`，只需设置环境变量：

```powershell
$env:RAG_EMBEDDING_API_KEY = "sk-..."   # embedding 与 reranker 共用
$env:RAG_VISION_API_KEY   = "sk-..."
$env:RAG_ASR_API_KEY      = "sk-..."
```

检索质量实测（10 条中英文标注查询，examples/retrieval_eval.py 可复现）：

| 模式 | Recall@5 | MRR | 平均延迟 |
|---|---|---|---|
| full_text | 0.9 | 0.9 | ~2ms |
| vector | 1.0 | 1.0 | ~255ms |
| hybrid | 1.0 | 1.0 | ~257ms |
| hybrid+rerank | 1.0 | 1.0 | ~528ms |

完整验收（17 项检查，examples/verify_full.py 可复现）：幂等导入、修改同步后旧内容失效、证据回查、三种原文返回模式、删除保留原件、SQLite↔zvec 一致性、4 类错误路径结构化返回、跨进程重启持久化。

## MCP 客户端接入（Claude Desktop / Cursor 示例）

```json
{
  "mcpServers": {
    "multimodal-rag": {
      "command": "C:\\path\\to\\multimodal-rag-mcp\\.venv\\Scripts\\python.exe",
      "args": ["-m", "app", "serve", "--config", "C:\\path\\to\\multimodal-rag-mcp\\config.toml"],
      "env": {
        "RAG_EMBEDDING_API_KEY": "<仅环境注入，不要提交>",
        "RAG_VISION_API_KEY": "",
        "RAG_ASR_API_KEY": ""
      }
    }
  }
}
```

stdio 模式下日志走 stderr，stdout 只承载 MCP 协议消息。

## MCP 工具（14 个）

| 工具 | 说明 |
|---|---|
| `list_libraries` / `get_library_info` | 知识库列表与配置/能力摘要 |
| `search_knowledge` | `hybrid`（zvec 双路 + RRF）/`vector`/`full_text`；支持 `content_types`、`file_types`、`path_prefix`、`include_model_generated` 过滤 |
| `get_source_context` | 按 `chunk_id` 返回片段与相邻上下文（限制最大字符数） |
| `get_source_file` | `metadata_only` / `text_excerpt` / `file_uri`；只允许访问已登记文件 |
| `add_file` / `add_folder` | 导入；根目录外默认拒绝，`copy_to_library=true` 复制进 `imports/` |
| `get_job_status` | 任务状态机：DISCOVERED→QUEUED→PARSING→EMBEDDING→INDEXING→VERIFYING→READY / FAILED（可重试错误进 RETRY_WAIT） |
| `sync_library` | 增量扫描新增/修改/删除；只删索引不删原件 |
| `remove_file` | 只移除索引与元数据，绝不删除磁盘原文件 |
| `reindex_file` | 解析器/模型变更后重处理 |
| `get_index_status` / `get_service_status` | 统计、最近错误、依赖与 Provider 状态（不返回密钥） |
| `reconcile_index` | SQLite ↔ zvec 一致性核对；`dry_run=false` 清理孤儿索引 |

另有只读资源：`rag://libraries`。

## 安全与隐私

- 所有路径必须位于库根目录内；拒绝路径穿越，默认不跟随符号链接。
- 根目录外文件默认拒绝；导入副本会真实复制并明确返回实际索引路径与源路径。
- 原始文件默认留在本地；仅当配置了对应 Provider 且模态开关打开时，才把任务所需的文本/图片/音频/视频帧发送到云端 API。
- 文档内容按不可信数据处理；密钥不出现在 MCP 参数、结果或日志中。

## 测试与评测

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q          # 27 项单元/集成测试
.\.venv\Scripts\python.exe examples\demo_eval.py       # 最小检索评测（无需 API Key）
```

覆盖：配置校验、路径安全、分块、文本/DOCX/XLSX/PPTX/HTML 解析、全流程（导入→索引→hybrid/FTS 检索→上下文回查→更新同步→旧内容失效→删除→一致性核对）、MCP 工具注册、外部文件策略、幂等重索引、重启恢复。

## 故障排查

| 现象 | 处理 |
|---|---|
| `EMBEDDING_PROVIDER_NOT_CONFIGURED` | 配置 `[embedding]` 并设置 `RAG_EMBEDDING_API_KEY`；或直接使用 full_text 模式 |
| `VISION_PROVIDER_NOT_CONFIGURED`（图片/扫描 PDF） | 配置 `[vision]`；扫描 PDF 渲染还需 `pip install pymupdf` |
| `ASR_PROVIDER_NOT_CONFIGURED`（音频/视频） | 配置 `[asr]`（OpenAI 兼容 `/audio/transcriptions`） |
| `PARSER_DEPENDENCY_MISSING`（视频） | 安装 FFmpeg 并加入 PATH，或设置 `[video].ffmpeg_path` |
| `EMBEDDING_DIMENSION_MISMATCH` | 换了 Embedding 模型：删除 `data\indexes\<library_id>` 后重新 sync 重建 |
| 检索结果异常 / 疑似新旧混杂 | `reconcile_index`（`dry_run=false` 自动清理孤儿索引）；检索层本就按 SQLite 权威过滤僵尸片段 |
| 中断后任务卡住 | 重启自动恢复为 QUEUED；`get_index_status` 查看 |

## 已知限制（第一版）

- `allow_reference` 外部引用模式未启用（根目录外文件：拒绝或复制导入）。
- `watch_mode` 仅 `manual`；`periodic`/`filesystem` 未实现。
- ZIP 解包未实现（明确报 `UNSUPPORTED_FILE_TYPE`）。
- `binary_content` 返回模式未启用（用 `text_excerpt` / `file_uri`）。
- RAG-Anything（PyPI 包名 `raganything`）列为可选 extra 预留适配点；当前多模态解析由内置 OpenAI 兼容 Provider 适配器完成。

## 状态说明

**已实现并测试**：文本/Markdown/代码/CSV/JSON 解析与检索、DOCX/PPTX/XLSX（工作表/幻灯片/表格定位）、PDF 文本层（页码定位）、混合/向量/全文检索与 RRF、证据回查、文件更新后旧内容失效、幂等导入、删除只删索引、外部文件策略、路径安全、重启恢复、SQLite↔zvec 一致性核对、MCP stdio 全链路（真实客户端实测）。

**已实现并测试（真实 API 验收）**：图片视觉描述（image_caption）、扫描 PDF 视觉 OCR（image_ocr，带页码）、视频关键帧描述（带毫秒时间戳）、云端 ASR（SenseVoiceSmall）、bge-m3 真实向量检索与混合 RRF、bge-reranker-v2-m3 云端重排、无效密钥 0.1s 快速失败、17 项端到端验收全部通过（examples/verify_full.py）。
