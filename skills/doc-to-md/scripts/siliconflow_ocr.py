#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SiliconFlow OCR 模块 — API Key 从环境变量/配置文件读取，绝不明文硬编码"""
import base64, json, os, pathlib, re
import requests

ENDPOINT = "https://api.siliconflow.cn/v1"
MODEL = "PaddlePaddle/PaddleOCR-VL-1.5"

def get_api_key():
    key = os.environ.get("SILICONFLOW_API_KEY", "")
    if key:
        return key
    f = pathlib.Path.home() / ".config" / "doc-to-md" / "config.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8")).get("siliconflow_api_key", "")
    return ""

def clean_text(text):
    """清理 OCR 定位杂讯标记 <|LOC_n|>"""
    return re.sub(r"<\|LOC_\d+\|>", "", text)

def ocr_image(img_bytes, api_key=None):
    key = api_key or get_api_key()
    if not key:
        raise RuntimeError("缺少 SILICONFLOW_API_KEY，配置方法见 CONFIG.md")
    b64 = base64.b64encode(img_bytes).decode()
    r = requests.post(
        f"{ENDPOINT}/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": MODEL, "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            {"type": "text", "text": "将图中内容完整转为 Markdown"}]}]},
        timeout=120)
    r.raise_for_status()
    return clean_text(r.json()["choices"][0]["message"]["content"])

def ocr_pdf(pdf_path, dpi=200):
    import fitz
    doc = fitz.open(str(pdf_path))
    parts = [ocr_image(page.get_pixmap(dpi=dpi).tobytes("png")) for page in doc]
    doc.close()
    return "\n\n".join(parts)
