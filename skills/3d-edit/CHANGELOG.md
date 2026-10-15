# 更新日志

## 1.1.1 - 2026-10-15

- 新增「无浏览器环境：chromium 无头 CLI 渲染配方」（checklist.md）：apt 装 chromium+fonts-noto-cjk、本地 HTTP、swiftshader 截图 flags、rAF 日志阈值适配（swiftshader 下 30 帧跑不满 → 降到 3）、PIL 像素统计目检替代（分区 luma/近黑占比/暖冷像素/轮间趋势，夜景主体区 luma 35~45 达标带）；来自"云顶华庭"商品楼 S 档实战（408 窗 251 亮、5 轮提亮 27→40）
- 新增生成脚本做锚点区块手术的防护：语法闸三道顺序（.mjs node --check → edit3d.mjs check → 无头渲染）；"Unexpected end of input" 排查法（五态状态机扫描器，裸括号计数会被字符串/注释/模板骗——实证模板 shader 与注释反引号各骗一次）
- 障碍速查表 +6 行：锚点手术吞闭符、node ESM 自动检测假通过、无浏览器沙箱、无头拿不到 OK 日志、夜景黑坨（主光移相机象限+强度上探+微 emissive）、无视觉输入环境的像素统计验证
- SKILL.md 第 3 步补无浏览器/无视觉环境指针

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
