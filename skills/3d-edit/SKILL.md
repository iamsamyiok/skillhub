---
name: 3d-edit
version: 1.0.0
category: 前端开发
tags: [3D, Three.js, 程序化生成, 场景生成, 局部编辑, 参数化, 人工编辑, 数字孪生, WebGL]
description: 一个技能管住 3D 图的两件事——用单文件 HTML + Three.js 程序化生成宏大、精美、可交互的 3D 场景（城市/滨水/山地/数字孪生/游戏原型/单物体产品图），以及对已有场景做确定性局部修改，并按需交付给用户自己动手的可视化编辑器。当用户要求"画一个3D城市/3D场景/三维可视化""像 Claude 一键生成 3D 城市""做个可交互的 3D 网页""水库/厂区/管线数字孪生 3D 展示""给我一个小盒子/设备/推车的 3D 图"、要求 3D 汇报页/截图/PNG；或者说"把那座塔改红""河往东弯""楼密一点""雾再浓点"、指着截图某处说"改那个""去掉那栋楼"；或说"我想自己手动编辑这个 3D 图""给我个能拖的界面""别每次都得找你"时使用。零美术资产（贴图/模型全部由代码生成），种子随机可复现，内置浏览器渲染自验证循环 + MANIFEST/实体/锚点三级局部编辑层 + 零依赖人工编辑宿主页。
slug: 3d-edit
displayName: 3D Edit — 3D 场景的生成与编辑
summary: 单文件 HTML + Three.js 程序化生成可交互 3D 场景（城市/数字孪生/单物体产品图），并对已有场景做确定性局部修改与人工可视化编辑。
---

# 3D Edit — 3D 场景的生成与编辑（新建 / 改局部 / 手动调 三合一）

## 第 分流步：先判意图，再进对应工作流（每次请求的第一步）

| 用户的话 | 意图 | 走哪条 | 入口 |
|---|---|---|---|
| "画个…""做个…""生成…""来张 3D 汇报图"（**没有**现成 HTML） | 新建 | 工作流 A | 下面「工作流 A」第 0→4 步 |
| "把…改红""雾再浓点""河往东弯""楼密一点"，或指着截图说"改那个"（**有**现成 HTML） | 改局部 | 工作流 B | 「工作流 B」B1→B4 + `references/edit-playbook.md` |
| "我自己调调看""给我个能拖的页面""别每次都得找你" | 人工微调 | 工作流 B 的人工通道 | B4（`editor.html` 宿主页） |
| "再大一点""换个颜色"（歧义） | 看有无产物 | 有文件→B，无文件→A | 拿不准就一句话确认，别连环追问 |
| "再加座桥""把江改成湖""换成白天带云版" | 结构级 | 先 B1 `find`；**find 不到地址就明确转 A**（改生成代码），不要偷偷在数据层硬凑 | 已有文件就在**该文件**的 `@锚点@` 规则函数里增量写几何（取 A 的 recipes 配方，不是重新复制模板）；无文件才走 A 第 1 步 |

判据一句话：**能落到已有地址（MANIFEST `path` / 稳定实体 id）→ B；需要新一类几何或新算法 → A。**
两条工作流共用同一套骨架与同一个 patches 数据区，所以 A 的产物天生可被 B 改，B 改完还能回 A 增量重建。

## 核心原理（本 skill 的世界观）

震撼的 AI 生成 3D 场景 = 三层栈相乘，缺一层就退化成"灰绿盒子城"：

> **宏大面积 × 精美画面 × 流畅交互 = 程序化生成配方（用算法代替枚举） × 审美先验（冷暖对比/雾/辉光/构图） × 自验证迭代循环（跑→看→改）**

