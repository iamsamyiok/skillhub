#!/usr/bin/env python3
"""relay 通道 —— 自建中转服务的客户端（服务端见 ../relay-server.py，部署在你自己的 VPS）。

REST 语义（与 local 通道一一对应）：
  PUT    {ep}/box/{box}/{name}      上传分片（raw body）
  GET    {ep}/box/{box}/{name}      下载分片（200 / 404）
  GET    {ep}/box/{box}             {"names": [...]}
  GET    {ep}/boxes                 {"boxes": [...]}
  DELETE {ep}/box/{box}             删除整个 box
鉴权：--endpoint 带 token 时按 X-Auth-Token 头携带。
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request

NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class Provider:
    scheme = "relay"

    def __init__(self, endpoint: str):
        # endpoint 形如 http://vps:7777 或 http://vps:7777#token（# 后为鉴权 token）
        if "#" in endpoint:
            endpoint, self.token = endpoint.split("#", 1)
        else:
            self.token = None
        self.ep = endpoint.rstrip("/")

    def _req(self, method, path, data=None, as_json=True):
        url = self.ep + path
        headers = {"X-Auth-Token": self.token} if self.token else {}
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        if data is not None:
            req.add_header("Content-Type", "application/octet-stream")
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404 and method == "GET":
                return None
            raise RuntimeError(f"relay {e.code} {method} {path}: "
                               f"{e.read().decode(errors='replace')[:200]}") from None
        except urllib.error.URLError as e:
            raise RuntimeError(f"relay 不可达 {url}: {e.reason}") from None
        return json.loads(body.decode()) if as_json and body else body

    def put(self, box, name, data):
        if not NAME_RE.match(name or ""):
            raise ValueError(f"非法分片名: {name!r}")
        if not NAME_RE.match(box or ""):
            raise ValueError(f"非法 box id: {box!r}")
        self._req("PUT", f"/box/{box}/{name}", data=data, as_json=False)

    def get(self, box, name):
        return self._req("GET", f"/box/{box}/{name}", as_json=False)

    def list(self, box):
        r = self._req("GET", f"/box/{box}")
        return sorted(r.get("names", [])) if r else []

    def delete(self, box):
        self._req("DELETE", f"/box/{box}", as_json=False)

    def boxes(self):
        return self._req("GET", "/boxes").get("boxes", [])


def read_meta(prov, box):
    raw = prov.get(box, "box.json")
    return json.loads(raw.decode()) if raw else None
