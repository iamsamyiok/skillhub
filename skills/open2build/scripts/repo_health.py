#!/usr/bin/env python3
"""GitHub repo health check for open2build stage-2 evaluation.

Zero-dependency (urllib). Optional GITHUB_TOKEN env for higher rate limits
(read-only scope is enough).

Usage: python repo_health.py owner/repo [owner/repo2 ...]
Outputs a per-repo health summary to stdout as JSON.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

API = "https://api.github.com"


def get(path: str) -> dict:
    req = urllib.request.Request(API + path)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "open2build-health")
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def health(slug: str) -> dict:
    repo = get(f"/repos/{slug}")
    out: dict = {
        "repo": slug,
        "stars": repo.get("stargazers_count"),
        "open_issues": repo.get("open_issues_count"),
        "pushed_at": repo.get("pushed_at"),
        "license": (repo.get("license") or {}).get("spdx_id", "NONE"),
        "archived": repo.get("archived"),
    }
    try:
        contribs = get(f"/repos/{slug}/contributors?per_page=100")
        out["contributors"] = len(contribs) if isinstance(contribs, list) else 0
    except Exception:  # noqa: BLE001
        out["contributors"] = None
    try:
        rel = get(f"/repos/{slug}/releases/latest")
        out["latest_release"] = rel.get("tag_name")
        out["released_at"] = rel.get("published_at")
    except Exception:  # noqa: BLE001
        out["latest_release"] = None
    # simple danger flags for stage-2 triage
    flags = []
    if out["license"] in (None, "NONE", "NOASSERTION"):
        # NONE = repo truly has no LICENSE; NOASSERTION = custom text GitHub
        # cannot auto-detect (e.g. PSF license). Verify manually either way.
        flags.append("LICENSE_UNVERIFIED")
    if out["archived"]:
        flags.append("ARCHIVED")
    if isinstance(out["contributors"], int) and out["contributors"] < 2:
        flags.append("FEW_CONTRIBUTORS")
    out["danger_flags"] = flags
    return out


def main() -> int:
    slugs = sys.argv[1:]
    if not slugs:
        print(__doc__)
        return 2
    results = []
    for slug in slugs:
        try:
            results.append(health(slug))
        except Exception as e:  # noqa: BLE001
            results.append({"repo": slug, "error": f"{type(e).__name__}: {e}"})
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
