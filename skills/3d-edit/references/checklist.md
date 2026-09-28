# 自验证循环与故障排查（checklist）

## 核心认知：一次生成不值钱，闭环迭代才值钱

出圈的"one-shot 3D 城市"实测均为 **60~90 分钟、7 轮以上自我修正** 的产物。
Agent 必须执行"写 → 跑 → 看 → 改"循环，禁止写完 HTML 直接交付。

## 标准循环（每轮 5 步）

1. **跑**：**必须用本地 HTTP server，不要 file:// 双击**——本模板是 `<script type="module">`+importmap，`file://` 协议会被浏览器静默拦截跨源 module 加载（无报错、canvas 不出现、网络面板空），极易误判。启动 `python -m http.server 8765` 后访问 `http://127.0.0.1:8765/xxx.html`，等首帧稳定（~2s，CDN 需联网）。成品若交付给走 file:// 的用户，须把 three.module.js 与 addons 下到同目录改相对 import。
   - **无头/隐藏视口兜底**：内置浏览器 `innerWidth` 可能为 0（0x0 画布）。模板暴露 `window.CITY`：`CITY.stats`→`{buildings,cars,drawCalls,tris}`；`CITY.shot(1280,800)` 强制设尺寸+渲染一帧返回 PNG dataURL（无头截图正解）；`CITY.snap(k)` 瞬时切预设机位（k 与键盘一致 1-based）。判断纯色：对 shot 图 canvas 采样算 `lumMax-lumMin` 与 distinctColors，跨度过小=画面异常。
   - **rAF 暂停铁律**：内置浏览器后台标签页会**暂停 requestAnimationFrame**。凡依赖主循环的状态——tween 运镜、`controls.update()` 的相机 lookAt、按相机位置切换的可见性——在 agent 调用时全都不执行。症状：`go(k)` 后截图机位纹丝不动、snap 后相机朝向还是旧的（画面偏出主体）、背面机位穿进墙里。对策：agent 一律用 `snap(k)`（内部已补 `camera.lookAt(target)` + `syncState()`），不要用 `go(k)`；自定义的场景同步逻辑必须抽进 `CITY.syncState()`，禁止只写在 rAF 循环里。
2. **读文本通道**：`list_console_messages` —— 任何 error 级别都要处理；
   先确认 `[3d-edit] OK buildings=... drawCalls=... tris=...`（脚本起来了且首帧渲染完成；技能合并前的老产物打 `[3d-creat] OK`，`check` 两者都认），
   再确认 `[3d-edit] kit v1.3 ready params=... entities=... patches=...`（编辑运行时装载成功，局部修改的前置条件）；
   没有 `[3d-edit] OK` = 脚本在初始化阶段就炸了；有 OK 但无 kit ready（或打 `[3d-edit] SKIP`）= SCENE 契约断了，跑 `node scripts/edit3d.mjs check <file>` 定位。
   > 排障"module 静默不执行却无报错"：取 `[...document.scripts].find(s=>s.type==='module').textContent`，去掉 `import` 行，用 `await import()` 到的依赖作参数 `new Function(...)` 手动调用，异常栈直接指向源码行。实战坑：`-(x)**2`（一元负号紧贴幂）是 JS 语法错误 → 整个 module 静默不执行 → canvas 不出现。
3. **读视觉通道**：优先真图目检，**不要只靠像素统计盲改**（"路灯被楼吞了"这种错，统计只看得到"暖色像素少"，看不出根因）。内置浏览器标签页可见时用 `take_screenshot`；后台/隐藏（报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`）时起 `node scripts/capture.mjs <outDir> --port 8941`，页内 `await fetch('http://127.0.0.1:8941/',{method:'POST',headers:{'x-name':'wide'},body:CITY.shot(1280,800)})` 落盘后 Read 目检。对照下方"视觉体检单"逐项检查。
   - **覆盖矩阵，不许只看默认机位**：每个预设机位（snap 1~6）× 每个切换态（标注开/关、开盖件闭合/掀开）都要出一张图目检。角度相关穿帮（近共面 z-fighting 摩尔纹、Sprite 标注穿透模型、部件悬空缝隙）往往只在斜视角暴露——正视干净 ≠ 没问题。
   - evaluate 批量截图注意超时：6 机位一批容易超 15s，分 2~3 张一组。
4. **改**：一轮只处理一类问题（先报错→再黑屏/穿帮→再性能→最后审美），防止改 A 坏 B。
   - **对已有场景的局部诉求**：走 `edit-playbook.md` 三级路由（P1 MANIFEST patch → P2 实体 patch → P3 锚点手术），禁止全文重写；P3 与 rebuild 级改动必须做 playbook 里的**对照对复核**（改前/改后同 seed 同机位逐对目检，无关差异即回滚）。
   - **编辑卫生**：手写/编辑代码后 grep 一遍关键赋值（如 `castShadow`、`receiveShadow`），确认没被上一行的行尾注释吞掉（`// 注释 ... key.castShadow = true;` 会让语句变注释的一部分，**静默失效无报错**）。给 HTML 加注释时，代码语句必须另起一行。
