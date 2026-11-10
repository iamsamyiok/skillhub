#!/usr/bin/env python3
"""本地目录通道（同机回环）——与 relay 通道同语义，供测试与单机演示。

root/
  box/{box_id}/box.json, manifest.bin, part-*.bin
"""
import json
import os
import re
import shutil

NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class Provider:
    scheme = "local"

    def __init__(self, root: str):
        self.root = os.path.abspath(root)
        os.makedirs(os.path.join(self.root, "box"), exist_ok=True)

    def _dir(self, box):
        if not NAME_RE.match(box or ""):
            raise ValueError(f"非法 box id: {box!r}")
        return os.path.join(self.root, "box", box)

    def put(self, box, name, data: bytes):
        if not NAME_RE.match(name or ""):
            raise ValueError(f"非法分片名: {name!r}")
        d = self._dir(box)
        os.makedirs(d, exist_ok=True)
        tmp = os.path.join(d, name + ".tmp")
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, os.path.join(d, name))  # 原子落盘，读端看不到半块

    def get(self, box, name):
        p = os.path.join(self._dir(box), name)
        if not os.path.isfile(p):
            return None
        with open(p, "rb") as f:
            return f.read()

    def list(self, box):
        d = self._dir(box)
        if not os.path.isdir(d):
            return []
        return sorted(n for n in os.listdir(d)
                      if not n.endswith(".tmp") and NAME_RE.match(n))

    def delete(self, box):
        d = self._dir(box)
        if os.path.isdir(d):
            shutil.rmtree(d)

    def boxes(self):
        d = os.path.join(self.root, "box")
        if not os.path.isdir(d):
            return []
        return sorted(n for n in os.listdir(d) if os.path.isdir(os.path.join(d, n)))


def read_meta(prov, box):
    raw = prov.get(box, "box.json")
    return json.loads(raw.decode()) if raw else None
