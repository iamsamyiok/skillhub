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

## 1.2.0 (2026-10-19)

新增相机 JSON 合同 / 剖切 / window 命令通道（借鉴 SolidCraft MCP camera 与 close-up recipe）：

- `CITY.camera({target,yaw,pitch,distance,fov})`：弧度合同（yaw 0=正面 -Z 看 +Z，pitch=仰角，π/2=顶视）；`fov:0`/缺省 = 正交观感（半高 0.4×distance，2° 窄视场远距模拟）；自动扩 far 平面
- `CITY.cam()`：读回当前相机 JSON，与 camera() 互逆（fov 统一弧度，往返修复过单位 bug：曾度/弧度双转致 3283° 黑屏）
- `CITY.saveView(name)/view(name)/views()`：命名机位，独立于 1~6 预设；存 cam() 快照可跨会话复现
- `CITY.section({axis,at}|{origin,normal},flip?)`：全局裁剪面剖切，保留法向指向侧；rebuild 后仍有效；`section(null)` 关闭
- `CITY.execute(cmd,params)` + `CITY.commands()`：13 命令统一通道（人机同源），未知命令返回命令目录
- 模板自测锚点（e2e 注入验证）：roundtrip（yaw/pitch/distance/fov 四元互逆）、viewFovRoundtrip、section 开关、shot、stats、unknownCmd 拒绝；无头渲染 PIL 复核 mean=22.4 mid=19.3%（夜景城内容正常）
- SKILL.md：新章节「相机 JSON / 命名机位 / 剖切 / window 命令通道」+ 特写/剖视配方（section→正交 camera→shot→微调）

## 1.3.0 (2026-11-09)

新增 SimReady 物体资产库（assetlib）——日常物件"检索复用优先、程序化生成兜底"：

- 内置 `assetlib/`：catalog.jsonl（2,595 个真实感 GLB，源自 NVIDIA SimReady Assets，CC BY 4.0；取 codepawl/simready-glb 的 glb 档）+ `search.py` 中英文检索（192 类别中文映射+物件别名表+IDF 加权，`--json` 机器可读）+ `fetch.py` 本地缓存下载（断点跳过/缩略图）+ `build_catalog.py` 目录再生（raw 元数据 3.5MB 不随包分发，再生方法见手册）
- SKILL.md 新增第 1.6 步「日常物件先查库」：S 档主体/数字孪生设备件/场景配菜先 search → fetch 进 `assetlib/cache/` → GLTFLoader 挂 MeshoptDecoder 加载（库内 GLB required 扩展 EXT_meshopt_compression，不挂直接报错）→ Box3 归一化米制落地进实体表；查无或需参数化变体族再手搓
- 铁律 1 增补例外：本地缓存 GLB（禁止运行时直连外网）与 base64 单文件内嵌；边界补"assetlib 首次 fetch 需联网，缓存后离线可用"
- 新增 `references/assetlib.md` 手册：字段表、meshopt/量化/WebP 扩展加载要点、归一化落地配方、base64 内嵌、KTX2/lods 档位取舍、性能预算（triangles 选件）、CC BY 4.0 署名要求、目录再生
- 障碍速查 +1 行（真实感日常物件→先查库）；Resources 同步收录
- 手册新增「夜景打光与无头验证」节（别墅庭院 M 档实战反哺）：物理光单位点光量级表（decay=2 下室内 6/水下 9/柱灯 2.6——1.5 级强度在 PBR 上近乎不可见）、点光源封死实心壳的开口壳配方（泳池冷光 8 px→268 px 实证）、swiftshader virtual-time rAF 早停的补渲兜底、renderer.info 陈旧读数时机（7,020 vs 真值 361,536）、GLB drawCalls 估算（每件 2~4）、transmission 玻璃夜景慎选；base64 节补实测双分支代码路径（__GLB_B64__ 走 parse 否则 load，外链/单文件同码）；何时查库表补库覆盖弱项处置（庭院家具等两轮无果转程序化）；fetch 示例补 --dest 直下项目 assets
- checklist：无浏览器配方新增第 7 条 GLB 专项（props loaded 后读统计、#p hash 多机位覆盖）；故障对照表 +3 行（GLB 截图消失/统计陈旧、点光封死实心壳、GLB 夜景打不亮的物理光单位）
- template.html 新增 URL hash 机位直达（`#p1~#p6` 载入即 snap，无头多机位验证矩阵标准化；无 hash 零行为）；SKILL.md 1.6 步补夜景打光/无头验证四坑摘要与摘要行 hash 说明
