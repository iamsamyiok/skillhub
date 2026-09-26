#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""preview.py — localtunnel-preview v2.0:国内可用的本地预览发布器
三策略自动回退(按国内可用性排序):
  A. server      部署到自有服务器(需 ~/.localtunnel-preview-server.json) — 国内最快最稳,不过期
  B. cloudflared Cloudflare 快速隧道(trycloudflare.com,临时,国内一般可达)
  C. localtunnel 原版(loca.lt) — 国内多数运营商拦截,仅海外可用

用法: python preview.py <含index.html的目录> [--port 8899] [--strategy auto|server|cloudflared|localtunnel]
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


def strat_server(source, name):
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
    r = subprocess.run(ssh + ["mkdir -p %s" % dest], capture_output=True, text=True)
    if r.returncode != 0:
        return None, "ssh mkdir 失败: " + r.stderr[:150]
    scp = ["scp", "-P", str(sshport)]
    if key:
        scp += ["-i", key]
    src = Path(source)
    n = 0
    for f in sorted(src.rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(src).as_posix()
        rdir = dest + "/" + os.path.dirname(rel) if os.path.dirname(rel) else dest
        r = subprocess.run(ssh + ["mkdir -p %s" % rdir], capture_output=True, text=True)
        r = subprocess.run(scp + [str(f), "%s@%s:%s/%s" % (user, host, dest, rel)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            return None, "scp 失败(%s): %s" % (rel, (r.stderr or r.stdout)[:120])
        n += 1
    url = "%s/%s/" % (base.rstrip("/"), name)
    ok, status, body = verify(url)
    if not ok:
        return None, "已部署但外网验证失败(status=%s)" % status
    return url, "自有服务器部署 ✓(%d 文件,不过期)" % n


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
                    choices=["auto", "server", "cloudflared", "localtunnel"])
    a = ap.parse_args()
    if not (8000 <= a.port <= 9999):
        print("✗ 端口必须在 8000-9999(安全规则)"); sys.exit(1)
    name = a.name or Path(a.source).resolve().name
    server = start_server(a.port, a.source)
    time.sleep(1.5)
    print("本地服务 127.0.0.1:%d ✓ (目录 %s)" % (a.port, a.source), flush=True)
    try:
        order = [a.strategy] if a.strategy != "auto" else ["server", "cloudflared", "localtunnel"]
        for strat in order:
            print("[%s] 尝试中…" % strat, flush=True)
            try:
                if strat == "server":
                    url, note = strat_server(a.source, name)
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
