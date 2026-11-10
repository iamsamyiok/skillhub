#!/usr/bin/env python3
"""aft relay server —— 自建中转落点（部署在你自己的 VPS / 内网机器上，请勿跑在 agent 沙箱里）

语义（与 scripts/providers/relay.py 客户端一一对应）：
  PUT    /box/{box}/{name}    上传分片（raw body，原子落盘）
  GET    /box/{box}/{name}    下载分片
  GET    /box/{box}           {"names":[...]}
  GET    /boxes               {"boxes":[...]}
  DELETE /box/{box}           删整箱
运维：
  存储：--root 目录（默认 /var/aft）；TTL 清道夫每 5 分钟扫 box.json 的 ttl_hours
  鉴权：环境变量 AFT_RELAY_TOKEN（客户端 endpoint 写 http://vps:7777#token）
  上限：--max-body 单分片上限（默认 512MiB）
启动示例：
  AFT_RELAY_TOKEN=s3cret python3 relay-server.py --port 7777 --root /var/aft
"""
import argparse
import datetime as dt
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
TOKEN = os.environ.get("AFT_RELAY_TOKEN", "")


class Handler(BaseHTTPRequestHandler):
    root = "/var/aft"
    max_body = 512 * 1024**2
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 单行访问日志，便于 agent/运维 grep
        print(f"[relay] {self.address_string()} {fmt % args}", flush=True)

    def _send(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _authed(self):
        if TOKEN and self.headers.get("X-Auth-Token") != TOKEN:
            self._send(403, b'{"error":"bad token"}')
            return False
        return True

    def _path_box(self):
        parts = self.path.lstrip("/").split("/")
        if len(parts) >= 2 and parts[0] == "box" and NAME_RE.match(parts[1]):
            return parts[1], parts[2] if len(parts) > 2 else None
        return None, None

    def do_PUT(self):
        if not self._authed():
            return
        box, name = self._path_box()
        if not box or not name or not NAME_RE.match(name):
            return self._send(400, b'{"error":"bad name"}')
        n = int(self.headers.get("Content-Length", 0))
        if n > self.max_body:
            return self._send(413, b'{"error":"too large"}')
        d = os.path.join(self.root, "box", box)
        os.makedirs(d, exist_ok=True)
        tmp = os.path.join(d, name + ".tmp")
        with open(tmp, "wb") as f:
            while n > 0:
                blk = self.rfile.read(min(n, 1 << 20))
                if not blk:
                    break
                f.write(blk)
                n -= len(blk)
        os.replace(tmp, os.path.join(d, name))
        self._send(200, b'{"ok":true}')

    def do_GET(self):
        if not self._authed():
            return
        box, name = self._path_box()
        if box and name:
            p = os.path.join(self.root, "box", box, name)
            if not os.path.isfile(p):
                return self._send(404, b'{"error":"not found"}')
            with open(p, "rb") as f:
                body = f.read()
            return self._send(200, body, "application/octet-stream")
        if box and self.path.rstrip("/").endswith(box):
            d = os.path.join(self.root, "box", box)
            names = sorted(x for x in os.listdir(d) if not x.endswith(".tmp")) \
                if os.path.isdir(d) else []
            return self._send(200, json.dumps({"names": names}).encode())
        if self.path.rstrip("/") in ("/boxes", ""):
            d = os.path.join(self.root, "box")
            boxes = sorted(os.listdir(d)) if os.path.isdir(d) else []
            return self._send(200, json.dumps({"boxes": boxes}).encode())
        self._send(404, b'{"error":"not found"}')

    def do_DELETE(self):
        if not self._authed():
            return
        box, _ = self._path_box()
        if not box:
            return self._send(400, b'{"error":"bad box"}')
        import shutil
        d = os.path.join(self.root, "box", box)
        if os.path.isdir(d):
            shutil.rmtree(d)
        self._send(200, b'{"ok":true}')


def sweeper(root, interval=300):
    """TTL 清道夫：created + ttl_hours 过期即删整箱"""
    import shutil
    while True:
        base = os.path.join(root, "box")
        if os.path.isdir(base):
            now = dt.datetime.now(dt.timezone.utc)
            for b in os.listdir(base):
                mp = os.path.join(base, b, "box.json")
                try:
                    with open(mp) as f:
                        m = json.load(f)
                    created = dt.datetime.strptime(
                        m["created"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
                    if now > created + dt.timedelta(hours=int(m.get("ttl_hours", 24))):
                        shutil.rmtree(os.path.join(base, b), ignore_errors=True)
                        print(f"[relay] TTL expired box={b}", flush=True)
                except (OSError, ValueError, KeyError):
                    pass
        threading.Event().wait(interval)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7777)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--root", default="/var/aft")
    ap.add_argument("--max-body", type=int, default=512 * 1024**2)
    a = ap.parse_args()
    Handler.root = a.root
    Handler.max_body = a.max_body
    os.makedirs(os.path.join(a.root, "box"), exist_ok=True)
    threading.Thread(target=sweeper, args=(a.root,), daemon=True).start()
    print(f"[relay] serving {a.root} on {a.host}:{a.port} "
          f"auth={'on' if TOKEN else 'off'}", flush=True)
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
