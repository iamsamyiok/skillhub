import argparse
import json
import math
import re
from pathlib import Path

from build_catalog import CATEGORY_ZH, NAME_ZH

ROOT = Path(__file__).resolve().parent
CATALOG = ROOT / "catalog.jsonl"

WORD_RE = re.compile(r"[\w]+", re.UNICODE)
MAX_TOKEN_PART = 6


def load_catalog(path=CATALOG):
    records = []
    with Path(path).open(encoding="utf-8") as fh:
        for line in fh:
            records.append(json.loads(line))
    return records


def build_vocab(records):
    vocab = set()
    for rec in records:
        vocab.update(rec.get("zh", []))
    return vocab


def segment_zh(query, vocab):
    words = []
    i = 0
    while i < len(query):
        matched = None
        for end in range(min(len(query), i + MAX_TOKEN_PART), i, -1):
            cand = query[i:end]
            if cand in vocab:
                matched = cand
                break
        if matched:
            words.append(matched)
            i += len(matched)
        else:
            i += 1
    return words


def parse_query(query, vocab):
    latin = [t.lower() for t in WORD_RE.findall(query) if t.isascii()]
    zh = segment_zh(query, vocab)
    return latin, zh


def score_record(rec, latin, zh, query_lower, idf, idf_norm):
    score = 0.0
    rec_zh = set(rec.get("zh", []))
    score += 3.0 * len(rec_zh.intersection(zh))
    name_tokens = set(rec.get("name_tokens", rec["tokens"]))
    cat_tokens = set(rec["tokens"]) - name_tokens
    for tok in name_tokens.intersection(latin):
        score += 4.0 * idf.get(tok, idf_norm) / idf_norm
    for tok in cat_tokens.intersection(latin):
        score += 0.5
    if latin and set(latin).issubset(name_tokens.union(cat_tokens)):
        score += 1.5
    for tok in latin:
        if len(tok) >= 4 and tok not in name_tokens:
            for t in name_tokens:
                if t.startswith(tok) or tok.startswith(t):
                    score += 1.0
                    break
    for tok in name_tokens:
        mapped = NAME_ZH.get(tok)
        if mapped and set(mapped).intersection(zh):
            score += 3.0
            break
    cat_zh = CATEGORY_ZH.get(rec["category"])
    if cat_zh and cat_zh in zh:
        score += 1.0
    if rec["name"] and rec["name"] in query_lower:
        score += 1.5
    return score


def build_idf(records):
    df = {}
    for rec in records:
        for tok in set(rec.get("name_tokens", rec["tokens"])):
            df[tok] = df.get(tok, 0) + 1
    n = len(records)
    idf = {t: math.log(1 + n / d) for t, d in df.items()}
    return idf, math.log(1 + n)


def find(query, records=None, vocab=None, top_k=10, category=None):
    if records is None:
        records = load_catalog()
    if vocab is None:
        vocab = build_vocab(records)
    latin, zh = parse_query(query, vocab)
    query_lower = query.lower()
    idf, idf_norm = build_idf(records)
    scored = []
    for rec in records:
        if category and rec["category"].lower() != category.lower():
            continue
        s = score_record(rec, latin, zh, query_lower, idf, idf_norm)
        if s > 0:
            scored.append((s, rec))
    scored.sort(key=lambda x: (-x[0], x[1]["size_mb"]))
    return [{"score": round(s, 2), **rec} for s, rec in scored[:top_k]]


def format_hit(rec):
    joints = f", joints {rec['joints']}" if rec["joints"] else ""
    return (
        f"[{rec['score']:>5}] {rec['id']}"
        f"  ({rec['name']}, {rec['category_zh'] or rec['category']},"
        f" {rec['size_mb']}MB, {rec['triangles']} tris{joints})"
    )


def main():
    parser = argparse.ArgumentParser(description="search SimReady GLB asset catalog")
    parser.add_argument("query", nargs="+", help="search query, Chinese or English")
    parser.add_argument("-n", "--top", type=int, default=10)
    parser.add_argument("--cat", dest="category", default=None)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--url", action="store_true", help="print glb_url and thumb_url")
    args = parser.parse_args()
    query = " ".join(args.query)
    hits = find(query, top_k=args.top, category=args.category)
    if args.json:
        print(json.dumps(hits, ensure_ascii=False, indent=2))
        return
    if not hits:
        print("no match")
        return
    for rec in hits:
        print(format_hit(rec))
        if args.url:
            print(f"       glb:   {rec['glb_url']}")
            print(f"       thumb: {rec['thumb_url']}")


if __name__ == "__main__":
    main()