四条铁律：
1. **一切皆代码**：不引用任何外部贴图/模型/音频；贴图用 Canvas 画，天空水面用 shader。零美术资产，永不缺素材（three.js 本体走 CDN importmap，是唯一外链，锁版本）。
2. **种子确定性**：所有随机走 `mulberry32(seed)` 与噪声函数，禁止 `Math.random()`——保证每轮迭代画面可对比、演示可复现。
3. **迭代出精品**：one-shot 只算原型。必须执行"写→跑→看→改"循环 ≥3 轮（见 references/checklist.md），这是 90 分钟出圈 demo 的真实工作方式。
4. **局部修改不重写**：模板天生可编辑（MANIFEST 参数说明书 + 稳定实体 id + `/*@锚点@*/` 规则把手 + patches 数据区）。收到"改一小块"诉求时按 P1 参数 > P2 实体 > P3 锚点手术 三级路由（见 references/edit-playbook.md），禁止全文重写。

## 工作流 A：新建 3D 场景（第 0→4 步，全程不许跳过第 3 步）

### 第 0 步：需求定型（1 个小表，缺项用默认值，不要连环追问）

| 项 | 选项 | 默认 |
|---|---|---|
| 场景类型 | 城市 / 滨水山城 / 数字孪生(水库·厂区·管线) / 游戏场景 | 夜景城市 |
| 尺度档位 | S 单物体（一个盒子/设备/装置）/ M 局部（广场·厂区·一段河街）/ L 全城 | 按诉求自动判：问"一个 X"就用 S，别硬套全城模板 |
| 时间氛围 | 夜景(自发光+辉光, 最出彩) / 日景(汇报用) / 黄昏(折中) | 夜景 |
| 交互 | OrbitControls + 数字键预设机位 / 自动巡城 / 点击拾取标注 | 全含前两项 |
| 尺度锚点 | 必须有 1~2 个地标（塔/桥/CBD群/大坝/穿楼轻轨），否则"宏大"无参照物（S 档不需要） | CBD+江+轻轨 |
| 交付 | 单 HTML / 附截图 PNG / 两者 | 两者 |

### 第 1 步：从模板起步（不要从零写）

复制 `assets/template.html` → 改 `CONFIG`（seed、gridN、fog、bloom、pal）。
模板已含全部骨架：种子随机/fBm 噪声、渐变天空+星、指数雾、河道判定、水面实例、
InstancedMesh 建筑(窗光 Canvas 贴图+setColorAt 冷色渐变)、车流运动光带、
UnrealBloomPass、OrbitControls、1~6 预设机位 lerp、resize、`[3d-edit] OK` 自检日志。
在模板上做**增量修改**，比重新生成少 90% 的几何 bug。

**S 档（单物体：一个盒子/设备/推车/装置）不要背全城包袱**——走下面第 1.5 步的独立分支，
别套用全城模板的相机与雾默认值（那组数字是按"1 单位=1 栋楼"标定的，套到 1 米级物体会得到
"物体小如米粒 + 背景圆盘硬边"，实证见第 1.5 步）。骨架要留全，后续"换个色/再大点"仍走 P1/P2 三级路由。

### 第 1.5 步：S 档（单物体）分支工作流

来自"3D 小推车"任务（整车 0.75×0.50 m、扶手高 0.95 m，5 轮截图迭代）的沉淀。与 L/M 档的差别不是
"少写点代码"，而是**四组标定值全部要重推**：

1. **尺度约定：1 单位 = 1 米，按实物尺寸建模**。750 mm 台面就写 `deckL: 0.75`，零件厚度写真实量级
   （管径 0.0145、板厚 0.035、轮径 0.062）。禁止为了"看着大"把物体放大到几十单位——那会让雾、阴影
   相机、bloom 阈值全部失配，且用户说"再大点"时无处可加。MANIFEST 里给每个尺寸参数标 `unit:'m'`。
