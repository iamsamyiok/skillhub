---
name: geogpt
description: 调用 GeoGPT 科研开发者平台 API 做地理/地质/地球科学研究，提供地学问答、多轮会话、文献知识库检索（公共库/个人库/团队库）和带文献引用的证据增强回答。当用户提出地球科学问题、要查地学文献、做地学科研调研、搭建地质类 RAG 流水线，或明确提到 GeoGPT 时使用。
version: 1.0.0
category: 研究分析
tags: [地球科学, 地质学, 文献检索, RAG, 科研问答, GeoGPT]
authors:
  - muxinyide
credentials:
  - name: GEOGPT_TOKEN
    required: true
    description: "GeoGPT 开发者平台的 Bearer access_token（sk- 开头）。在 https://geogpt.zero2x.org.cn/cn/developer/api-keys 注册后创建。"
    storage: "Windows 用户级环境变量 GEOGPT_TOKEN、shell 环境变量，或技能目录 config.json"
---

# GeoGPT 科研 API 调用

## Overview

GeoGPT 是之江实验室主导的地理科学大模型平台（`https://geogpt.zero2x.org.cn`），本技能封装其 4 个实测可用能力：创建会话、流式问答（3 个模型）、公共库文献检索、个人/团队库检索。

脚本已按线上真实格式调通并做过全量回归。**直接用脚本，不要现写 curl/请求代码** —— 官方文档的响应格式已过期，照抄必然解析失败（详见「已知坑」）。

## 首次使用

**1. 取得密钥**（必需，平台注册后在开发者面板创建 API Key，形如 `sk-…`）：

- 申请页 https://geogpt.zero2x.org.cn/cn/developer/api-keys
- 问题反馈邮箱 support.geogpt@zhejianglab.org

**2. 配置密钥**（选一种，脚本按 `进程环境变量 → config.json → Windows 用户级环境变量` 顺序自动读取）：

```powershell
# Windows，一次设置长期生效
powershell -Command "[Environment]::SetEnvironmentVariable('GEOGPT_TOKEN','sk-你的密钥','User')"
```

```bash
# macOS / Linux，写进 ~/.bashrc 或 ~/.zshrc 可长期生效
export GEOGPT_TOKEN=sk-你的密钥

# 或编辑本技能目录的 config.json，把 REPLACE_ME 换成密钥
```

**3. 自检**（逐项打连通性，首行会显示密钥实际来自哪里）：

```bash
node scripts/doctor.mjs
```

报告里 🔴 `模型服务 /v1/models` 是上游 LiteLLM 网关 401，官方已知故障，不影响其余接口。

**密钥安全**：不要把明文密钥提交进仓库或写进任何交付文档；对外分享技能时只分享 `config.json` 的 `REPLACE_ME` 模板。

## 脚本

先 `cd` 到本技能目录。三个脚本都支持 `-h` 看完整选项。

### ask.mjs —— 问答

```bash
# 单轮问答（默认 GeoGPT-R1-Preview）
node scripts/ask.mjs "郯庐断裂带的构造属性是什么？"

# 多轮追问：复用上一步 stderr 打印的 sessionId
node scripts/ask.mjs "那它和俯冲带怎么区分？" --session <id>

# 换模型，三者实测均可用
node scripts/ask.mjs "问题" --module Qwen2.5-72B-GeoGPT   # 或 GeoGPT-R1-Preview / DeepSeekR1-GeoGPT

# 证据增强：先检索文献片段拼进 prompt，要求只依据材料作答并编号引用
node scripts/ask.mjs "稀有气体同位素为什么能作地幔源区示踪剂？" \
  --ground "noble gas isotopes mantle source tracers" --ground-k 3

# 批量：文件一行一问，结果写 markdown
node scripts/ask.mjs --batch questions.txt --out results.md --delay 400
```

| 选项 | 用途 |
| --- | --- |
| `--show-reasoning` | 一并打印思考链（`reasoning_content` 与正式回答是分开的两个字段） |
| `--no-context` | 只输出答案，便于程序化取用 |
| `--personal` | `--ground` 改查个人库（中英文均可） |
| `--ground-k` / `--min-score` / `--min-distance` | 召回条数与相关度阈值 |
| `--shared-session` | 批量模式共用一个会话（默认每行独立，避免上下文串味） |
| `--timeout <秒>` | 单次问答超时，默认 300 |

### rag.mjs —— 文献检索

