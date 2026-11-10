# aft 协议（v1）— 线格式 / 箱布局 / 通道契约

## 总览

```
发送端                                     中转落点                          接收端
send ──加密──▶ box.json + manifest.bin + part-*.bin ──▶ status/recv ◀── 下载校验解密
       配对码 aft-XXXXXXXX 经聊天渠道转告（码=箱地址=密钥材料）
```

## 箱内对象（与通道无关的统一布局）

| 名 | 内容 | 加密 |
|---|---|---|
| `box.json` | `{v, box, created(UTC ISO), ttl_hours, files, parts, total_bytes, sender_host, note}` | 明文（仅计数与元信息，无文件名） |
| `manifest.bin` | `{v, box, kdf:"hkdf-sha256/aes256-ctr/hmac-sha256", files:[{name, size, sha256, parts:[{n,size,sha256}]}]}` | 加密（label=`manifest`） |
| `part-{fi:04d}-{pi:05d}.bin` | 密文块 `nonce(16)‖ct‖tag(32)`，label=`"{fi}:{pi}"` | 加密 |

命名约束：box id 与分片名均匹配 `^[A-Za-z0-9._-]{1,64}$`（所有 provider 强制，防路径穿越）。
`name`（逻辑文件名）为 posix 相对路径，可含子目录与 unicode；接收端拒绝绝对路径与 `..`。

## 密文与密钥

- ikm=配对码（大写规范化）, salt=box id, info=`aft-v1`
- HKDF-SHA256 输出 96B：enc_key[32] / mac_key[32] / nonce_key[32]
- 每分片 nonce = HMAC-SHA256(nonce_key, label)[:16] —— **确定性**：同码同输入永远产出相同密文（幂等重发与续传的前提），nonce 唯一性由 label 唯一性保证（同一密钥只活在一个箱内）
- tag = HMAC-SHA256(mac_key, nonce‖ct)（encrypt-then-MAC），解密前先验 tag 与 nonce-label 一致性

## 通道契约（六操作）

任何通道只需实现：`put(box,name,data)` `get(box,name)` `list(box)` `delete(box)` `boxes()`，
外加 `box.json` 就是普通对象。语义要求：

- put 幂等（同名覆盖为原子写，读端看不到半块）
- get 对不存在的 box/name 返回 None（不抛异常）
- list 返回稳定排序的分片名
- delete 删整箱

### github 映射

一箱 = 一个 prerelease（tag=box id）；对象 = release 资产；boxes = prerelease tag 前缀 `aft-` 过滤。
删除 = DELETE release + DELETE `git/refs/tags/{box}`（防 tag 残留撞 422）。
幂等 = 同名资产同尺寸跳过，尺寸不同先删再传。
上限：单资产 2GiB 硬限；实践舒适区 ≤50MiB/片（JSON 请求体通道）。

### relay 映射（REST）

```
PUT    /box/{box}/{name}     raw body 上传
GET    /box/{box}/{name}     200 bytes / 404
GET    /box/{box}            {"names":[...]}
GET    /boxes                {"boxes":[...]}
DELETE /box/{box}            删整箱
鉴权头   X-Auth-Token: <token>（endpoint 写法 http://vps:7777#token）
```

服务端（relay-server.py）：原子落盘（.tmp + rename）、TTL 清道夫（5 分钟扫 box.json）、
`--max-body` 单片上限、`AFT_RELAY_TOKEN` 环境变量开关鉴权。

### local 映射

`{root}/box/{box}/{name}` 目录树；同 relay 语义，测试与单机演示用。

## 传输流程

### send

1. 展开路径 → 按 posix 相对名排序（分片号稳定的前提）
2. 逐文件切块（默认 8MiB）→ seal → 记录密文 sha256
3. 上传顺序：box.json → manifest.bin → 全部 part（meta 先行，status 早早可用）
4. 锚点 `[aft] OK box=... parts=k/k files=f bytes=B sha256=<首文件哈希>` + `[aft] HINT code=...`

中断续传：带**同一配对码**重跑 send——确定性密文保证逐字节复现，已存在同名同尺寸分片自动跳过。

### recv

1. box.json 存在性 → manifest 下载 + MAC 验证（失败退 3）
2. `list` 对账：缺片退 2（附缺口，发送端重发即补）
3. 逐片下载 → 密文 sha256 校验 → 缓存到 `{out}/.aft-cache/{box}/`（重跑 recv 命中缓存先验哈希，坏缓存自动重下）
4. 解密拼装 → 整文件 sha256 校验 → 落盘
5. `--purge` 时校验通过后删箱
6. 锚点 `[aft] OK verified=k/k files=f saved=... sha256=...`

### status / verify / clean

- status 无码：列全部箱摘要；带码：manifest 对账 `parts=k/M`
- verify：本地目录对 manifest 复验（重算 sha256），不碰通道
- clean：删单箱或按 box.json 的 `created+ttl_hours` 清过期

## 退出码与锚点（agent 验收契约）

| 码 | 含义 | 典型锚点 |
|---|---|---|
| 0 | 成功 | `[aft] OK ...` `[aft] BOX ...` |
| 1 | 参数/用法 | `[aft] ERR 非法配对码` 等 |
| 2 | 通道：网络/不存在/不完整 | `[aft] ERR box ... 不存在` `[aft] ERR box 不完整 (k/M)` |
| 3 | 加密校验：码错/篡改 | `[aft] ERR ... MAC 校验失败` `[aft] ERR 分片哈希不符` |

## 尺寸与频率预算

- 默认 8MiB/片：github 舒适（≤50MiB），100MB 文件 ≈ 13 片 = 13 次 PUT
- 单文件 >2GiB：github 硬限拦截，改 `--chunk` 更小无效（片数更多但单片仍可能超限时），走 relay
- 频率：github 无认证 60 req/h、PAT 5000 req/h——AFT 全程带 PAT，常规投递远够