2. **相机**：`fov 38~42`、`near 0.01`、`far 100+`（留给背景球），**机位距离 = 1.4~1.8 × D**，
   `D = 主体包围盒最长边`（用 Box3 实测，取模型 Group 那一行，不含标注层/地面盘/天空球；
   实测脚本见 recipes"产品/装置效果图"第 15 条）。本例实测包围盒 `0.913 × 0.972 × 0.511`，
   `D = 0.972` → 距离带 1.36~1.75，hero 位 `|[1.10,0.74,1.22]-[0.03,0.46,0]|` = 1.65（比值 1.70，
   取上沿是为了整车上沿留 8% 边距）。**别用包围盒对角线当 D**（本例对角线 1.43 → 比值只有 1.15，
   会把相机拉近到裁切主体）。预设表里**必须留 1 个贴地位**（y ≤ 0.1× 主体高，本例 `p=[0.86,0.07,0.82]`）
   ——它是唯一能暴露"立管从台实体里穿出来"这类穿模的机位，本例的穿模就是它抓到的。
3. **雾与背景**：棚拍用"地面圆盘 + 天空球"两层，雾的作用不是营造纵深而是**把圆盘边缘化进背景色**。
   取 `fog ≈ 0.8~1.0 / 地面盘半径`。判据用 FogExp2 的真实衰减 `雾占比 = 1 - exp(-(fog·d)²)`：
   主体处 ≤10%（`fog·d ≤ 0.32`）、地面盘边缘处 ≥40%。本例盘半径 5.2、`fog 0.16` →
   边缘 `1-exp(-(0.16×5.2)²)` = 50%（半化开，再靠 `pal.floor` 与 `pal.wallHor` 近似同色吞掉硬边），
   主体处 `fog·d = 0.16×1.65 = 0.26` → 6.6%（ crisp）。**照全城模板默认的 `fog: 0.0016` 写会得到硬边圆盘**
   —— 同一判据下盘边缘雾占比只有 0.007%，等于没雾。
4. **光照与 bloom**：三点布光（key 1.5±带 PCFSoft 阴影、rim 冷色轮廓光 1.0±、fill 0.3、amb 0.1）+
   阴影相机框到主体包围盒（本例 `left/right/top/bottom = ±1.5`，`near 0.6 far 7`）。
   `bloom.threshold` 必须 **> 背景最亮处**（近白棚拍背景用 1.05），否则整图乳白过曝、接触阴影被冲淡；
   背景/地面的 `envMapIntensity` 压到 0.3~0.4，金属件才 1.2~1.4。

S 档的骨架六件套不变（渲染器+雾+Bloom+OrbitControls+SCENE 契约/kit+patches 区），删的是
gridN/river/建筑网格/车流；**MANIFEST、稳定实体 id、≥5 个 `/*@锚点@*/`、`CITY.snap/shot/stats`
一个都不能省**——S 档恰恰最容易被"就一个小东西"诱惑而退化成不可编辑的一次性 demo。

交付截图集按 `1 hero / 2 正侧（型录用）/ 3 俯视 / 4 贴地 / 5 细节特写 / 6 背面` 六张走，
命名 `<场景名>-<序号>-<机位名>.png`（与第 4 步一致）。特写机位（5）在 P3 改过尺寸公式后要重新推导，
否则会糊成端盖微距（实证见 edit-playbook 的"机位表跟尺寸走"）。


### 第 2 步：按需求取配方

需要扩展什么，就去 `references/recipes.md` grep 对应节：
地形高度场 / Instancing 细则 / 程序化贴图 / 水面与假反射 / 天空云 / 夜景三板斧 /
车流生活感 / 地标建模 / 运镜交互 / HUD / 性能预算表 / 真实场景改造(水库·管线) /
**产品·装置效果图（S 档必读：棚拍布光、外凸件根部、bloom 与近白背景、单件改色要 clone 材质）**。

### 第 3 步：自验证循环（本 skill 的强制环节，不可跳过）

按 `references/checklist.md` 执行：
1. 浏览器打开 → 读 console（错误 + `[3d-edit] OK buildings=... drawCalls=...` 锚点日志；
   合并前的老产物打的是 `[3d-creat] OK`，`check` 两者都认）；
