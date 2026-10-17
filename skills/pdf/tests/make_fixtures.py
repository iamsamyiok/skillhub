#!/usr/bin/env python3
"""生成测试固件：A(5页英文) / B(3页英文) / CN(2页中文) / TOC(4页带书签)。"""
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
os.makedirs(OUT, exist_ok=True)

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont


def make_plain(name, pages, tag, size=A4):
    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=size)
    for i in range(1, pages + 1):
        c.setFont("Helvetica", 24)
        c.drawString(100, 700, f"{tag}-{i}")
        c.setFont("Helvetica", 12)
        c.drawString(100, 660, f"page {i} of {pages}")
        c.showPage()
    c.save()
    return path


def make_cn(name):
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=A4)
    c.setFont("Helvetica", 20)
    for i, txt in enumerate(["第一页 中文测试", "第二页 大亚湾 再生水"], start=1):
        c.drawString(100, 700, f"CN-{i}")
        c.setFont("STSong-Light", 18)
        c.drawString(100, 640, txt)
        c.setFont("Helvetica", 20)
        c.showPage()
    c.save()
    return path


def make_toc(name):
    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=A4)
    for i in range(1, 5):
        c.setFont("Helvetica", 24)
        c.drawString(100, 700, f"TOC-{i}")
        c.showPage()
    c.save()
    # pypdf 添加书签
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(path)
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    for title, page_no in [("第一章", 0), ("第二章", 2), ("2.1 小节", 3)]:
        writer.add_outline_item(title, page_no)
    with open(path, "wb") as f:
        writer.write(f)
    return path


def make_tables(name):
    """两页：第 1 页有线表格（lines 策略），第 2 页无框线表格（text 策略）。"""
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer, Paragraph
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors

    path = os.path.join(OUT, name)
    doc = SimpleDocTemplate(path, pagesize=A4)
    styles = getSampleStyleSheet()
    story = []
    story.append(Paragraph("Table Fixture", styles["Title"]))

    data = [
        ["Name", "Q1", "Q2", "Q3"],
        ["Alpha", "10", "20", "30"],
        ["Beta", "40", "50", "60"],
        ["Gamma", "70", "80", "90"],
    ]
    t = Table(data)
    t.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 24))
    doc.build(story)

    # 第 2 页：无框线表格（追加一页）
    from pypdf import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas as _canvas

    tmp2 = os.path.join(OUT, "_tables_p2.pdf")
    c = _canvas.Canvas(tmp2, pagesize=A4)
    c.setFont("Helvetica-Bold", 12)
    for x, h in zip([80, 240, 380], ["City", "Pop", "Area"]):
        c.drawString(x, 700, h)
    c.setFont("Helvetica", 12)
    rows = [["Beijing", "21.5M", "16410"], ["Shanghai", "24.9M", "6340"]]
    for ri, row in enumerate(rows):
        for x, cell in zip([80, 240, 380], row):
            c.drawString(x, 670 - ri * 20, cell)
    c.showPage()
    c.save()

    reader = PdfReader(path)
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    for page in PdfReader(tmp2).pages:
        writer.add_page(page)
    with open(path, "wb") as f:
        writer.write(f)
    os.remove(tmp2)
    return path


def make_tables_enc(name, src):
    """加密的表格 PDF（用于 table 命令的“先解密后提取”链路）。"""
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(src)
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt("userpw", use_128bit=True)
    with open(os.path.join(OUT, name), "wb") as f:
        writer.write(f)
    return os.path.join(OUT, name)


def make_images(name):
    """两页图片 PDF：第 1 页 JPEG（DCTDecode），第 2 页 PNG 位图（FlateDecode）。"""
    import io

    from PIL import Image
    from reportlab.lib.utils import ImageReader

    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=A4)
    c.setFont("Helvetica", 14)
    # 第 1 页：红色渐变 JPEG（reportlab 保留 DCTDecode 原始流）
    img = Image.new("RGB", (120, 80))
    for x in range(120):
        for y in range(80):
            img.putpixel((x, y), (x * 2 % 256, y * 3 % 256, 128))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    buf.seek(0)
    c.drawString(72, 780, "Images Fixture - JPEG")
    c.drawImage(ImageReader(buf), 72, 560, width=240, height=160)
    c.showPage()
    # 第 2 页：蓝色 PNG（reportlab 转 FlateDecode 位图）
    img2 = Image.new("RGB", (100, 60), (30, 90, 200))
    buf2 = io.BytesIO()
    img2.save(buf2, format="PNG")
    buf2.seek(0)
    c.drawString(72, 780, "Images Fixture - PNG")
    c.drawImage(ImageReader(buf2), 72, 560, width=200, height=120)
    c.showPage()
    c.save()
    return path


