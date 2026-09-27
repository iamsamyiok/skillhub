"""Helper script to refresh resources/cited_papers/index.json prior to LaTeX build.

Invoked by VS Code LaTeX Workshop recipe.
Assumes working directory is the thesis root (parent of this script's directory).
"""
from __future__ import annotations
import sys
import argparse
from pathlib import Path
import json
import time

# Ensure package path available when not installed as a tool
THIS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = THIS_DIR.parent  # thesis root
sys.path.insert(0, str(THIS_DIR))  # so 'latex_mcp_server' becomes importable

from latex_mcp_server.functions import latex_ops  # type: ignore  # noqa: E402


def parse_args():
    p = argparse.ArgumentParser(description="Fast incremental update of citation index")
    p.add_argument('--bib', default='src/references.bib', help='Relative path to .bib file')
    p.add_argument('--force', action='store_true', help='Force regenerate even if up-to-date')
    p.add_argument('--no-download', action='store_true', help='Skip auto PDF downloads (index only)')
    p.add_argument('--touch-threshold', type=float, default=0.0, help='Seconds to tolerate mtime skew before forcing rebuild')
    return p.parse_args()


def main():
    args = parse_args()
    root = PROJECT_ROOT
    bib_path = root / args.bib
    if not bib_path.is_file():
        print(f"[update_index] Bib file missing: {args.bib}", file=sys.stderr)
        return 1
    index_path = root / 'resources' / 'cited_papers' / 'index.json'

    # Fast skip: if index exists and is newer than bib (allowing threshold) and not forced
    if not args.force and index_path.is_file():
        bib_mtime = bib_path.stat().st_mtime
        idx_mtime = index_path.stat().st_mtime
        if idx_mtime + args.touch_threshold >= bib_mtime:
            # Optional sanity: compare counts (lightweight) to detect truncated file changes
            try:
                old_entries = json.loads(index_path.read_text(encoding='utf-8'))
                if isinstance(old_entries, list) and old_entries:
                    print(f"[update_index] Skip (index fresh, {len(old_entries)} entries)")
                    return 0
            except Exception:
                pass  # fall through to rebuild if unreadable

    # Optionally disable downloads by monkeypatching
    if args.no_download:
        def _skip_download(workspace, force=False, limit=None):  # noqa: ARG001
            return {'skipped': True, 'reason': 'no-download'}
        latex_ops.download_bibliography = _skip_download  # type: ignore

    start = time.time()
    try:
        entries = latex_ops.extract_bibliography(root, args.bib)
    except Exception as e:  # noqa: BLE001
        print(f"[update_index] Failed: {e}", file=sys.stderr)
        return 1
    elapsed = time.time() - start
    print(f"[update_index] Rebuilt index: {len(entries)} entries in {elapsed:.2f}s (force={args.force}, downloads={'off' if args.no_download else 'on'})")
    return 0


if __name__ == '__main__':  # pragma: no cover
    raise SystemExit(main())