2. 截图 → 过"视觉体检单"7 项（有东西/有层次/有冷暖/无穿帮/有主体/会动/HUD 完整）；
3. 一轮只修一类问题：报错 → 穿帮 → 性能 → 审美；
4. 回归重跑。交付前至少 3 轮；用户嫌"不精美"→ 追加 2 轮纯审美专项（配色/雾/辉光/机位构图）。

### 第 4 步：交付

单 HTML + 预设机位截图集，命名 `<场景名>-<序号>-<机位名>.png`（如 `trolley-4-低机位.png`；
L 档同理 `city-1-hero.png`）。报告统计数字时**必须现测**：后台标签页 rAF 暂停时
`CITY.stats.drawCalls` 是跨多次 render 的累计值（本例同一场景读到过 239/280/932，真值 122（标注关·出厂态）/ 126（标注开）），
取真值的探针只有一句：`const t=SCENE.three; t.renderer.info.reset(); t.renderer.render(t.scene,t.camera);`
然后读 `t.renderer.info.render.calls`，并注明"主渲染 pass，Bloom 合成另计"。
演示时现场换 seed（"再抽一座城"）是最有说服力的环节。


## 工作流 B：编辑已有场景（B1→B4，禁止全文重写）

产物是**生成规则**（几十 KB 代码 → 上千栋楼），不是静态模型。所以"改一处"的正确做法不是改代码，
而是往文件里的 **patches 区追加一条数据**，让场景自带的 kit 在加载时回放——可撤销、可复现、不改崩生成逻辑。

### B1：先定位，别猜（地址来自命令，不来自记忆）

```
node scripts/edit3d.mjs manifest <file>        # 参数说明书；报错=老产物没骨架，先 sync/upgrade
node scripts/edit3d.mjs find     <file> 雾      # 口语 → path/id，带取值范围
node scripts/edit3d.mjs entities <file> --like bld
node scripts/edit3d.mjs list     <file>        # 多轮续接先看这个：已经改过什么
```
- 命中不唯一**不要瞎挑**：把候选报给用户（"是最高那栋 landmark.tallest，还是 24-24 那栋？"）。
- 命中为空换词再 find（`aliases` 是生成侧写的口语词表），仍无则明说"这个地址没暴露"，转工作流 A 增量改代码。
- 用户指着截图某处说"改那个"：浏览器里 `CITY.snap(k)` 之后 `CITY.pick(nx,ny)` 拿语义实体 id
  （不 snap 直接 pick 会因后台 rAF 暂停打空）。

### B2：三级路由（优先级从上往下，代价从低到高）

| 级别 | 手段 | 典型诉求 | 工具 |
|---|---|---|---|
| P1 参数 | MANIFEST patch（只写数据不改代码） | 密度/雾/辉光/配色/规模 | `edit3d.mjs apply --set` / `CITY.set/nudge` |
| P2 实体 | entity patch（稳定 id 跨 rebuild） | 单栋楼/江面/车群 | `CITY.pick(nx,ny)` 定位 → `CITY.entity(id,props)` |
| P3 规则 | `/*@锚点@*/` 代码手术（str_replace 唯一锚点） | 河形/楼高公式/车道数/机位表 | Edit 工具碰锚点函数，之后跑 `check` |
| 人工通道 | 用户在 `editor.html` 面板/gizmo 自己拖 | "我自己调调看""给我个能改的页面" | 见 B4 |

批量写盘用一条命令改完，`--note` 必填一句人话（它就是 patches 区注释，也是用户问"上次改了啥"的答案）。
超出 min/max 会被拒（退出码 2）——按提示改值，不要绕过校验。

### B3：改完必看（没截图目检过的修改不算完成）

`serve` 起页 → `CITY.snap(k)` → `CITY.shot()` 落盘 PNG → Read 目检。必看三件：①改的生效了；
②没牵连别处（整城消失/黑屏/穿帮）；③换个机位再看。
P3 与 rebuild 级改动必须做**对照对复核**：改前 snap(1..6) 存图 → 改后同 seed 同机位再存 → 逐对目检，无关差异即回滚。
不满意就退，别重写：`CITY.undo()/reset()`、`CITY.nudge('bloom.strength', +1)` 做相对调整、
文件级 `edit3d.mjs undo <file> [n]` / `clear`。结构体检：`node scripts/edit3d.mjs check <file>` 应全绿，
console 须有 `[3d-edit] kit v1.3 ready`。

