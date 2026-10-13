---
name: paper-pipeline
version: 1.0.1
category: 学术写作
tags: [论文, 学术写作, 文献检索, 引用核验, 文献综述, 证据表, 同行评审, 参考文献]
description: 证据驱动的学术写作流水线——多源真实检索、[cite:KEY] 逐段引用、三层引用核验、评审团审稿、cited-only 参考文献。Evidence-driven academic writing pipeline. Trigger on 写论文/写综述/开题报告/文献调研/论文修改/查引用/refs/文献池, or /paper-pipeline. Four-source live search (OpenAlex/Crossref/arXiv/Semantic Scholar), hallucination-proof citation via three-layer verification, reviewer-board critique, cited-only BibTeX/RIS export.
---

# Paper-Pipeline（证据驱动的论文流水线）

## Overview

融合两个公开设计的确定性引擎 + Agent 判断力：**Open Academic Paper Gen**（mmlong818，AGPL-3.0）提供「证据先行、三层核验」的引擎思想；**Academic Research Skills**（Imbad0202，CC BY-NC 4.0）提供「苏格拉底成题、评审团、魔鬼代言人」的流程骨架。本技能代码为原创实现，限非商业用途。

核心信条：**证据先于论断。** 每一个事实句必须挂在真实文献上，每一篇参考文献必须真实存在且有原文支撑。LLM（Agent）负责判断；paperkit 负责检索、去重、分配 key、核验与导出这些确定性环节。

```
架构分工
┌─────────────────────────────────────────────┐
│ paperkit.py（确定性引擎，零第三方依赖）        │
│  search · verify · export · fulltext · doctor│
├─────────────────────────────────────────────┤
│ Agent（判断力）                              │
│  成题 · 筛选判读 · 证据抽取 · 逐段写作        │
│  · 支撑性判读 · 评审团 · 修订                 │
└─────────────────────────────────────────────┘
```

## 第 0 步：环境自检与模式路由

### 自检（静默执行）

```bash
python3 <skill_dir>/scripts/paperkit.py doctor
```

四源全 ok/empty → 直接开工。某源 fail → 继续开工但记住该源缺失，检索面变窄时在交付说明中提及。pdf 显示 abstract-only → L3 核验退化为摘要级支撑（诚实降级，写入完整性自述）。所有检索有失败风险：paperkit 对每个源静默容错，若四源全失败，停下询问用户网络状况。

### 模式路由

| 用户意图 | 模式 | 执行阶段 |
|---|---|---|
| 「写篇小论文 / 针对某个论点快速成文」 | **quick** | 1→3→4→6→8→9 |
| 「文献综述 / 调研一个领域」 | **lit-review** | 1→2→3→4→5→6（大纲=综述结构）→8→9 |
| 「完整论文 / 开题报告」 | **full** | 1→2→3→4→5→6→7→8→9 全程 |
| 「帮我改论文 / revise 这段」 | **revision** | 仅 8（评审团）→9 |
| 「帮我查这些引用靠不靠谱」 | **verify-only** | 仅 9 的核验部分 |

用户没说清楚时问一句：「成文（quick）、完整流程（full）、还是先建文献池？」不要猜。

## 九阶段流水线

### 阶段 1 · 需求对齐（苏格拉底成题）

先做研究后成题。用 2-3 轮提问收敛：研究什么问题、给谁看、篇幅和深度。禁止连环问卷。产出一句 **研究问题（RQ）** + 一行目标读者。用户只给主题名时，主动补一轮：「你想回答的具体问题是什么？还是先看看这个领域里大家都在争什么？」

### 阶段 2 · 检索建池（paperkit search）

```bash
python3 <skill_dir>/scripts/paperkit.py search "<英文检索词>" --limit 20 --out pool.json
```

要点：
- 检索词用**英文**（四源覆盖最好）；可用 2-3 组不同角度的检索词（如 "retrieval augmented generation survey" + "RAG hallucination mitigation"），分别建池后合并同名 pool 文件由 paperkit 去重
- **先广后窄**：第一轮 limit 20 看面，再决定是否加第二组词
- 游标展示文献池（key + 年份 + 标题 + 引用数，`*` 表示有全文/摘要可用），让用户勾选或说「按你的判断筛」

### 阶段 3 · 筛选（Agent 判断 + 用户确认）

对池内每篇用三问快筛：与 RQ 相关吗？证据型（有数据/方法）还是观点型？年代和引用是否站得住？筛出 **10-20 篇核心文献**。quick 模式可缩到 5-8 篇。给用户一屏清单确认：入选理由一句话。

### 阶段 4 · 证据表（逐篇抽取）

对每篇入选文献（有全文的用 `fulltext <key>` 抓取），抽取为证据表条目：

```markdown
| key | 证据内容（含数字/结论） | 原文位置 | 可支撑的论点 |
|---|---|---|---|
| procko2024graph | Graph RAG 在多跳问答上显著优于向量 RAG | fulltext p.3 | 图结构检索的优势 |
```

规则：**证据内容必须是你从原文读到的转述，禁止编造数字与结论**。写完后这张表就是阶段 6 的唯一弹药库——正文里每个事实句必须能在表里找到出处。

### 阶段 5 · 创新性诊断

