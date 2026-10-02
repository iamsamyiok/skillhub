---
name: ip-info-api
version: 1.0.0
category: 网络与 IP
tags: [免费API, IP查询, 归属地, 失效标注]
description: 免费 IP 信息查询 API 合集：聚合 20+ 个本机 IP 与 IP 归属地查询端点，逐个标注可用性（已失效的明确标出），支持多语言。
repo: https://github.com/ihmily/ip-info-api
stars: 1546
pushedAt: 2026-09-29
verifiedAt: 2026-10-02
freeType: 永久
---
# ip-info-api —— 免费 IP 查询接口合集（带失效标注）

> 引用仓库：[ihmily/ip-info-api](https://github.com/ihmily/ip-info-api) · 1,546 星 · 最近推送 2026-09-29 · 核实于 2026-10-02
>
> 免费类型主基调：**永久**

难得的"负责任"合集：README 明确标出哪些端点已失效（如 ip.cn、api.vore.top），并对每个端点给出返回示例。下表为核实仍可用的端点精选。

免费类型图例：`永久` = 无需注册直接调用；`需注册` = 需申请 API Key；`限定额度` = 免费层有配额，括号内为额度。

## 可用端点表单

| API | 分类 | 描述 | 免费类型 | 链接 |
| --- | --- | --- | --- | --- |
| whois.pconline.com.cn | IP 归属 | 太平洋 IP 库（中文） | 永久 | https://whois.pconline.com.cn/ipJson.jsp |
| api.ip.sb/geoip | IP 归属 | IPSB 地理位置查询 | 永久 | https://api.ip.sb/geoip |
| realip.cc | 本机 IP | 返回本机公网 IP 与归属 | 永久 | https://realip.cc |
| ip-api.com | IP 归属 | 老牌 IP 库（免费层 HTTP） | 限定额度(45次/分 · 仅HTTP) | http://ip-api.com/json/ |
| ipapi.co | IP 归属 | REST 风格 IP 查询 | 限定额度(1000次/天) | https://ipapi.co/json/ |
| api.ip2location.io | IP 归属 | IP2Location 精确库 | 需注册 · 限额(30000次/月) | https://api.ip2location.io |
| demo.ip-api.com | IP 归属 | ip-api 演示端点 | 永久(演示数据) | http://demo.ip-api.com/json/ |

## 使用建议

- 原文按"查询本机 IP / 通过 IP 反查"两类组织，附 curl 示例与返回 JSON 样例。
- ip-api.com 免费层仅 HTTP；HTTPS 需付费，前端直连场景选 ipapi.co 或 ip.sb。
