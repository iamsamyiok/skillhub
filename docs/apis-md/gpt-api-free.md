---
name: gpt-api-free
version: 1.0.0
category: AI 与大模型
tags: [免费API, GPT, OpenAI兼容, 国内直连, 中转]
description: 免费 GPT/DeepSeek API 中转服务：注册绑定 GitHub 取 Key，免费版每周 50000 点、每天 100 次请求，国内直连低延迟。
repo: https://github.com/chatanywhere/GPT_API_free
stars: 43505
pushedAt: 2026-09-07
verifiedAt: 2026-10-02
freeType: 限定额度
---
# GPT_API_free —— 国内可直连的 GPT 免费中转

> 引用仓库：[chatanywhere/GPT_API_free](https://github.com/chatanywhere/GPT_API_free) · 43,505 星 · 最近推送 2026-09-07 · 核实于 2026-10-02
>
> 免费类型主基调：**限定额度**

免费的 OpenAI 兼容中转：免费版支持 gpt-3.5-turbo、gpt-4o 系列、gpt-5 系列、deepseek 与 embedding。额度每周 50000 点 + 每天 100 次请求，官方声明持续扩容。

免费类型图例：`永久` = 无需注册直接调用；`需注册` = 需申请 API Key；`限定额度` = 免费层有配额，括号内为额度。

## 接入表单

| API | 分类 | 描述 | 免费类型 | 链接 |
| --- | --- | --- | --- | --- |
| 免费版 API | OpenAI 兼容 | gpt-3.5-turbo / gpt-4o / gpt-5 / deepseek / embedding | 需注册 · 限额(每周50000点+每天100次) | https://chatanywhere.tech |
| 国内中转 Host | 接入端点 | api.chatanywhere.tech（国内低延迟） | 需注册 | https://api.chatanywhere.tech |
| 海外中转 Host | 接入端点 | api.chatanywhere.org（海外用） | 需注册 | https://api.chatanywhere.org |
| 免费 Key 申请 | 取钥 | 注册并绑定 GitHub 账号 | 需注册 | https://chatanywhere.tech |
| OpenAI SDK 接入 | 接入方式 | base_url 换成中转 Host 即可 | 混合 | https://github.com/chatanywhere/GPT_API_free |

## 使用建议

- 完全兼容 OpenAI SDK：只改 base_url 与 api_key。
- 免费版与付费版 Host 相同、模型路由不同；商用建议付费版。
- 该服务已运行多年，但第三方中转存在稳定性与合规风险，敏感数据勿传。
