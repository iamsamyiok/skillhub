#!/usr/bin/env python3
"""aft crypto — 端到端加密原语（纯标准库 + openssl CLI，零第三方依赖）

构造（aft-v1）：
  ikm  = 配对码（大写规范化）
  salt = box id（"aft-XXXXXXXX"）
  HKDF-SHA256(ikm, salt, info="aft-v1", L=96) 派生 96 字节：
    [ 0:32)  enc_key    AES-256-CTR 密钥
    [ 32:64) mac_key    HMAC-SHA256（对 nonce||ct 做 encrypt-then-MAC）
    [64:96)  nonce_key  分片确定性 nonce 派生：HMAC(nonce_key, label)[:16]

密文块布局：nonce(16) || ciphertext || tag(32)

确定性 nonce 设计：同一 (box, label) 永远得到同一 nonce——
  1) 重发同一分片产生逐字节相同的密文 → 上传天然幂等（断点续传=带同一配对码重跑 send）
  2) nonce 唯一性由 label 唯一性保证（同一密钥只活在一个 box 内，label 含文件号:分片号）
"""
import hashlib
import hmac
import secrets
import subprocess

ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford 风格：去掉 0/1/I/L/O/U，口头转述零歧义
INFO = b"aft-v1"


class CryptoError(Exception):
    pass


def hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int) -> bytes:
    """RFC 5869 HKDF（extract + expand），stdlib hmac 实现"""
    prk = hmac.new(b"\x00" * 32 if not salt else salt, ikm, hashlib.sha256).digest()
    out, t, i = b"", b"", 1
    while len(out) < length:
        t = hmac.new(prk, t + info + bytes([i]), hashlib.sha256).digest()
        out += t
        i += 1
    return out[:length]


def new_code(n=8) -> str:
    """一次性配对码：aft-XXXXXXXX（~40 bit 熵；内容另有端到端加密兜底）"""
    return "aft-" + "".join(secrets.choice(ALPHABET) for _ in range(n))


def normalize_code(code: str) -> str:
    c = (code or "").strip().upper()
    body = c[4:] if c.startswith("AFT-") else c
    if not body or any(ch not in ALPHABET for ch in body):
        raise CryptoError(f"非法配对码（只允许 {ALPHABET}，不含 0/1/I/L/O/U）：{code!r}")
    return "aft-" + body


def derive_keys(code: str, box: str):
    """配对码 + box id → (enc_key, mac_key, nonce_key)"""
    mat = hkdf_sha256(normalize_code(code).encode(), box.encode(), INFO, 96)
    return mat[0:32], mat[32:64], mat[64:96]


def part_nonce(nonce_key: bytes, label: str) -> bytes:
    return hmac.new(nonce_key, label.encode(), hashlib.sha256).digest()[:16]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def _openssl(args, data: bytes) -> bytes:
    try:
        r = subprocess.run(["openssl", "enc", *args], input=data,
                           capture_output=True, check=False)
    except FileNotFoundError:
        raise CryptoError("openssl 不可用（本构造依赖系统 openssl）")
    if r.returncode != 0:
        raise CryptoError(f"openssl 失败: {r.stderr.decode(errors='replace').strip()[:200]}")
    return r.stdout


def seal(enc_key, mac_key, nonce_key, label: str, plaintext: bytes) -> bytes:
    """明文 → nonce||ct||tag（分片为内存块，≤8MiB 量级）"""
    nonce = part_nonce(nonce_key, label)
    ct = _openssl(["-aes-256-ctr", "-K", enc_key.hex(), "-iv", nonce.hex()], plaintext)
    tag = hmac.new(mac_key, nonce + ct, hashlib.sha256).digest()
    return nonce + ct + tag


def open_(enc_key, mac_key, nonce_key, label: str, blob: bytes) -> bytes:
    """校验 tag 后解密；tag 不符 = 配对码错误或密文被篡改"""
    if len(blob) < 16 + 32:
        raise CryptoError(f"密文块过短 ({len(blob)}B)")
    nonce, ct, tag = blob[:16], blob[16:-32], blob[-32:]
    # 确定性 nonce 与携带 nonce 必须一致（防搬运拼接）
    if not hmac.compare_digest(nonce, part_nonce(nonce_key, label)):
        raise CryptoError("nonce 与 label 不匹配（分片错位或被拼接）")
    if not hmac.compare_digest(tag, hmac.new(mac_key, nonce + ct, hashlib.sha256).digest()):
        raise CryptoError("MAC 校验失败：配对码错误或密文被篡改")
    return _openssl(["-d", "-aes-256-ctr", "-K", enc_key.hex(), "-iv", nonce.hex()], ct)
