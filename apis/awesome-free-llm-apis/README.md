---
name: awesome-free-llm-apis
version: 1.0.0
category: AI 与大模型
tags: [免费API, 大模型, LLM, APIKey, 永久免费层]
description: 收录 Google、Groq、Cohere、智谱、硅基流动等 16+ 提供商的永久免费 LLM API，逐模型标注上下文长度与 RPM/TPD 速率限制。
repo: https://github.com/mnfst/awesome-free-llm-apis
stars: 8968
pushedAt: 2026-10-02
verifiedAt: 2026-10-02
freeType: 限定额度
---
# awesome-free-llm-apis —— 永久免费 LLM API 大全

> 引用仓库：[mnfst/awesome-free-llm-apis](https://github.com/mnfst/awesome-free-llm-apis) · 8,968 星 · 最近推送 2026-10-02 · 核实于 2026-10-02
>
> 免费类型主基调：**限定额度**

"永久"指免费层长期存在：Key 一次申请长期有效，但每个模型都有 RPM/TPD 速率限制（如 15 RPM、2 万 tokens/天），适合个人项目与测试。精选 12 家如下。

免费类型图例：`永久` = 无需注册直接调用；`需注册` = 需申请 API Key；`限定额度` = 免费层有配额，括号内为额度。

## 提供商表单（12 家）

| API | 分类 | 描述 | 免费类型 | 链接 |
| --- | --- | --- | --- | --- |
| Google Gemini | AI 提供商 | Gemini 全系免费层 | 需注册 · 限额(RPM 因模型而异) | https://aistudio.google.com/app/apikey |
| Groq | AI 提供商 | Llama/Mixtral 超低延迟推理 | 需注册 · 限额(30次/分) | https://console.groq.com/keys |
| Cohere | AI 提供商 | Command 系列与 Embed | 需注册 · 限额(20次/分) | https://dashboard.cohere.com/api-keys |
| Mistral AI | AI 提供商 | Mistral 系免费层 | 需注册 · 限额(1次/秒) | https://console.mistral.ai/api-keys |
| NVIDIA NIM | AI 提供商 | 开源模型托管推理 | 需注册 · 限额(40次/分) | https://build.nvidia.com |
| Cloudflare Workers AI | AI 提供商 | 边缘推理（每天 10000 单位） | 需注册 · 限额(10000神经元/天) | https://developers.cloudflare.com/workers-ai/ |
| OpenRouter | AI 路由 | 多模型统一接口（:free 后缀模型） | 需注册 · 限额(20次/天 免费模型) | https://openrouter.ai/keys |
| SiliconFlow 硅基流动 | AI 提供商（中国） | Qwen/DeepSeek 等免费模型 | 需注册 | https://cloud.siliconflow.cn |
| ModelScope 魔搭 | AI 提供商（中国） | 阿里系模型免费推理 | 需注册 | https://modelscope.cn |
| Z AI 智谱 | AI 提供商（中国） | GLM 系列免费层 | 需注册 | https://open.bigmodel.cn |
| LLM7.io | AI 提供商 | 免信用卡取 Key | 需注册 · 限额(5次/分) | https://token.llm7.io |
| HuggingFace Inference | AI 提供商 | 十万+ 开源模型推理 | 需注册 · 限额(每月少量额度) | https://huggingface.co/inference-api |

## 使用建议

- 每家提供商的 README 章节有逐模型表格（Context / Max Output / Rate Limit），选型时对照。
- 国内可直连：硅基流动、魔搭、智谱。
- 多数提供商 API 兼容 OpenAI SDK，换 base_url 即可。
