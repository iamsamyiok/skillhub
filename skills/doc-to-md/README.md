# doc-to-md — 文档转 Markdown 统一技能

把 Word / Excel / PPT / PDF / RTF / EPUB / CSV / 图片 一律转成干净的 Markdown。

## 特性

- **自动降级**：本地引擎优先，扫描件自动走OCR，一条命令全程托管
- **快**：文本型文档毫秒级（本地 Rust 引擎 anydoc）
- **免费OCR**：SiliconFlow PaddleOCR-VL-1.5，准确率约94.5%
- **干净输出**：自动清理 OCR 杂讯标记（`<|LOC_n|>` 等）
- **零硬编码密钥**：所有 Key 走环境变量或本地配置文件（见 CONFIG.md）

## 安装依赖

### 核心（必需）

```bash
pip install firecrawl-anydoc pymupdf requests
```

| 包 | 用途 |
|---|---|
| `firecrawl-anydoc` | 本地文档解析引擎（14种格式，毫秒级） |
| `pymupdf` | PDF→图片（OCR前置）、PDF文本探测 |
| `requests` | OCR API 调用 |

### 可选

```bash
pip install markitdown        # 备选引擎（微软出品，支持音频转录）
```

| 包 | 用途 |
|---|---|
| `markitdown` | 降级备选；PPT/音频转录 |

## 使用

```bash
# 单文件（自动判断文本型/扫描型）
python scripts/convert.py 合同.docx -o 合同.md

# 强制走 OCR（扫描件/盖章件/拍照件）
python scripts/convert.py 扫描件.pdf --ocr

# 批量：整个目录
python scripts/convert.py ./资料库/ -o ./MD输出/
```

## 目录结构

```
doc-to-md/
├── SKILL.md          # 技能说明（agent 入口）
├── README.md         # 本文件
├── CONFIG.md         # 密钥与端点配置指引（无真实密钥）
└── scripts/
    ├── convert.py          # 统一入口（自动降级）
    └── siliconflow_ocr.py  # OCR 模块（key 从环境变量读取）
```

## 常见问题

**Q: 怎么判断是不是扫描件？**
内置脚本用 PyMuPDF 探测：文本层字符 < 50 自动走 OCR；也可手动加 `--ocr` 强制。

**Q: OCR 输出有 `<|LOC_12|>` 这类标记？**
已内置清理（`--clean` 默认开启），原理：`re.sub(r'<\|LOC_\d+\|>', '', text)`。

**Q: Word 是 .doc 老格式？**
anydoc 支持从字节识别格式，.doc 直接转；若失败用 LibreOffice 转 .docx 后重试。

## 许可

MIT
