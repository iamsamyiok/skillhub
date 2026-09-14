#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""doc-to-md 统一转换入口：自动降级 anydoc → OCR → markitdown"""
import argparse, json, os, re, sys, pathlib

def load_config():
    """key 读取顺序：环境变量 → ~/.config/doc-to-md/config.json"""
    cfg = {}
    f = pathlib.Path.home() / ".config" / "doc-to-md" / "config.json"
    if f.exists():
        try:
            cfg = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "siliconflow_api_key": os.environ.get("SILICONFLOW_API_KEY") or cfg.get("siliconflow_api_key", ""),
        "siliconflow_endpoint": os.environ.get("SILICONFLOW_ENDPOINT") or cfg.get("siliconflow_endpoint", "https://api.siliconflow.cn/v1"),
        "ocr_model": cfg.get("ocr_model", "PaddlePaddle/PaddleOCR-VL-1.5"),
        "mineru_api_key": os.environ.get("MINERU_API_KEY") or cfg.get("mineru_api_key", ""),
    }

def is_scanned_pdf(path):
    """PDF 文本层 < 50 字符视为扫描型"""
    if path.suffix.lower() != ".pdf":
        return False
    try:
        import fitz
        doc = fitz.open(str(path))
        text = doc[0].get_text()[:2000]
        doc.close()
        return len(text.strip()) < 50
    except Exception:
        return False

def clean_ocr(text):
    """清理 OCR 杂讯标记"""
    text = re.sub(r'<\|LOC_\d+\|>', '', text)
    text = re.sub(r'<\|[^|]*\|>', '', text)
    return text

def conv_anydoc(path):
    import anydoc
    return anydoc.to_markdown(str(path))

def conv_ocr(path, cfg):
    import base64
    import requests
    import fitz
    key = cfg["siliconflow_api_key"]
    if not key:
        raise RuntimeError("SiliconFlow key 未配置：设置环境变量 SILICONFLOW_API_KEY（见 CONFIG.md）")
    doc = fitz.open(str(path))
    md_parts = []
    for page in doc:
        pix = page.get_pixmap(dpi=200)
        img_b64 = base64.b64encode(pix.tobytes("png")).decode()
        r = requests.post(
            f"{cfg['siliconflow_endpoint'].rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": cfg["ocr_model"],
                  "messages": [{"role": "user", "content": [
                      {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
                      {"type": "text", "text": "将图中内容完整转为 Markdown"}]}]},
            timeout=120)
        r.raise_for_status()
        md_parts.append(clean_ocr(r.json()["choices"][0]["message"]["content"]))
    doc.close()
    return "\n\n".join(md_parts)

def conv_markitdown(path):
    from markitdown import MarkItDown
    return MarkItDown().convert(str(path)).text_content

def convert_one(path, force_ocr=False, cfg=None):
    cfg = cfg or load_config()
    suffix = path.suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png"} or force_ocr or is_scanned_pdf(path):
        return conv_ocr(path, cfg), "ocr"
    try:
        return conv_anydoc(path), "anydoc"
    except Exception:
        if suffix in {".pdf"}:
            return conv_ocr(path, cfg), "ocr-fallback"
        return conv_markitdown(path), "markitdown"

def main():
    ap = argparse.ArgumentParser(description="文档转 Markdown（自动降级）")
    ap.add_argument("input", nargs="?", help="输入文件或目录（--check-config 时可省略）")
    ap.add_argument("-o", "--output", help="输出文件（单文件）或目录（批量）")
    ap.add_argument("--ocr", action="store_true", help="强制走 OCR")
    ap.add_argument("--check-config", action="store_true")
    args = ap.parse_args()

    cfg = load_config()
    if args.check_config:
        def st(ok, name, extra=""):
            print(f"[{'ok' if ok else '--'}] {name:<12} {extra}")
        try:
            import anydoc; st(True, "anydoc", "本地引擎就绪")
        except ImportError: st(False, "anydoc", "pip install firecrawl-anydoc")
        st(bool(cfg["siliconflow_api_key"]), "SiliconFlow",
           "key已配置" if cfg["siliconflow_api_key"] else "未配置（见 CONFIG.md）")
        try:
            import markitdown; st(True, "markitdown", "备选就绪")
        except ImportError: st(False, "markitdown", "可选: pip install markitdown")
        st(bool(cfg["mineru_api_key"]), "MinerU", "已配置" if cfg["mineru_api_key"] else "未配置（可选）")
        return

    src = pathlib.Path(args.input)
    files = [src] if src.is_file() else sorted(
        p for p in src.iterdir() if p.suffix.lower() in
        {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf", ".rtf", ".epub", ".csv", ".jpg", ".jpeg", ".png"})
    out_dir = pathlib.Path(args.output) if args.output else src.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    ok = fail = 0
    for f in files:
        if src.is_dir():
            out = out_dir / (f.stem + ".md")
        else:
            out = pathlib.Path(args.output) if args.output else f.with_suffix(".md")
            if out.suffix.lower() != ".md":      # 给了目录则放入目录
                out = out / (f.stem + ".md")
        try:
            if out.is_dir():                    # 之前失败遗留的同名目录 → 自动改名
                out = out.with_name(out.stem + "_1.md")
            md, engine = convert_one(f, force_ocr=args.ocr, cfg=cfg)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(md, encoding="utf-8")
            print(f"[ok] {f.name} -> {out}  ({engine}, {len(md)} chars)")
            ok += 1
        except Exception as e:
            print(f"[fail] {f.name}: {e}")
            fail += 1
    print(f"\n完成: {ok} 成功, {fail} 失败")

if __name__ == "__main__":
    main()
