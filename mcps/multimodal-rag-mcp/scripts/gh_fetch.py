"""Fetch sample files from iamsamyiok/skillhub to learn the publishing format."""
import json
import os

import httpx

H = {"Authorization": f"token {os.environ['GH_TOKEN']}", "User-Agent": "pub-bot"}
RAW = "https://raw.githubusercontent.com/iamsamyiok/skillhub/main/"


def get_raw(path: str) -> str:
    r = httpx.get(RAW + path, headers=H, timeout=30)
    print(f"===== {path} ({r.status_code}) =====")
    return r.text if r.status_code == 200 else "(not found)"


def main() -> None:
    wf = get_raw(".github/workflows/deploy-pages.yml")
    print(wf[:5000])

    md = get_raw("docs/mcps-md/weather-mcp.md")
    print(md[:3000])

    js = get_raw("docs/data/mcps.json")
    try:
        data = json.loads(js)
    except ValueError:
        print("mcps.json is not valid JSON")
        return
    print("===== mcps.json (first 2 entries) =====")
    entries = data if isinstance(data, list) else data.get("mcps", data)
    print(json.dumps(entries[:2] if isinstance(entries, list) else entries,
                     ensure_ascii=False, indent=2)[:3000])


if __name__ == "__main__":
    main()
