---
name: skillmanager
description: >
  SkillManager — 技能管理器。手动触发技能组合建议(采纳才挂回调)、扫描技能目录更新全局索引、
  单技能MD归档标记、静态HTML仪表盘(调用次数/成功率/平均耗时/高频报错,排序与筛选)。
  无侵入原有Agent逻辑,全部数据仅用MD文件存储,零外部服务。
  当用户要求"管理技能/技能建议/技能统计/技能归档/技能仪表盘"或输入 /skillmanager 时使用。
version: 1.0.0
---

# SkillManager — 技能管理器

无侵入的技能治理工具：**只用 MD 文件存储**（全局索引 + 各技能 SKILL.md 内的托管数据块），不修改任何 Agent 原生调用逻辑，零外部服务。

## 执行引擎

所有命令通过 Python CLI 执行（脚本位于本技能 `scripts/skillmanager.py`）：

```bash
python "脚本目录/skillmanager.py" <子命令> [参数]
```

## 子命令速查

| 命令 | 说明 |
|---|---|
| `refresh` | 扫描技能目录 → 更新全局索引MD + 输出高频问题更新建议 |
| `suggest --task "任务描述"` | 手动触发技能组合建议（匹配度排序；**采纳才挂回调**） |
| `run <技能名> -- <命令...>` | 临时回调包装器：计时/状态/报错 → 写入单技能MD托管块 + 全局索引 |
| `archive <技能名> <on\|off>` | 归档标记（仅建议列表隐藏，不影响Agent原生调用） |
| `dashboard` | 生成静态HTML仪表盘（调用次数/成功率/平均耗时/最近调用/高频报错，支持排序与按归档/标签筛选） |
| `stats [技能名]` | 查看统计 |

## 组合建议 → 采纳 → 回调 的标准流程

1. 用户描述任务 → Agent 执行 `suggest --task "..."`
2. 输出匹配度排序的组合建议与建议执行链（A → B → C）
3. **用户确认采纳后**，Agent 按“建议执行链”逐条挂临时回调，命令模板：

```bash
python "<脚本绝对路径>" run "<技能名>" -- <该技能的实际执行命令>
```

4. 每次运行自动把 耗时/状态/报错 写入 单技能MD托管块 + 全局索引MD——这就是“挂临时回调”的实现

## 数据组织（仅MD存储）

- 全局索引：`~/.skillmanager/index.md`（技能清单表 + 运行日志表）
- 单技能：各技能 `SKILL.md` 末尾的托管数据块（HTML注释内 JSON：归档/标签/运行统计/高频报错）
- 归档标记与标签都在托管块内；Agent 原生调用完全不感知

## 自动学习（实验）

若本机同时部署了“水库预警 LSTM 模拟器”等带自动学习的程序，SkillManager 的 run 包装器记录的数据亦可作为其训练样本来源（按需对接）。

## 边界声明

- suggest 仅输出建议，**绝不自动执行**；采纳必须由用户确认
- 归档只影响 SkillManager 建议列表的可见性，不影响 Agent 的技能加载与调用
- 不读写任何非 MD 文件作为数据存储；不依赖外部服务


## skillhub 集成 (v1.1)

配合"skillhub 优先"工作流:执行任务先查内置 skill,再查 skillhub,最后才自己造。

| 命令 | 说明 |
|---|---|
| `hub-search <关键词>` | 搜索 skillhub 上的技能(名称+描述全文,自动节流防限流) |
| `hub-install <名称> [--force]` | 从 skillhub 安装到 ~/.agents/skills/,写 .skillhub.json 来源标记(blob sha 清单) |
| `hub-outdated` | 对比本机 hub 技能与远端 blob sha,列出可更新项 |
| `hub-publish <名称> [--dry-run]` | 发布本地技能到 skillhub(自动处理已存在文件的 sha 覆盖) |

已知坑:本机代理偶发返回 rc=0 空响应 — _hub_tree 已带 3 次重试;描述扫描每请求间隔 0.5s 防 GitHub 二级限流。


## Agent 工作流:用户要求查找/安装 skillhub 技能时 (v1.2)

当用户说"帮我找一个 XX 技能"、"skillhub 上有没有 YY"、"安装 ZZ 技能"时,按以下流程执行:

1. **搜索**: `python <本技能>/scripts/skillmanager.py hub-search <关键词>`
   - 返回名称命中与描述命中两个维度,逐条列给用户
2. **给结果**: 把命中列表整理成表格(技能名 + 推断用途)呈现给用户
3. **安装**: 用户确认(或明确要求"直接装")后执行
   `python <本技能>/scripts/skillmanager.py hub-install <名称>`
   安装到 `~/.agents/skills/<名称>/`,ZCode 重启后自动进技能列表
4. **确认**: `hub-outdated` 检查安装结果,向用户报告安装路径与用法入口(SKILL.md)

示例对话:
- 用户:"skillhub 上有没有能生成图表的技能?"
- → `hub-search 图表` / `hub-search chart` / `hub-search d2` → 命中 d2-chart、text-to-d2 →
  呈现给用户 → 用户说"装 d2-chart" → `hub-install d2-chart` → 完成