在证据表基础上回答：这个选题里前人做到了哪一步？还没被回答的缝隙在哪？用户的写法落在「重复已有结论 / 已有结论的新组合 / 真正的新增量」哪一档？给一句话诊断和调整建议（对 lit-review 模式跳过，改为给出综述的分类框架）。

### 阶段 6 · 大纲（用户确认后才动笔）

产出层级大纲，每个三级条目标注将引用的证据 key（如 `3.1 Graph RAG 的检索优势 [procko2024graph]`）。**大纲给用户确认，改完再进写作。**

### 阶段 7 · 逐段写作（引用纪律）

写作纪律四条：

1. **事实句必挂引用**：含数字、结论、前人工作、领域共识的句子，句尾挂 `[cite:KEY]`；多个来源逗号分隔 `[cite:key1,key2]`
2. **自己的分析句不挂引用**：推断、评价、过渡句裸奔是合法的
3. **转述优先**：证据表内容转述后挂 key；直接引用原文必须用引号并在证据表标注页码
4. **一段一职能**：每段只做一件事（主张→证据→诠释），段落结尾回扣小节论点

写完立即跑核验（阶段 9 的 verify 命令），带报告进评审。

### 阶段 8 · 评审团

扮演四角色逐节审稿，输出结构化意见后统一修订：

| 角色 | 关注点 | 输出格式 |
|---|---|---|
| 主编 | 论点是否回答 RQ、结构是否服务论证 | 必须改 / 建议改 / 无意见 |
| 审稿人 A（领域专家） | 论断强度 vs 证据强度、术语准确 | 逐节意见 |
| 审稿人 B（方法审稿人） | 引用位置是否恰当、证据是否被过度概括 | 逐节意见 |
| 魔鬼代言人 | 攻击最强主张：反例、竞争解释、被忽略的文献面 | 3 条以上攻击 |

修订规则：每条意见标 accept / reject（说明理由）/ revise（怎么改）。**逐字引用原则**：修订时保留用户认可的原句表述，改动的句子逐句给出 before/after。major 修订后再跑一次核验。

### 阶段 9 · 三层核验 + 完整性门禁

```bash
python3 <skill_dir>/scripts/paperkit.py verify draft.md --pool pool.json --out verify-report.json
python3 <skill_dir>/scripts/paperkit.py export draft.md --pool pool.json --style bibtex --out references.bib
```

#### 三层核验（paperkit 自动 + Agent 判读）

| 层 | 内容 | 执行者 |
|---|---|---|
| Check 1 · key 解析 | 每个 [cite:KEY] 是否在文献池 | paperkit（代码） |
| Check 2 · 元数据 | DOI 在 Crossref 是否真实、标题是否匹配 | paperkit（网络） |
| Check 3 · 证据定位 | 论断在原文是否有支撑段落 + 页码锚点 | paperkit 定位 → **Agent 判读** |

Check 3 状态判读规则：`evidence_found` → 复读 passage 确认真的支撑该句；`unsupported_risk` → **必须人工处理**：改写句子弱化论断，或换证据，或补检索；`unverified`（无摘要无全文）→ 换有全文的文献或明示降级。

#### 处置顺序

hallucinated → 立即删除或换真文献（**零容忍**）。doi_warn → 复核 DOI。unsupported_risk → 逐条处理。全绿 → 出参考文献。

#### 完整性门禁（交付前自述 7 项）

交付时附一小节「完整性自述」，逐项答 0 / 数量 / N-A：

1. 被删除的 hallucinated 引用数
2. 因证据不足而弱化的论断数
3. 仅有摘要支撑（无全文）的引用数
4. verify 后仍处 unsupported_risk 的条目数（理想 0；若非 0，说明为何保留）
5. 检索面缺口（哪些源 fail / 哪些角度没搜）
6. 魔鬼代言人攻击中未被采纳的条目及理由
7. 字数/结构 vs 用户要求的偏差

## 目录约定

工作目录（当前工作区，禁写 skill 目录）：

```
pool.json            # 文献池（search 产物，后续命令的输入）
draft.md             # 草稿（含 [cite:KEY]）
verify-report.json   # 核验报告
references.bib|ris|md
.paperkit/           # 全文缓存（可删，自动重建）
```

## 常见坑

- **检索词太具体** → 池子空。先广后窄，用领域术语而非完整句
- **arXiv 源 http 偶发失败** → paperkit 静默跳过，池子照出；重要文献可用 fulltext 单篇补抓
- **S2 限流** → 返回空；不重试轰炸，剩余三源足够
- **同名作者同年多篇** → key 自动加 a/b 后缀，写引用时对照池子清单别拿错
- **verify 报 unverified 很多** → 环境缺 pdf 解析（doctor 看得到）；`pip install pypdf` 或装 poppler 后重跑，缓存自动生效

## Attribution

引擎设计融合自：
- **Open Academic Paper Gen** (mmlong818, AGPL-3.0) — 证据表、三层引用核验、四源检索架构思想
- **Academic Research Skills** (Imbad0202, CC BY-NC 4.0) — 苏格拉底成题、评审团、魔鬼代言人流程

本 skill 为独立原创实现（未复制源码），依两者许可精神限**非商业用途**。若商用，请分别遵守 AGPL-3.0 与 CC BY-NC 4.0 的原许可条款。
