---
name: zg-search
description: zvec-grep(zg) 本地语义检索 — 语义+BM25+rg三合一混合搜索; 已作MCP接入ZCode(zg-search);
  三工作区已索引(报告/转写稿/记忆); 中文实测fts+vector双命中
---

# zg-search — 本地语义检索(MCP已接入)

zvec-grep 0.2.2(@zvec/zvec-grep, 阿里zvec引擎): 本地优先的语义+关键词+精确三合一检索。
**我已有 MCP 服务 `zg-search`**(ZCode 重启后自动可用), 工具名 `zvec_grep_search`。

## 已索引工作区(3个)

| root | 内容 | 用途 |
|---|---|---|
| `C:/Users/Administrator/Desktop/1` | 40+报告/交办记录(中文) | "以前哪份资料说过X" |
| `C:/Users/Administrator/RecorderLibrary/transcripts` | 录音转写稿 | 录音内容召回 |
| `C:/Users/Administrator/.zcode/cli/memories/projects/test3-57f986dcbd20e80d/memory` | 记忆文件 | 跨会话经验检索 |

## 用法

**MCP 方式(首选)**: 工具 `zvec_grep_search`, 参数 `{root, query, limit}` — root 必填(见上表), 返回带行号结构化证据(freshness/heading/scope/source)。

**CLI 方式**(调试/批量):
```bash
cd <root> && zg query "<中文查询>" --limit 3     # 混合(fts+vector)
zg query --rg -F "字面" .                         # 纯rg精确
zg index --rebuild --embedding local/potion-multilingual-128m   # 重建
zg status                                          # 索引状态
```

## 决策表

| 需求 | 用什么 |
|---|---|
| 本地沉淀资料语义召回 | **zg-search MCP** |
| 文件名定位 | everything-search |
| 公网搜索 | anysearch |
| 精确字面/正则 | zg query --rg 或直接 rg |

## 实测数据(2026-10-07)

- Desktop\1: 31文件/467实体/5m14s索引; Q1"SCNet超算坑"→fts+vector双命中带行号✓
- 转写稿/记忆: 秒级索引; 4类查询全命中(含语义改述)
- MCP init **730ms**(六服务最快); 工具调用8s内返回

## 维护与坑

- 新文档入 Desktop\1 后: 下次查询自动增量刷新(或手动 zg index)
- **嵌入引擎**: 当前 local/potion-multilingual-128m(256d/101语言); 升级路径=embeddinggemma-300m(zg内置)→EmbeddingGemma 2(等zg目录收录, llama.cpp GGUF已就绪)
- 坑: ①MCP工具名是 `zvec_grep_search`(非文档里的长名) ②root 参数用正斜杠 ③CLI 的 `/path` 参数在 Git Bash 会被路径转换(MSYS_NO_PATHCONV=1) ④本地路径要 Windows 风格
- 升级: `npm i -g @zvec/zvec-grep`(npmmirror); 详见融合方案 Desktop\1\ZCode融合方案v2
