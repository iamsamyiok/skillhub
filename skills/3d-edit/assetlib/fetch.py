import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CATALOG = ROOT / "catalog.jsonl"
CACHE = ROOT / "cache"

UA = {"User-Agent": "assetlib/0.1 (local cache fetcher)"}


def load_index():
    index = {}
    with CATALOG.open(encoding="utf-8") as fh:
        for line in fh:
            rec = json.loads(line)
            index[rec["id"]] = rec
    return index


def download(url, dest, timeout=120):
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp, part.open("wb") as fh:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
    part.replace(dest)
    return dest.stat().st_size


def fetch_asset(asset_id, index, dest_dir, force=False, with_thumb=False):
    rec = index[asset_id]
    results = []
    glb_dest = dest_dir / rec["glb"].split("/")[-1]
    if glb_dest.exists() and not force:
        results.append((glb_dest.name, "cached", glb_dest.stat().st_size))
    else:
        size = download(rec["glb_url"], glb_dest)
        results.append((glb_dest.name, "downloaded", size))
    if with_thumb:
        thumb_dest = dest_dir / "thumbs" / (asset_id + ".webp")
        if thumb_dest.exists() and not force:
            results.append((thumb_dest.name, "cached", thumb_dest.stat().st_size))
        else:
            size = download(rec["thumb_url"], thumb_dest)
            results.append((thumb_dest.name, "downloaded", size))
    return results


def main():
    parser = argparse.ArgumentParser(description="download SimReady GLB assets into local cache")
    parser.add_argument("ids", nargs="+", help="asset ids from catalog")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--thumb", action="store_true", help="also download the 512px webp thumbnail")
    parser.add_argument("--dest", default=str(CACHE / "glb"))
    args = parser.parse_args()
    index = load_index()
    missing = [i for i in args.ids if i not in index]
    if missing:
        print("unknown ids: " + ", ".join(missing), file=sys.stderr)
        sys.exit(1)
    dest_dir = Path(args.dest)
    total = 0
    for asset_id in args.ids:
        for name, status, size in fetch_asset(asset_id, index, dest_dir, args.force, args.thumb):
            total += size
            print(f"{status:>10}  {name}  {size / 1e6:.2f}MB")
    print(f"total {total / 1e6:.2f}MB -> {dest_dir}")


if __name__ == "__main__":
    main()
