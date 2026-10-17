#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""发布 hybrid-constrained-ml 到 iamsamyiok/skillhub (GitHub Pages 站点)。
通过 Contents API 上传文件 + 更新 data/meta.json。"""
import base64
import datetime
import json
import os
import sys

TOKEN = os.environ["GITHUB_TOKEN"]
REPO = "iamsamyiok/skillhub"
BRANCH = "main"
SKILL_LOCAL = "/workspace/hybrid-constrained-ml"
SKILL_REMOTE = "skills/hybrid-constrained-ml"
API = f"https://api.github.com/repos/{REPO}/contents"

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
}

import urllib.request

def api_req(method, url, data=None):
    req = urllib.request.Request(url, data=(json.dumps(data).encode() if data else None),
                                 headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode()
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            j = json.loads(body)
            print(f"  HTTP {e.code}: {j.get('message')} {j.get('errors')}")
        except Exception:
            print(f"  HTTP {e.code}: {body[:200]}")
        return e.code, {}

def walk_files():
    out = []
    for root, dirs, files in os.walk(SKILL_LOCAL):
        dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git", ".codebuddy")]
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, SKILL_LOCAL).replace(os.sep, "/")
            out.append((rel, full))
    return sorted(out)

def upload_file(rel, full):
    remote = f"{SKILL_REMOTE}/{rel}"
    with open(full, "rb") as fh:
        content = base64.b64encode(fh.read()).decode()
    url = f"{API}/{remote}"
    status, _ = api_req("PUT", url, {
        "message": f"feat: add skill hybrid-constrained-ml ({rel})",
        "content": content,
        "branch": BRANCH,
    })
    ok = status in (200, 201)
    print(f"  [{'OK' if ok else 'FAIL'} {status}] {remote}  ({os.path.getsize(full)}B)")
    return ok

def parse_frontmatter():
    fm = {}
    path = os.path.join(SKILL_LOCAL, "SKILL.md")
    lines = open(path, encoding="utf-8").read().splitlines()
    if lines[0].strip() != "---":
        return fm
    for ln in lines[1:]:
        if ln.strip() == "---":
            break
        if ":" in ln:
            k, v = ln.split(":", 1)
            fm[k.strip()] = v.strip()
    # tags 可能是 [a, b]
    raw = open(path, encoding="utf-8").read()
    import re
    m = re.search(r"tags:\s*\[(.*?)\]", raw)
    if m:
        fm["tags"] = [t.strip() for t in m.group(1).split(",") if t.strip()]
    return fm

def update_meta():
    # GET 现有 meta.json
    url = f"{API}/data/meta.json"
    status, data = api_req("GET", url)
    if status != 200:
        print("  meta.json GET 失败, 跳过登记")
        return False
    sha = data["sha"]
    meta = json.loads(base64.b64decode(data["content"]).decode())
    fm = parse_frontmatter()
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    meta.setdefault("skills", {})
    meta["skills"]["hybrid-constrained-ml"] = {
        "version": fm.get("version", "1.0.0"),
        "category": fm.get("category", "开发工具"),
        "tags": fm.get("tags", []),
        "downloads": 0,
        "createdAt": now,
        "updatedAt": now,
        "description": "融合 rcml 白盒先验(冻结结构+硬护栏)与 XGBoost 残差(补抓交互/非线性)的可解释安全建模 skill：分布外安全、小数据友好。",
    }
    content = base64.b64encode(json.dumps(meta, ensure_ascii=False, indent=2).encode()).decode()
    s2, _ = api_req("PUT", url, {
        "message": "feat: register hybrid-constrained-ml in meta.json",
        "content": content,
        "sha": sha,
        "branch": BRANCH,
    })
    print(f"  [{'OK' if s2 in (200,201) else 'FAIL'} {s2}] data/meta.json updated")
    return s2 in (200, 201)

def main():
    print(">>> 上传 skill 文件到", SKILL_REMOTE)
    files = walk_files()
    all_ok = True
    for rel, full in files:
        if not upload_file(rel, full):
            all_ok = False
    print(">>> 更新 data/meta.json 登记")
    update_meta()
    print(">>> 发布完成" if all_ok else ">>> 部分文件上传失败, 请检查")

if __name__ == "__main__":
    main()
