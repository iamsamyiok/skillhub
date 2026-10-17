#!/usr/bin/env python3
"""pdf-rust vs 原版 pdf skill（Python 生态）实测基准。

对比方式：同一任务、同一输入文件，pdfctl 单命令 vs pypdf/pdfplumber 惯用脚本（模拟 agent 现场所写）。
每项跑 3 次取中位数。
"""
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PDFCTL = os.path.join(ROOT, "bin", "pdfctl-linux-x86_64")
TMP = tempfile.mkdtemp(prefix="pdf-bench-")


def timed(fn, n=3):
    ts = []
    for _ in range(n):
        t0 = time.perf_counter()
        fn()
        ts.append((time.perf_counter() - t0) * 1000)
    return statistics.median(ts)


def make_bench_pdf(path, pages):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(path, pagesize=A4)
    for i in range(1, pages + 1):
        c.setFont("Helvetica", 14)
        c.drawString(100, 750, f"BENCH page {i} / {pages}")
        c.drawString(100, 720, "The quick brown fox jumps over the lazy dog. " * 3)
        c.showPage()
    c.save()


def make_cn_bench_pdf(path, pages):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfgen import canvas

    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    c = canvas.Canvas(path, pagesize=A4)
    for i in range(1, pages + 1):
        c.setFont("STSong-Light", 14)
        c.drawString(100, 750, f"第 {i} 页 大亚湾水质净化二厂 再生水外推项目 用水量统计")
        c.showPage()
    c.save()


# ---------------- 任务定义：pdfctl 侧 ----------------
def bench_merge_pdfctl(inputs, out):
    subprocess.run([PDFCTL, "merge", "-o", out] + inputs, check=True, capture_output=True)


def bench_split_pdfctl(inp, outdir):
    subprocess.run([PDFCTL, "split", inp, "-o", outdir, "--each", "--prefix", "b"],
                   check=True, capture_output=True)


def bench_text_pdfctl(inp):
    subprocess.run([PDFCTL, "text", inp], check=True, capture_output=True)


def bench_encdec_pdfctl(inp, out, dec):
    subprocess.run([PDFCTL, "encrypt", inp, "-o", out, "--user-pw", "p"], check=True, capture_output=True)
    subprocess.run([PDFCTL, "decrypt", out, "-o", dec, "--password", "p"], check=True, capture_output=True)


# ---------------- 任务定义：Python 侧（pypdf/pdfplumber 惯用写法） ----------------
def bench_merge_pypdf(inputs, out):
    from pypdf import PdfReader, PdfWriter

    w = PdfWriter()
    for f in inputs:
        r = PdfReader(f)
        for p in r.pages:
            w.add_page(p)
    with open(out, "wb") as fh:
        w.write(fh)


def bench_split_pypdf(inp, outdir):
    from pypdf import PdfReader, PdfWriter

    r = PdfReader(inp)
    for i, p in enumerate(r.pages):
        w = PdfWriter()
        w.add_page(p)
        with open(os.path.join(outdir, f"page_{i+1}.pdf"), "wb") as fh:
            w.write(fh)


def bench_text_pdfplumber(inp):
    import pdfplumber

    with pdfplumber.open(inp) as pdf:
        for page in pdf.pages:
            page.extract_text()


def bench_encdec_pypdf(inp, out, dec):
    from pypdf import PdfReader, PdfWriter

    r = PdfReader(inp)
    w = PdfWriter()
    for p in r.pages:
        w.add_page(p)
    w.encrypt("p")
    with open(out, "wb") as fh:
        w.write(fh)
    r2 = PdfReader(out)
    if r2.is_encrypted:
        r2.decrypt("p")
    w2 = PdfWriter()
    for p in r2.pages:
        w2.add_page(p)
    with open(dec, "wb") as fh:
        w2.write(fh)


def main():
    print("生成基准固件...")
    big = os.path.join(TMP, "bench100.pdf")
    cn = os.path.join(TMP, "bench_cn50.pdf")
    make_bench_pdf(big, 100)
    make_cn_bench_pdf(cn, 50)
    big_size = os.path.getsize(big)
    print(f"  bench100.pdf: {big_size/1024:.0f} KB / 100 页")
    print(f"  bench_cn50.pdf: {os.path.getsize(cn)/1024:.0f} KB / 50 页中文")

    results = {}

    # --- merge: 100 + 50 中文 = 150 页 ---
    o1, o2 = os.path.join(TMP, "m_rust.pdf"), os.path.join(TMP, "m_py.pdf")
    t_rust = timed(lambda: bench_merge_pdfctl([big, cn], o1))
    t_py = timed(lambda: bench_merge_pypdf([big, cn], o2))
    results["merge(150页)"] = (t_rust, t_py, os.path.getsize(o1), os.path.getsize(o2))

    # --- split --each: 100 页 → 100 文件 ---
    d1, d2 = os.path.join(TMP, "s_rust"), os.path.join(TMP, "s_py")
    os.makedirs(d1, exist_ok=True), os.makedirs(d2, exist_ok=True)
    t_rust = timed(lambda: bench_split_pdfctl(big, d1))
    t_py = timed(lambda: bench_split_pypdf(big, d2))
    results["split逐页(100文件)"] = (t_rust, t_py, 0, 0)

    # --- text: 100 页英文 ---
    t_rust = timed(lambda: bench_text_pdfctl(big))
    t_py = timed(lambda: bench_text_pdfplumber(big))
    results["text(100页英文)"] = (t_rust, t_py, 0, 0)

    # --- text: 50 页中文 ---
    t_rust = timed(lambda: bench_text_pdfctl(cn))
    t_py = timed(lambda: bench_text_pdfplumber(cn))
    results["text(50页中文)"] = (t_rust, t_py, 0, 0)

    # --- encrypt+decrypt 往返: 100 页 ---
    e1, e2 = os.path.join(TMP, "e_rust.pdf"), os.path.join(TMP, "e_py.pdf")
    d1f, d2f = os.path.join(TMP, "d_rust.pdf"), os.path.join(TMP, "d_py.pdf")
    t_rust = timed(lambda: bench_encdec_pdfctl(big, e1, d1f))
    t_py = timed(lambda: bench_encdec_pypdf(big, e2, d2f))
    results["encrypt+decrypt(100页)"] = (t_rust, t_py, os.path.getsize(e1), os.path.getsize(e2))

    print(f"\n{'任务':<26}{'pdfctl(ms)':>12}{'Python(ms)':>12}{'倍差':>8}   输出大小")
    print("-" * 78)
    for k, (tr, tp, sr, sp) in results.items():
        ratio = f"{tp/tr:.1f}x" if tr > 0 else "-"
        size = f"rust={sr/1024:.0f}KB py={sp/1024:.0f}KB" if sr else ""
        print(f"{k:<26}{tr:>12.1f}{tp:>12.1f}{ratio:>8}   {size}")

    # 输出质量抽查：中文提取
    r_rust = subprocess.run([PDFCTL, "text", cn], capture_output=True, text=True).stdout
    import pdfplumber

    with pdfplumber.open(cn) as pdf:
        r_py = "\n".join((p.extract_text() or "") for p in pdf.pages)
    print("\n中文提取质量:")
    print("  pdfctl    :", repr(r_rust[:60]))
    print("  pdfplumber:", repr(r_py[:60]))
    print(f"  pdfctl 提取到关键词'再生水': {'再生水' in r_rust}, pdfplumber: {'再生水' in r_py}")

    print("\nTMP:", TMP)


if __name__ == "__main__":
    main()
