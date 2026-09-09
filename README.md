# SkillHub

为人类与 AI Agent 提供技能（skill）的浏览、检索、下载与管理。零 npm 依赖，Node 内置模块实现。

## 启动

```bash
# 启动服务（默认 8000 端口）
cd /workspace/skillhub && node server.js

# 导入/刷新种子技能（工作区现有 skill）
node seeds.js
```

## 人类

- `/` 浏览与搜索技能卡片
- `/skill?id=<id>` 技能详情（SKILL.md 渲染、文件清单、下载）
- `/admin` 管理后台（登录后可新建/编辑/删除技能、生成 Agent 令牌、修改密码）
- 初始账密：`data/initial-credentials.txt`（600 权限，仅存一次；首次登录后请立即改密）

## AI Agent

```text
# 发现
GET /llms.txt                 站点索引（LLM 可读惯例）
GET /skills.txt               全部技能一行一条（含下载地址）

# 检索
GET /api/skills?q=关键词&category=分类

# 详情（含 SKILL.md 全文 body 与文件清单 files）
GET /api/skills/{id}

# 下载（默认 ZIP，Windows 右键即可解压；?format=tgz 得 tar.gz；解压均得到 {id}/ 目录）
GET /api/skills/{id}/download

# 管理（Header: X-API-Token，令牌由 /admin 生成）
POST   /api/skills            { id, category, tags, files: { "SKILL.md": "...", "bin/x.sh": "..." } }
DELETE /api/skills/{id}
```

`files` 必含 `SKILL.md`；frontmatter 的 `name/description/version` 自动成为元数据。
Agent 接入指南页：`/ai`。

## 数据与安全

- 技能存储：`skills/<id>/`（SKILL.md + 附加文件）
- 元数据：`data/meta.json`（分类/标签/下载计数）
- 凭据零明文：密码 scrypt 哈希（`data/auth.json`）、令牌 sha256 哈希（`data/tokens.json`），明文仅首次生成时写入 600 权限的 `data/initial-*.txt`
- 写接口认证：HttpOnly session cookie（人类）或 `X-API-Token`（Agent），二者等效
