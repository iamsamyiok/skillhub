---
name: awesome-freellm-apis
version: 1.0.0
category: AI 与大模型
tags: [免费API, 大模型, LLM, 实操指南]
description: 40+ 提供商的免费 LLM API 汇总，分"永久免费层/可续额度"两类，含 Python/Cursor/Claude Code 接入示例与 Base URL 速查表。
repo: https://github.com/open-free-llm-api/awesome-freellm-apis
stars: 3561
pushedAt: 2026-10-02
verifiedAt: 2026-10-02
freeType: 限定额度
---
# awesome-freellm-apis —— 134+ 免费 LLM API 实操手册

> 引用仓库：[open-free-llm-api/awesome-freellm-apis](https://github.com/open-free-llm-api/awesome-freellm-apis) · 3,561 星 · 最近推送 2026-10-02 · 核实于 2026-10-02
>
> 免费类型主基调：**限定额度**

与 mnfst 清单互补：这份更偏"怎么用"，有 30 秒上手示例（OpenAI SDK 改 base_url）、各家 Quick Reference 表与主流工具接入法。

免费类型图例：`永久` = 无需注册直接调用；`需注册` = 需申请 API Key；`限定额度` = 免费层有配额，括号内为额度。

## 精选提供商表单

| API | 分类 | 描述 | 免费类型 | 链接 |
| --- | --- | --- | --- | --- |
| NVIDIA NIM | 永久免费层 | 132 个免费模型，1M 上下文 | 需注册(手机验证) | https://build.nvidia.com |
| Groq | 永久免费层 | Llama 3.x 等，30 RPM / 14400 RPD | 需注册 · 限额(30次/分) | https://console.groq.com |
| Google AI Studio | 永久免费层 | Gemini Flash/Pro 免费层 | 需注册 · 限额(15次/分) | https://aistudio.google.com |
| Cloudflare Workers AI | 永久免费层 | 每天 10000 神经元额度 | 需注册 · 限额(10000/天) | https://developers.cloudflare.com/workers-ai/ |
| Cerebras | 永久免费层 | 超高速推理免费层 | 需注册 · 限额(30次/天) | https://cloud.cerebras.ai |
| GitHub Models | 永久免费层 | GitHub 上的模型 Playground | 需注册 · 限额(低速率) | https://github.com/marketplace/models |
| OpenRouter | 可续额度 | :free 模型每日免费额度 | 需注册 · 限额(50次/天) | https://openrouter.ai |
| Anthropic 兼容端点 | 接入技巧 | Claude Code 等工具的接入方案 | 混合 | https://github.com/open-free-llm-api/awesome-freellm-apis |

## 使用建议

- README 有"Quick Reference — Base URLs & API Keys"总表，可直接抄。
- 部分高级通道（如 OpenRouter Anthropic 系）需一次性充值 10 美元解锁免费模型，表内已标注。