5. **回归**：重跑确认，截图对比上一轮。至少完成 3 轮才能交付；用户说"不够精美"= 继续 2 轮审美专项（配色/雾/辉光/构图），不要空口答应。

## 视觉体检单（截图后逐项过）

- [ ] 有东西：非纯黑/纯白/纯色（相机没在地平线下、物体没在 far 外）
- [ ] 有层次：近实远虚（雾生效），画面深浅至少 3 个明度档
- [ ] 有冷暖：夜景 冷蓝环境+暖橙窗光；日景 天蓝+地面暖灰。整图单色相 = 丑
- [ ] 无穿帮：建筑不陷地/不悬空、不互相穿模、车不飘楼里、水面不 Z-fighting 闪面；**斜视角专查近共面分层**（屏幕/玻璃/铭牌层间距 <0.01×场景尺度会出摩尔纹）；线缆/软管末端不悬空成"拐杖钩"
- [ ] 有主体：默认机位里有一个可辨认的焦点（CBD 群/塔/桥），不是均匀麻将盘
- [ ] 无空白大面：产品/装置类场景里的大面积单色板（铭牌、面板）必须有 canvas 文字或细节，否则读作"未完成的白块"
- [ ] **S 档专查·贴地位**：至少 1 张 y≤0.1× 主体高的贴地截图，专抓"立管/支架从主体体积里穿过"——正视与俯视看不见
- [ ] **S 档专查·深色小件**：轮胎/橡胶握把/黑色台面等深色件，在浅背景+弱接触阴影下会糊成一团黑盘，必须给方向性纹理（胎纹/滚花）并把接触阴影压深（地面 `envMapIntensity` 0.3~0.4）
- [ ] **S 档专查·外凸件根部**：扶手、支架、拉杆的根部要么落在主体投影之外，要么走板底/内部受力层，不能"从板子里长出来"
- [ ] 会动：至少一个运动元素（车流/水波/云/自动巡城）；S 档棚拍可豁免运动，但要有自动环绕或机位可切
- [ ] HUD 完整：标题、操作提示、机位说明在位且可读

## 故障对照表

