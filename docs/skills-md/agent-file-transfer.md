---
name: agent-file-transfer
version: 1.0.0
category: 开发工具
tags: [文件传输, 智能体协作, 端到端加密, 跨机器, GitHub Releases, 中继, 断点续传, 零依赖]
description: 多台电脑的智能体之间端到端加密传文件——发送端 agent 一条命令建箱上传，配对码经聊天转告，接收端 agent 一条命令下载校验解密落盘。当用户说"把这份文件/目录传给另一台电脑的 agent""帮我接收对端 agent 发来的文件""两台机器的智能体怎么交换文件""把这个大文件跨设备发给另一个智能体""用 aft 传一下"时使用。邮箱中转模型（双方只走出站 HTTPS，无需公网入站/SSH 可达），三通道可切换（GitHub 私库 Releases / 自建 relay / 本地回环），AES-256-CTR + HMAC-SHA256 端到端加密（中转只见密文），分片 + sha256 校验 + 幂等续传，纯 Python 标准库零第三方依赖。
slug: agent-file-transfer
displayName: AFT — 智能体间加密文件传输
---

# AFT — 智能体间加密文件传输

## 它解决什么

两台不同电脑上的 agent 要互传文件：沙箱无公网入站、互相 SSH 不可达、网盘要人工介入。
AFT 用**邮箱中转模型**绕开所有约束——双方都只做出站 HTTPS，向一个中转落点写/取加密分块：

```
发送方 agent ──PUT 加密分块──▶ 中转落点(GitHub 私库 / 自建 relay) ◀──GET── 接收方 agent
                     └──── 配对码 aft-XXXXXXXX 经聊天人肉转告 ────┘
```

配对码同时是箱地址与密钥材料（wormhole 模型）：中转运营方拿得到密文拿不到明文。

## 铁律

1. **只做客户端**：AFT 一切操作都是出站 HTTPS 请求；relay-server.py 只部署在用户自己的 VPS，绝不在 agent 沙箱里常驻运行（沙箱不做隧道/中继节点）。
2. **凭据不入库不回显**：token 经 `--token` 或环境变量 `AFT_TOKEN` 传入，任何日志/报错/锚点不出现 token；建议 fine-grained PAT 且只授权单个私有仓库。
3. **端到端加密不可绕过**：所有分片与 manifest 先加密后上箱，明文文件名只存在于加密 manifest 里；box.json 仅含计数与时间。
4. **幂等可续传**：同码重跑 send 产生逐字节相同密文（确定性 nonce），断点续传=带同一配对码重跑；recv 端缓存哈希命中即跳过。
5. **收必校验**：分片 sha256 → 解密 → 整文件 sha256 三级校验全过才打 `[aft] OK verified=k/k`；MAC 失败=码错或被篡改，直接退码。

## 第 1 步：选通道

| 通道 | 适用 | 前置 | 关键参数 |
|---|---|---|---|
| `github`（默认） | 两端都有同一 GitHub 私库凭据 | fine-grained PAT（单仓库 Contents 读写） | `--repo owner/name --token XXX` |
| `relay` | 自控内网/大文件/无 GitHub | 自建 relay-server.py 跑在自己 VPS | `--endpoint http://vps:7777#token` |
| `local` | 单机演示与测试 | 无 | `--dir .aft-store` |

GitHub 通道映射：一箱 = 一个 prerelease（tag=配对码），分片 = release 资产（单资产 2GiB 上限，默认 8MiB/片实践舒适）。环境变量：`AFT_REPO` `AFT_TOKEN` `AFT_ENDPOINT` `AFT_DIR`。

## 第 2 步：agent 剧本（双端各一条命令）

