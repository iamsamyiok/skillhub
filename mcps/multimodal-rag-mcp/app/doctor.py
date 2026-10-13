from __future__ import annotations

import shutil


def _writable(path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".doctor_probe"
        probe.write_text("ok")
        probe.unlink()
        return True
    except OSError:
        return False


def run_doctor(ctx) -> dict:
    cfg = ctx.cfg
    checks: list[dict] = []

    def add(name: str, ok: bool, detail: str = ""):
        checks.append({"check": name, "ok": ok, "detail": detail})

    add("config_loaded", True, str(cfg.config_path))
    try:
        import mcp
        import zvec

        add("core_dependencies", True, f"zvec={getattr(zvec, '__version__', 'ok')} mcp ok")
    except ImportError as e:
        add("core_dependencies", False, str(e))
    add("state_dir_writable", _writable(cfg.state_path), str(cfg.state_path))
    for lib in cfg.libraries:
        add(f"library:{lib.id}", lib.root_path.is_dir(), str(lib.root_path))
    add("embedding_provider", cfg.embedding.is_configured(),
        "configured" if cfg.embedding.is_configured() else "not configured (full_text only)")
    add("vision_provider", cfg.vision.is_configured(),
        "configured" if cfg.vision.is_configured() else "not configured")
    add("asr_provider", cfg.asr.is_configured(),
        "configured" if cfg.asr.is_configured() else "not configured")
    ff = shutil.which("ffmpeg")
    add("ffmpeg", bool(ff), ff or "not found (video indexing disabled)")
    try:
        import pypdf  # noqa: F401
        import docx  # noqa: F401
        import pptx  # noqa: F401
        import openpyxl  # noqa: F401

        add("document_parsers", True, "pypdf/python-docx/python-pptx/openpyxl")
    except ImportError as e:
        add("document_parsers", False, str(e))

    optional = {"embedding_provider", "vision_provider", "asr_provider", "ffmpeg"}
    required_checks = [c for c in checks if c["check"] not in optional]
    return {
        "service": cfg.server.name,
        "transport": cfg.server.transport,
        "default_library_id": cfg.server.default_library_id,
        "checks": checks,
        "all_ok": all(c["ok"] for c in checks),
        "required_ok": all(c["ok"] for c in required_checks),
        "optional_missing": [c["check"] for c in checks if c["check"] in optional and not c["ok"]],
    }