| 症状 | 高概率原因 | 处理 |
|---|---|---|
| 全黑但无报错 | 相机在地面下 / fog 太浓 / bloom threshold 吞光 / 材质 color 与 map 双黑 | 挪相机到 (200,150,300) 试；console.log 相机坐标验证 |
| 全白/糊 | Bloom strength>1.5 或 threshold≈0 | 回到模板默认值再微调 |
| 贴图纯黑 | Canvas 画在纹理上传之后（CanvasTexture 需先画后建）或 needsUpdate 未置 | 调整顺序 |
| 楼陷地/悬空 | 实例支点没 translate 到脚底；makeScale 与 setPosition 顺序错 | 先 makeScale 后 setPosition |
| 地面与水面闪面 | 两个共面几何 Y 相同（Z-fighting） | 拉开 ≥0.15 高差；分层薄面（屏幕+玻璃+铭牌）间距 ≥0.01×场景尺度，斜视角复查 |
| 斜视角才有摩尔纹、正视干净 | 近共面薄层 z-fighting（只在非正对角度暴露） | 拉开层间距或 polygonOffset；**必须换机位复查** |
| go(k) 后截图机位不动 / snap 后画面偏出主体 | 后台标签页 rAF 暂停：tween 与 controls.update() 的 lookAt 不执行 | agent 用 `CITY.snap(k)`（瞬时+手动 lookAt+syncState），别用 go；状态同步别只写在 rAF 循环 |
| 阴影/某属性静默失效、无报错 | 赋值语句被上一行行尾注释吞掉（编辑事故） | 编辑后 grep 关键赋值确认独立成行；注释与代码分行 |
| 金属面白斑过曝（伴随 bloom） | 环境贴图灯板/主光的**镜面反射**进入相机，不是辉光的锅 | 先挪主光改变反射方向，再 roughness↑/envMapIntensity↓；别乱调 bloom（会误伤屏幕辉光） |
| 标注 Sprite 穿透模型悬浮 | depthTest:false + 标签落在模型轮廓投影内 | 标签摆到模型剪影外（引线指向部件）；标注模式必须截图目检 |
| 线缆/软管像"拐杖钩" | Catmull-Rom 端点切线失控；落地水平段太短；管心陷地 | 垂直段+长缓弧+末端被遮挡；贴地段管心抬高一个半径；TubeGeometry 分段 ≥40 |
| 地平线脏边 | 雾色 ≠ 天空地平线色 | 统一取 skyHorizon |
| 掉帧 | drawCalls>150 / pixelRatio 未封顶 / 阴影开了 | 按 recipes 性能预算表逐项砍；夜景直接 renderer.shadowMap 关 |
| import 报错 404 | importmap 用了不存在的版本/裸包名 | 固定 unpkg 已验证版本， addons 路径带 examples/jsm/ |
| 改了没变化 | 浏览器缓存 file:// | 换端口或加 ?v=n 重载 |
| 画面"对但丑" | 缺运动物/缺冷暖/机位平 | 三板斧重跑 + 给 1 个低机位预设 |
| 棚拍整图乳白过曝、接触阴影被冲淡 | 近白背景（`#dfe6ee` 一类）亮度越过 `bloom.threshold` | threshold 抬到 ≥1.05 + 背景/地面 `envMapIntensity` 压到 0.3~0.4；**别靠降 exposure 救**（金属高光一起死） |
| 深色小件（轮胎/握把/黑台面）读成一团黑盘 | 浅背景下无方向性纹理 + 接触阴影太淡 | 加 CanvasTexture 方向纹（胎纹/滚花）+ 地面 `envMapIntensity`↓ 让阴影显形 |
| 面板显示"某层关着"但画面里它还在（或反之） | `effect:'hot'` 的 `apply` 直改对象、绕过实体 props 记录 | 开关"一整层"的参数改用 `effect:'rebuild'`；注册时显式带 `props:{visible:…}`（见 edit-playbook） |
| 用户一打开页面就弹"有 N 条草稿待恢复" | agent 自验证里的 `CITY.set()` 探针写了 localStorage 草稿 | 收尾 `Object.keys(localStorage).forEach(k=>localStorage.removeItem(k))` 并重载，确认 console 无 `pendingRestore` 警告 |
| 特写机位突然只剩一个端盖/物体出画 | 上游 P3 改了尺寸公式，`@presets@` 还按旧外形算 | 改尺寸后重算机位表：距离 = 1.4~1.8× 主体最大外形，1~6 全机位重拍 |

## GLSL 专项

- shader 编译错误信息在 console 里极长：只取第一处 `ERROR: 0:行号` 定位。
- 保底策略：任何新 shader 先在模板旁开最小页面验证，再合并。
- 精度：`mediump` 在部分设备溢出，全屏效果写 `highp`。

## 交付标准

- 单 HTML 文件、双击可开、CDN 有网即可跑；文件头注释写明"改哪里得到什么"。
- console 有 `[3d-edit] OK` 锚点日志与统计数。
- 截图集命名 `<场景名>-<序号>-<机位名>.png`（`trolley-4-低机位.png` / `city-1-hero.png`）：
  L/M 档出默认 + 最佳 2~4 张；**S 档出全套 6 张**（hero/正侧/俯视/贴地/特写/背面），
  因为单物体的穿模与比例问题只有换足角度才暴露。统计数字必须现测（见 edit-playbook 的探针写法）。
- 附 1 张默认机位截图 + 1 张最佳预设机位截图给用户体验（截图规则见用户偏好：完整内容、浅色 HUD）。
- 说明换 seed 的视觉效果（"再抽一次城"），这是程序化生成的天然演示点。

## 收尾清理清单（交付前逐项打勾，防"把测试痕迹留给用户"）

- [ ] `edit3d.mjs list <file>` 为空或只剩本次任务要求的改动；演练用的 patch 走 `clear`/`undo` 撤掉。
- [ ] 删掉演练产生的 `<file>.bak`（`apply`/`__save` 每次都会备份一份）。
- [ ] 清 localStorage 草稿（探针里的 `CITY.set()` 会写），重载确认 console 无 `pendingRestore` 警告。
- [ ] `check <file>` 全绿；重载后 console 三行齐（kit ready / `[3d-edit] OK` / surface）。
- [ ] 停掉后台 `serve` 与 `capture.mjs`；中间截图从 `scratch/` 删净，只留工作区根目录的交付 PNG。
- [ ] 本次若改了技能自身（references/scripts），把实证编号（截图名、命令输出）记进交付说明，供回溯。