def make_forms(name):
    """AcroForm 表单 PDF：文本框 / 复选框（reportlab）+ 下拉框（pypdf 注入）。

    注：reportlab 4.4.9 的 choice()/listbox() 有 lbextras UnboundLocalError
    bug，下拉框改用 pypdf 后处理往 AcroForm/Fields 注入 /Ch 字段。
    """
    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=A4)
    c.setFont("Helvetica", 16)
    c.drawString(72, 780, "Forms Fixture")
    form = c.acroForm
    c.setFont("Helvetica", 11)
    c.drawString(72, 720, "单位名称:")
    form.textfield(
        name="unit_name",
        tooltip="用水单位名称",
        x=150,
        y=712,
        width=220,
        height=20,
        value="",
        borderStyle="inset",
    )
    c.drawString(72, 680, "年用水量(万m3):")
    form.textfield(
        name="annual_use",
        tooltip="年用水量",
        x=150,
        y=672,
        width=220,
        height=20,
        value="",
        borderStyle="inset",
    )
    c.drawString(72, 600, "已签框架协议:")
    form.checkbox(
        name="signed",
        tooltip="是否已签框架协议",
        x=150,
        y=596,
        size=16,
        checked=False,
        buttonStyle="check",
    )
    c.showPage()
    c.save()

    # pypdf 后处理：注入下拉框字段 rating（/Ch）
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import (
        ArrayObject,
        BooleanObject,
        DictionaryObject,
        FloatObject,
        NameObject,
        NumberObject,
        TextStringObject,
    )

    reader = PdfReader(path)
    writer = PdfWriter()
    writer.append(reader)
    rating = DictionaryObject(
        {
            NameObject("/FT"): NameObject("/Ch"),
            NameObject("/T"): TextStringObject("rating"),
            NameObject("/V"): TextStringObject(""),
            NameObject("/Opt"): ArrayObject(
                [TextStringObject("高"), TextStringObject("中"), TextStringObject("低")]
            ),
            NameObject("/Ff"): NumberObject(1 << 18),  # Combo（位 18）
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Widget"),
            NameObject("/Rect"): ArrayObject(
                [FloatObject(150), FloatObject(632), FloatObject(270), FloatObject(652)]
            ),
        }
    )
    ref = writer._add_object(rating)
    page = writer.pages[0]
    if "/Annots" in page:
        page[NameObject("/Annots")].append(ref)
    else:
        page[NameObject("/Annots")] = ArrayObject([ref])
    acro_ref = writer._root_object.get("/AcroForm")
    acro = (
        acro_ref.get_object()
        if acro_ref is not None
        else writer._root_object.setdefault(NameObject("/AcroForm"), DictionaryObject())
    )
    if not isinstance(acro, DictionaryObject):
        acro = DictionaryObject()
        writer._root_object[NameObject("/AcroForm")] = acro
    fields = acro.setdefault(NameObject("/Fields"), ArrayObject())
    fields.append(ref)
    acro[NameObject("/NeedAppearances")] = BooleanObject(True)
    with open(path, "wb") as f:
        writer.write(f)
    return path


if __name__ == "__main__":
    print(make_plain("a.pdf", 5, "PAGE-A"))
    print(make_plain("b.pdf", 3, "PAGE-B"))
    print(make_cn("cn.pdf"))
    print(make_toc("toc.pdf"))
    print(make_tables("tables.pdf"))
    print(make_tables_enc("tables_enc.pdf", os.path.join(OUT, "tables.pdf")))
    print(make_images("images.pdf"))
    print(make_forms("forms.pdf"))
    print("fixtures done ->", OUT)
