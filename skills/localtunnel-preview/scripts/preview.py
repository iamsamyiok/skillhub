#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""preview.py — localtunnel-preview v2.1:国内可用的本地预览发布器
四策略自动回退(按国内可用性排序):
  A. server      tar管道单连接上传到自有服务器(需 ~/.localtunnel-preview-server.json) — 最快最稳
                 支持 --ttl 定时自动清理(如 5m/1h),不带则不过期
  B. bore        自建 bore 隧道(服务器跑 bore server,本机动态服务穿透) — localtunnel 体验的真正等价物
  C. cloudflared Cloudflare 快速隧道(trycloudflare.com) — 国内多数网络被拦
  D. localtunnel 原版(loca.lt) — 国内被拦,仅海外可用
所有策略成功后输出二维码(终端 UTF-8),手机扫码直达。

用法: python preview.py <含index.html的目录> [--port 8899] [--name x] [--ttl 5m]
      [--strategy auto|server|bore|cloudflared|localtunnel]
安全规则沿用 v1.x: 端口限 8000-9999,服务只绑 127.0.0.1,进程由当前用户启动。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HOME = Path.home()
SKILL_DIR = Path(__file__).resolve().parent
CFG_PATH = HOME / ".localtunnel-preview-server.json"
BLOCK_SIGNS = ("网页禁止访问", "jcloud", "illegality", "防火墙", "拦截")


def fetch(url, timeout=12, extra=None):
    headers = {"User-Agent": "Mozilla/5.0", "bypass-tunnel-reminder": "true"}
    headers.update(extra or {})
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(65536).decode("utf-8", "replace")
    except Exception as e:
        return -1, str(e)


def is_blocked(body):
    return any(s in body for s in BLOCK_SIGNS)


def verify(url):
    status, body = fetch(url)
    ok = status == 200 and not is_blocked(body)
    return ok, status, body


