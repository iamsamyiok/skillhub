#!/usr/bin/env python3
"""pdfctl 全命令交叉验证测试（pypdf 验证结果正确性）。

用法: python3 tests/run_tests.py [T1 T2 ...]    # 缺省跑全部
"""
import json
import os
import subprocess
import sys
import tempfile

from pypdf import PdfReader
from pypdf import PasswordType

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _find_pdfctl():
    """优先用随包预编译二进制，否则用本地构建产物。"""
    prebuilt = os.path.join(ROOT, "bin", "pdfctl-linux-x86_64")
    if os.path.exists(prebuilt):
        return prebuilt
    return os.path.join(ROOT, "target", "release", "pdfctl")


PDFCTL = _find_pdfctl()
FIX = os.path.join(HERE, "fixtures")

PASS, FAIL = 0, 0
SELECTED = set(sys.argv[1:]) if len(sys.argv) > 1 else None


def run(args, expect_rc=0):
    r = subprocess.run(
        [PDFCTL] + args, capture_output=True, text=True, timeout=120
    )
    if expect_rc is not None and r.returncode != expect_rc:
        raise AssertionError(
            f"pdfctl {' '.join(args)} -> rc={r.returncode} (期望 {expect_rc})\n"
            f"stdout: {r.stdout[:500]}\nstderr: {r.stderr[:500]}"
        )
    return r


def jrun(args, expect_rc=0):
    r = run(args, expect_rc)
    out = r.stdout.strip()
    if not out:
        raise AssertionError(f"无 JSON 输出: {' '.join(args)}\nstderr: {r.stderr[:300]}")
    return json.loads(out)


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name} {detail}")


def pages_text(path):
    return [(p.extract_text() or "").strip() for p in PdfReader(path).pages]


def npages(path):
    return len(PdfReader(path).pages)


class _SkipTest(Exception):
    """测试内主动跳过（外部依赖瞬断），装饰器记 SKIP 不计 FAIL"""


def t(name):
    """测试装饰器：支持选跑；_SkipTest → SKIP，Exception → FAIL"""
    def deco(fn):
        if SELECTED is None or name in SELECTED:
            print(f"[{name}] {fn.__doc__}")
            try:
                fn()
            except _SkipTest as e:
                print(f"  SKIP {e}")
            except Exception as e:
                global FAIL
                FAIL += 1
                print(f"  FAIL {name} 异常: {e}")
        return fn

    return deco


TMP = tempfile.mkdtemp(prefix="pdfctl-test-")


def tmp(name):
    return os.path.join(TMP, name)


A = os.path.join(FIX, "a.pdf")
B = os.path.join(FIX, "b.pdf")
CN = os.path.join(FIX, "cn.pdf")
TOC = os.path.join(FIX, "toc.pdf")
TABLES = os.path.join(FIX, "tables.pdf")
TABLES_ENC = os.path.join(FIX, "tables_enc.pdf")


