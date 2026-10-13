# 多模态 RAG 知识库

文件夹即知识库·向量/全文/混合检索·证据回查。基于 Zvec 的本地多模态知识库 MCP Server：文件夹即知识库，支持向量/全文/混合检索，每条结果可回查到源文件与具体位置（页码/工作表/幻灯片/时间戳/行号）。

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
curl -L https://iamsamyiok.github.io/skillhub/downloads/multimodal-rag-mcp.zip -o multimodal-rag-mcp.zip
unzip multimodal-rag-mcp.zip

# 安装依赖（需要 Python 3.10+）
cd multimodal-rag-mcp && python -m venv .venv
.venv/Scripts/python -m pip install -e .        # Windows
# .venv/bin/python -m pip install -e .           # Linux/macOS
```

## 配置

复制 `config.example.toml` 为 `config.toml`，修改 `[[libraries]]` 的 `root_path` 指向你的知识库文件夹。

### Claude Desktop

编辑 MCP 配置：

```json
{
  "mcpServers": {
    "multimodal-rag": {
      "command": "C:\\path\\to\\multimodal-rag-mcp\\.venv\\Scripts\\python.exe",
      "args": ["-m", "app", "serve", "--config",
               "C:\\path\\to\\multimodal-rag-mcp\\config.toml"],
      "env": {
        "RAG_EMBEDDING_API_KEY": "your-api-key-here",
        "RAG_VISION_API_KEY": "your-api-key-here",
        "RAG_ASR_API_KEY": "your-api-key-here"
      }
    }
  }
}
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
