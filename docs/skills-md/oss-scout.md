---
name: oss-scout
description: 智能选型 GitHub 开源项目：自然语言需求 → 搜索 → 深读 → 对比推荐报告。Use when 用户想找开源项目、开源替代品、选型对比、评估某个 repo 是否可用，或提到"站在开源肩膀上""找现成的库/框架/工具"。
---

# OSS Scout - GitHub 开源项目智能调研

帮助用户把「我需要 X 能力」变成「用这几个开源项目，理由如下」。核心流程：
搜索召回 → 元数据初筛 → 深读理解 → 评分推荐。全程使用项目自带脚本 +
GitHub REST API + gitingest，agent 自身负责分析与判断。

## 环境要求

- `GITHUB_TOKEN` 环境变量（可选但强烈建议）：匿名限额仅 60 请求/小时，带 token 为 5000/小时。
- `gitingest` Python 包（仅 digest 需要）：`pip install --break-system-packages gitingest`

## 工作流

### 第 1 步：拆解需求为检索词

把用户的自然语言需求（常为中文）翻译成 2-4 组**英文** GitHub 搜索查询。
英文检索效果远好于中文。每组查询用 GitHub 搜索语法：

```
"rag pipeline" in:name,description,readme
code search engine language:rust
"self-hosted" "deep wiki" in:description
```

技巧：
- 同一需求从功能词、同义词、技术词三个角度各构造一组查询
- 脚本会自动追加 `stars:>=100`（可用 `--min-stars 0` 关闭）
- 可用 `--sort updated` 找活跃新项目，默认按 stars 排序

### 第 2 步：搜索召回

```bash
python3 {SKILL_DIR}/scripts/oss_scout.py search \
  '"code search" self-hosted in:description' \
  'sourcegraph alternative' --top 15
```

输出候选表：stars / forks / 最近推送 / license / 描述 / topics。

### 第 3 步：初筛

从候选表中剔除（在心中，不需要写出来）：

- `archived`、最近推送超过 12 个月的僵尸项目
- star 少但描述高度匹配的项目要保留——小而美常是黑马
- license 与用户用途冲突的（如用户要做闭源产品，排除 AGPL/GPL）

选出 2-4 个入围者。

### 第 4 步：逐个深查

```bash
python3 {SKILL_DIR}/scripts/oss_scout.py inspect owner/repo
```

输出完整元数据 + README（截断 6000 字符）+ 健康度指标。
重点关注：issue/stars 比例（>0.05 说明问题多）、release 频率、语言构成。

### 第 5 步（按需）：深入理解

两个互补渠道，按需选用：

**a) 源码摘要（默认）** — gitingest 把仓库文件拉成本地文本：

```bash
python3 {SKILL_DIR}/scripts/oss_scout.py digest owner/repo \
  --include 'README.md,docs/**/*.md,src/**/*.py' --chars 80000
```

适合：确认架构、看核心实现、评估二次开发难度。

**b) DeepWiki 在线页** — 多数知名仓库在 deepwiki.com 已有 AI 生成的结构化
wiki，直接用 webfetch 抓取阅读：

```
https://deepwiki.com/{owner}/{repo}
```

适合：快速了解项目全貌与模块关系，无需等待脚本克隆。

两者结论互补时优先采信源码摘要（digest 基于真实代码）。

### 第 6 步：输出推荐报告

必含结构：

1. **对比表**：每个候选一行，维度 = 功能匹配度(1-5) / 活跃度 / 文档质量 /
   社区规模 / license / 二次开发难度
2. **推荐结论**：主推 1 个 + 理由；备选 1-2 个 + 各自适用条件
3. **风险与成本**：已知短板、维护风险、集成工作量估计
4. **下一步**：最小可行验证方式（如 `pip install x` 试跑 / clone 到本地跑 demo）

## 注意事项

- 报告中所有数据必须来自脚本实际输出，禁止凭记忆编造 star 数或活跃度
- 匿名模式下单次调研约消耗 10-15 个 API 请求，60/小时限额约够 4 次完整调研
- 搜索结果为空时：放宽 `--min-stars`、减少引号短语、换同义词重试
- 用户需求明确指定语言/技术栈时，加 `language:` 过滤
