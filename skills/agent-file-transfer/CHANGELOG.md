# 更新日志

## 1.0.0 - 2026-11-09

首版：多台电脑的智能体之间端到端加密传文件（邮箱中转模型，双方只走出站 HTTPS）

- `scripts/transfer.py` 统一 CLI：send / recv / status / verify / clean；日志锚点
  `[aft] OK|BOX|HINT|ERR` 与退出码契约（0 成功 / 1 参数 / 2 通道 / 3 加密校验）
- `scripts/crypto.py`：HKDF-SHA256 派生（配对码+box id → enc/mac/nonce 三钥）+
  AES-256-CTR + HMAC-SHA256 encrypt-then-MAC（openssl CLI，纯标准库零依赖）；
  确定性 nonce 支撑幂等重发与断点续传
- 三通道 provider（六操作同契约 put/get/list/delete/boxes）：
  `github.py`（私库 Releases：一箱一 prerelease、分片即资产、幂等跳过、删箱清 tag）、
  `relay.py`（自建 REST 中转客户端）、`local.py`（目录回环，测试/演示）
- `scripts/relay-server.py`：自建中转服务端（原子落盘、TTL 清道夫、可选 token 鉴权、
  --max-body 上限）；部署于用户 VPS，沙箱内永远只跑客户端
- 分片（默认 8MiB）+ 双层校验（分片密文 sha256 → 整文件明文 sha256）+ 接收端缓存续传；
  box.json 明文仅计数元信息，文件名藏在加密 manifest 里
- `test/run-tests.js` 15 项回环回归：往返字节一致 / 错码 / manifest 篡改 / 分片篡改 /
  幂等重发 / 断点续传 / 缺片对账 / 补齐 / 清箱，期望 ALL_PASS
- 手册：`references/protocol.md`（线格式与通道契约）、`references/security.md`（威胁模型与构造理由）
