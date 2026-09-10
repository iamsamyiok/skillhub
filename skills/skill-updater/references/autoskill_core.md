# AutoSkill 核心摘录（已核实来源）

来源（2026-09-10 核实）：
- 论文：AutoSkill: Experience-Driven Lifelong Learning via Skill Self-Evolution,
  arXiv:2603.01145 v2, 2026-03-05, https://arxiv.org/abs/2603.01145
- 仓库：https://github.com/ECNU-ICALK/AutoSkill （MIT, ECNU-ICALK；机构含上海AI实验室与华东师大）

## 术语勘误

**论文与仓库均无"双循环 / dual loop / inner/outer loop"表述。**
该词不是 AutoSkill 的官方概念（论文 HTML 全文与仓库代码全文检索均零命中）。
论文使用的术语是 **skill lifecycle**（生命周期）；仓库中唯一的循环描述是
SkillEvo README 的 "replay-driven skill self-evolution loop"（单数）。
本技能包按真实内容实现，不引入"双循环"说法。

## 论文：skill lifecycle（第 4.3 节主题）

论文摘要与引言给出的完整生命周期（五个环节，环环相扣，无内环外环之分）：

1. **Extraction**：从对话与交互事件中识别候选技能（无稳定偏好/约束时不建技能，
   输出空抽取结果以避免噪声技能——见仓库 README 3.A）。
2. **Structured representation**：固化为标准 `SKILL.md` 工件，可读、可审、
   可手工修改、带版本号。
3. **Iterative refinement**：后续反馈更新既有技能而非制造副本（版本
   `v0.1.0 -> v0.1.1`，见仓库 README 3.B；SkillBank 中
   `professional_text_rewrite` 已演进到 v0.1.34）。
4. **Retrieval**：推理时按请求检索相关技能。
5. **Reuse**：注入未来请求，无需重训练底层模型。

定位：model-agnostic 插件层，把短时交互经验变成显式、可复用、可组合的能力资产。

## 仓库：SkillEvo 五步循环（SkillEvo/README.md，2026-03-23 发布的 1.0）

SkillEvo 是 replay-driven 的技能自进化 runner，不回写主 SkillBank，本地循环五步：

1. **build replay pool**：为单个技能谱系构建冻结回放池（在线来源
   `history[].messages` 重建；离线来源 `source_file + conversation_index`）。
2. **compile 3-6 binary eval rules**：从 prompt 与需求统计编译二元规则
   （`programmatic` 或 `llm_binary`，见 `SkillEvo/models.py: EvalRule`）。
3. **generate small mutations under a fixed budget**：启发式变异 + 可选 LLM 引导
   变异，预算内小步修改。
4. **evaluate on `mutate_dev`**：样本分 `mutate_dev` / `promotion_test` 两个
   split（`models.py: ReplaySample.split`）。
5. **promote only if better**：候选在 `promotion_test` 上击败当前 champion 才
   晋升；champion 存于 `SkillEvo/champions/`。

其他值得保留的实现细节：

- 谱系不足时保持 `incubating` 状态（样本太少不进化）——skill_updater 采纳为
  replay 池最少样本规则。
- 仓库 2026-05-09 新增 Local Skill Manager（`skills/autoskill`）：会话后维护
  本地技能文件，做 reusable-experience 分诊与 `discard / improve / merge /
  create` 决策——skill_updater 的定位对应其中的 `improve` 决策自动化。
- SkillEvo 明确"Not implemented: automatic write-back into the main SkillBank"，
  即官方把"测试通过后写回"留作扩展点——skill_updater 的 promote 步骤正是补上
  这一环，故写回前必须有全样本二元测试与熔断保护。
- 关键数据结构（`SkillEvo/models.py`）：`SkillSnapshot{skill_id, name,
  description, instructions, version, tags, triggers, metadata}`——skill_updater
  的 YAML frontmatter 字段与其对齐。