### B4：用户要自己动手改（人工编辑通道，kit v1.3+）

```
node scripts/edit3d.mjs sync <file>              # 升 kit v1.3（SCENE.three 契约需含 controls）
node scripts/edit3d.mjs editor <file> --install  # editor.html 落到场景同目录（场景文件零改动）
node scripts/edit3d.mjs serve <file> --port 8765 # 打开 http://localhost:8765/editor.html?src=<file>
```

人在面板里拖出来的东西与 agent 写的是**同一条 patch 命令流**（`param/entity/preset/add/remove`），
点「保存」走 `POST /__save` 只重写 patches 区。所以：用户改完 → agent 读 `list` 就知道改了什么，接着改；
agent 改完 → 用户刷新页面看到同样的结果。交付时提醒"改完点 💾 保存才落盘"。
详见 `references/editor-enhance.md`（三层职责、撤销语义、三项目借鉴对照、已知边界）。

### B 的铁律

1. **只碰 patches 区和 kit 标记区**；生成代码（build*、噪声、材质）不动，要动就是 P3 或转工作流 A。
2. **不手改 kit 标记区**（`//<<3d-edit:kit …>>`）——单一来源是 `assets/editkit.js`，改完 `sync` 到各文件。
3. **地址来自 find/manifest**，id 和 path 都是生成侧定的，换个场景就不一样。
4. **调色类需求优先走 P1 参数**（`pal.*`），别用 P2 实体 `color`：实体色会在 rebuild 后盖住 CONFIG 色。
5. **实例实体必须带 index**：一条 `scale` 补丁让整城消失，十有八九是实体登记成了"整体"而不是"实例"。
6. 渲染复核要本地 http + 浏览器；纯离线只能静态校验（find/manifest/list），交付时如实说明"未做视觉复核"。
7. 一次一个 HTML；不做 GLTF/其他引擎文件的编辑。

## 常见障碍速查（详见 checklist 故障表）