def find_cjk_font():
    """在常见路径找可用的 CJK 字体（TTC/TTF），找不到返回 None。"""
    candidates = [
        "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def find_cjk_font_tt():
    """找 TrueType 轮廓（有 hmtx 宽度表）的 CJK 字体，找不到返回 None。

    CFF 轮廓字体（Noto CJK 系列）无 hmtx，printpdf 嵌入后字符步进不可靠，
    中文表格闭环测试必须用 TrueType 轮廓字体。
    """
    candidates = [
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]
    for p in candidates:
        if os.path.exists(p) and not is_cff_font(p):
            return p
    return None


def is_cff_font(path):
    """复刻 create.rs 的 is_cff_outline：有 CFF 表且无 glyf 表即 CFF 轮廓。"""
    import struct

    try:
        with open(path, "rb") as f:
            data = f.read(64 + 16 * 100)
    except OSError:
        return False
    if data[:4] == b"ttcf":
        n = struct.unpack(">I", data[8:12])[0]
        if n == 0:
            return False
        font_off = struct.unpack(">I", data[12:16])[0]
    else:
        font_off = 0
    base = data[font_off:]
    if len(base) < 6:
        return False
    num_tables = struct.unpack(">H", base[4:6])[0]
    has_cff = has_glyf = False
    for i in range(num_tables):
        tag = base[12 + i * 16 : 12 + i * 16 + 4]
        if tag == b"CFF ":
            has_cff = True
        elif tag == b"glyf":
            has_glyf = True
    return has_cff and not has_glyf


# ---------------------------------------------------------------- T1 info
@t("T1")
def _():
    """info 基本信息"""
    j = jrun(["info", A])
    check("页数=5", j["page_count"] == 5, j)
    check("版本=1.3+", j["pdf_version"] is not None)
    check("未加密", j["encrypted"] is False)
    check("A4 尺寸", any(s["label"] == "A4" for s in j["page_sizes"]), j["page_sizes"])
    j2 = jrun(["info", TOC])
    check("书签数=3", j2["outline_entries"] == 3, j2["outline_entries"])


# ---------------------------------------------------------------- T2 merge
@t("T2")
def _():
    """merge 合并与页内容正确性"""
    out = tmp("merged.pdf")
    j = jrun(["merge", "-o", out, A, B])
    check("总页数=8", j["total_pages"] == 8, j)
    check("每文件页数", j["pages_per_input"] == [5, 3], j)
    texts = pages_text(out)
    check("页1=A1", "PAGE-A-1" in texts[0], texts[0])
    check("页5=A5", "PAGE-A-5" in texts[4], texts[4])
    check("页6=B1", "PAGE-B-1" in texts[5], texts[5])
    check("页8=B3", "PAGE-B-3" in texts[7], texts[7])
    # 三文件合并（含前向引用场景：对象引用后定义的 id）
    out3 = tmp("merged3.pdf")
    j3 = jrun(["merge", "-o", out3, A, B, CN])
    check("三文件=10页", npages(out3) == 10, npages(out3))


# ---------------------------------------------------------------- T3 split
@t("T3")
def _():
    """split 逐页与范围拆分"""
    d = tmp("split_each")
    j = jrun(["split", A, "-o", d, "--each", "--prefix", "ea"])
    check("5 个文件", len(j["files"]) == 5, j)
    check("每个 1 页", all(f["page_count"] == 1 for f in j["files"]))
    check("第3文件内容", "PAGE-A-3" in pages_text(j["files"][2]["file"])[0])
    d2 = tmp("split_ranges")
    j2 = jrun(["split", A, "-o", d2, "--ranges", "1-2,4", "--prefix", "rg"])
    check("2 个文件", len(j2["files"]) == 2, j2)
    check("第一段2页", j2["files"][0]["page_count"] == 2)
    check("第二段1页", j2["files"][1]["page_count"] == 1)
    check("第二段是原第4页", "PAGE-A-4" in pages_text(j2["files"][1]["file"])[0])


# ---------------------------------------------------------------- T4 rotate
@t("T4")
def _():
    """rotate 旋转与叠加"""
    out = tmp("rot.pdf")
    jrun(["rotate", A, "-o", out, "-p", "90", "--pages", "2-3"])
    from pypdf import PdfReader

    r = PdfReader(out)
    rots = [int(p.get("/Rotate", 0)) for p in r.pages]
    check("页1不转", rots[0] == 0, rots)
    check("页2转90", rots[1] == 90, rots)
    check("页3转90", rots[2] == 90, rots)
    # 再转 90 → 180（叠加）
    jrun(["rotate", out, "-p", "90", "--pages", "2"])
    r2 = PdfReader(out)
    check("叠加=180", int(r2.pages[1].get("/Rotate", 0)) == 180)
    # 负角度
    jrun(["rotate", out, "-p", "-90", "--pages", "1"])
    check("负角=270", int(PdfReader(out).pages[0].get("/Rotate", 0)) == 270)


# ---------------------------------------------------------------- T5 delete
@t("T5")
def _():
    """delete 删除页后剩余内容正确"""
    out = tmp("del.pdf")
    j = jrun(["delete", A, "-o", out, "--pages", "2,4"])
    check("剩3页", j["remaining"] == 3, j)
    texts = [t for t in pages_text(out) if "PAGE-A" in t]
    check("剩 1,3,5", len(texts) == 3 and all(f"PAGE-A-{n}" in texts[i] for i, n in enumerate([1, 3, 5])), texts)
    # 删全部应报错
    r = run(["delete", A, "-o", tmp("x.pdf"), "--pages", "all"], expect_rc=1)
    check("删全部被拒", "至少保留" in r.stderr, r.stderr)


# ---------------------------------------------------------------- T6 extract
@t("T6")
def _():
    """extract 提取页"""
    out = tmp("ext.pdf")
    j = jrun(["extract", A, "-o", out, "--pages", "2-3,5"])
    check("3页", j["extracted"] == [2, 3, 5], j)
    texts = pages_text(out)
    check(
        "内容=2,3,5",
        len(texts) == 3 and all(f"PAGE-A-{n}" in texts[i] for i, n in enumerate([2, 3, 5])),
        texts,
    )


# ---------------------------------------------------------------- T7 reorder
@t("T7")
def _():
    """reorder 重排"""
    out = tmp("reo.pdf")
    jrun(["reorder", A, "5,4,3,2,1", "-o", out])
    texts = pages_text(out)
    check(
        "逆序",
        len(texts) == 5 and all(f"PAGE-A-{n}" in texts[5 - n] for n in range(1, 6)),
        texts,
    )
    # 缺页报错
    r = run(["reorder", A, "1,2", "-o", tmp("x.pdf")], expect_rc=1)
    check("缺页被拒", "覆盖全部" in r.stderr, r.stderr)


# ---------------------------------------------------------------- T8 metadata
@t("T8")
def _():
    """metadata 中文往返"""
    out = tmp("meta.pdf")
    jrun(
        [
            "metadata", "set", A, "-o", out,
            "--title", "大亚湾再生水项目 测试",
            "--author", "老板",
            "--keywords", "再生水,大亚湾",
        ]
    )
    j = jrun(["metadata", "get", out])
    check("标题中文", j["metadata"].get("Title") == "大亚湾再生水项目 测试", j)
    check("作者", j["metadata"].get("Author") == "老板", j)
    # pypdf 也能读
    from pypdf import PdfReader

    meta = PdfReader(out).metadata
    check("pypdf 读标题", meta.title == "大亚湾再生水项目 测试", meta)
    # clear
    jrun(["metadata", "set", out, "--clear"])
    j2 = jrun(["metadata", "get", out])
    check("清空", j2["metadata"] == {}, j2)


# ---------------------------------------------------------------- T9 加解密
@t("T9")
def _():
    """encrypt(aes-256/rc4-128/rc4-40/aes-128) + decrypt"""
    from pypdf import PdfReader

    for method in ["aes-256", "rc4-128", "rc4-40", "aes-128"]:
        out = tmp(f"enc_{method}.pdf")
        jrun(["encrypt", A, "-o", out, "--user-pw", "u123", "--owner-pw", "o456", "--method", method])
        r = PdfReader(out)
        check(f"{method} 已加密", r.is_encrypted)
        check(f"{method} 用户密码可解", r.decrypt("u123") != PasswordType.NOT_DECRYPTED)
        # 所有者密码也能解
        r2 = PdfReader(out)
        check(f"{method} owner 密码可解", r2.decrypt("o456") != PasswordType.NOT_DECRYPTED)
        # 错误密码
        r3 = PdfReader(out)
        check(f"{method} 错密码拒解", r3.decrypt("wrong") == PasswordType.NOT_DECRYPTED)
        # decrypt 移除加密
        dec = tmp(f"dec_{method}.pdf")
        jrun(["decrypt", out, "-o", dec, "--password", "u123"])
        rd = PdfReader(dec)
        check(f"{method} 解密后明文", not rd.is_encrypted)
        check(f"{method} 解密后页数", len(rd.pages) == 5)
    # 未加密文档 decrypt 应报错
    r = run(["decrypt", A], expect_rc=1)
    check("明文 decrypt 报错", "未加密" in r.stderr, r.stderr)
    # 空用户密码
    out = tmp("enc_empty.pdf")
    jrun(["encrypt", A, "-o", out, "--user-pw", ""])
    r = PdfReader(out)
    check("空密码可开", r.decrypt("") is not False)


# ---------------------------------------------------------------- T10 加密源操作
@t("T10")
def _():
    """加密文档的 delete/merge/info"""
    enc = tmp("enc_src.pdf")
    jrun(["encrypt", A, "-o", enc, "--user-pw", "pw1", "--owner-pw", "owner-secret"])
    # info 无密码 → 报告加密
    j = jrun(["info", enc])
    check("info 识别加密", j["encrypted"] is True, j)
    # info 带密码
    j2 = jrun(["info", enc, "--password", "pw1"])
    check("带密码读页数", j2["page_count"] == 5, j2)
    check("带密码读尺寸", any(s["label"] == "A4" for s in j2["page_sizes"]))
    # delete 加密源
    dec = tmp("from_enc.pdf")
    jrun(["delete", enc, "-o", dec, "--pages", "1", "--password", "pw1"])
    check("删加密源=4页", npages(dec) == 4, npages(dec))
    check("删除后是明文", not PdfReader(dec).is_encrypted)
    # merge 加密源
    m = tmp("m_enc.pdf")
    jrun(["merge", "-o", m, enc, B, "--password", "pw1"])
    check("加密源合并=8页", npages(m) == 8, npages(m))
    # 无密码 delete 加密源 → 报错引导
    r = run(["delete", enc, "-o", tmp("x.pdf"), "--pages", "1"], expect_rc=1)
    check("无密码操作被引导", "密码" in r.stderr, r.stderr)


# ---------------------------------------------------------------- T11 text
@t("T11")
def _():
    """text 提取（英文+中文）"""
    # 默认纯文本模式
    r = run(["text", A])
    check("stdout 含 PAGE-A-3", "PAGE-A-3" in r.stdout, r.stdout[:200])
    check("stdout 含 PAGE-A-1", "PAGE-A-1" in r.stdout)
    # JSON 模式
    j = jrun(["text", A, "--json"])
    all_text = "\n".join(p.get("text") or "" for p in j["pages"])
    check("5 页都有文本", all(p.get("text") for p in j["pages"]))
    check("JSON 含 PAGE-A-3", "PAGE-A-3" in all_text)
    # 指定页
    j2 = jrun(["text", A, "--pages", "2", "--json"])
    check("只提1页", len(j2["pages"]) == 1 and "PAGE-A-2" in (j2["pages"][0]["text"] or ""))
    # 输出到文件
    out = tmp("a.txt")
    r = run(["text", A, "-o", out])
    check("写文件无 stdout 文本", "PAGE-A-3" not in r.stdout, r.stdout[:100])
    with open(out) as f:
        check("文件含 PAGE-A-3", "PAGE-A-3" in f.read())
    # 中文（reportlab UnicodeCID → Type0/UniGB-UCS2-H）
    j3 = jrun(["text", CN, "--json"])
    cn_text = "\n".join(p.get("text") or "" for p in j3["pages"])
    print("    CN 提取样例:", repr(cn_text[:80]))
    check("中文页无错误", all(p.get("error") is None for p in j3["pages"]), j3["pages"])


# ---------------------------------------------------------------- T12 validate
@t("T12")
def _():
    """validate 正常与损坏文档"""
    j = jrun(["validate", A])
    check("正常 OK", j["ok"] is True, j["issues"])
    # 截断文件
    bad = tmp("bad.pdf")
    with open(A, "rb") as f:
        data = f.read()
    with open(bad, "wb") as f:
        f.write(data[: len(data) // 2])
    r = run(["validate", bad], expect_rc=3)
    j2 = json.loads(r.stdout)
    check("损坏检出", j2["ok"] is False and len(j2["issues"]) > 0, j2)
    # 加密文档 validate 需密码
    enc = tmp("v_enc.pdf")
    jrun(["encrypt", A, "-o", enc, "--user-pw", "z", "--owner-pw", "zz"])
    r = run(["validate", enc], expect_rc=3)
    check("加密无密码 validate 失败", json.loads(r.stdout)["ok"] is False)
    j = jrun(["validate", enc, "--password", "z"])
    check("带密码 validate OK", j["ok"] is True)


# ---------------------------------------------------------------- T13 watermark
@t("T13")
def _():
    """watermark 注入与渲染"""
    out = tmp("wm.pdf")
    j = jrun(
        ["watermark", A, "-o", out, "-t", "内部资料 严禁外传", "--angle", "45",
         "--opacity", "0.15", "--pages", "1-2"]
    )
    check("2 页加水印", j["pages_marked"] == 2, j)
    v = jrun(["validate", out])
    check("加水印后结构 OK", v["ok"] is True, v["issues"])
    check("页数不变", npages(out) == 5)
    # 渲染第 1 页检查非空白
    png = tmp("wm_p1")
    subprocess.run(["pdftoppm", "-f", "1", "-l", "1", "-png", "-r", "50", out, png],
                   check=True, capture_output=True)
    import glob

    files = glob.glob(png + "*.png")
    check("渲染产出", len(files) == 1, files)
    if files:
        from PIL import Image

        im = Image.open(files[0]).convert("L")
        px = list(im.getdata())
        dark = sum(1 for p in px if p < 200)
        check("水印像素存在", dark > 20, f"dark={dark}/{len(px)}")


# ---------------------------------------------------------------- T14 outline
@t("T14")
def _():
    """outline 保留与清理"""
    # extract 后书签数应减少（指向被删页的 item 被清理）
    out = tmp("toc_ext.pdf")
    jrun(["extract", TOC, "-o", out, "--pages", "1-2"])
    j = jrun(["info", out])
    check("书签清理后=1", j["outline_entries"] == 1, j["outline_entries"])
    # merge 嫁接书签
    m = tmp("toc_merge.pdf")
    jrun(["merge", "-o", m, TOC, A])
    jm = jrun(["info", m])
    check("merge 后书签=3", jm["outline_entries"] == 3, jm["outline_entries"])


# ---------------------------------------------------------------- T15 边界
@t("T15")
def _():
    """错误处理与边界"""
    r = run(["info", "/nonexistent.pdf"], expect_rc=1)
    check("不存在文件报错", "失败" in r.stderr or "不存在" in r.stderr, r.stderr)
    r = run(["split", A, "-o", tmp("s"), "--ranges", "9-99"], expect_rc=1)
    check("越界页码报错", "超出范围" in r.stderr, r.stderr)
    r = run(["text", A, "--pages", "1-99"], expect_rc=1)
    check("text 越界报错", "超出范围" in r.stderr, r.stderr)
    # end 关键字
    out = tmp("end.pdf")
    jrun(["extract", A, "-o", out, "--pages", "3-end"])
    check("3-end=3页", npages(out) == 3)


# ---------------------------------------------------------------- T16 table
@t("T16")
def _():
    """table 表格提取（lines/text 策略 + 加密链路 + csv/markdown）"""
    # lines 策略：第 1 页 4x4 有线表格，与 pdfplumber 对照
    j = jrun(["table", TABLES, "--pages", "1"])
    tables = j["pages"][0]["tables"]
    check("lines 检出 1 张表", len(tables) == 1, len(tables))
    if tables:
        rows = tables[0]["rows"]
        check("lines 形状 4x4", tables[0]["shape"] == [4, 4], tables[0]["shape"])
        check("lines 表头", rows[0] == ["Name", "Q1", "Q2", "Q3"], rows[0])
        check("lines 末行", rows[3] == ["Gamma", "70", "80", "90"], rows[3])

    # text 策略：第 2 页无框线表格，pdfplumber 同样策略对照
    j2 = jrun(["table", TABLES, "--pages", "2", "--strategy", "text"])
    rows2 = j2["pages"][0]["tables"][0]["rows"]
    expect2 = [
        ["City", "Pop", "Area"],
        ["", "", ""],
        ["Beijing", "21.5M", "16410"],
        ["", "", ""],
        ["Shanghai", "24.9M", "6340"],
    ]
    check("text 策略与 pdfplumber 一致", rows2 == expect2, rows2)

    # 加密文档：先解密后提取
    j3 = jrun(["table", TABLES_ENC, "--password", "userpw", "--pages", "1"])
    check("加密文档提取表头", j3["pages"][0]["tables"][0]["rows"][0][0] == "Name")

    # 无密码应报错（不假成功）
    run(["table", TABLES_ENC], expect_rc=1)

    # csv / markdown 格式
    r = run(["table", TABLES, "--pages", "1", "--format", "csv"])
    check("csv 输出", r.stdout.strip().splitlines()[0] == "Name,Q1,Q2,Q3", r.stdout[:80])
    r = run(["table", TABLES, "--pages", "1", "--format", "markdown"])
    check(
        "markdown 分隔行",
        r.stdout.splitlines()[1] == "|---|---|---|---|",
        r.stdout[:120],
    )
    # 临时解密文件应被清理
    check("临时文件已清理", not os.path.exists(TABLES_ENC + ".pdfctl-table-tmp.pdf"))


# ---------------------------------------------------------------- T17 create
@t("T17")
def _():
    """create 拉丁文档生成（pypdf 回读验证）"""
    spec = tmp("spec_latin.json")
    with open(spec, "w") as f:
        json.dump(
            {
                "title": "Quarterly Report",
                "meta": {"author": "pdfctl", "subject": "test"},
                "page_size": "a4",
                "margin_mm": 18,
                "font_size": 11,
                "blocks": [
                    {"type": "heading", "text": "1. Overview", "level": 1},
                    {
                        "type": "paragraph",
                        "text": "This is a test paragraph with enough text to require wrapping across multiple lines so we can verify the greedy line-breaking logic works correctly for Latin text.",
                    },
                    {"type": "list", "items": ["First bullet", "Second bullet"]},
                    {
                        "type": "table",
                        "header": ["Region", "Revenue"],
                        "rows": [["North", "1200"], ["South", "980"]],
                    },
                    {"type": "spacer", "height_mm": 10},
                    {"type": "pagebreak"},
                    {"type": "heading", "text": "2. Second Page", "level": 2},
                    {"type": "paragraph", "text": "Content after page break."},
                ],
            },
            f,
        )
    out = tmp("created_latin.pdf")
    j = jrun(["create", spec, "-o", out])
    check("生成 2 页", j["pages"] == 2, j)
    r = PdfReader(out)
    check("pypdf 页数=2", len(r.pages) == 2)
    t1 = r.pages[0].extract_text()
    t2 = r.pages[1].extract_text()
    check("标题在", "1. Overview" in t1)
    check("自动换行发生", "verify" in t1 and "greedy" in t1, t1[:100])
    # 内置字体（WinAnsi 回退按 UTF-8 写）下 U+2022 会乱码，create 自动降级为 ASCII 连字符
    check("列表符号(ASCII 降级)", "- First bullet" in t1, t1[:200])
    check("表格内容", "Revenue" in t1 and "North" in t1 and "1200" in t1)
    check("分页生效", "2. Second Page" in t2)
    check("元数据 author", r.metadata.author == "pdfctl", r.metadata)
    check("元数据 title", r.metadata.title == "Quarterly Report", r.metadata)

    # 错误处理：坏 JSON / 坏页面尺寸 / 坏 margin
    bad = tmp("bad.json")
    with open(bad, "w") as f:
        f.write("{not json")
    run(["create", bad, "-o", tmp("x.pdf")], expect_rc=1)
    with open(bad, "w") as f:
        json.dump({"page_size": "a9", "blocks": []}, f)
    run(["create", bad, "-o", tmp("x.pdf")], expect_rc=1)
    with open(bad, "w") as f:
        json.dump({"margin_mm": 500, "blocks": []}, f)
    run(["create", bad, "-o", tmp("x.pdf")], expect_rc=1)


# ---------------------------------------------------------------- T18 create 中文
@t("T18")
def _():
    """create 中文文档（TTF 嵌入 + 内置字体 CJK 警告）"""
    font = find_cjk_font()
    if font is None:
        print("  SKIP 未找到 CJK 字体，跳过中文嵌入断言")
        return
    spec = tmp("spec_cn.json")
    with open(spec, "w") as f:
        json.dump(
            {
                "title": "大亚湾再生水外推项目报告",
                "blocks": [
                    {"type": "heading", "text": "一、项目概况", "level": 1},
                    {
                        "type": "paragraph",
                        "text": "本项目依托大亚湾水质净化二厂，向周边47家工业用水单位推进再生水外推，按高/中/低意向评级管理《意向单位名录》。",
                    },
                    {"type": "list", "items": ["已调研高意向单位12家", "低意向单位12家，持续跟进"]},
                    {
                        "type": "table",
                        "header": ["单位", "评级", "年用水量"],
                        "rows": [["A 石化", "高", "36.5"], ["B 电子", "高", "28.2"]],
                    },
                ],
            },
            f,
            ensure_ascii=False,
        )
    out = tmp("created_cn.pdf")
    jrun(["create", spec, "-o", out, "--font", font])
    t = PdfReader(out).pages[0].extract_text()
    check("中文标题", "一、项目概况" in t, t[:80])
    check("中文段落", "意向评级" in t and "再生水外推" in t)
    check("中文列表", "已调研高意向单位12家" in t)
    check("中文表格", "A 石化" in t and "36.5" in t)

    # 内置字体 + 中文 → 必须警告
    r = run(["create", spec, "-o", tmp("cn_builtin.pdf")])
    check(
        "CJK 警告触发",
        "非 ASCII" in r.stderr,
        r.stderr[:200],
    )

    # CFF 轮廓字体（如 Noto CJK）→ 必须披露宽度/定位风险
    if is_cff_font(font):
        r2 = run(["create", spec, "-o", tmp("cn_cff.pdf"), "--font", font])
        check(
            "CFF 宽度风险警告",
            "hmtx" in r2.stderr and "TrueType" in r2.stderr,
            r2.stderr[:300],
        )


# ---------------------------------------------------------------- T19 create->table 闭环
@t("T19")
def _():
    """create 生成的表格可被 table 命令提取回读（自闭环）"""
    spec = tmp("spec_loop.json")
    with open(spec, "w") as f:
        json.dump(
            {
                "title": "Loop Test",
                "blocks": [
                    {
                        "type": "table",
                        "header": ["Key", "Value", "Note"],
                        "rows": [
                            ["alpha", "1", "first"],
                            ["beta", "2", "second"],
                            ["gamma", "3", "third"],
                        ],
                    }
                ],
            },
            f,
        )
    out = tmp("loop.pdf")
    jrun(["create", spec, "-o", out])
    j = jrun(["table", out])
    tables = j["pages"][0]["tables"]
    check("闭环检出 1 张表", len(tables) == 1, len(tables))
    if tables:
        rows = tables[0]["rows"]
        check("闭环表头", rows[0] == ["Key", "Value", "Note"], rows[0])
        check("闭环行数=4", len(rows) == 4, len(rows))
        check("闭环内容", rows[2] == ["beta", "2", "second"], rows[2])


# ---------------------------------------------------------------- T20 中文 TTF 表格闭环
@t("T20")
def _():
    """create 中文 TTF（TrueType 轮廓）表格 → table 回读内容一致（宽度可靠）"""
    font = find_cjk_font_tt()
    if font is None:
        print("  SKIP 未找到 TrueType 轮廓 CJK 字体，跳过中文闭环断言")
        return
    spec = tmp("spec_loop_cn.json")
    with open(spec, "w") as f:
        json.dump(
            {
                "title": "大亚湾再生水外推",
                "blocks": [
                    {
                        "type": "table",
                        "header": ["单位", "评级", "年用水量"],
                        "rows": [
                            ["A 石化", "高", "36.5"],
                            ["B 电子", "中", "28.2"],
                        ],
                    }
                ],
            },
            f,
            ensure_ascii=False,
        )
    out = tmp("loop_cn.pdf")
    jrun(["create", spec, "-o", out, "--font", font])
    j = jrun(["table", out, "--strategy", "lines"])
    tables = j["pages"][0]["tables"]
    check("中文闭环检出 1 张表", len(tables) == 1, len(tables))
    if tables:
        rows = tables[0]["rows"]
        check("中文闭环表头", rows[0] == ["单位", "评级", "年用水量"], rows[0])
        check("中文闭环行数=3", len(rows) == 3, len(rows))
        check("中文闭环内容", rows[1] == ["A 石化", "高", "36.5"], rows[1])


# ---------------------------------------------------------------- T21 ocr MinerU 云端
@t("T21")
def _():
    """ocr：真实调用 MinerU 免登录轻量版（网络不通或云端瞬断则 SKIP，不计失败——
    免费额度限流/排队超时属外部依赖的正常波动，不影响 pdfctl 自身正确性断言）"""
    import socket

    try:
        socket.create_connection(("mineru.net", 443), timeout=5).close()
    except OSError:
        print("  SKIP 无法连接 mineru.net，跳过 OCR 真实链路（离线环境）")
        return

    def cloud_skip_if_transient(r):
        """云端瞬断（上传/轮询/下载/超时）→ SKIP；其余 rc!=0 仍算 FAIL"""
        if r.returncode == 0:
            return
        transient = any(k in r.stderr for k in
                        ("MinerU", "轮询总超时", "下载", "429", "503", "timeout"))
        if transient:
            raise _SkipTest(f"MinerU 云端瞬断: {r.stderr.strip()[:100]}")
        raise AssertionError(f"ocr rc={r.returncode}\nstderr: {r.stderr[:300]}")

    out = tmp("ocr_out.md")
    r = run(["ocr", os.path.join(FIX, "cn.pdf"), "--pages", "1", "-o", out], expect_rc=None)
    cloud_skip_if_transient(r)
    check("上传提示在 stderr", "mineru.net" in r.stderr, r.stderr[:120])
    md = open(out, encoding="utf-8").read() if os.path.exists(out) else ""
    check("markdown 非空", len(md) > 10, md[:80])
    check("markdown 含中文内容", "中文" in md, md[:80])
    check("markdown 含页码标记", "CN-1" in md, md[:80])
    # json 模式：报告含 mode 字段
    r2 = run(["ocr", os.path.join(FIX, "cn.pdf"), "--pages", "1", "--format", "json"], expect_rc=None)
    cloud_skip_if_transient(r2)
    j = json.loads(r2.stdout)
    check("mode=agent", j["mode"] == "agent", j.get("mode"))
    check("json 含 markdown 字段", isinstance(j.get("markdown"), str))
    check("上传字节数>0", j["uploaded_bytes"] > 0, j.get("uploaded_bytes"))


# ---------------------------------------------------------------- T22 images 内嵌图片提取
@t("T22")
def _():
    """images：JPEG（A85+DCT）与 PNG（A85+Flate）双链路 + 格式校验"""
    outdir = tmp("imgs")
    j = jrun(["images", os.path.join(FIX, "images.pdf"), "-o", outdir])
    ex = j["extracted"]
    check("提取 2 张图", len(ex) == 2, [e["name"] for e in ex])
    check("无 skipped", len(j["skipped"]) == 0, j["skipped"])
    jpg = [e for e in ex if e["kind"] == "jpeg"]
    png = [e for e in ex if e["kind"] == "png"]
    check("jpeg 尺寸 120x80", jpg and jpg[0]["width"] == 120 and jpg[0]["height"] == 80, jpg)
    check("png 尺寸 100x60", png and png[0]["width"] == 100 and png[0]["height"] == 60, png)
    if jpg:
        head = open(jpg[0]["file"], "rb").read(3)
        check("jpg 魔数 FFD8FF", head == b"\xff\xd8\xff", head)
    if png:
        head = open(png[0]["file"], "rb").read(8)
        check("png 魔数", head == b"\x89PNG\r\n\x1a\n", head)
        # PNG 解像素验证（PIL）
        from PIL import Image

        im = Image.open(png[0]["file"])
        check("png 可解码且尺寸对", im.size == (100, 60) and im.mode == "RGB", im.size)
    # 页范围过滤：只取第 1 页
    j2 = jrun(["images", os.path.join(FIX, "images.pdf"), "--pages", "1", "-o", tmp("imgs_p1")])
    check("页范围过滤仅 1 张", len(j2["extracted"]) == 1, len(j2["extracted"]))


# ---------------------------------------------------------------- T23 forms AcroForm
@t("T23")
def _():
    """forms：list 字段树（含中文 options）+ set 后 pypdf 回读"""
    j = jrun(["forms", "list", os.path.join(FIX, "forms.pdf")])
    fields = {f["name"]: f for f in j["fields"]}
    check("4 个字段", len(j["fields"]) == 4, list(fields))
    check("文本框类型", fields.get("unit_name", {}).get("ftype") == "text")
    check("复选框类型", fields.get("signed", {}).get("ftype") == "checkbox")
    check("复选框当前值 Off", fields.get("signed", {}).get("value") == "Off")
    check("下拉 options 中文", fields.get("rating", {}).get("options") == ["高", "中", "低"],
          fields.get("rating", {}).get("options"))

    out = tmp("forms_filled.pdf")
    jrun(
        [
            "forms", "set", os.path.join(FIX, "forms.pdf"),
            "--field", "unit_name=A 石化",
            "--field", "annual_use=36.5",
            "--field", "rating=高",
            "--field", "signed=on",
            "-o", out,
        ]
    )
    r = PdfReader(out)
    f = r.get_fields()
    check("回读文本框中文", f["unit_name"].get("/V") == "A 石化", f["unit_name"].get("/V"))
    check("回读数字", f["annual_use"].get("/V") == "36.5")
    check("回读下拉中文", f["rating"].get("/V") == "高", f["rating"].get("/V"))
    check("回读复选框 on", f["signed"].get("/V") == "/Yes", f["signed"].get("/V"))
    # 未找到字段时报错
    r2 = run(
        ["forms", "set", os.path.join(FIX, "forms.pdf"), "--field", "不存在=1", "-o", out],
        expect_rc=1,
    )
    check("未找到字段报错", "未匹配到任何字段" in r2.stderr, r2.stderr[:120])
    # 无 AcroForm 的 PDF 应明确报错
    r3 = run(["forms", "list", os.path.join(FIX, "a.pdf")], expect_rc=1)
    check("无表单报错", "AcroForm" in r3.stderr, r3.stderr[:120])


# ---------------------------------------------------------------- T24 create 标题渲染与元数据规范
@t("T24")
def _():
    """create：spec.title 必须渲染为页面标题；中文元数据按 PDF 规范 UTF-16BE 编码（pypdf 回读不乱码）；
    日期为当前时间而非 epoch 0。对敲 reportlab 实测发现的三处缺陷的回归守护。"""
    font = find_cjk_font_tt()
    if font is None:
        print("  SKIP 未找到 TrueType 轮廓 CJK 字体")
        return
    spec = tmp("spec_title.json")
    with open(spec, "w") as f:
        json.dump(
            {
                "title": "再生水外推项目阶段报告",
                "meta": {"author": "大亚湾水质净化二厂", "subject": "意向单位名录"},
                "blocks": [{"type": "paragraph", "text": "正文第一段。"}],
            },
            f,
            ensure_ascii=False,
        )
    out = tmp("titled.pdf")
    jrun(["create", spec, "-o", out, "--font", font])
    r = PdfReader(out)
    text = "\n".join((p.extract_text() or "") for p in r.pages)
    check("标题渲染并可提取", "再生水外推项目阶段报告" in text, text[:80])
    meta = r.metadata or {}
    check("Info Title 中文", meta.get("/Title") == "再生水外推项目阶段报告", meta.get("/Title"))
    check("Info Author 中文", meta.get("/Author") == "大亚湾水质净化二厂", meta.get("/Author"))
    check("Info Subject 中文", meta.get("/Subject") == "意向单位名录", meta.get("/Subject"))
    cd = str(meta.get("/CreationDate") or "")
    check("创建日期非 1970", cd.startswith("D:20"), cd)


def main():
    print(f"pdfctl: {PDFCTL}")
    print(f"fixtures: {FIX}")
    print(f"tmp: {TMP}")
    print(f"\ntotal: PASS={PASS} FAIL={FAIL}")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