```bash
# 发送端 agent（用户说"把这个传给另一台电脑的 agent"）
python3 scripts/transfer.py send report.pdf bundle/ \
  --provider github --repo yourorg/aft-box --token "$AFT_TOKEN" --chunk 8M
# → [aft] OK box=aft-XXXXXXXX parts=6/6 files=2 bytes=... sha256=...
# → [aft] HINT code=aft-XXXXXXXX 转告对端用户，由对端 agent 执行：...

# 聊天：用户把配对码 aft-XXXXXXXX 告诉对端用户（码即地址+密钥，别走公开频道也行，内容另有 E2E 兜底）

# 接收端 agent（用户说"收到码 aft-XXXXXXXX，帮我接一下"）
python3 scripts/transfer.py recv aft-XXXXXXXX \
  --provider github --repo yourorg/aft-box --token "$AFT_TOKEN" --out ./received --purge
# → [aft] OK verified=6/6 files=2 saved=.../received sha256=...
```

验收就认锚点：`[aft] OK`（send/recv 成功）、`[aft] BOX`（status 列表）、`[aft] ERR`（失败原因）。
退出码：0 成功 / 1 参数 / 2 通道（网络、box 不存在、不完整）/ 3 加密校验（码错、篡改）。

## 第 3 步：运维命令

```bash
python3 scripts/transfer.py status                # 列箱（files/parts/bytes/created/ttl）
python3 scripts/transfer.py status aft-XXXXXXXX   # 单箱完整性 parts=k/M
python3 scripts/transfer.py verify aft-XXXXXXXX --out ./received   # 本地文件对 manifest 复验
python3 scripts/transfer.py clean aft-XXXXXXXX    # 立即删箱
python3 scripts/transfer.py clean --expired       # 清全部过期箱（TTL 默认 24h）
```

relay 通道的 TTL 由服务端清道夫自动执行；github 通道建议接收端 `--purge` 或定期 `clean --expired`。

## 障碍速查

| 症状 | 原因 | 处置 |
|---|---|---|
| `github 401/403` | token 权限不足 | fine-grained PAT 授目标仓库 Contents 读写；classic 需 repo 权限 |
| `box 不存在或已过期` | 码敲错 / 已被 purge / TTL 过期 | 对发送端 `status` 核对箱在不在；码用复制粘贴（含 0/1/I/L/O/U 之外的字符即非法码会直接报） |
| `box 不完整 (k/M)` | 发送端上传中断 | 发送端带**同一配对码**重跑 send（幂等续传），随后接收端重跑 recv |
| `MAC 校验失败` | 配对码错误或 manifest 被篡改 | 先核对码；码对仍报=通道被动手脚，弃箱换通道 |
| `分片哈希不符` | 传输损坏或被篡改 | 重跑 recv（缓存自动失效重下）；反复失败弃箱 |
| 单片超 2GiB | github 资产上限 | `--chunk` 调小；或换 relay 通道（服务端 `--max-body` 自定） |
| 429/慢 | github API 频率限制 | 加大 `--chunk` 减少请求数；或换 relay 通道 |

## Resources

- `scripts/transfer.py` — 统一 CLI（send/recv/status/verify/clean）
- `scripts/crypto.py` — HKDF 派生 + AES-256-CTR + HMAC encrypt-then-MAC（openssl 流程）
- `scripts/providers/{github,relay,local}.py` — 三通道（六操作同契约：put/get/list/delete/boxes）
- `scripts/relay-server.py` — 自建中转服务端（部署 VPS，TTL 清道夫 + 可选 token 鉴权）
- `references/protocol.md` — 线格式/箱布局/通道契约/退出码
- `references/security.md` — 威胁模型与加密构造说明
- `test/run-tests.js` — 15 项回环回归（篡改/错码/续传/幂等/清箱），期望 ALL_PASS

## 边界

- 传的是文件与目录，做的是"可靠的加密投递"；实时同步、断点目录镜像、P2P 直连不在范围
- 沙箱内 AFT 永远是出站客户端；要长驻服务请把 relay-server.py 放到自己的服务器
- 单箱软上限：github 通道按 release 资产 2GiB/片与频率舒适区设计，超大文件走 relay