```bash
node scripts/rag.mjs "zircon U-Pb geochronology North China Craton" -k 5   # 公共库，必须英文
node scripts/rag.mjs "锆石 U-Pb 定年" --personal                            # 个人库，中英文均可
node scripts/rag.mjs "关键词" --personal --team                             # 团队库
node scripts/rag.mjs "关键词" --personal --path "文献库/2024" -k 3           # 限定 MyLibrary 目录
node scripts/rag.mjs "关键词" --full        # 每段正文输出 3000 字（默认 500）
node scripts/rag.mjs "关键词" --json        # 原始 JSON，接管道
```

输出带 `title` / `document_id` / `chunk_index` / `section` / `text_type`，引用溯源就靠这几个字段。

### lib.mjs

需要自定义编排时 import 它（`newSession` / `ask` / `streamAsk` / `ragCommon` / `ragPersonal` / `authHeaders` / `BASE`），别重写流解析和信封判错逻辑。

## 推荐工作流

1. 用户给地学问题 → 先 `rag.mjs`（英文检索词）确认能召回到相关文献。
2. 有相关文献 → `ask.mjs --ground` 出带编号引用的答案；召回 0 段时脚本会提示"已退化为无依据问答"，此时应显式告诉用户这是模型自身知识、无文献支撑。
3. 需要深挖 → 保留 `sessionId` 连续追问，比一次性拼长 prompt 省 token 也不易挂死。
4. 交付时附上文献标题 + `document_id`，并说明 `year`/`journal`/`authors` 平台不返回，规范引用需人工补。
5. 综述类任务分批喂材料（每批几千字），不要把整篇文献一次塞进 prompt。

## 已知坑（实测结论，违背会静默出错）

- **HTTP 200 ≠ 成功**：上游故障是 `code:"0001"` + `data` 塞错误串；无效 token 是 `code:"2020"` / `msg:"token illegal"`。两种状态码都是 200，必须判 `code === "00000"`（脚本已处理）。
- **成功 ≠ 有内容**：服务端不校验 `sessionId`，传错 id 不报错、直接返回空回答（脚本已改为空回答退出码 2）。
- **sendMsg 是双层 JSON 转义**的 OpenAI chunk 流，结束标记 `[DONE]`，不是官方文档写的 `<end></end>`；官方承诺的 `questionId`/`answerId` 也不返回。
- **公共库纯中文 0 命中** —— 检索词必须译成英文。注意 `锆石U-Pb定年` 这类混排会命中，但起作用的是夹带的 `U-Pb`，别据此以为中文可用。
- **RAG 不会因为不相关返回空**，一定凑满 `topK`，阈值必须自己卡：公共库看 `metadata.score`，个人库看 `metadata.distance`（越大越接近，相关 0.31–0.42，无关 0.02–0.05）。
- **两库结构不同**：公共库是扁平对象 + `score`；个人库是 `[文档, 分数]` 二元组且外层分数恒 0；团队库为空时 `data` 直接是 `[]`。
- **别塞超长 prompt**：1.8 万字正常（约 24s），18 万字服务端不返回也不报错，一路挂到客户端超时。
- **个人库前置条件**：文档需先在网页端 MyLibrary 上传；空库检索只会拿到无关结果。
- 地学细节仍需人工核对，模型会自我怀疑（实测出现过"郯庐断裂带是否属于俯冲带"的犹豫推理）。

## 配额与性能

RPM 1000 / RPD 30 万 / TPM 100 万 / TPD 1 亿。真正的约束是 **RPD**（全天平均约 208 次/分钟）；满负荷 token 消耗只能撑约 100 分钟就被 TPD 卡住。

实测基线：单轮问答 7–12s（R1 类偏慢）；批量 3 问 104s；4 路并发 12.3s 无失败。并发不是瓶颈，跑大批次按 RPD 排时段。

## 能力边界

适合 —— 地学概念解释、文献片段召回与综述、私有资料问答、批量抽取（矿物名、元素比值、年龄、构造背景）、带思考链的可解释回答、嵌进自己的 SSE 后端。

不适合 —— 当通用 OpenAI 替代（`/model/v1/chat/completions` 目前服务端不可用且模型不可指定）、对事实精度零容忍的场景、依赖返回元数据自动生成规范引用。

## Resources

- `references/api.md` —— 完整接口文档：6 个接口逐字段规格、curl/Python 示例、配额解读、官方文档勘误表（15.1 文字错误 / 15.2 结构性偏差 / 15.4 两轮全量复测数据）、能力清单（第 16 节）。需要确切字段名或响应结构时 grep 这里，不要凭记忆猜。