| 障碍 | 一招破解 |
|---|---|
| token 装不下大场景 | 写生成规则不写结果：几十 KB 代码 → 几十万栋楼 |
| 万级物体掉帧 | InstancedMesh：1 次 draw call 画一整城 |
| 缺素材/CORS/图裂 | Canvas 画贴图 + shader 画天空水面，全文件零外链素材 |
| 灰绿盒子城(丑) | 夜景三板斧：冷暖对比 + FogExp2 + Bloom + ACES 色调映射 |
| 穿模/悬空楼 | 实例几何 translate 到脚底 + 建筑先采样地形高 + 截图专查 |
| 模型看不见结果瞎改 | 强制渲染反馈闭环：console 锚点日志 + 截图体检单 |
| three.js API 版本漂移 | importmap 锁死已验证版本，模板默认 0.160.0 |
| file:// 下 module 静默不执行 | 一律用本地 HTTP server 打开；成品离线则把 three 下到本地改相对 import |
| agent 截预设机位全错位 | 后台标签页 **rAF 被暂停**：tween/lookAt/可见性同步全不执行。用 `CITY.snap(k)`（纯函数、瞬时、1-based 与键盘一致），状态同步写进 `CITY.syncState()` |
| 斜视角才有摩尔纹/穿帮 | 近共面薄层（屏幕+玻璃+铭牌）z-fighting 只在非正对角度暴露：层间距 ≥0.01×场景尺度，且**每个预设机位×每个切换态都要截图目检**，不许只看默认机位 |
| 宏大感缺失 | 必须有地标 + 至少 1 个低机位预设（尺度对比） |
| 用户指着截图说"改那个"，不知道是哪栋楼 | `CITY.pick(nx,ny)` 归一化屏幕坐标 → 语义实体 id（见 edit-playbook"pick 定位流程"），再 entity patch |
| 局部改动牵连别处（改河形机位 5 穿帮） | 对照对复核：改前 snap(1..6) 存图 → 改后同 seed 同机位逐对目检，无关差异即 undo/回滚 |
| 编辑功能静默失效，只有 `[3d-edit] OK`（老产物 `[3d-creat] OK`）没有 `[3d-edit] kit v1.3 ready` | kit 区被手改坏/老文件无 kit：`edit3d.mjs check` 定位 → `sync`（或 `upgrade`）修复 |
| 拖 gizmo 时相机跟着一起转 | 场景契约没给 controls：`SCENE.three` 必须含 `controls`（OrbitControls 实例），kit 拖动时锁、松手恢复；`check` 有专项体检 |
| 用户自己加的物件"没出现" | 落点默认视线中心预填；若场景无 `SCENE.groundY` 且未点画面取落点，物件会埋在原地 (0,0,0) —— 用「选中」页拖 gizmo 抬起来 |
| 撤销一步"什么都没发生" | 空改（改前==改后）已被 `noop` 拦掉不记账；若仍复现，看 `CITY.history()` 的 `label` 定位是哪一步 |
| 内嵌 UI 让场景文件变胖 / 跨 document 材质 instanceof 失败 | UI 不进场景文件：`editor <file> --install` 装独立宿主页，TransformControls 由 kit 在场景自己的模块图里动态 import |
| 新增地面要素（路/路灯/树）被楼埋、穿楼 | 先算**退线**：建筑半宽 ≤ cell/2 − 要素半宽 − 人行道；收窄楼体公式在前、布要素在后；布点用 `CITY.pick` 反查落点归属验证 |
| CanvasTexture 贴图发白/过曝 | 必须 `t.colorSpace = THREE.SRGBColorSpace`（map/emissiveMap 皆然），否则按 linear 解释整体提亮（模板已修） |
| 格状水面旁，摆放物"站在水里" | isRiver 只测格心，水面格向外还扩半格 → 落点判定用 isRiver 加 cell×0.8 水缘余量（nearRiver） |
| drawCalls 恒为 1 | composer 多 pass 会把 renderer.info 重置成最后一个 pass：`info.autoReset=false` + 每帧 `info.reset()`（模板已修） |
| 主循环每帧写 `mesh.visible`，实体显隐失效 | 该组实体注册**组对象**（`SCENE.reg('cars', L.cars)`）而非 lazy children 数组，组级显隐与逐帧可见性互不覆盖 |
| 后台标签页拿不到截图（take_screenshot 报 VIEWPORT_UNAVAILABLE） | `scripts/capture.mjs`：页内 `CITY.shot()` 的 dataURL 用 fetch POST 到本地端口落盘 PNG，再 Read 目检——别只靠像素统计盲改（楼吞路灯就是靠目检发现的） |
| `serve` 传了 html 文件 → 全站 404 无提示 | 新版 `edit3d.mjs serve` 已自动识别文件参数（起其所在目录并打印入口 URL）；旧版记得传目录 |
| S 档照搬 L 档的相机/雾默认值 | 物体小如米粒 + 背景圆盘硬边。按第 1.5 步重推：机位距离 = 1.4~1.8× `D`（`D`=主体包围盒**最长边**，Box3 实测，勿用对角线）、`fog ≈ 0.9 / 地面盘半径` |
| 正视干净、低机位看见"钢管从台实体里穿出来" | 外凸件（立管/支架/斜撑）根部必须落在主体投影**之外**或走板底受力层；预设表里强制留 1 个贴地机位专门抓这类穿模 |
| `CITY.stats()` 抛 `is not a function` | `stats` 是 getter **属性**不是方法，写 `CITY.stats.parts`；同理 `CITY.describe()` 返回对象不是字符串 |
| 面板显示"标注层关着"，画面里标注还在（或反之） | `effect:'hot'` 的 `apply` 直改对象会**绕过实体 props 记录**，`CITY.entProp` 读到过期值。开关"一整层"的参数改用 `effect:'rebuild'`（见 edit-playbook） |
| 隐藏 group 实体永远关不掉 | `SCENE.reg()` 会按 DEFV 把 object/group 复位成 `visible:true`；注册时显式带 `props:{visible:!!CONFIG.xxx}` |
| P3 改完尺寸公式，某个预设机位糊成微距/物体出画 | 机位表是按旧外形算的：改 `@*-rule@` 里任何尺寸后，重算 `@presets@` 并 1~6 全机位重拍 |
| 自验证跑完，用户打开页面弹"有 N 条草稿待恢复" | agent 探针里的 `CITY.set()` 会写 localStorage 草稿。交付前 `Object.keys(localStorage).forEach(k=>localStorage.removeItem(k))` 并重载确认 console 无 `pendingRestore` 警告 |

