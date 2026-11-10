#!/usr/bin/env python3
"""aft — agent file transfer：多机智能体间端到端加密传文件（邮箱中转模型）

用法（agent 剧本，双端各一条命令）：
  发送端  transfer.py send  report.pdf --provider github --repo owner/name --token XXX
          → 打印 [aft] OK box=aft-XXXX ... 与 [aft] HINT code=aft-XXXX
  聊天    用户把配对码 aft-XXXX 转告对端用户
  接收端  transfer.py recv aft-XXXX --provider github --repo owner/name --token XXX --out ./

日志锚点（agent 验收依据）：[aft] OK / [aft] BOX / [aft] HINT / [aft] ERR
退出码：0 成功；1 参数/用法；2 通道（网络/box 不存在/不完整）；3 加密校验（配对码错/篡改）
"""
import argparse
import datetime as dt
import json
import os
import platform
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crypto  # noqa: E402
from providers import github as p_github  # noqa: E402
from providers import local as p_local  # noqa: E402
from providers import relay as p_relay  # noqa: E402

CHUNK_DEFAULT = 8 * 1024 * 1024
META_NAME = "box.json"
MANIFEST_NAME = "manifest.bin"


def die(code, msg):
    print(f"[aft] ERR {msg}", file=sys.stderr)
    sys.exit(code)


def parse_size(s):
    s = (s or "").strip().upper()
    mult = 1
    for suf, m in (("K", 1024), ("M", 1024**2), ("G", 1024**3)):
        if s.endswith(suf):
            mult, s = m, s[:-1]
    try:
        n = int(s) * mult
    except ValueError:
        raise ValueError(f"尺寸格式非法: {s!r}（例：8M / 512K）")
    if n <= 0 or n > 512 * 1024**2:
        raise ValueError("分片尺寸需在 (0, 512M] 区间")
    return n


def make_provider(a):
    if a.provider == "github":
        return p_github.Provider(a.repo, a.token)
    if a.provider == "relay":
        return p_relay.Provider(a.endpoint)
    return p_local.Provider(a.dir)


def collect_files(paths):
    """展开文件/目录 → [(posix 相对名, 绝对路径)]，按名排序保证分片号稳定（幂等重发的前提）"""
    out = []
    for p in paths:
        if os.path.isfile(p):
            out.append((os.path.basename(p), os.path.abspath(p)))
        elif os.path.isdir(p):
            base = os.path.abspath(p)
            for root, _dirs, files in os.walk(base):
                for fn in sorted(files):
                    ap = os.path.join(root, fn)
                    rel = os.path.relpath(ap, base).replace(os.sep, "/")
                    out.append((f"{os.path.basename(base)}/{rel}", ap))
        else:
            raise ValueError(f"路径不存在: {p}")
    return sorted(out)


def safe_relpath(name):
    """manifest 属解密后数据，写盘前拒绝绝对路径与 .. 穿越"""
    if name.startswith(("/", "\\")) or ".." in name.split("/"):
        raise ValueError(f"manifest 内含非法路径: {name!r}")
    return name


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def cmd_send(a, prov):
    files = collect_files(a.paths)
    if not files:
        die(1, "没有可发送的文件")
    try:
        code = crypto.normalize_code(a.code) if a.code else crypto.new_code()
    except crypto.CryptoError as e:
        die(1, str(e))
    box = code
    enc, mac, nk = crypto.derive_keys(code, box)
    chunk = parse_size(a.chunk)
    if prov.scheme == "github" and chunk > p_github.SOFT_LIMIT:
        print(f"[aft] HINT 分片 {chunk//1048576}MiB 超 github 舒适区 50MiB（可用但慢）")

    manifest = {"v": 1, "box": box, "kdf": "hkdf-sha256/aes256-ctr/hmac-sha256", "files": []}
    parts_total, bytes_total = 0, 0
    uploads = []  # (name, blob) 延迟到 meta/manifest 之后统一传
    for fi, (name, path) in enumerate(files):
        entry = {"name": name, "size": os.path.getsize(path),
                 "sha256": crypto.sha256_file(path), "parts": []}
        with open(path, "rb") as f:
            pi = 0
            while True:
                plain = f.read(chunk)
                if not plain:
                    break
                blob = crypto.seal(enc, mac, nk, f"{fi}:{pi}", plain)
                pname = f"part-{fi:04d}-{pi:05d}.bin"
                entry["parts"].append({"n": pname, "size": len(blob),
                                       "sha256": crypto.sha256_bytes(blob)})
                uploads.append((pname, blob))
                parts_total += 1
                bytes_total += len(plain)
                pi += 1
        manifest["files"].append(entry)

    meta = {"v": 1, "box": box, "created": now_iso(), "ttl_hours": a.ttl,
            "files": len(files), "parts": parts_total, "total_bytes": bytes_total,
            "sender_host": platform.node(), "note": a.note or ""}
    mlen = len(json.dumps(meta, ensure_ascii=False))
    if mlen > 4096:
        die(1, "--note 过长")

    order = [(META_NAME, json.dumps(meta, ensure_ascii=False).encode()),
             (MANIFEST_NAME, crypto.seal(enc, mac, nk, "manifest",
                                         json.dumps(manifest, ensure_ascii=False).encode()))] + uploads
    try:
        for i, (pname, blob) in enumerate(order, 1):
            prov.put(box, pname, blob)
            if i % 10 == 0 or i == len(order):
                print(f"[aft] PUT {i}/{len(order)} {pname}", file=sys.stderr)
    except (RuntimeError, ValueError) as e:
        die(2, f"上传失败（可带同一配对码重跑 send 续传）: {e}")
    first = manifest["files"][0]
    print(f"[aft] OK box={box} parts={parts_total}/{parts_total} files={len(files)} "
          f"bytes={bytes_total} sha256={first['sha256']}")
    print(f"[aft] HINT code={code} 转告对端用户，由对端 agent 执行："
          f"transfer.py recv {code} --provider {prov.scheme}"
          + (f" --repo {a.repo}" if a.provider == "github" else ""))


