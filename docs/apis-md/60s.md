---
name: 60s
version: 1.0.0
category: 中文服务
tags: [免费API, 中文, 热搜, 金价, 自部署]
description: 中文日常数据聚合接口：每天 60 秒看世界、全平台热搜、金价油价、奥运奖牌榜等，无需 Key；公共实例限额，支持 Docker 一键自部署。
repo: https://github.com/vikiboss/60s
stars: 5782
pushedAt: 2026-09-10
verifiedAt: 2026-10-02
freeType: 限定额度
---
# 60s API —— 中文日常数据免费接口

> 引用仓库：[vikiboss/60s](https://github.com/vikiboss/60s) · 5,782 星 · 最近推送 2026-09-10 · 核实于 2026-10-02
>
> 免费类型主基调：**限定额度**

免 Key 即调，公共实例迁移到 Cloudflare Workers 且每日额度有限（生产环境建议自部署：docker run vikiboss/60s）。完整文档在 Apifox（docs.60s-api.viki.moe）。

免费类型图例：`永久` = 无需注册直接调用；`需注册` = 需申请 API Key；`限定额度` = 免费层有配额，括号内为额度。

## 端点表单（精选）

| API | 分类 | 描述 | 免费类型 | 链接 |
| --- | --- | --- | --- | --- |
| 每天 60 秒看世界 | 资讯 | v2/60s 端点，支持文本/图片输出 | 永久(无需Key) | https://60s.viki.moe/v2/60s |
| 热搜聚合 | 社交 | 微博/知乎/B站/抖音/小红书热搜 | 永久(无需Key) | https://docs.60s-api.viki.moe |
| 金价/油价 | 财经 | 实时金价油价查询 | 永久(无需Key) | https://docs.60s-api.viki.moe |
| 奥运奖牌榜 | 体育 | 奖牌榜数据 | 永久(无需Key) | https://docs.60s-api.viki.moe |
| BiliBili 解析 | 多媒体 | B 站视频/音频解析 | 永久(无需Key) | https://docs.60s-api.viki.moe |

## 使用建议

- 调试用主域名 60s.viki.moe；生产自部署：docker run -d -p 4399:4399 vikiboss/60s:latest，即变永久。
- 支持 encoding=text/json/image 多种输出格式。
