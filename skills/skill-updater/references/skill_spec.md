# SKILL.md 编写规范（AutoSkill / Agent Skill 通用格式）

## 结构

每个技能一个目录，核心是 `SKILL.md`：YAML frontmatter（--- 包裹）+ Markdown 正文。

```markdown
---
name: my_skill                 # 技能标识，建议与目录名一致
description: >-                # 一句话说明能力边界；judge 依据它判定符合性
  做什么 + 适用场景 + 关键约束。必须具体，避免空话。
version: v0.1.0                # 语义化版本，patch 位随每次演进 +1
tags:
  - skill                      # 检索标签
triggers:                      # 触发词/命令
  - /my_skill
---

# 技能名

## 触发方式       ← 用户/Agent 如何唤起
## 工作流程      ← 有序步骤，每步可执行、可验证
## 约束与安全     ← 禁止行为、失败处理、熔断条件
## 配置          ← 外部依赖、路径、环境变量
## 版本规则       ← 什么字段允许被自动修改
```

## frontmatter 字段规则

| 字段 | 必填 | 说明 |
|------|------|------|
| name | 是 | 与目录名一致；触发匹配用 |
| description | 是 | judge LLM 判定输出是否符合 skill 的唯一依据，必须写得可判定 |
| version | 建议 | `vMAJOR.MINOR.PATCH`；无此字段时首写 v0.1.0 |
| tags | 建议 | 检索用；中文场景建议附中文别名 |
| triggers | 建议 | 命令式触发词 |

## 正文编写规则

1. **可判定性优先**：description 与流程写成可观察、可判定的行为
   （"输出 JSON 且含 verdict 字段"），judge 才能二元判定。
2. **最小充分修改**：演进时只改实现逻辑（流程/规则/约束），不重写无关内容。
3. **元数据冻结**：YAML 字段是技能的稳定标识，演进工具只允许改 `version`。
4. **显式失败路径**：写明什么情况停止/退出（熔断、缺依赖、样本不足）。
5. **一目录一技能**：附带脚本放 `scripts/`，参考资料放 `references/`，
   依赖清单写 `requirements.txt`，全部相对路径引用。

## 与 AutoSkill SkillSnapshot 的对应

`name <-> snapshot.name`，`description <-> snapshot.description`，
正文 <-> `snapshot.instructions`，`version <-> snapshot.version`，
`tags/triggers <-> snapshot.tags/triggers`。
