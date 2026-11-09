---
name: open2build
version: 0.1.0
description: Large-program development by composing open source. Use when the user wants to decompose a program/feature into modules, find and evaluate open-source projects or libraries on GitHub, then legally integrate, improve, or combine them into their own codebase. Covers module decomposition, OSS discovery/evaluation, license compliance (GPL/AGPL/Apache etc.), integration strategy (dependency vs snippet-copy vs fork vs process-wrap vs rewrite), vendor/adapter architecture, SBOM/NOTICES/supply-chain compliance, and upstream maintenance. Triggers (CN/EN): 拆分模块、找开源项目、开源选型、组合开源、许可证合规、依赖治理、vendoring、fork 改造、站在巨人肩膀上、build with open source.
---

# open2build — 开源组合编程工作流

把"拆分模块 → 找开源 → 改进组合 → 合法发布"作为一条流水线执行。
巨人负责轮子，你负责方向盘。

## 执行顺序

### 阶段 0：模块拆分
按"变化轴"（I/O 边界 / 核心算法 / 编排业务流 / 界面协议）切分系统，
每个模块填一张模块卡片（模板 `assets/module-card.md`）。
记住：**编排与安全边界通常自研**——那是差异化所在。

### 阶段 1：许可证预检（必须先于一切技术调研）
读 `references/license-compliance.md` 的决策表与红线清单。
用产品的交付方式（内部工具/分发软件/SaaS/开源）过滤许可证。
任一红线命中 → 直接淘汰候选或上报用户，不进入阶段 2。

### 阶段 2：寻找与评估
按 `references/discovery-evaluation.md` 的渠道找 2-4 个候选，
用 9 维记分卡打分（≥7/10 通过），可用 `scripts/repo_health.py` 快速体检。

### 阶段 3：集成策略（五选一）
按 `references/integration-patterns.md` 的决策树选择：
片段复制 / 依赖引入 / 提 PR 上游 / fork+patch 队列 / 进程包裹或重写。
向用户呈现选择理由后再动手写集成代码。

### 阶段 4：提取与改进
片段复制必须：来源注释（URL+许可证+commit）+ 最小测试 + 登记 NOTICES。
fork 改造遵守四铁律（见 reference）。

### 阶段 5：组合架构
六边形端口-适配器法：业务代码只 import 自己的模块与适配器；
每个开源依赖一个适配器文件；契约测试钉住适配器行为。

### 阶段 6：合规自动化
按 `references/compliance-automation.md` 生成 LICENSE、THIRD-PARTY-NOTICES、
SBOM，并把审计命令装进 CI。

### 阶段 7：长期维护
为每个关键依赖写一行"弃用预案"；建立升级节奏（周/季/年）。

## 执行纪律

1. 每阶段产出物落盘到项目内（如 `docs/oss-decisions.md` 累积决策记录）
2. 阶段 1-3 的结论必须先呈现给用户确认，再写集成代码
3. 引入新依赖前过一遍准入 8 问（`assets/dependency-admission-checklist.md`）
4. 交付时更新 THIRD-PARTY-NOTICES 与 SBOM

## 参考文件索引（按需加载，勿全部读入）

| 文件 | 何时读 |
|---|---|
| `references/license-compliance.md` | 阶段 1；涉及任何许可证疑问时 |
| `references/discovery-evaluation.md` | 阶段 2 |
| `references/integration-patterns.md` | 阶段 3-5 |
| `references/compliance-automation.md` | 阶段 6 与交付前 |
| `assets/module-card.md` | 阶段 0 填卡时复制 |
| `assets/dependency-admission-checklist.md` | 新依赖 PR 前 |
| `assets/third-party-notices-template.md` | 阶段 6 生成 NOTICES 时 |
| `scripts/repo_health.py` | 阶段 2 候选体检（零依赖，urllib） |
