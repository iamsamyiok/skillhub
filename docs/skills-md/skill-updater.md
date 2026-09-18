---
name: skill-updater
description: 本地 skill 自进化更新器：基于 AutoSkill（arXiv:2603.01145）官方 SkillEvo 组件（vendored，MIT）。双折回放验收（mutate_dev/promotion_test）、混合变异（启发式+LLM）、程序化+LLM 二元规则评估，分数超过 champion 才晋升，连续 2 轮无晋升自动熔断。仅依赖 pyyaml 与 httpx，LLM 可用任何 OpenAI 兼容端点。当用户要「更新/进化某个技能」「优化本地 SKILL.md」时使用。
version: 0.2.0
tags:
  - skill
  - evolution
  - auto-update
triggers:
  - /skill-updater
---

# skill_updater

对本地 skill 目录中的指定技能执行一次受控自进化更新。核心算法复用 AutoSkill 官方
仓库的 SkillEvo 组件（`scripts/skillevo/`，vendored 副本，MIT，见
`skillevo/NOTICE.md` 与 `references/autoskill_core.md`）。

## 触发方式

```bash
# 手动执行（推荐先 dry-run）
python3 scripts/evolve.py <skill_id> --note "迭代备注" --root <skills目录> --dry-run

# 正式更新
python3 scripts/evolve.py <skill_id> --note "迭代备注" --root <skills目录>

# 累积回放样本 / 持久需求备注（供规则编译与回放使用）
python3 scripts/evolve.py <skill_id> --root <skills目录> --add-sample "用户输入样例"
python3 scripts/evolve.py <skill_id> --root <skills目录> --add-note "长期约束"
```

Agent 调度时把上述命令作为 shell 工具调用即可；stdout 末行输出 JSON 摘要。

## 目录约定

```text
<skills根目录>/
├── <skill_id>/SKILL.md          # 待演进的目标技能
├── .skillevo/                   # champion 注册表（自动创建）
├── ../skill_archive/<skill_id>/ # 旧版归档（自动创建）
└── feedback.db                  # SQLite 反馈库（自动创建）
```

## 工作流程（SkillEvo 原版算法）

1. **replay + 双折分割**：从 `feedback.db` 取样本（默认上限 12，不足 2 条则
   `incubating` 退出），按 7:3 分为 `mutate_dev`（指导变异）与
   `promotion_test`（独立验收），避免候选对验收样本过拟合。
2. **compile evals**：`EvalCompiler` 从 description/正文/标签/迭代备注启发式编译
   至多 6 条二元规则——programmatic（非空/JSON 可解析/段落上限/结论前置/表格结构，
   确定性校验）+ llm_binary（需求满足/反幻觉，严格 JSON 判定）；另追加一条
   description 符合性硬规则。
3. **mutate**：`VariantGenerator` 混合变异——启发式（按规则追加约束行）+ LLM 改写
   （强制 instructions-only，YAML 元数据冻结）。
4. **evaluate**：候选与 baseline 在 `mutate_dev` 上评估选最优；最优候选与 baseline
   在 `promotion_test` 上按 `promotion_repeats`（默认 3）重复评估。
5. **promote**：`should_promote`——候选均分超过 champion + `min_score_delta`(0.05)
   且 hard 失败数不上升才生效：旧版归档、新正文写回、版本 bump、champion 注册、
   关键词索引增量重建。

## 熔断与安全

- 连续 2 轮（`breaker.max_consecutive_failures`）未晋升 → 终止（exit 4），保留旧版。
- 任何未晋升的运行都不写盘；`--dry-run` 连测试通过也不写盘。
- LLM 端点不可用（重试 2 次）→ exit 3；技能不存在 → exit 2；无晋升候选 → exit 1。
- 变异输出若违规携带 frontmatter 会被自动剥离（防文件结构损坏）。

## 配置

`scripts/config.yaml`：LLM 端点（默认 AGNES，密钥引用环境变量 `AGNES_API_KEY`，
零明文）、熔断阈值、replay 池与分割比例、变异预算、归档与反馈库路径。

## 依赖与溯源

`pip install -r requirements.txt`（仅 pyyaml、httpx）。
vendored 源码 commit：94c47ca（2026-09-10 同步），本地改动仅两处适配
（requirement_texts 注入、instructions-only 变异），详见 `skillevo/NOTICE.md`。

## 版本号规则

版本号是演进历史的必要记录，是唯一允许被本工具修改的 YAML 字段：
`v0.1.3 -> v0.1.4`；无 `version` 字段时首写 `v0.1.0`。
