---
name: public-apis-marcelscruz
version: 1.0.0
category: 综合合集
tags: [免费API, 综合合集, Auth标注, CORS标注]
description: 社区协作维护的 public APIs 列表，每条标注 Auth 与 CORS，配套 resources.json 结构化数据与自动同步机制。
repo: https://github.com/marcelscruz/public-apis
stars: 9533
pushedAt: 2026-10-02
verifiedAt: 2026-10-02
freeType: 混合
---
# public-apis（marcelscruz）—— 带资源同步的社区列表

> 引用仓库：[marcelscruz/public-apis](https://github.com/marcelscruz/public-apis) · 9,533 星 · 最近推送 2026-10-02 · 核实于 2026-10-02
>
> 免费类型主基调：**混合**

特点：条目带 Auth（No/apiKey/OAuth）与 CORS 两列，且维护 resources.json 机器可读数据，适合脚本化消费。精选 16 条。

免费类型图例：`永久` = 无需注册直接调用；`需注册` = 需申请 API Key；`限定额度` = 免费层有配额，括号内为额度。

## 分类导航（52 类 / 1804 条）

Development(184)、Government(96)、Geocoding(94)、Games & Comics(92)、Finance(88)、Transportation(71)、Cryptocurrency(68)、Documents & Productivity(59)、Video(59)、Sports & Fitness(51)、Security(49)、Social(49)、AI(46)、Open Data(46) 等 52 类

## 精选 API 表单（16 条）

| API | 分类 | 描述 | 免费类型 | 链接 |
| --- | --- | --- | --- | --- |
| Cat Facts | Animals | 随机猫知识（免注册） | 永久 | https://catfact.ninja |
| PokéAPI | Anime | 宝可梦数据与图片 | 永久 | https://pokeapi.co |
| Harry Potter | Books | 哈利波特 spells/characters | 永久 | https://hp-api.onrender.com |
| Open Library | Books | 开放图书库 | 永久 | https://openlibrary.org |
| Frankfurter | Currency Exchange | 汇率换算 | 永久 | https://frankfurter.app |
| CoinGecko | Cryptocurrency | 加密货币行情 | 永久 | https://www.coingecko.com |
| IPify | Development | 公网 IP 查询 | 永久 | https://www.ipify.org |
| IPinfo | Development | IP 归属地 | 永久 · 限额(50000次/月) | https://ipinfo.io |
| Nominatim | Geocoding | 地理编码 | 限定额度(1次/秒) | https://nominatim.openstreetmap.org |
| REST Countries | Geocoding | 国家信息 | 永久 | https://restcountries.com |
| Zippopotam.us | Geocoding | 邮编查地名 | 永久 | https://www.zippopotam.us |
| NASA | Science & Math | NASA 开放数据 | 永久(部分接口) | https://api.nasa.gov |
| Wikipedia | Open Data | 维基百科 | 永久 | https://api.wikimedia.org |
| Giphy | Photography | GIF 图库 | 需注册 | https://developers.giphy.com |
| Pexels | Photography | 免费图库视频 | 需注册 · 限额(200次/时) | https://www.pexels.com/api/ |
| Unsplash | Photography | 高清摄影图库 | 需注册 · 限额(50次/时) | https://unsplash.com/developers |

## 使用建议

- resources.json 在仓库根目录，含全部条目可直接解析。
- CORS 列对浏览器直连场景最有用，Unknown 值需自测。