def fetch_manifest(code, box, prov):
    raw = prov.get(box, MANIFEST_NAME)
    if raw is None:
        die(2, f"box {box} 缺 manifest（发送端未完成上传？稍后重试）")
    enc, mac, nk = crypto.derive_keys(code, box)
    try:
        plain = crypto.open_(enc, mac, nk, "manifest", raw)
    except crypto.CryptoError:
        die(3, "manifest MAC 校验失败：配对码错误或数据被篡改")
    return json.loads(plain.decode())


def expected_parts(manifest):
    return [p["n"] for fe in manifest["files"] for p in fe["parts"]]


def get_meta(prov, box):
    raw = prov.get(box, META_NAME)
    return json.loads(raw.decode()) if raw else None


def cmd_recv(a, prov):
    try:
        code = crypto.normalize_code(a.code)
    except crypto.CryptoError as e:
        die(1, str(e))
    box = code
    meta = get_meta(prov, box)
    if meta is None:
        die(2, f"box {box} 不存在或已过期")
    manifest = fetch_manifest(code, box, prov)

    present = set(prov.list(box))
    need = expected_parts(manifest)
    missing = [n for n in need if n not in present]
    if missing:
        die(2, f"box 不完整 ({len(need)-len(missing)}/{len(need)})，缺 {missing[0]} 等；"
               f"发送端带同一配对码重跑 send 即续传")

    out_dir = os.path.abspath(a.out or os.path.join("aft-recv", box))
    cache = os.path.join(out_dir, ".aft-cache", box)
    os.makedirs(cache, exist_ok=True)
    enc, mac, nk = crypto.derive_keys(code, box)

    verified = 0
    try:
        for fi, fe in enumerate(manifest["files"]):
            dest = os.path.join(out_dir, safe_relpath(fe["name"]))
            os.makedirs(os.path.dirname(dest) or out_dir, exist_ok=True)
            with open(dest, "wb") as w:
                for i, part in enumerate(fe["parts"]):
                    cp = os.path.join(cache, part["n"])
                    blob = None
                    if os.path.isfile(cp):  # 断点续传：命中缓存先验哈希
                        with open(cp, "rb") as f:
                            blob = f.read()
                        if crypto.sha256_bytes(blob) != part["sha256"]:
                            blob = None
                    if blob is None:
                        blob = prov.get(box, part["n"])
                        if blob is None:
                            die(2, f"分片丢失: {part['n']}")
                        got = crypto.sha256_bytes(blob)
                        if got != part["sha256"]:
                            die(3, f"分片哈希不符 {part['n']}: {got} != {part['sha256']}")
                        with open(cp, "wb") as f:
                            f.write(blob)
                    w.write(crypto.open_(enc, mac, nk, f"{fi}:{i}", blob))
                    verified += 1
            if crypto.sha256_file(dest) != fe["sha256"]:
                die(3, f"整文件校验失败: {fe['name']}")
    except crypto.CryptoError as e:
        die(3, f"解密失败: {e}")
    except (RuntimeError, ValueError) as e:
        die(2, str(e))

    if a.purge:
        try:
            prov.delete(box)
        except RuntimeError as e:
            print(f"[aft] ERR 清理失败（文件已落盘）: {e}", file=sys.stderr)
    print(f"[aft] OK verified={verified}/{len(need)} files={len(manifest['files'])} "
          f"saved={out_dir} sha256={manifest['files'][0]['sha256']}")


