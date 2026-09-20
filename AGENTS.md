# AGENTS.md — SkillHub 维护规范（Agent 必读）

本文件是 SkillHub 仓库的唯一 Agent 操作规范。**任何上架 / 修改 / 删除技能的任务，必须先完整读本文件再动手。** 历史教训：未按规范操作会导致站点显示异常、校验失败、反复整改。

## 一、仓库机制速览

| 项 | 说明 |
|---|---|
| 站点 | https://iamsamyiok.github.io/skillhub（GitHub Pages，由 **docs/** 目录部署，分支 main） |
| 技能源 | `skills/{id}/`，一个技能一个目录，**必须含 SKILL.md**，可附带 LICENSE/脚本/资源（会被打包进 zip/tar.gz） |
| 元数据 | `data/meta.json` 的 `skills.{id}` 条目（category/tags/downloads/createdAt/updatedAt/version） |
| 构建 | `node export-static.js --site-url https://iamsamyiok.github.io/skillhub --repo-url https://github.com/iamsamyiok/skillhub` → **清空重建 docs/** |
| 测试 | `npm test`（= test/health.test.js + test/validate_skill.test.js） |
| 关键实现 | `server.js`（parseFrontmatter / skillDetail / allSkillIds）、`export-static.js`、`seeds.js` |

构建产出的 docs/ 内容包括：`skills-md/{id}.md`（SKILL.md 原文）、`downloads/{id}.zip` 与 `.tar.gz`、`skills.json`、`data/skills.json`、`llms.txt`、`skills.txt`、`index.html`（内联技能清单 + skills-data JSON）、`AGENTS.md`（安装说明）。

## 二、上架新技能：必做清单（按序执行，缺一不可）

### 1. 添加技能目录 `skills/{id}/`

- **id 规则**：必须匹配 `^[a-z0-9][a-z0-9._-]{0,63}$` —— 小写字母或数字开头，只含小写字母/数字/`.`/`_`/`-`，最长 64 字符。**禁止大写、中文、空格**（否则 `skillDetail` 直接返回 null，技能不显示）。
- 三处必须一致：**目录名 = frontmatter 的 name = meta.json 的 key**。
- 至少放 SKILL.md；其余文件（LICENSE 等）原样随附。

### 2. 规范 SKILL.md frontmatter（硬性约束，最常见的坑）

`server.js` 的 `parseFrontmatter` 只解析**单行 `key: value`**：按第一个冒号切分，值去首尾引号；**跳过以空格或 `#` 开头的行**。

- ✅ **description 必须单行**。❌ 禁止 `description: >` 多行折叠写法——折叠块会被解析成值 `">"`，站点描述直接显示异常。
- 必填字段：`name` / `version` / `description` / `category` / `tags`；`license`、`authors`、`credentials` 可选。
- `version` 必须 `x.y.z` 格式（如 `1.0.0`）。
- `tags` 用行内数组：`tags: [标签1, 标签2]`。
- `description` 建议中文优先、可中英混合，单行长文本；会展示在站点卡片与 llms.txt（截断 160 字符）。
- 示例（合规）：

```yaml
---
name: your-skill
version: 1.0.0
category: 开发工具
tags: [关键词1, 关键词2]
description: 一句话讲清技能做什么、何时用。单行，不换行。
license: MIT
---
```

- **正文（`---` 之后）不得改动**；官方技能的 frontmatter 若为多行折叠，只允许把 description 压成单行并补全必填字段，其余原样保留。

### 3. 更新 `data/meta.json`

- 在 `skills` 对象中新增 `{id}` 条目，**不得改动其他技能条目**：

```json
"your-skill": {
  "version": "1.0.0",
  "category": "开发工具",
  "tags": ["关键词1", "关键词2"],
  "downloads": 0,
  "createdAt": "2026-09-20T00:00:00.000Z",
  "updatedAt": "2026-09-20T00:00:00.000Z"
}
```

- `version` 必须与 frontmatter 一致；`category` 优先复用站点既有 14 类：写作工具 / 前端开发 / 图像理解 / 图像生成 / 工作流 / 开发工具 / 开发调试 / 技能开发 / 文档处理 / 知识转化 / 研究分析 / 网络与搜索 / 视频创作 / 需求梳理（确需新分类才新增）。
- `tags` 与 frontmatter 保持一致或更全。

### 4. 构建

```bash
cd <仓库根>
node export-static.js --site-url https://iamsamyiok.github.io/skillhub --repo-url https://github.com/iamsamyiok/skillhub
```

- 该命令会 `fs.rmSync` 清空重建 docs/，技能源与 meta.json 的任何不一致都会在此暴露。
- **禁止手工编辑 docs/ 生成物**；docs/ 的一切改动只能来自 export-static.js。

### 5. 验证（交付前全部通过）

```bash
npm test
```

并逐项检查（用真实文件/HTTP 验证，不能只看构建无报错）：

- `docs/skills-md/{id}.md` 存在，frontmatter 为单行合规格式
- `docs/downloads/{id}.zip` 与 `.tar.gz` 存在，zip 内路径为 `{id}/SKILL.md`
- `docs/skills.json` 与 `docs/data/skills.json` 的 `total` 正确、含新技能条目
- `docs/llms.txt`、`docs/skills.txt`、`docs/index.html`（内联清单与 skills-data JSON）均含新技能

### 6. 提交与推送

```bash
git config user.name "iamsamyiok"
git config user.email "iamsamyiok@users.noreply.github.com"   # 首次必须配置，否则 commit 失败
git add -A
git commit -m "feat: 上架 {id} 技能（一句话说明）"
# push 用 credential helper 注入 token，禁止把 token 写进 URL/提交信息/任何文件
TOKEN="<用户的 GitHub token>" git -c credential.helper='!f() { echo "username=x-access-token"; echo "password=$TOKEN"; }; f' push origin main
```

- 推送成功后等待 GitHub Pages 部署（约 1–2 分钟），再验证线上：`skills.json` 的 total、`skills-md/{id}.md` HTTP 200、首页内联清单含新技能。

## 三、禁止事项

- 不改动其他技能的源文件、meta.json 条目与生成物。
- 不提交敏感文件：`data/initial-credentials.txt`、`data/initial-agent-token.txt`、`data/auth.json`、`data/tokens.json`（已 gitignore；不要 `git add -f`）。
- 不在仓库任何文件、提交信息、产物中写入用户凭证（GitHub token / API key 等）。
- 不手工修改 docs/（一律由 export-static.js 重建后整体提交）。
- 不动 `auto-code/*` 分支，只在 main 上操作。
- 找不到技能来源或来源有歧义时，先向用户确认，不凭猜测制造内容。

## 四、常见坑速查（历史教训）

| 症状 | 原因 | 处置 |
|---|---|---|
| 站点描述显示 `>` | frontmatter 用了 `description: >` 多行折叠 | 压成单行 |
| 技能不在站点出现 | 目录名含大写/中文/超长，未过 ID_RE | 改名，保持三处一致 |
| npm test 失败 | meta.json version 与 frontmatter 不一致 / 缺必填字段 | 对齐版本、补字段 |
| 站点与源码不同步 | 改完没跑 export-static.js 就提交 | 先构建再提交 |
| commit 报 unable to auto-detect email | 未配置 git 身份 | 先 git config |

## 五、修改 / 删除技能

- **改**：同"上架"流程 —— 改源文件或 meta.json → 重建 docs/ → 测试 → 提交推送。
- **删**：删 `skills/{id}/` 与 meta.json 条目 → 重建 docs/（会清掉对应 zip/md）→ 测试 → 提交推送。
- 批量新增多个技能时，每个技能独立完成 1–3 步后统一构建一次、逐项验证再推送。
