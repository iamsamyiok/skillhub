---
name: localtunnel-preview
version: 2.0.0
category: 开发工具
tags: [预览, 临时链接, 内网穿透, 隧道, 发布, 国内可用]
description: 把本地网页发布为可公开访问的链接。v2.0 多策略国内可用版:方案A 部署到自有服务器(最快最稳,不过期,推荐) → 方案B Cloudflare 临时隧道 → 方案C localtunnel(仅海外),自动回退+每步外网验证+运营商拦截识别。适用:分享本地项目预览、临时演示页、快速给用户一个可点开的链接。
license: MIT
---

# LocalTunnel Preview Skill (v2.0 国内可用版)

把本地网页发布为可公开访问的链接。**国内网络实测结论:loca.lt 与 trycloudflare.com 均会被运营商 SNI 拦截或 SSL 阻断——自有服务器部署(方案A)是境内唯一稳定路线**,故设为默认首选。

## 使用

```bash
python <本技能>/scripts/preview.py <含index.html的目录> [--port 8899] [--name 子目录名] [--strategy auto|server|cloudflared|localtunnel]
```

- 端口限 8000-9999,本地服务只绑 127.0.0.1(安全规则沿用 v1.x)
- `--strategy auto`(默认)按 server → cloudflared → localtunnel 顺序回退,每步都做外网可达性验证(识别运营商拦截页),验证不过自动换下一策略

## 方案A 自有服务器(推荐,国内秒开)

一次性配置 `~/.localtunnel-preview-server.json`(本文件含服务器信息,不随技能发布):
```json
{"host":"服务器IP","sshport":22,"user":"root","key":"SSH私钥路径",
 "webroot":"/var/www/站点根","baseurl":"http://服务器IP:端口"}
```
之后每次发布 = 逐文件 scp + 外网验证,秒级完成,**不过期**。适合少儿网页这类需要稳定访问的站点。

## 方案B/C 临时隧道(海外或特定网络用)

- cloudflared:自动下载二进制 → trycloudflare.com 随机子域(进程存活期间有效)
- localtunnel:loca.lt 随机子域(同上)。**国内运营商对这两类域名普遍 SNI 拦截**,验证失败会如实报告并建议方案A

## 质量约定

- 每种策略成功后都必须经 `verify()`:HTTP 200 且不含拦截页签名(网页禁止访问/jcloud 等)
- 失败信息如实报告(含策略名与原因),不允许报告一个验证失败的链接
