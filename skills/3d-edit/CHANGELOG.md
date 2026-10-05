# 更新日志

## 1.1.0 - 2026-10-05

- 新增 GLB 导出：模板 `CITY.glb()/saveGlb()`（GLTFExporter，二进制 glTF）+ G 键快捷导出 + editor.html「⬇ GLB」按钮；capture.mjs 增加二进制通道，页面导出的 GLB 直接 POST 落盘——场景可进 Blender/Unity/在线查看器
- 新增工程测量模式（数字孪生交付）：M 键 / `CITY.measure()` 动态比例尺 + 场地尺寸/最高建筑换算；`CONFIG.perUnit/unitLabel` 定标（1 单位=几米）并登记进 MANIFEST（`find('单位')` 可改）；S 档自定义场景可用 `window.__DIM__` 覆盖钩子
- 新增 `edit3d.mjs doctor` 技能环境自检（模板/kit 同步/编辑器/配方/GLB/测量在位性，JSON 输出）
- 新增回归测试 `test/run-tests.js`：check 全绿 + manifest 解析 + patch 写入/撤销闭环 + kit 区零污染（11 项，期望 ALL_PASS）
- recipes.md 新增「标准件参数注册表」（桥/门式起重机/冷却塔/变压器/大坝：参数表+建模要点+实体注册约定），性能预算表增补 S/M/L 分级预算与交付物工程化说明
- 模板新增 `@meas-fn@` 规则锚点（第 6 个）；HUD 提示更新（M 测量 · G 导出GLB）
- edit3d.mjs 用法说明补 doctor；editor.html 工具栏补 GLB 按钮

## 1.0.0 - 2026-09-28

- 首版：3d-creat（生成）与 3d-edit（编辑）合并；单文件 HTML + Three.js 程序化生成，MANIFEST/实体/锚点三级局部编辑，kit v1.3，editor.html 人工编辑宿主页
