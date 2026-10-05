# 更新日志

## 2.1.0 - 2026-10-05

- 跨平台便携化：移除全部硬编码个人路径（Node/Python/工作区目录），改为 PATH 探测 + `<skill>` 相对引用，Linux / Windows / macOS 通用
- 新增 DXF 导出（R12 ASCII 实体）：CLI `--dxf`（并入 `--all`）、`api.exportDXF()`、`toDXF()`；Y 轴已翻转为 CAD 惯例（Y 向上），可直接用于激光切割下料或导入 AutoCAD/Fusion 等
- 新增 `doctor` 自检子命令：一键输出引擎版本 / Node / Python 状态 / 冒烟绘图结果
- 新增回归测试 `test/run-tests.js`：doctor + 全部正例示例（含新 flange）+ bad.js 负例，期望 ALL_PASS
- 新增示例 `examples/flange.js`（法兰盘：多孔环阵 + 半径标注 + 文字标题）
- SKILL.md 路由表新增 3D 转介规则：需要 STEP/STL 实体、工程图 PDF、可制造性检查时转 text-to-cad（生态互补）
- 引擎版本号升至 cadAPI-2.1-headless

## 1.0.0 - 2026-09-28

- 首版：CAD-CREATE（无头引擎 SVG/PNG/CSV）+ SVG-EDIT（id 寻址 / 过滤器 / 点选 / 版本化）融合技能
