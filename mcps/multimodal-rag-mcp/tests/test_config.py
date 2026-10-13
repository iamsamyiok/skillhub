from __future__ import annotations

import pytest

from app.config import load_config
from app.errors import RagError


def test_load_example_config(tmp_path):
    example = (tmp_path / "config.example.toml")
    example.write_text(
        """
[server]
state_dir = "./data"
default_library_id = "default"

[[libraries]]
id = "default"
name = "默认知识库"
root_path = "./knowledge"
""",
        encoding="utf-8",
    )
    cfg = load_config(example)
    assert cfg.server.default_library_id == "default"
    assert cfg.libraries[0].id == "default"
    assert cfg.libraries[0].root_path == (tmp_path / "knowledge").resolve()


def test_unknown_key_rejected(tmp_path):
    example = tmp_path / "config.toml"
    example.write_text(
        """
[server]
state_dir = "./data"
bogus_key = 1

[[libraries]]
id = "a"
name = "A"
root_path = "./knowledge"
""",
        encoding="utf-8",
    )
    with pytest.raises(RagError) as ei:
        load_config(example)
    assert ei.value.code == "CONFIG_INVALID"


def test_default_library_must_exist(tmp_path):
    example = tmp_path / "config.toml"
    example.write_text(
        """
[server]
state_dir = "./data"
default_library_id = "missing"

[[libraries]]
id = "a"
name = "A"
root_path = "./knowledge"
""",
        encoding="utf-8",
    )
    with pytest.raises(RagError):
        load_config(example)
