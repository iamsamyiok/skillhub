#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""paperkit — 论文流水线的确定性引擎（零第三方依赖，Python 3.9+）

四源真实检索（OpenAlex/Crossref/arXiv/Semantic Scholar）· 开放获取全文抓取 ·
[cite:KEY] 三层引用核验 · 证据定位 · cited-only 导出（BibTeX/RIS/Markdown）

架构融合自 Open Academic Paper Gen (AGPL-3.0) 与 Academic Research Skills (CC BY-NC 4.0)
的公开设计，本实现为原创代码，限非商业用途。
"""
import argparse
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

UA = "paperkit/1.0 (academic skill engine; mailto:paperkit@users.noreply.github.com)"
TIMEOUT = 25
CACHE_DIR = Path(".paperkit")
STOP = set("""a an the of in on for and or to with by from as is are was were be been this that these those
we our their its it they he she you i not no than then thus hence using used use based paper study research
which what when where how between among during into over under via each other more most such can may might
new novel proposed propose results result show shows shown approach method methods model models data dataset
""".split())


# ---------- 基础工具 ----------

def http_get(url: str, accept: str = "application/json") -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def http_get_json(url: str):
    return json.loads(http_get(url).decode("utf-8", "replace"))


def norm_title(t: str) -> str:
    t = unicodedata.normalize("NFKD", t or "").lower()
    return re.sub(r"[^a-z0-9]+", "", t)


def tokens(text: str):
    return [w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if w not in STOP and len(w) > 1]


def overlap(a: str, b: str) -> float:
    ta, tb = set(tokens(a)), set(tokens(b))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


def load_pool(path: str) -> dict:
    pool = json.loads(Path(path).read_text(encoding="utf-8"))
    if any(not p.get("key") for p in pool.get("papers", [])):
        assign_keys(pool["papers"])
    return pool


def save_pool(pool: dict, path: str):
    Path(path).write_text(json.dumps(pool, ensure_ascii=False, indent=1), encoding="utf-8")


# ---------- 记录规范化 ----------

def rec(doi=None, arxiv_id=None, title="", year=None, authors=None, venue="",
        abstract="", citations=0, oa_url="", sources=None) -> dict:
    return {
        "doi": (doi or "").strip() or None,
        "arxiv_id": (arxiv_id or "").strip() or None,
        "title": (title or "").strip(),
        "year": year, "authors": authors or [], "venue": venue or "",
        "abstract": (abstract or "").strip(),
        "citation_count": citations or 0, "oa_url": oa_url or "",
        "sources": sources or [], "key": None, "score": 0.0,
    }


def oa_abstract(inv) -> str:
    """OpenAlex abstract_inverted_index 还原"""
    if not inv:
        return ""
    pos = {}
    for w, idxs in inv.items():
        for i in idxs:
            pos[i] = w
    return " ".join(pos[i] for i in sorted(pos))


def from_openalex(w) -> dict:
    loc = (w.get("best_oa_location") or {})
    prim = (w.get("primary_location") or {})
    return rec(
        doi=w.get("doi", "").replace("https://doi.org/", "") if w.get("doi") else None,
        title=w.get("title"), year=w.get("publication_year"),
        authors=[a["author"]["display_name"] for a in w.get("authorships", [])][:8],
        venue=((prim.get("source") or {}).get("display_name") or ""),
        abstract=oa_abstract(w.get("abstract_inverted_index")),
        citations=w.get("cited_by_count", 0),
        oa_url=loc.get("pdf_url") or "",
        sources=["openalex"],
    )


def from_crossref(it) -> dict:
    ab = it.get("abstract", "")
    ab = re.sub(r"<[^>]+>", " ", ab)
    return rec(
        doi=it.get("DOI"), title=(it.get("title") or [""])[0],
        year=(it.get("issued", {}).get("date-parts") or [[None]])[0][0],
        authors=[f"{a.get('given','')} {a.get('family','')}".strip()
                 for a in it.get("author", [])][:8],
        venue=(it.get("container-title") or [""])[0],
        abstract=ab, citations=it.get("is-referenced-by-count", 0),
        sources=["crossref"],
    )


def from_arxiv(e, ns) -> dict:
    g = lambda t: (e.findtext(t, default="") or "").strip()
    aid = g("{%s}id" % ns).rsplit("/", 1)[-1]
    return rec(
        arxiv_id=aid.split("v")[0],
        title=re.sub(r"\s+", " ", g("{%s}title" % ns)),
        year=int(g("{%s}published" % ns)[:4]) if g("{%s}published" % ns) else None,
        authors=[a.findtext("{%s}name" % ns) for a in e.findall("{%s}author" % ns)][:8],
        venue="arXiv",
        abstract=re.sub(r"\s+", " ", g("{%s}summary" % ns)),
        oa_url=f"https://arxiv.org/pdf/{aid.split('v')[0]}",
        sources=["arxiv"],
    )


def from_s2(p) -> dict:
    ext = p.get("externalIds") or {}
    oa = (p.get("openAccessPdf") or {}).get("url") or ""
    return rec(
        doi=ext.get("DOI"), arxiv_id=ext.get("ArXiv"),
        title=p.get("title"), year=p.get("year"),
        authors=[a["name"] for a in (p.get("authors") or [])][:8],
        venue=p.get("venue") or "", abstract=p.get("abstract") or "",
        citations=p.get("citationCount") or 0, oa_url=oa, sources=["s2"],
    )


# ---------- 检索 ----------

def q_openalex(query, limit):
    u = ("https://api.openalex.org/works?search=" + urllib.parse.quote(query)
         + f"&per-page={min(limit,50)}&mailto=paperkit@users.noreply.github.com")
    try:
        return [from_openalex(w) for w in http_get_json(u).get("results", [])]
    except Exception:
        return []


def q_crossref(query, limit):
    u = ("https://api.crossref.org/works?query=" + urllib.parse.quote(query)
         + f"&rows={min(limit,40)}&mailto=paperkit@users.noreply.github.com")
    try:
        return [from_crossref(it) for it in http_get_json(u).get("message", {}).get("items", [])]
    except Exception:
        return []


def q_arxiv(query, limit):
    u = ("http://export.arxiv.org/api/query?search_query=all:" + urllib.parse.quote(query)
         + f"&max_results={min(limit,30)}")
    ns = "http://www.w3.org/2005/Atom"
    try:
        root = ET.fromstring(http_get(u, accept="application/atom+xml"))
        return [from_arxiv(e, ns) for e in root.findall("{%s}entry" % ns)]
    except Exception:
        return []


def q_s2(query, limit):
    u = ("https://api.semanticscholar.org/graph/v1/paper/search?query=" + urllib.parse.quote(query)
         + f"&limit={min(limit,30)}&fields=title,authors,year,externalIds,abstract,openAccessPdf,citationCount,venue")
    try:
        return [from_s2(p) for p in http_get_json(u).get("data", [])]
    except Exception:
        return []


def dedupe(papers):
    seen_doi, seen_ti, out = {}, {}, []
    for p in papers:
        doi_k = ("doi:" + p["doi"]) if p["doi"] else None
        ti_v = norm_title(p["title"])
        ti_k = ("t:" + ti_v) if ti_v else None
        if not (doi_k or ti_k):
            continue
        old = None
        if doi_k and doi_k in seen_doi:
            old = seen_doi[doi_k]
        elif ti_k and ti_k in seen_ti:
            old = seen_ti[ti_k]
        if old:
            for f in ("abstract", "oa_url", "doi", "arxiv_id", "year", "venue"):
                if not old.get(f) and p.get(f):
                    old[f] = p[f]
            old["sources"] = sorted(set(old["sources"]) | set(p["sources"]))
            old["citation_count"] = max(old["citation_count"], p["citation_count"])
        else:
            old = p
            out.append(p)
        if doi_k:
            seen_doi[doi_k] = old
        if ti_k:
            seen_ti[ti_k] = old
    return out


def score(papers, query):
    qt = set(tokens(query))
    for p in papers:
        s = overlap(query, p["title"]) * 6 + overlap(query, p["abstract"]) * 4
        s += min(p["citation_count"], 2000) / 200.0
        if p["year"] and p["year"] >= 2022:
            s += 1.0
        if p["oa_url"] or p["abstract"]:
            s += 0.5
        p["score"] = round(s, 2)
    papers.sort(key=lambda x: -x["score"])
    return papers


def assign_keys(papers):
    used = {}
    for p in papers:
        if p.get("key"):
            used[p["key"]] = p
            continue
        last = (p["authors"][0].split()[-1] if p["authors"] else "anon").lower()
        last = re.sub(r"[^a-z]", "", last) or "anon"
        tw = [w for w in re.findall(r"[a-z0-9]+", (p["title"] or "untitled").lower()) if w not in STOP]
        first = tw[0] if tw else "x"
        base = f"{last}{p['year'] or 'nd'}{first}"
        k, i = base, 0
        while k in used:
            i += 1
            k = base + chr(97 + i - 1)
        used[k] = p
        p["key"] = k
    return papers


# ---------- 全文 ----------

def fetch_fulltext(p: dict) -> dict:
    """抓 OA PDF 并按页抽文本；无 pdftotext/pypdf 时降级为摘要。"""
    out = CACHE_DIR / "fulltext" / f"{p['key']}.json"
    if out.exists():
        return json.loads(out.read_text(encoding="utf-8"))
    url = p.get("oa_url") or ""
    if p.get("arxiv_id") and not url:
        url = f"https://arxiv.org/pdf/{p['arxiv_id']}"
    result = {"pages": [], "source": "", "mode": "abstract-only"}
    if url:
        try:
            data = http_get(url, accept="application/pdf")
            pages = extract_pdf_pages(data)
            if pages:
                result = {"pages": pages, "source": url, "mode": "fulltext"}
        except Exception:
            pass
    if not result["pages"] and p["abstract"]:
        result["pages"] = [p["abstract"]]
        result["source"] = "abstract"
    result["fetched_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


def extract_pdf_pages(data: bytes):
    # 路径1: poppler pdftotext
    try:
        import subprocess, tempfile
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            tmp = f.name
        for sep in (b"\x0c",):
            pass
        r = subprocess.run(["pdftotext", tmp, "-"], capture_output=True, timeout=60)
        if r.returncode == 0 and r.stdout.strip():
            return [pg for pg in r.stdout.decode("utf-8", "replace").split("\f") if pg.strip()]
    except Exception:
        pass
    # 路径2: pypdf
    try:
        import io
        from pypdf import PdfReader
        rd = PdfReader(io.BytesIO(data))
        return [(pg.extract_text() or "") for pg in rd.pages]
    except Exception:
        return []


# ---------- 核验 ----------

MARK = re.compile(r"\[cite:([^\]]+)\]")
SENT = re.compile(r"(?<=[.!?。！？])\s+")


def parse_markers(draft: str):
    out = []
    for i, sent in enumerate(SENT.split(draft)):
        for m in MARK.finditer(sent):
            for key in m.group(1).split(","):
                key = key.strip().replace("cite:", "").strip()
                if key:
                    out.append({"key": key, "sentence": sent.strip(), "para": i})
    return out


def check_l3(marker, p, ft) -> dict:
    """在全文/摘要中定位最佳支撑段落，输出证据位置；支撑与否由 Agent 判读。"""
    text_pages = ft.get("pages") or ([p["abstract"]] if p["abstract"] else [])
    best, where = 0.0, ""
    if not text_pages:
        return {"status": "unverified", "detail": "无摘要与全文", "evidence": None}
    for pi, page in enumerate(text_pages):
        for chunk in re.split(r"(?<=[.!?])\s+|\n", page):
            if len(tokens(chunk)) < 5:
                continue
            ov = overlap(marker["sentence"], chunk)
            if ov > best:
                best, where = ov, chunk.strip()
    tag = "abstract" if (ft.get("mode") == "abstract-only" or ft.get("source") == "abstract") \
        else f"fulltext p.{text_pages.index(next(pg for pg in text_pages if where in pg)) + 1}" if where else "fulltext"
    if best < 0.12:
        return {"status": "unsupported_risk",
                "detail": f"最强匹配相似度 {best:.2f}，需 Agent 判读是否真支撑",
                "evidence": {"where": tag, "passage": (where or "")[:400]}}
    return {"status": "evidence_found", "detail": f"匹配度 {best:.2f}，Agent 判读",
            "evidence": {"where": tag, "passage": where[:400]}}


def cmd_verify(args):
    draft = Path(args.draft).read_text(encoding="utf-8")
    pool = load_pool(args.pool)
    by_key = {p["key"]: p for p in pool["papers"]}
    markers = parse_markers(draft)
    checks = []
    for m in markers:
        p = by_key.get(m["key"])
        if not p:
            checks.append({"key": m["key"], "status": "hallucinated",
                           "detail": "key 不在文献池（Check 1 未解析）",
                           "sentence": m["sentence"][:200]})
            continue
        c = {"key": m["key"], "status": "checked", "title": p["title"], "sentence": m["sentence"][:200]}
        # Check 2: 元数据
        if args.offline:
            c["doi_status"] = "skipped-offline"
        elif p["doi"]:
            try:
                cr = http_get_json("https://api.crossref.org/works/" + urllib.parse.quote(p["doi"]))
                item = cr["message"]
                t2 = (item.get("title") or [""])[0]
                sim = overlap(p["title"], t2)
                if norm_title(p["title"]) == norm_title(t2) or sim >= 0.8:
                    c["doi_status"] = "ok"
                elif sim >= 0.45:
                    c["doi_status"] = "warn"
                    c["detail_cr"] = f"标题相似度 {sim:.2f}，人工核对"
                else:
                    c["doi_status"] = "warn"
                    c["detail_cr"] = f"标题差异大({sim:.2f})，疑似串号"
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    c["doi_status"] = "warn"
                    c["detail_cr"] = "Crossref 404，试 doi.org 复核"
                else:
                    c["doi_status"] = "unverified"
            except Exception:
                c["doi_status"] = "unverified"
        else:
            c["doi_status"] = "no-doi"
        # Check 3: 证据定位
        if args.offline:
            c["l3"] = {"status": "skipped-offline", "evidence": None}
        else:
            ft = fetch_fulltext(p)
            c["l3"] = check_l3(m, p, ft)
        checks.append(c)
    # 未引用的数字/专名句（advisory）
    cited_sents = {m["sentence"] for m in markers}
    uncited = [s[:160] for s in SENT.split(draft)
               if s.strip() and s not in cited_sents
               and (re.search(r"\d+(\.\d+)?%|\b(19|20)\d{2}\b", s) or len(re.findall(r"\b[A-Z][a-z]{3,}", s)) >= 2)
               and not MARK.search(s)][:20]
    rep = {"draft": args.draft, "markers": len(markers),
           "summary": {
               "hallucinated": sum(1 for c in checks if c["status"] == "hallucinated"),
               "doi_warn": sum(1 for c in checks if c.get("doi_status") == "warn"),
               "unsupported_risk": sum(1 for c in checks if c.get("l3", {}).get("status") == "unsupported_risk"),
               "evidence_found": sum(1 for c in checks if c.get("l3", {}).get("status") == "evidence_found"),
               "unverified": sum(1 for c in checks if c.get("l3", {}).get("status") == "unverified"),
           },
           "checks": checks, "uncited_claims": uncited}
    Path(args.out).write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(rep["summary"], ensure_ascii=False))
    print("report -> " + args.out)


# ---------- 导出 ----------

def cited_keys(draft: str):
    seen, order = set(), []
    for m in parse_markers(draft):
        if m["key"] not in seen:
            seen.add(m["key"])
            order.append(m["key"])
    return order


def to_bibtex(p) -> str:
    ty = "article" if p["venue"] and p["venue"] != "arXiv" else "misc"
    a = " and ".join(p["authors"])
    fields = [f"  title = {{{p['title']}}}"]
    if p["authors"]:
        fields.append(f"  author = {{{a}}}")
    if p["year"]:
        fields.append(f"  year = {{{p['year']}}}")
    if p["venue"]:
        fields.append(f"  journal = {{{p['venue']}}}" if ty == "article" else f"  howpublished = {{{p['venue']}}}")
    if p["doi"]:
        fields.append(f"  doi = {{{p['doi']}}}")
    if p["arxiv_id"]:
        fields.append(f"  eprint = {{{p['arxiv_id']}}}")
    return f"@{ty}{{{p['key']},\n" + ",\n".join(fields) + "\n}"


def to_ris(p) -> str:
    ty = "RPRT" if p["venue"] == "arXiv" else "JOUR"
    lines = [f"TY  - {ty}", f"TI  - {p['title']}", "AU  - " + "\nAU  - ".join(p["authors"]),
             f"PY  - {p['year'] or ''}"]
    if p["venue"]:
        lines.append(f"JO  - {p['venue']}")
    if p["doi"]:
        lines.append(f"DO  - {p['doi']}")
    lines.append("ER  - ")
    return "\n".join(lines)


def cmd_export(args):
    pool = load_pool(args.pool)
    by_key = {p["key"]: p for p in pool["papers"]}
    draft = Path(args.draft).read_text(encoding="utf-8") if args.draft else ""
    order = cited_keys(draft) if draft else [p["key"] for p in pool["papers"]]
    missing = [k for k in order if k not in by_key]
    papers = [by_key[k] for k in order if k in by_key]
    if args.style == "bibtex":
        text = "\n\n".join(to_bibtex(p) for p in papers)
    elif args.style == "ris":
        text = "\n\n".join(to_ris(p) for p in papers)
    else:
        text = "\n".join(
            f"{i+1}. {', '.join(a for a in p['authors'][:3])}{' et al.' if len(p['authors'])>3 else ''} "
            f"({p['year'] or 'n.d.'}). {p['title']}."
            + (f" {p['venue']}." if p["venue"] else "")
            + (f" https://doi.org/{p['doi']}" if p["doi"] else "")
            for i, p in enumerate(papers))
    if missing:
        text = f"% 未解析 key（已跳过）: {', '.join(missing)}\n" + text
    Path(args.out).write_text(text + "\n", encoding="utf-8")
    print(f"{len(papers)} refs ({args.style}) -> {args.out}" + (f" | skipped: {missing}" if missing else ""))


# ---------- CLI ----------

def cmd_search(args):
    papers = []
    if "openalex" in args.sources:
        papers += q_openalex(args.query, args.limit)
    if "crossref" in args.sources:
        papers += q_crossref(args.query, args.limit)
    if "arxiv" in args.sources:
        papers += q_arxiv(args.query, args.limit)
    if "s2" in args.sources:
        papers += q_s2(args.query, args.limit)
    new = score(dedupe(papers), args.query)[: args.limit]
    existing, queries = [], []
    if Path(args.out).exists():
        try:
            old = load_pool(args.out)
            existing = old.get("papers", [])
            queries = list(old.get("queries") or ([old["topic"]] if old.get("topic") else []))
        except Exception:
            pass
    before = len(existing)
    merged = dedupe(existing + new)
    assign_keys(merged)
    if args.query not in queries:
        queries.append(args.query)
    pool = {"topic": " + ".join(queries), "queries": queries,
            "created": time.strftime("%Y-%m-%d %H:%M:%S"),
            "papers": merged, "prisma": {"identified": len(merged),
                                         "added": len(merged) - before}}
    save_pool(pool, args.out)
    print(f"+{len(merged) - before} new, {len(merged)} total -> {args.out}")
    for p in merged[:12]:
        oa = "*" if (p["oa_url"] or p["arxiv_id"]) else " "
        print(f"  [{p['key']}{oa}] ({p['year']}) {p['title'][:72]}  cites={p['citation_count']}")


def cmd_doctor(_):
    checks = {}
    for name, fn, url in [("openalex", q_openalex, "test RAG"), ("crossref", q_crossref, "test RAG"),
                          ("arxiv", q_arxiv, "transformer"), ("s2", q_s2, "test RAG")]:
        try:
            r = fn(url, 1)
            checks[name] = "ok" if r else "empty"
        except Exception as e:
            checks[name] = f"fail: {e}"
    try:
        import pypdf  # noqa
        checks["pdf"] = "pypdf"
    except ImportError:
        import shutil
        checks["pdf"] = "pdftotext" if shutil.which("pdftotext") else "abstract-only（安装 poppler 或 pypdf 可启用全文核验）"
    print(json.dumps(checks, ensure_ascii=False, indent=1))


def main():
    ap = argparse.ArgumentParser(prog="paperkit", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search", help="多源检索建池")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=20)
    s.add_argument("--out", default="pool.json")
    s.add_argument("--sources", default="openalex,crossref,arxiv,s2")
    s.set_defaults(fn=cmd_search)

    v = sub.add_parser("verify", help="三层引用核验")
    v.add_argument("draft")
    v.add_argument("--pool", default="pool.json")
    v.add_argument("--out", default="verify-report.json")
    v.add_argument("--offline", action="store_true", help="跳过网络层（Check2/全文）")
    v.set_defaults(fn=cmd_verify)

    e = sub.add_parser("export", help="cited-only 参考文献")
    e.add_argument("draft", nargs="?", help="含 [cite:KEY] 的草稿；省略则导出全池")
    e.add_argument("--pool", default="pool.json")
    e.add_argument("--style", choices=["bibtex", "ris", "md"], default="md")
    e.add_argument("--out", default="references.md")
    e.set_defaults(fn=cmd_export)

    f = sub.add_parser("fulltext", help="抓取并缓存某 key 的全文")
    f.add_argument("key")
    f.add_argument("--pool", default="pool.json")
    f.set_defaults(fn=lambda a: print(json.dumps(
        {k: (v if k != "pages" else f"[{len(v)} pages]") for k, v in fetch_fulltext(
            {p['key']: p for p in load_pool(a.pool)['papers']}[a.key]).items()},
        ensure_ascii=False)))

    d = sub.add_parser("doctor", help="环境与四源连通性自检")
    d.set_defaults(fn=cmd_doctor)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
