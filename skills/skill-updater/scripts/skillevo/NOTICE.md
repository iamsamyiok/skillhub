# NOTICE

本目录 (`models.py` / `io_utils.py` / `config.py` / `evals.py` / `mutators.py` /
`registry.py`) 复制自 ECNU-ICALK/AutoSkill 仓库的 SkillEvo 组件。

- 上游: https://github.com/ECNU-ICALK/AutoSkill (commit 94c47ca488d4ba4117d20272e66d49b9877e68cf)
- 许可: MIT（上游 README 许可证声明；上游仓库根目录当前未附 LICENSE 文件文件本身，
  以其 README badge 为准: https://opensource.org/licenses/MIT）
- 本地改动:
  - evals.py: 移除 `autoskill.offline.conversation.requirement_memory` 依赖，
    `EvalCompiler` 改为直接注入 `requirement_texts`（来源: 本地 SQLite 反馈库）
  - mutators.py: `_llm_variant` 强制 instructions-only（本工具约束: YAML 元数据冻结）
  - 其余文件原样保留
