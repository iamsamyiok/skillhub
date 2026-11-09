# assetlib — SimReady 物体资产库（3d-edit v1.3+）

2,595 个真实感日常物件 GLB（NVIDIA SimReady Assets，CC BY 4.0；glb 档转换来自 codepawl/simready-glb），
含分类/三角面数/包围盒/物理元数据，中英文可检索。完整手册见 `../references/assetlib.md`。

```bash
python3 assetlib/search.py 马克杯 -n 5 --json   # 检索（中英文皆可，--json 机器可读）
python3 assetlib/fetch.py kitchenware_mug_c01 --thumb   # 下载到 cache/（断点跳过）
```

- `catalog.jsonl`：目录成品（2,595 条）；`search.py`/`fetch.py`：检索与本地缓存下载，零第三方依赖
- `cache/`：下载缓存，`.gitignore` 忽略（按需 fetch，不入库）
- `build_catalog.py`：目录再生（库更新时，用法见文件顶部注释与 references/assetlib.md「目录再生」）
- `raw/` 未随 skill 分发（3.5MB 元数据），再生时从 HuggingFace `codepawl/simready-glb` 下载
- 使用资产须署名：`3D assets: NVIDIA SimReady Assets (CC BY 4.0)`
