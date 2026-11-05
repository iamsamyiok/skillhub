# Vendor: everything-cad 几何内核

- 来源: https://github.com/HeyPuter/everything (`src/cad/src/core` + `src/cad/src/io`)
- 许可: MIT (见 LICENSE-everything-cad, 原仓库许可证保留)
- 快照 commit: 8a2574649deed1cf9419dd16b783e62313193375 (2026-11-05)
- vendor 范围: core/(几何内核+填充+标注+文字) + io/(DXF R2000 读写/DWG R13-2018 导入/导出)
- 未 vendor: editor/(交互编辑器)/render/(WebGL)/ui/(界面) — 浏览器专用, 本 skill 无头场景用不到
- 接口层: ../geom-boost.mjs (老引擎 schema ↔ 本内核 schema 转换 + 无头 CLI)
- 验收: 内核抽样 21/21(含平行线 fillet/尖角自交 offset/1e-6 与 1e6 坐标退化) + DXF roundtrip 6/6 (test-geom-boost.mjs)

## 实体模型差异(适配层职责)
| | 老引擎(cad-engine.js) | everything-geom |
|---|---|---|
| 坐标系 | SVG 系, Y 向下, 像素 | 数学系, Y 向上, 世界单位 |
| 角度 | 弧度(内部), ccw 标志 | 弧度, 恒 CCW start→end |
| 实体 | {type, p1:{x,y}, c:{x,y}...} | 平铺字段 {x1,y1,x2,y2...} |
| polyline | points:[{x,y}] 无 bulge | pts:[x,y,bulge...] 支持 bulge |
| rect | 原生 | 无(转闭合 polyline) |
| text/dim | 有 | io 有但 boost v1 不转换 |
| spline | fit 点 | ctrl+node 点(boost v1 不转) |