## 版本与兼容（合并说明，别"顺手修"）

- 本技能由 `3d-creat-v1.2s`（生成）与更早一代独立编辑层 `3d-edit`（已归档）合并而来，工具链一律取 v1.2s 的新版
  （kit v1.3、`check`、`editor --install`、人工通道写回都是 v1.2s 才有的）。
- **console 锚点 `[3d-edit] OK` 只在新模板生效**；已有产物（`city.html`/`trolley.html`）仍打 `[3d-creat] OK`，
  `edit3d.mjs check` 的正则两者都认，不要为此去改老产物。
- **`assets/editkit.js` 与 kit 标记区里的"由 3d-creat-v1.2s 技能管理"注释刻意保留**：kit 区文本是 `check`
  比对 `assets/editkit.js` 的基准，改这一行会让**所有**已有产物立刻报"kit 未同步"，逼一次 sync。
  要改就得连场景文件一起 `sync`，别只改源。

## 边界

- 需要联网加载 three.js CDN；完全离线环境需把 three.module.js 下载到同目录并改 importmap。
- 本 skill 产出"可视化场景"，不是游戏引擎项目：无物理、无关卡、无多人。用户要玩法时明确降级预期或建议接 Unity/UE。
- 超大规模真实测绘数据（激光点云、实景三维）超出本配方，只做简化体量/高程表插值。

## Resources

- `assets/template.html` — 可运行的单文件夜景城市模板（天生可编辑：MANIFEST + 稳定实体 id + 5 个规则锚点 + patches/kit 标记区）
- `assets/editkit.js` — 3d-edit kit v1.3 运行时源码（find/set/nudge/entity/patch/pick/select/gizmo/add/remove/history/undo/saveFile/surface，由 `edit3d.mjs sync` 注入模板）
- `assets/editor.html` — 人工编辑宿主页（零 three 依赖，只调 `CITY.*`；`edit3d.mjs editor --install` 装到场景同目录，场景文件不增一字）
- `scripts/edit3d.mjs` — 离线操作产物文件的命令行套件：find/manifest/entities/apply/undo/clear/**check**/sync/upgrade/**editor**/serve（serve 带 `POST /__save` 写回）
- `scripts/capture.mjs` — 后台标签页的截图落盘服务：页内 `CITY.shot()` POST dataURL → PNG（自验证目检用）
- `references/editor-enhance.md` — 人工编辑通道架构：三层职责、patch op 契约、撤销语义、ShadowEditor/three.js Editor/threepipe 借鉴与淘汰对照、已知边界
- `references/edit-playbook.md` — 局部修改路由手册：P1/P2/P3 三级优先级、诉求→手术位置路由表、pick 定位流程、对照对复核规程
- `references/recipes.md` — 配方库：按 `##` 标题 grep 取用（地形/水面/辉光/地标/性能/数字孪生改造/**产品·装置效果图（S 档）**）
- `references/checklist.md` — 自验证循环规程、视觉体检单、故障对照表、交付标准
