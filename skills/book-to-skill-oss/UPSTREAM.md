# Upstream 来源说明

| 项 | 值 |
|----|----|
| 上游仓库 | https://github.com/virgiliojr94/book-to-skill |
| 同步版本 | v1.4.0（2026-08-10，见 CHANGELOG.md） |
| 许可证 | MIT（保留原 LICENSE.md 全文） |
| 收录日期 | 2026-10-16 |
| 本地目录名 | `book-to-skill-oss` |

## 改名原因

本仓库 `skills/book-to-skill` 已有自研技能 v1.1.0（轻量中文工作流：把书籍方法论提炼成单份
SKILL.md）。上游项目与其功能定位不同：上游是完整工具链（确定性 Python 提取器 + spec 驱动
生成器，产出 SKILL.md + 分章文件 + glossary/patterns/cheatsheet），故以 `-oss` 别名共存。

## 本地改动

仅两类，均不改变行为：

1. `SKILL.md` frontmatter：`name` 改为 `book-to-skill-oss`，补充 `version`/`category`/`tags`
   与中文 description；正文开头加来源引用块。
2. 路径改写：`SKILL.md` 内 41 处 `book-to-skill/` 目录段统一改为 `book-to-skill-oss/`
   （均为 extract.py 自定位候选路径；上游 URL 等无斜杠引用保持原样）。

## 未收录内容

上游的 `tests/`、`docs/`（站点源文件）、`evals/`、`README*.md`、`.github/`、构建配置
（`pyproject.toml`/`mkdocs.yml`/`cliff.toml`/`overrides/`）未纳入，需要时查阅上游仓库。

## 收录文件清单

```
book-to-skill-oss/
├── SKILL.md            # 技能定义（generator spec，本地 patched）
├── UPSTREAM.md         # 本文件
├── LICENSE.md          # 上游 MIT 许可证原文
├── CHANGELOG.md        # 上游版本历史（v1.4.0）
├── scripts/extract.py  # 提取器入口（薄封装）
├── book_to_skill/      # 提取器包：cli/config/dependencies/parsers(pdf,epub,docx,html,rtf,calibre,text)
└── tools/              # validate_skill.py / scan_generated_skill.py / discovery_tax.py / evals/
```