def box_summary(prov, box):
    return get_meta(prov, box)


def cmd_status(a, prov):
    if not a.code:
        for b in prov.boxes():
            m = box_summary(prov, b) or {}
            print(f"[aft] BOX {b} files={m.get('files','?')} parts={m.get('parts','?')} "
                  f"bytes={m.get('total_bytes','?')} created={m.get('created','?')} "
                  f"ttl={m.get('ttl_hours','?')}h note={m.get('note','')}")
        return
    code = crypto.normalize_code(a.code)
    m = box_summary(prov, code)
    if not m:
        die(2, f"box {code} 不存在或已过期")
    if prov.get(code, MANIFEST_NAME) is None:
        die(2, f"box {code} 缺 manifest（发送端未完成上传）")
    manifest = fetch_manifest(a.code, code, prov)
    present = set(prov.list(code))
    need = expected_parts(manifest)
    ok = sum(1 for n in need if n in present)
    print(f"[aft] BOX {code} parts={ok}/{len(need)} files={m['files']} "
          f"bytes={m['total_bytes']} created={m['created']} ttl={m['ttl_hours']}h "
          f"sender={m.get('sender_host','?')}")


def cmd_verify(a, prov):
    code = crypto.normalize_code(a.code)
    box = code
    manifest = fetch_manifest(code, box, prov)
    out_dir = os.path.abspath(a.out or os.path.join("aft-recv", box))
    bad = []
    for fe in manifest["files"]:
        p = os.path.join(out_dir, safe_relpath(fe["name"]))
        ok = os.path.isfile(p) and crypto.sha256_file(p) == fe["sha256"]
        if not ok:
            bad.append(fe["name"])
    if bad:
        die(3, f"本地校验失败 {len(bad)} 个: {', '.join(bad[:5])}")
    print(f"[aft] OK verified=local files={len(manifest['files'])} dir={out_dir}")


def cmd_clean(a, prov):
    if a.expired:
        n = 0
        for b in prov.boxes():
            m = box_summary(prov, b)
            if not m:
                continue
            created = dt.datetime.strptime(m["created"], "%Y-%m-%dT%H:%M:%SZ").replace(
                tzinfo=dt.timezone.utc)
            if dt.datetime.now(dt.timezone.utc) > created + dt.timedelta(hours=int(m["ttl_hours"])):
                prov.delete(b)
                n += 1
        print(f"[aft] OK cleaned={n}")
        return
    if not a.code:
        die(1, "clean 需要 box 配对码或 --expired")
    code = crypto.normalize_code(a.code)
    prov.delete(code)
    print(f"[aft] OK cleaned={code}")


def main():
    ap = argparse.ArgumentParser(prog="aft", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--provider", choices=["github", "relay", "local"], default="github")
        p.add_argument("--repo", default=os.environ.get("AFT_REPO", ""),
                       help="github 通道：owner/name（或环境变量 AFT_REPO）")
        p.add_argument("--token", default="", help="github 通道：PAT（或 AFT_TOKEN）")
        p.add_argument("--endpoint", default=os.environ.get("AFT_ENDPOINT", "http://127.0.0.1:7777"),
                       help="relay 通道：http://vps:7777#token")
        p.add_argument("--dir", default=os.environ.get("AFT_DIR", ".aft-store"),
                       help="local 通道：存储根目录")

    s = sub.add_parser("send", help="发送文件/目录 → 建箱上传")
    common(s)
    s.add_argument("paths", nargs="+")
    s.add_argument("--code", default="", help="复用配对码（续传/重发必带同一个）")
    s.add_argument("--ttl", type=int, default=24, help="有效期（小时，默认 24）")
    s.add_argument("--chunk", default="8M")
    s.add_argument("--note", default="", help="备注（明文，≤4KB）")

    r = sub.add_parser("recv", help="接收：码 → 下载校验解密落盘")
    common(r)
    r.add_argument("code")
    r.add_argument("--out", default="")
    r.add_argument("--purge", action="store_true", help="校验通过后即删箱")

    st = sub.add_parser("status", help="列箱 / 看单箱完整性")
    common(st)
    st.add_argument("code", nargs="?")

    v = sub.add_parser("verify", help="本地文件对 manifest 复验")
    common(v)
    v.add_argument("code")
    v.add_argument("--out", default="")

    c = sub.add_parser("clean", help="删箱 / 清全部过期箱")
    common(c)
    c.add_argument("code", nargs="?")
    c.add_argument("--expired", action="store_true")

    a = ap.parse_args()
    prov = make_provider(a)
    {"send": cmd_send, "recv": cmd_recv, "status": cmd_status,
     "verify": cmd_verify, "clean": cmd_clean}[a.cmd](a, prov)


if __name__ == "__main__":
    main()
