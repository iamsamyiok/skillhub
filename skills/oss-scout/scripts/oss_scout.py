#!/usr/bin/env python3
"""oss-scout: search, inspect and digest GitHub open-source projects.

Subcommands:
  search   Query GitHub Search API with one or more queries, merge and rank.
  inspect  Fetch metadata + README + activity for a single repo.
  digest   Pull selected repo files as LLM-friendly text (gitingest).

Auth: set GITHUB_TOKEN env var to raise the API rate limit from 60/h to 5000/h.
Output: human/agent-readable markdown on stdout.
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.github.com"


class RateLimit(Exception):
    pass


def gh_get(path, token=None, raw=False):
    url = path if path.startswith("http") else API + path
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "oss-scout"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
                return body if raw else json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code == 403:
                remaining = e.headers.get("X-RateLimit-Remaining")
                if remaining == "0":
                    reset = int(e.headers.get("X-RateLimit-Reset", time.time() + 3600))
                    raise RateLimit(
                        f"GitHub API rate limit exhausted (resets at "
                        f"{time.strftime('%H:%M', time.localtime(reset))}). "
                        f"Set GITHUB_TOKEN env var to get 5000 req/h."
                    )
                time.sleep(3 * (attempt + 1))
                continue
            if e.code == 404:
                return None
            raise
        except urllib.error.URLError as e:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"request failed after retries: {url}")


def fmt_num(n):
    return f"{n/1000:.1f}k" if n >= 1000 else str(n)


def fmt_repo(item, rank):
    topics = ",".join(item.get("topics", [])[:6])
    license_ = (item.get("license") or {}).get("spdx_id", "-")
    desc = (item.get("description") or "").replace("|", "/")
    if topics:
        desc = f"{desc}<br>topics: {topics}"
    return (
        f"| {rank} | [{item['full_name']}]({item['html_url']}) "
        f"| {fmt_num(item['stargazers_count'])} | {fmt_num(item['forks_count'])} "
        f"| {item['pushed_at'][:10]} | {license_} | {item.get('language') or '-'} "
        f"| {desc} |\n"
    )


SEARCH_HEADER = (
    "| # | Repo | Stars | Forks | Last push | License | Lang | Description |\n"
    "|---|------|-------|-------|-----------|---------|------|-------------|\n"
)


def cmd_search(args, token):
    seen = {}
    for q in args.query:
        full = q
        if args.min_stars and "stars:" not in q:
            full += f" stars:>={args.min_stars}"
        if args.lang and "language:" not in q:
            full += f" language:{args.lang}"
        qs = urllib.parse.urlencode(
            {"q": full, "sort": args.sort, "order": "desc", "per_page": args.per_page}
        )
        try:
            data = gh_get(f"/search/repositories?{qs}", token)
        except RateLimit as e:
            sys.exit(f"ERROR: {e}")
        for item in data.get("items", []):
            if item["full_name"] not in seen:
                seen[item["full_name"]] = item
        time.sleep(1.5)

    ranked = sorted(
        seen.values(), key=lambda r: r["stargazers_count"], reverse=True
    )[: args.top]
    print(f"# Candidates ({len(ranked)} repos, {len(args.query)} queries merged)\n")
    print(SEARCH_HEADER)
    for i, item in enumerate(ranked, 1):
        print(fmt_repo(item, i), end="")
    print(
        "\nNext: pick 2-4 candidates and run `inspect` on each; "
        "use `digest` for deep reading."
    )


def cmd_inspect(args, token):
    name = args.repo
    repo = gh_get(f"/repos/{name}", token)
    if repo is None:
        sys.exit(f"ERROR: repo {name} not found")
    readme = gh_get(f"/repos/{name}/readme", token)
    readme_text = ""
    if readme:
        try:
            readme_text = base64.b64decode(readme.get("content", "")).decode(
                "utf-8", errors="ignore"
            )
        except Exception:
            readme_text = ""
    langs = gh_get(f"/repos/{name}/languages", token) or {}
    releases = gh_get(f"/repos/{name}/releases?per_page=3", token) or []
    open_issues = repo.get("open_issues_count", 0)

    print(f"# {repo['full_name']}\n")
    print(f"- URL: {repo['html_url']}")
    print(f"- Description: {repo.get('description')}")
    print(
        f"- Stars: {repo['stargazers_count']} | Forks: {repo['forks_count']} "
        f"| Watchers: {repo['subscribers_count']} | Open issues: {open_issues}"
    )
    print(f"- License: {(repo.get('license') or {}).get('spdx_id', 'NONE')}")
    print(f"- Language: {repo.get('language')} | All: {json.dumps(langs)}")
    print(f"- Created: {repo['created_at'][:10]} | Last push: {repo['pushed_at'][:10]}")
    print(f"- Archived: {repo.get('archived')} | Topics: {repo.get('topics', [])}")
    print(f"- Homepage: {repo.get('homepage') or '-'}")
    if releases:
        print("- Recent releases:")
        for r in releases:
            print(f"  - {r.get('tag_name')} ({(r.get('published_at') or '')[:10]})")
    else:
        print("- Recent releases: none")
    print(
        f"\nHealth hints: archived={repo.get('archived')}; "
        f"last push {repo['pushed_at'][:10]}; "
        f"issue/stars ratio {open_issues / max(repo['stargazers_count'], 1):.3f}"
    )
    print(f"\n## README ({len(readme_text)} chars, truncated to 6000)\n")
    print(readme_text[:6000])
    if len(readme_text) > 6000:
        print("...[truncated]")


def cmd_digest(args, token):
    try:
        from gitingest import ingest
    except ImportError:
        sys.exit(
            "ERROR: gitingest not installed. Run: "
            "pip install --break-system-packages gitingest"
        )
    url = args.repo if "/" in args.repo else f"https://github.com/{args.repo}"
    if not url.startswith("http"):
        url = f"https://github.com/{url}"
    gh_token = token or os.environ.get("GH_TOKEN")
    include = set(args.include.split(",")) if args.include else None
    exclude = set(args.exclude.split(",")) if args.exclude else None
    try:
        summary, tree, content = ingest(
            url,
            max_file_size=args.max_file_size,
            include_patterns=include,
            exclude_patterns=exclude or {"*.lock", "*.svg", "*.png", "*.jpg"},
        )
    except Exception as e:
        sys.exit(f"ERROR: gitingest failed: {e}")
    print(f"# Digest of {args.repo}\n")
    print(summary)
    print("\n## File tree\n")
    print(tree)
    limit = args.chars
    print(f"\n## Content (showing {min(limit, len(content))} of {len(content)} chars)\n")
    print(content[:limit])
    if len(content) > limit:
        print(f"...[truncated, {len(content) - limit} chars left]")


def main():
    p = argparse.ArgumentParser(prog="oss_scout")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search", help="search GitHub repositories")
    s.add_argument("query", nargs="+", help="GitHub search query, e.g. 'rag code search in:name,description,readme'")
    s.add_argument("--lang", default=None, help="filter language, e.g. python")
    s.add_argument("--min-stars", type=int, default=100)
    s.add_argument("--sort", default="stars", choices=["stars", "updated", "best-match"])
    s.add_argument("--per-page", type=int, default=10)
    s.add_argument("--top", type=int, default=15)
    s.set_defaults(func=cmd_search)

    i = sub.add_parser("inspect", help="inspect one repo (metadata + README)")
    i.add_argument("repo", help="owner/name")
    i.set_defaults(func=cmd_inspect)

    d = sub.add_parser("digest", help="pull repo files as text via gitingest")
    d.add_argument("repo", help="owner/name or full URL")
    d.add_argument("--include", default=None, help="comma-separated globs, e.g. 'README.md,src/**/*.py'")
    d.add_argument("--exclude", default=None, help="comma-separated globs to skip")
    d.add_argument("--max-file-size", type=int, default=200000)
    d.add_argument("--chars", type=int, default=60000, help="max content chars to print")
    d.set_defaults(func=cmd_digest)

    args = p.parse_args()
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print(
            "[hint] GITHUB_TOKEN not set: anonymous limit is 60 req/h. "
            "export GITHUB_TOKEN to get 5000 req/h.\n",
            file=sys.stderr,
        )
    args.func(args, token)


if __name__ == "__main__":
    main()
