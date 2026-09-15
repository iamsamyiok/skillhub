---
name: recorder2skill
version: 1.0.0
description: 屏幕录制→可复用技能（Recorder2Skill）：录制你操作电脑完成任务的屏幕过程，由 agent 分析事件时间线自动生成符合规范的 SKILL.md 技能包。当用户要求"录屏并把我刚才的操作变成技能""watch me do this and automate it""turn this into a skill"或类似意图时使用。turn a live screen recording into a reusable agent skill (Windows/Linux)
category: 技能开发
tags: [屏幕录制, 技能生成, SKILL.md, 自动化, recorder2skill]
---

# Skill: recorder2skill（屏幕录制→可复用技能）

把"你亲手做一遍任务"变成 agent 可复用的技能：启动屏幕录制 → 你正常完成任务并点 Stop → agent 读取事件时间线（应用切换、窗口标题、浏览器 URL、终端命令、剪贴板、marker）→ 自动撰写并保存符合 Agent Skills 规范的 `SKILL.md`。

支持 Windows 和 Linux（X11），全流程通过一条 CLI 驱动，任何能执行命令的 agent 都能用。

## 工作原理

1. **录制**：agent 调 `recorder-cli.mjs start` 拉起录制悬浮条；你像平时一样完成任务，点 Stop（或 `Ctrl+Shift+R`）。录制中随时 `Ctrl+Shift+M` 打标记，帮助 agent 定位关键动作。
2. **等待处理**：`recorder-cli.mjs wait-ready 600` 阻塞到帧提取、pHash 去重、事件关联完成。
3. **分析**：`timeline` 给出带毫秒时间戳的有序步骤和自动生成的描述；`events` 提供细粒度事件（文本字段已做 PII 脱敏）；`frames` 给出关键帧 JPEG 路径。
4. **生成技能**：agent 综合时间线与事件写出 SKILL.md 正文，`save-skill <name> --description "..." --body-file body.md` 落盘为标准技能包（name ≤64、单行 description ≤1024，兼容 OpenCode / Claude Code / Codex CLI 解析器）。
5. **验证与归档**：`skill-doctor` 校验生成物；`archive` 把会话移入 archived-sessions（绝不删除）。

## 安装

```bash
git clone https://github.com/iamsamyiok/recorder2skill.git
cd recorder2skill
./scripts/setup.sh          # Windows: scripts/setup.ps1
node scripts/recorder-cli.mjs doctor   # 全部绿即就绪
```

把本技能目录复制进 agent 的技能目录：

```bash
# OpenCode
cp -r recorder2skill  yourproject/.opencode/skill/
# Claude Code
cp -r recorder2skill  yourproject/.claude/skills/
```

之后对 agent 说一句即可：*"start recording my screen; I'll do the task, then turn it into a skill"*。

## 对 agent 的使用说明

完整流程、事件类型表和注意事项见包内 `SKILL.md`。核心命令：

```bash
node scripts/recorder-cli.mjs start          # 拉起录制，确认 recording.json 后返回
node scripts/recorder-cli.mjs wait-ready 600 # 等待会话处理完成
node scripts/recorder-cli.mjs timeline       # 有序步骤 + 自动描述
node scripts/recorder-cli.mjs events         # 事件明细（--types/--from/--to/--limit）
node scripts/recorder-cli.mjs save-skill <name> --description "..." --body-file body.md
node scripts/skill-doctor.mjs <skillDir>     # 校验生成物
```

## 来源与源码

- 源码仓库：<https://github.com/iamsamyiok/recorder2skill>
- 基于 microsoft/skill-recorder（MIT）二次开发，vendor 改动全部以 `[RECORDER-DEMO]` 标记并记录在 PATCHES.md
- 已发布版本：v1.0.0
