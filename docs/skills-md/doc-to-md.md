---
name: doc-to-md
description: >-
  统一文档转 Markdown 技能：Word(.doc/.docx)/Excel/PPT/PDF/RTF/EPUB/CSV 全格式覆盖。
  自动降级链路 anydoc(本地Rust,毫秒级) → SiliconFlow OCR(扫描件,免费) → markitdown(备选)。
  无硬编码密钥——API Key 通过环境变量或 CONFIG.md 指引的配置文件读取。
  当用户需要"把文档转成md/转markdown/提取内容"时使用。
version: 1.0.0
license: MIT
---

# Doc to MD — 文档转 Markdown 统一技能

## 降级链路（自动选择）

```
输入文档
  ├─ 文本型 Office/PDF (docx/xlsx/doc/pptx/pdf) ──→ ① anydoc（本地，毫秒级，首选）
  ├─ 扫描型 PDF / 图片（OCR需要）               ──→ ② SiliconFlow OCR（免费，94.5%）
  ├─ ①②不可用时                                 ──→ ③ markitdown（微软备选）
  └─ 复杂版式/公式/表格（①③效果差）             ──→ ④ MinerU 云端AI（慢~15s，有限流）
```

**判断标准**：用 PyMuPDF 提取 PDF 第一页文本，字符数 < 50 视为扫描型 → 走 OCR。

## 快速使用

```bash
# 方式一：一条命令（自动选择链路）
python scripts/convert.py "文档.docx" -o output.md
python scripts/convert.py "扫描件.pdf" -o output.md --ocr

# 方式二：批量转换目录
python scripts/convert.py ./docs/ -o ./md_out/
```

## ① anydoc（首选）

```python
import anydoc, pathlib
md = anydoc.to_markdown("文档.docx")
pathlib.Path("output.md").write_text(md, encoding="utf-8")
```

- 安装：`pip install firecrawl-anydoc`
- 14种格式，无限制，无网络依赖
- 输出 GitHub-Flavored Markdown（表格/锚点/列表全保留）

## ② SiliconFlow OCR（扫描件）

```python
from scripts.siliconflow_ocr import ocr_pdf_to_md   # key 从环境变量读取
# 环境变量：SILICONFLOW_API_KEY（见 CONFIG.md）
```

- 模型：PaddlePaddle/PaddleOCR-VL-1.5（免费，准确率约94.5%）
- 依赖：pymupdf（PDF转图片）、requests
- OCR输出需清理杂讯：`re.sub(r'<\|LOC_\d+\|>', '', text)`

## ③ markitdown（备选）

```bash
markitdown 文档.pptx > output.md
```

## ④ MinerU（复杂版式）

通过 MinerU MCP 工具调用（若宿主已配置），或参考 https://mineru.net

## 依赖安装

```bash
pip install firecrawl-anydoc pymupdf requests   # 核心
pip install markitdown                           # 可选备选
```

详见 README.md 与 CONFIG.md（密钥配置）。
