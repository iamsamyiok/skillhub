#!/usr/bin/env python3
"""github 通道 —— 用私有仓库的 Release 资产当"邮箱"（双方只走出站 HTTPS）。

映射：一个 box = 一个 prerelease（tag 名 = box id），分片 = release 资产（单资产上限 2GiB）。
凭据：fine-grained PAT（对该仓库 Contents 读写）或 classic token（repo 权限），
经 --token 或环境变量 AFT_TOKEN / AFT_GH_TOKEN 传入；任何日志与报错都不回显 token。
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.github.com"
UPLOADS = "https://uploads.github.com"
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
# github release 资产硬限 2GiB；JSON+base64 通道下实践舒适区 50MiB/片
HARD_LIMIT = 2 * 1024**3
SOFT_LIMIT = 50 * 1024**2


class Provider:
    scheme = "github"

    def __init__(self, repo: str, token: str):
        if not re.match(r"^[\w.-]+/[\w.-]+$", repo or ""):
            raise ValueError(f"repo 需形如 owner/name：{repo!r}")
        self.repo = repo
        self.token = token or os.environ.get("AFT_TOKEN") or os.environ.get("AFT_GH_TOKEN")
        if not self.token:
            raise ValueError("缺 GitHub token（--token 或环境变量 AFT_TOKEN）")

    def _hdr(self, accept="application/vnd.github+json"):
        return {"Authorization": f"Bearer {self.token}",
                "Accept": accept, "X-GitHub-Api-Version": "2022-11-28"}

    def _req(self, host, method, path, body=None, accept=None, raw_body=None):
        url = host + path
        data = raw_body if raw_body is not None else (
            json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(url, data=data, method=method)
        for k, v in self._hdr(accept).items():
            req.add_header(k, v)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            if e.code == 404:
                return 404, detail.encode(), {}
            if e.code in (401, 403):
                hint = "token 无效或权限不足（fine-grained 需对该仓库 Contents 读写；classic 需 repo）"
                raise RuntimeError(f"github {e.code}: {hint}") from None
            if e.code == 409:
                return 409, detail.encode(), {}
            raise RuntimeError(f"github {e.code} {method} {path}: {detail}") from None
        except urllib.error.URLError as e:
            raise RuntimeError(f"github 不可达: {e.reason}") from None

    def _release(self, box):
        st, body, _ = self._req(API, "GET", f"/repos/{self.repo}/releases/tags/{box}")
        return json.loads(body.decode()) if st == 200 else None

    def _ensure_release(self, box):
        rel = self._release(box)
        if rel:
            return rel
        st, body, _ = self._req(API, "POST", f"/repos/{self.repo}/releases",
                                body={"tag_name": box, "name": box,
                                      "prerelease": True,
                                      "body": "aft transfer box (auto-created)"})
        if st == 409:  # 并发创建撞车，读回即可
            rel = self._release(box)
            if rel:
                return rel
        if st != 201:
            raise RuntimeError(f"创建 release 失败: {body.decode()[:200]}")
        return json.loads(body.decode())

    def _asset(self, box, name):
        rel = self._release(box)
        if not rel:
            return None, None
        for a in rel.get("assets", []):
            if a["name"] == name:
                return rel, a
        return rel, None

    def put(self, box, name, data):
        if not NAME_RE.match(name or ""):
            raise ValueError(f"非法分片名: {name!r}")
        if len(data) > HARD_LIMIT:
            raise ValueError(f"分片 {name} {len(data)}B 超过 GitHub 单资产 2GiB 上限")
        rel, asset = self._asset(box, name)
        if rel is None:
            rel = self._ensure_release(box)
        elif asset and asset["size"] == len(data):
            return  # 幂等：同名同尺寸直接跳过（内容级校验由收端 manifest 兜底）
        elif asset:
            self._req(API, "DELETE", f"/repos/{self.repo}/releases/assets/{asset['id']}")
        q = urllib.parse.urlencode({"name": name})
        st, body, _ = self._req(UPLOADS, "POST",
                                f"/repos/{self.repo}/releases/{rel['id']}/assets?{q}",
                                raw_body=data, accept="application/octet-stream")
        if st != 201:
            raise RuntimeError(f"上传分片 {name} 失败: {body.decode(errors='replace')[:200]}")

    def get(self, box, name):
        rel, asset = self._asset(box, name)
        if rel is None or asset is None:
            return None
        st, body, _ = self._req(API, "GET", f"/repos/{self.repo}/releases/assets/{asset['id']}",
                                accept="application/octet-stream")
        if st == 404:
            return None
        return body

    def list(self, box):
        rel = self._release(box)
        return sorted(a["name"] for a in rel.get("assets", [])) if rel else []

    def delete(self, box):
        rel = self._release(box)
        if rel:
            self._req(API, "DELETE", f"/repos/{self.repo}/releases/{rel['id']}")
            # tag 残留会让同名重建撞 422，一并清掉
            self._req(API, "DELETE", f"/repos/{self.repo}/git/refs/tags/{box}")

    def boxes(self, prefix="aft-"):
        out, page = [], 1
        while page <= 3:  # 最多 300 个 box，够用
            st, body, _ = self._req(API, "GET",
                                    f"/repos/{self.repo}/releases?per_page=100&page={page}")
            rels = json.loads(body.decode())
            out += [r["tag_name"] for r in rels
                    if r.get("prerelease") and r["tag_name"].startswith(prefix)]
            if len(rels) < 100:
                break
            page += 1
        return sorted(out)


def read_meta(prov, box):
    raw = prov.get(box, "box.json")
    return json.loads(raw.decode()) if raw else None