def start_server(port, root):
    root = Path(root).resolve()
    if not (root / "index.html").exists():
        raise RuntimeError("目录里没有 index.html: %s" % root)
    return subprocess.Popen([sys.executable, "-m", "http.server", str(port),
                             "--bind", "127.0.0.1", "-d", str(root)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _ttl_seconds(ttl):
    if not ttl:
        return 0
    m = re.fullmatch(r"(\d+)([smhd])", ttl.strip())
    if not m:
        raise ValueError("--ttl 格式: 数字+单位(s/m/h/d),如 5m 1h 2d")
    return int(m.group(1)) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[m.group(2)]


def _qrcode_text(url):
    """纯 Python 二维码(qrcode 库可选;无库时跳过)"""
    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
        return True
    except Exception:
        return False


def strat_server(source, name, ttl=None):
    if not CFG_PATH.exists():
        return None, "未找到 %s(方案A不可用)" % CFG_PATH.name
    cfg = json.loads(CFG_PATH.read_text(encoding="utf-8"))
    host, sshport, user = cfg["host"], cfg.get("sshport", 22), cfg["user"]
    key, webroot, base = cfg.get("key"), cfg["webroot"], cfg["baseurl"]
    ssh = ["ssh", "-p", str(sshport), "-o", "ConnectTimeout=20"]
    if key:
        ssh += ["-i", key]
    ssh += ["%s@%s" % (user, host)]
    dest = "%s/%s" % (webroot.rstrip("/"), name)

    # tar 管道单连接上传(Windows 无 rsync;增量靠 tar 覆盖+服务器端清理旧目录)
    src = Path(source).resolve()
    if not (src / "index.html").exists():
        return None, "目录里没有 index.html: %s" % src
    tsec = _ttl_seconds(ttl)
    if tsec:
        r = subprocess.run(ssh + ["rm -rf %s" % dest], capture_output=True, text=True)
        if r.returncode != 0:
            return None, "ssh 清理旧目录失败: " + r.stderr[:150]
    r = subprocess.run(ssh + ["mkdir -p %s" % dest], capture_output=True, text=True)
    if r.returncode != 0:
        return None, "ssh mkdir 失败: " + r.stderr[:150]
    tar = subprocess.Popen(["tar", "-cf", "-", "-C", str(src), "."], stdout=subprocess.PIPE)
    r = subprocess.run(ssh + ["tar -xf - -C %s" % dest], stdin=tar.stdout,
                       capture_output=True, text=True)
    tar.stdout.close()
    tar.wait()
    if r.returncode != 0:
        return None, "tar 上传失败: " + (r.stderr or r.stdout)[:150]
    n = sum(1 for f in src.rglob("*") if f.is_file())

    if tsec:
        # 服务器端定时清理(systemd-run 一次性定时器,随 systemd 存活)
        r = subprocess.run(ssh + ["systemd-run --on-active=%d rm -rf %s" % (tsec, dest)],
                           capture_output=True, text=True)
        ttl_note = ",%s 后自动清理%s" % (ttl, "" if r.returncode == 0 else "(清理定时器创建失败!)")
    else:
        ttl_note = ",不过期"

    url = "%s/%s/" % (base.rstrip("/"), name)
    ok, status, body = verify(url)
    if not ok:
        return None, "已部署但外网验证失败(status=%s)" % status
    return url, "自有服务器部署 ✓(%d 文件%s)" % (n, ttl_note)


def ensure_cloudflared():
    exe = SKILL_DIR / "bin" / ("cloudflared.exe" if os.name == "nt" else "cloudflared")
    if exe.exists():
        return exe
    exe.parent.mkdir(parents=True, exist_ok=True)
    url = ("https://github.com/cloudflare/cloudflared/releases/latest/download/"
           + ("cloudflared-windows-amd64.exe" if os.name == "nt" else "cloudflared-linux-amd64"))
    print("  ↓ 下载 cloudflared(约16MB)…", flush=True)
    urllib.request.urlretrieve(url, exe)
    if os.name != "nt":
        os.chmod(exe, 0o755)
    return exe




def _server_cfg():
    if not CFG_PATH.exists():
        return None
    return json.loads(CFG_PATH.read_text(encoding="utf-8"))


def strat_bore(port, name=None):
    """自建 bore 隧道: 服务器跑 bore server(常驻), 本机 bore local 打洞。
    适合动态服务(Flask/Node 调试)——流量从本机实时转发,而非静态拷贝。"""
    cfg = _server_cfg()
    if not cfg:
        return None, "未找到 %s(bore 方案不可用)" % CFG_PATH.name
    host, sshport, user, key = cfg["host"], cfg.get("sshport", 22), cfg["user"], cfg.get("key")
    ssh = ["ssh", "-p", str(sshport), "-o", "ConnectTimeout=20"]
    if key:
        ssh += ["-i", key]
    ssh += ["%s@%s" % (user, host)]
    r = subprocess.run(ssh + ["systemctl is-active bore-server"], capture_output=True, text=True)
    if "active" not in r.stdout:
        return None, "服务器上 bore-server 服务未运行(先在服务器上安装: 见 SKILL.md 方案B)"
    exe = SKILL_DIR / "bin" / ("bore.exe" if os.name == "nt" else "bore")
    if not exe.exists():
        exe.parent.mkdir(parents=True, exist_ok=True)
        rel = "releases/download/v0.5.0/bore-v0.5.0-x86_64-pc-windows-msvc.zip" if os.name == "nt"             else "releases/download/v0.5.0/bore-v0.5.0-x86_64-unknown-linux-musl.tar.gz"
        url = "https://github.com/ekzhang/bore/" + rel
        print("  ↓ 下载 bore CLI…", flush=True)
        tmp = str(exe) + ".dl"
        try:
            urllib.request.urlretrieve(url, tmp)
            if tmp.endswith(".zip"):
                import zipfile
                z = zipfile.ZipFile(tmp)
                inner = [i for i in z.namelist() if i.lower().endswith(".exe")][0]
                with z.open(inner) as f, open(exe, "wb") as o:
                    o.write(f.read())
            else:
                import tarfile
                t = tarfile.open(tmp)
                inner = [i for i in t.getnames() if i.endswith("/bore")][0]
                t.extract(inner, str(exe.parent))
                os.replace(exe.parent / inner, exe)
                os.chmod(exe, 0o755)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    # 远端固定端口 = 10000 + 本地port,便于记忆
    rport = 10000 + port
    proc = subprocess.Popen([str(exe), "local", str(port), "--to", host, "--port", str(rport)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    if proc.poll() is not None:
        return None, "bore local 启动即退出(检查服务器 bore-server 端口 %d)" % rport
    base = cfg["baseurl"].rstrip("/")
    url = "http://%s:%d/" % (host, rport)
    ok, status, body = verify(url)
    if not ok:
        proc.kill()
        return None, "隧道已建立但服务器端口 %d 未放行(安全组需开放该端口)" % rport
    return url, "bore 隧道 ✓(本机动态服务穿透,本脚本退出即断)"



def strat_cloudflared(port):
    try:
        exe = ensure_cloudflared()
    except Exception as e:
        return None, "cloudflared 下载失败: " + str(e)
    proc = subprocess.Popen([str(exe), "tunnel", "--url", "http://127.0.0.1:%d" % port],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    url = None
    deadline = time.time() + 30
    buf = []
    while time.time() < deadline:
        line = proc.stderr.readline()
        if not line and proc.poll() is not None:
            break
        buf.append(line)
        m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
        if m:
            url = m.group(0)
            break
    if not url:
        proc.kill()
        return None, "cloudflared 30秒内未给出隧道链接"
    ok, status, body = verify(url)
    if not ok:
        proc.kill()
        return None, "隧道已建立(%s)但外网验证失败 status=%s" % (url, status)
    return url, "Cloudflare 临时隧道 ✓(进程存活期间有效)"


def strat_localtunnel(port):
    r = subprocess.run(["npx", "--yes", "localtunnel", "--port", str(port)],
                       capture_output=True, text=True, timeout=60)
    m = re.search(r"https://[a-z0-9-]+\.loca\.lt", r.stdout + r.stderr)
    if not m:
        return None, "localtunnel 未给出链接"
    url = m.group(0)
    ok, status, body = verify(url)
    if not ok:
        return url, "localtunnel 已建立但当前网络被运营商拦截(loca.lt 国内不可用)"
    return url, "localtunnel ✓"


def main():
    ap = argparse.ArgumentParser(description="国内可用的本地预览发布器(v2.0 多策略)")
    ap.add_argument("source", help="含 index.html 的目录")
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--name", default=None, help="远端子目录名(默认取目录名)")
    ap.add_argument("--strategy", default="auto",
                    choices=["auto", "server", "bore", "cloudflared", "localtunnel"])
    ap.add_argument("--ttl", default=None, help="server 方案: 自动清理时限,如 5m/1h/2d;缺省不过期")
    a = ap.parse_args()
    if not (8000 <= a.port <= 9999):
        print("✗ 端口必须在 8000-9999(安全规则)"); sys.exit(1)
    name = a.name or Path(a.source).resolve().name
    server = start_server(a.port, a.source)
    time.sleep(1.5)
    print("本地服务 127.0.0.1:%d ✓ (目录 %s)" % (a.port, a.source), flush=True)
    try:
        order = [a.strategy] if a.strategy != "auto" else ["server", "bore", "cloudflared", "localtunnel"]
        for strat in order:
            print("[%s] 尝试中…" % strat, flush=True)
            try:
                if strat == "server":
                    url, note = strat_server(a.source, name, ttl=a.ttl)
                elif strat == "bore":
                    url, note = strat_bore(a.port, name)
                elif strat == "cloudflared":
                    url, note = strat_cloudflared(a.port)
                else:
                    url, note = strat_localtunnel(a.port)
            except Exception as e:
                url, note = None, "异常: " + str(e)
            if url:
                ok, _s, _b = verify(url)
                if ok:
                    print("\n✅ 发布成功[%s]\n🔗 %s\nℹ %s" % (strat, url, note), flush=True)
                    return
                print("[%s] 验证失败: %s" % (strat, note), flush=True)
            else:
                print("[%s] %s" % (strat, note), flush=True)
        print("\n✗ 所有策略均失败——国内环境建议配置方案A(自有服务器): %s" % CFG_PATH, flush=True)
        sys.exit(1)
    finally:
        pass  # 服务进程交由调用方/会话管理;隧道进程随本脚本退出而结束


if __name__ == "__main__":
    main()
