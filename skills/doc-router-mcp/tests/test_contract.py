# -*- coding: utf-8 -*-
"""契约测试(1.5): 对全部工具统一跑 正常+失败+schema+完整性"""
import asyncio, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from harness import Harness
import pytest

@pytest.fixture()
def h():
    hh = Harness(Path(__file__).parent.parent / "tools")
    hh.load_all()
    return hh

def test_all_manifests_have_dual_channel():
    for mf in Path(__file__).parent.parent.glob("tools/*/manifest.json"):
        m = json.loads(mf.read_text("utf-8"))
        assert {"name","version","capabilities","inputSchema",
                "use_when","avoid_when","cost_hint","human_summary"} <= set(m)
def test_route_unknown_capability(h):
    import asyncio
    out = asyncio.run(h.route({"capability": "doc.nope"}))
    assert out["error"]["code"] == "E_NO_CAPABILITY" and "doc.scan" in out["error"]["detail"]
def test_scan_ok_and_compact(h, tmp_path):
    for i in range(8):
        (tmp_path / f"f{i}.md").write_text(f"# 标题{i}\n内容", encoding="utf-8")
    out = asyncio.run(h.route({"capability": "doc.scan", "target": str(tmp_path)}))
    assert out["result"]["count"] == 8 and len(out["result"]["rows"]) <= 5   # P2 裁剪
    assert "human" in out
def test_scan_full_detail(h, tmp_path):
    for i in range(8):
        (tmp_path / f"g{i}.md").write_text("# 标题%d\n内容" % i, encoding="utf-8")
    out = asyncio.run(h.route({"capability": "doc.scan", "target": str(tmp_path),
                               "meta": {"with_detail": True}}))
    assert len(out["result"]["rows"]) == 8                                                  # P2 全量
def test_summarize_bad_file(h):
    out = asyncio.run(h.route({"capability": "doc.summarize", "file": "X:/无.md"}))
    assert out["error"]["code"] == "E_BAD_FILE" and "doc.scan" in out["error"]["detail"]    # 1.7 可行动错误
def test_reindex_sync_mode(h, tmp_path):
    out = asyncio.run(h.route({"capability": "doc.reindex", "target": str(tmp_path),
                               "out": str(tmp_path/"index.md"), "meta": {"sync": True}}))
    assert "files" in out["result"]                                                          # 空目录也不炸
def test_integrity_guard(h, tmp_path):
    mf = Path(__file__).parent.parent / "tools/scan_dir/manifest.json"
    orig = mf.read_bytes(); mf.write_bytes(orig + b"\n")                                    # 模拟 rug-pull
    try:
        out = asyncio.run(h.route({"capability": "doc.scan", "target": str(tmp_path)}))
        assert out["error"]["code"] == "E_INTEGRITY"                                        # P4 拦截
    finally:
        mf.write_bytes(orig)
