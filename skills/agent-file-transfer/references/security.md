# aft 安全模型

## 威胁模型

| 角色 | 能力 | AFT 的应对 |
|---|---|---|
| 中转运营方（GitHub / VPS 管理员） | 看到全部密文、箱元信息（数量/大小/时间/note 明文） | 端到端加密：拿不到文件名与内容；box.json 无敏感字段 |
| 被动窃听者（聊天渠道泄漏配对码） | 知道码即能下载密文 | 码=密钥材料，E2E 加密下码本身不泄内容；TTL 24h + 接收即 purge 收窄窗口 |
| 主动篡改者（改中转上的分片/manifest） | 替换、拼接、重放密文块 | 每片 encrypt-then-MAC（tag 覆盖 nonce‖ct）+ manifest 自身加密带 MAC + nonce-label 绑定（拼接错位即失败） |
| 暴力猜测箱号 | 枚举 box id 下载密文 | 码 40 bit 熵（Crockford 32 符号 8 位），github/relay 可枚举但解密仍需 HKDF 正确；速率限制与 TTL 再收窄 |
| 本地残留 | 缓存/接收目录被翻 | 缓存的是密文分片；明文按用户 `--out` 落盘即用户领地；`clean` 一键清箱 |

明确不防御：发送端自己泄露明文；配对码与文件同时出现在同一泄漏面；端点被完全攻陷（agent 进程被控）。

## 密码学构造（aft-v1）

```
ikm  = 配对码（大写规范化，"aft-"+8×Crockford 字母表）
salt = box id
OKM  = HKDF-SHA256(ikm, salt, info="aft-v1", L=96)
       ├─ enc_key[0:32]   AES-256-CTR（openssl enc CLI 流式加解密）
       ├─ mac_key[32:64]  HMAC-SHA256，tag=MAC(nonce‖ct)，截 32B
       └─ nonce_key[64:96] 分片 nonce = HMAC(nonce_key, label)[:16]
```

选型理由：

- **AES-256-CTR + HMAC-SHA256（EtM）** 而非 AES-GCM：Python 标准库无 AES，openssl CLI 的
  `enc` 不支持 GCM 的 tag 传递；CTR+HMAC 是经典成熟组合（TLS 1.2 套件同思路），openssl
  到处可得，实现零第三方依赖。
- **确定性 nonce**：同一 (box,label) 恒定 nonce。CTR 模式 nonce 重用是致命的——这里通过
  "同一密钥只存在于一个箱内 + label 全箱唯一（文件号:分片号 / manifest）"保证唯一性，
  换来幂等重发与断点续传（同码同输入=逐字节相同密文）。nonce-label 绑定校验再防拼接重放。
- **HKDF 而非直接哈希码**：salt=box id 把密钥绑死到具体箱，跨箱不通用；info 版本化
  （aft-v1）为将来算法升级留路。
- **40 bit 码 + E2E 分层**：码同时是地址与密钥。地址层面的可枚举由中转侧速率/TTL 兜底；
  密钥层面暴力 40 bit 在线不可行（每次猜测都是一次 API 调用），离线不可行（先要拿到密文）。

## 凭据卫生

- token 只经 `--token` 或环境变量（`AFT_TOKEN`/`AFT_GH_TOKEN`）进入进程；所有日志、锚点、
  异常文本不回显 token；urllib 报错剥认证头
- GitHub 建议 fine-grained PAT、只授单个私有传输仓库的 Contents 读写、短有效期
- relay 的 `AFT_RELAY_TOKEN` 是通道鉴权（防匿名写入），与端到端加密相互独立、各配各的

## 运维建议

- 敏感投递：`--ttl` 调短（如 1h）+ 接收端 `--purge`
- 传输仓库保持 private；relay 只绑内网/加 token + TLS 反代
- 收发双方核对 `[aft] OK ... sha256=...` 与预期文件哈希一致再采信
