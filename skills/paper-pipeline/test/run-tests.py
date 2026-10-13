#!/usr/bin/env python3
"""paperkit 离线测试套件（无网络，fixture 驱动）"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent / "scripts" / "paperkit.py"
FAILED = []


def run(args, cwd):
    r = subprocess.run([sys.executable, str(KIT)] + args, cwd=cwd,
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"exit {r.returncode}: {r.stderr[-400:]}")
    return r.stdout


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f" | {detail}" if detail and not cond else ""))
    if not cond:
        FAILED.append(name)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="paperkit-test-"))
    (tmp / "draft.md").write_text(
        "向量检索是主流方案 [cite:wang2023retrieval]。\n"
        "据称准确率提升 99% [cite:ghost2020fake, wang2023retrieval]。\n"
        "报告称吞吐量提升了 40%。\n"
        "这是作者自己的分析句。\n", encoding="utf-8")
    pool = {"topic": "test", "papers": [
        {"doi": "10.1000/fake-doi", "arxiv_id": None, "title": "Retrieval Matters for Systems",
         "year": 2023, "authors": ["Alice Wang", "Bob Li"], "venue": "Journal of Testing",
         "abstract": "We study retrieval for systems with 42 percent gains.", "citation_count": 5,
         "oa_url": "", "sources": ["crossref"], "key": None, "score": 1.0},
        {"doi": None, "arxiv_id": "2401.00001", "title": "A Survey of Retrieval",
         "year": 2024, "authors": ["Carol Wang"], "venue": "arXiv",
         "abstract": "Survey of retrieval methods.", "citation_count": 0,
         "oa_url": "https://arxiv.org/pdf/2401.00001", "sources": ["arxiv"], "key": None, "score": 0.9},
    ]}
    (tmp / "pool.json").write_text(json.dumps(pool, ensure_ascii=False), encoding="utf-8")

    # 1. assign（离线验证 key 规则：stopword 首词跳过）
    out = run(["export", "--pool", "pool.json", "--style", "md", "--out", "all.md"], tmp)
    allmd = (tmp / "all.md").read_text(encoding="utf-8")
    check("export: 全池导出 2 条", "2 refs" in out)
    check("export: 不带 draft 导出全池", "Retrieval Matters" in allmd and "A Survey of Retrieval" in allmd)

    # 2. verify offline：key 解析 + 幻觉标记
    out = run(["verify", "draft.md", "--pool", "pool.json", "--out", "rep.json", "--offline"], tmp)
    rep = json.loads((tmp / "rep.json").read_text(encoding="utf-8"))
    check("verify: 幻觉 key 被标记", rep["summary"]["hallucinated"] == 1)
    check("verify: 真 key 通过解析", all(c["status"] == "checked"
          for c in rep["checks"] if c["key"] == "wang2023retrieval"))
    check("verify: offline 跳过网络层", all(
        c.get("doi_status") == "skipped-offline" for c in rep["checks"] if c["status"] == "checked"))
    check("verify: 重复 key 合并出现两次只报两条 check", len(rep["checks"]) == 3)

    # 3. uncited claims：含数字的无引用句被提示
    check("verify: 未引用论断提示", any("40" in s for s in rep["uncited_claims"]))

    # 4. bibtex / ris / md cited-only
    run(["export", "draft.md", "--pool", "pool.json", "--style", "bibtex", "--out", "r.bib"], tmp)
    bib = (tmp / "r.bib").read_text(encoding="utf-8")
    check("bibtex: cited-only 且含幽灵注释", "ghost2020fake" in bib and "@article{wang2023retrieval" in bib)
    check("bibtex: venue=Journal 用 article 类型", "@article" in bib)
    run(["export", "draft.md", "--pool", "pool.json", "--style", "ris", "--out", "r.ris"], tmp)
    ris = (tmp / "r.ris").read_text(encoding="utf-8")
    check("ris: 结构合法", ris.count("TY  - ") == 1 and ris.count("ER  - ") == 1 and "AU  - Alice Wang" in ris)
    run(["export", "draft.md", "--pool", "pool.json", "--style", "md", "--out", "r.md"], tmp)
    md = (tmp / "r.md").read_text(encoding="utf-8")
    check("md: 含 DOI 链接且无空 venue 残留", "https://doi.org/10.1000/fake-doi" in md and ". ." not in md)

    # 5. key 冲突后缀 + stopword 首词（构造同 author/year/首词的两篇）
    pool["papers"].append(dict(pool["papers"][1], title="The Survey of Retrieval", year=2024))
    (tmp / "pool2.json").write_text(json.dumps(pool, ensure_ascii=False), encoding="utf-8")
    run(["export", "--pool", "pool2.json", "--style", "bibtex", "--out", "all2.bib"], tmp)
    all2 = (tmp / "all2.bib").read_text(encoding="utf-8")
    check("key: 同名冲突自动后缀", "wang2024survey," in all2 and "wang2024surveya," in all2)

    # 6. search 同名池合并（--sources none 离线走合并路径，旧实现会清空池）
    (tmp / "merge.json").write_text(json.dumps(pool, ensure_ascii=False), encoding="utf-8")
    out = run(["search", "second query", "--sources", "none", "--out", "merge.json"], tmp)
    mp = json.loads((tmp / "merge.json").read_text(encoding="utf-8"))
    check("search: 同名池合并不丢文献", len(mp["papers"]) == 3 and mp["prisma"]["added"] == 0)
    check("search: 合并保留已有 key", [p["key"] for p in mp["papers"]][:2] == [None, None] or len(mp["papers"]) == 3)
    check("search: queries 累积", mp["queries"] == ["test", "second query"] and mp["topic"] == "test + second query")

    # 7. dedupe 交叉匹配：有 DOI 者与无 DOI 同标题者合并
    code = (
        "import sys, json; sys.path.insert(0, r'%s');"
        "import paperkit as pk;"
        "a = pk.rec(doi='10.1/x', title='Safety in Self-Evolving Agents: A Survey', year=2026, authors=['A Chen'], sources=['crossref']);"
        "b = pk.rec(arxiv_id='2601.99999', title='Safety in Self-Evolving Agents: A Survey', year=2026, authors=['A Chen'], sources=['arxiv']);"
        "c = pk.rec(doi='10.1/y', title='Another Paper', year=2025, authors=['B Wu'], sources=['openalex']);"
        "r = pk.dedupe([a, b, c]);"
        "print(json.dumps({'n': len(r), 'm': (bool(r[0]['doi']) and bool(r[0]['arxiv_id']) and sorted(r[0]['sources']))}))" % KIT.parent
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=30)
    dj = json.loads(r.stdout)
    check("dedupe: DOI/标题双索引交叉合并", dj["n"] == 2 and dj["m"] == ["arxiv", "crossref"])

    print()
    print("FAILED:", FAILED) if FAILED else print("ALL PASS")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
