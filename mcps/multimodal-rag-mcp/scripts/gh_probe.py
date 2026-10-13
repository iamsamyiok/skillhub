"""Probe GitHub token identity and find the skillhub pages repo (read-only)."""
import json
import os

import httpx

H = {
    "Authorization": f"token {os.environ['GH_TOKEN']}",
    "User-Agent": "pub-bot",
}


def main() -> None:
    r = httpx.get("https://api.github.com/user", headers=H, timeout=30)
    print("GET /user:", r.status_code)
    if r.status_code != 200:
        print(r.text[:300])
        return
    me = r.json()
    print("login:", me["login"], "| name:", me.get("name"))

    repos = httpx.get(
        "https://api.github.com/user/repos?per_page=100&sort=updated",
        headers=H, timeout=30,
    ).json()
    print(f"repos: {len(repos)}")
    for repo in repos:
        print(f"  {repo['full_name']:50s} private={repo['private']} pages={repo.get('has_pages')}")


if __name__ == "__main__":
    main()
