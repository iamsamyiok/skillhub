---
name: world-generator
version: 1.1.0
category: 前端开发
tags: [3D, Three.js, 程序化生成, 场景生成, 交互编辑, 参数化]
description: 通用参数化 3D 世界生成器：AI 语义规划 + 程序几何求解，从 JSON 场景计划一键生成单文件 world.html（内嵌 Three.js 零外部依赖），支持总图拼接 lint、渐进细化 refine、局部补丁 patch 与可视化点选编辑闭环。当用户需要生成或编辑 3D 场景、园区、别墅、校园等参数化世界时使用。
license: MIT
---


# World Generator Skill

规则机器固定，语义无限扩展；程序管几何，AI 管设计。

## 触发条件

- 用户提供自然语言场景需求（"帮我生成一个别墅的 3D 图"）
- 用户要求修改/迭代已有场景

## 强制流程

### 阶段 0：前置检查

```bash
ls node_modules/three >/dev/null 2>&1 || npm install
```

### 阶段 1：语义规划（AI 唯一写规划的地方）

输出 `scenes/<name>/scene-plan.json`，遵守：

- **零实例坐标**：只写 zone 边界（rect/circle/polygon）、密度、参数范围、约束；实例位置全部由求解器计算
- **只允许系统词表**：`inside_zone` / `no_placement` / `no_overlap` / `align_to_surface` / `min_distance_to_asset_type:[type,num]` / `max_elevation_diff:[num]` / `keep_inside_bounds`
- **放置顺序 = zones 数组顺序 + zone 内 placements 顺序**：大 footprint 先放、被距离约束依赖的先放（`min_distance_to_asset_type` 只对已放置实例生效）
- **规划参数范围必须落在资产定义 min/max 内**（违反会在 EXPAND 阶段报错）
- **可行域预算心算**（必做，防无解）：
  - 资产 footprint（含 factor/offset 展开）+ 全局 safety 必须 < zone 半宽，且留 15% 余量
  - 同 zone 多资产时扣除 no_overlap 排除区后再估容量
  - 约束数值语义要与碰撞精度匹配：引擎已用精确 box/circle 碰撞，不要为"保守"额外放大 `min_distance` 值（实测会制造无解，见踩坑表）

### 阶段 2：资产判断

`engine/assets/` 下已有 15 个资产（树×2、岩、屋、别墅、泳池、伞、灌木、车、长椅、灯、自行车、塔楼、桌、椅）。缺什么才生成什么。

### 阶段 3：新资产生成（每资产两个文件）

`engine/assets/<asset_id>/{definition.json, asset.js}`，硬性契约（全部来自真实踩坑，校验器会逐一检查）：

1. `function createAsset(params)` 返回 Mesh/Group，**原点在底面中心**
2. **多部件、含随机扰动、不对称设计（侧翼/靠背）的资产，返回前必须做 origin normalization**：
   ```js
   const box = new THREE_.Box3().setFromObject(group);
   const c = box.getCenter(new THREE_.Vector3());
   for (const ch of group.children) { ch.position.x -= c.x; ch.position.z -= c.z; }
   ```
   平移 children，**绝不能改根节点 position**（求解器会覆盖它）
3. 资产内随机必须从 `params._seed` 派生（mulberry32），保证实例可复现
4. `footprint` 引用的参数名必须在 `params_schema` 中声明，否则静默 fallback 0.5 导致碰撞错误
5. footprint 尺寸跟随可变几何时用表达式：`{"hw_param":"width","hw_factor":0.5,"hw_offset":1.9}`（如别墅含车库侧翼）
6. **`height` 表达式强烈建议必写**：`{"param":"total_height"}` 或 `{"param":"floors","factor":3.2,"offset":0.5}`。跨层碰撞豁免、refine 垂直分层全依赖它；缺省时引擎退化为碰撞半径×1.5 估计
7. 仅用原生 Three.js 基础几何体；Lambert 材质；注明 `max_triangles` 预算（默认 5000）
8. 顶点扰动类几何（岩石/树冠）扰动后必须 `computeVertexNormals()` 且 bbox 归零
9. 可入内的建筑类资产用框架式设计（角柱+楼板+半透明幕墙），保证内部 refine 的实例肉眼可见

### 阶段 3b：总图与地形拼接规范（masterplan & terrain continuity，硬性）

viewer 已内置统一地形机制：全场合并为**单张共享顶点晶格**（1.0m 网格），noise 基底先铺、flat 平台后叠，平台边界经 1.4m 过渡带平滑混合高度与颜色，斑驳纹理为世界空间噪声（跨界连续）。规划必须遵守以下规则，否则管线 `LINT MASTERPLAN` 会报警：

1. **单一连续基底**：有放置物的场景必须定义一个覆盖全场的 noise 基底 zone（如草坪/地被），作为"地"的存在；其余功能区是叠加其上的 flat 平台
2. **平台高度带**：flat 高度统一取 `[基底最大值+0.02, 基底最大值+0.25]`（如基底 amp 0.1 base 0 → 平台 0.13~0.16）；过高形成悬空 slab，低于基底则陷入地形
3. **边界三选一**：相邻平台要么共享边界线（间距恰为 0），要么间距 ≥ 1.4m（等于过渡带宽度）；**禁止 0.05~1.0m 窄缝**（晶格填不上，留脏缝）
4. **铺装保护**：每个有放置物的 flat 平台配套一个 no_placement 禁放区（外扩 ≥0.4m），且写 `except_zones: [该平台 zone_id]` 豁免自身；基底 zone 的散布资产靠禁放区挡在路面和过渡带之外
5. **动线连通**：车行（车道→庭院→宅基）与人行（园路串联功能平台）必须首尾相接，禁止孤岛平台
6. lint 规则对应：`seam_narrow_gap` / `platform_below_base` / `platform_step`(>0.15m) / `missing_np_cover`；报警不阻断管线，但新场景必须修到 clean

### 阶段 4：运行流水线

```bash
# base：全量求解 + 打包
node engine/index.mjs --scene scenes/<name>
# repack：只改了 viewer 模板/打包器时用，从磁盘 solved 状态直接重打包（实例坐标零变动）
node engine/index.mjs --scene scenes/<name> --repack
```
### 阶段 5：按报告路由定向修复（最多 3 轮）

读 `validation-report.md` 末尾的 routing：

| routing | 修什么 |
|---|---|
| `FIX_PLAN_OR_ASSET_DEFINITION` | JSON/schema/词表/参数越界/锚点缺失 → 修对应文档 |
| `FIX_ASSET_CODE` | 原点契约/法线/面数 → 只修被点名的 asset_id |
| `FIX_PLAN_DENSITY` | 摆放失败 → 降密度/放宽间距/扩 zone/缩 footprint 参数范围 |
| 视觉异常（渲染正常但观感差） | 微调材质颜色，不动几何 |

禁止全量乱改；超 3 轮输出诊断报告终止。

### 阶段 5b：渐进细化（progressive refinement）

base 模式成功后产出 `scenes/<name>/solved-instances.json`（全部实例的世界坐标快照）。在它之上做逐级细化：

```bash
node engine/index.mjs --scene scenes/<name> --refine refine-1.json
```

- refine 计划与 scene-plan 同 schema，zone 额外可带 `anchor: {instance_id}` 锚到已解实例（如某栋楼）
- **锚定 zone 的 boundary/elevation 全部写锚点局部坐标**：以锚实例原点为原点、随其朝向旋转；AI 依旧零世界坐标
- 分层摆放用锚定 elevation：`{"type":"flat","height": k*楼层高+板厚}`（如 3.2m 层高 + 0.25m 板 → k 层地面在 k*3.2+0.25）
- 引擎自动做三件事：局部→世界变换、跨层 Y 分离豁免碰撞（层间互不挡）、锚父实例豁免（子件不会撞自己楼体）
- 同层已有物（含前几轮 refine 的）会正常参与碰撞——增量求解，勿重跑 base（会重置 solved-instances.json）

### 阶段 5c：局部补丁（patch）

对已解世界做定点修改，不动其他实例：

```bash
node engine/index.mjs --scene scenes/<name> --patch patch-1.json
```

四种 op（`patches` 数组按序执行）：

```json
{ "op": "move",   "instance_id": "...", "offset": [dx, dy, dz] }
{ "op": "reparam", "instance_id": "...", "params": { "glass_glow": 0.95 } }
{ "op": "remove", "instance_id": "..." }
{ "op": "add", "instance_id": "新ID", "asset_id": "bench_v1", "zone_id": "zone_plaza", "params": {}, "constraints": ["no_overlap"] }
```

- `reparam` 参数会做范围校验（越界报 `[PATCH]` 错误）
- `add` 走单实例增量求解（避开现有世界）
- `move` 产生的重叠只告警不拒绝（用户显式移动优先）
- patch 文件可带顶层 `time_of_day`（0-24）：写入 `world-meta.json`，打包时叠加到场景元数据（viewer 实时重算太阳/天空/雾/泛光）

### 阶段 6：视觉与运行时能力（viewer 内建，无需额外操作）

- **渲染**（Opus 级质感四件套已全量内建）：ACES tone mapping + 线性光工作流；RoomEnvironment IBL（PMREM 程序化环境光，无外部 HDRI）；Lambert 资产 API → 引擎端统一升级 MeshStandardMaterial + 程序化噪变（多倍频值噪声 CanvasTexture 作 roughnessMap/bumpMap，打破平色塑料感）；UnrealBloom 泛光（灯头 emissive、太阳盘 HDR 自动发光）；FogExp2 大气
- **程序化天穹**：渐变穹顶 + HDR 日/月盘（同一形体昼夜换位换色）+ 程序化星场，随 time_of_day 联动；IBL 强度随昼夜调制（正午亮反射、午夜微光）
- **时间系统**：`scene_meta.time_of_day`（0-24，默认 14）驱动太阳方位/颜色、天穹、雾、半球光、IBL、夜间泛光增强；viewer「时间」按钮可实时拖动预览
- **水面动画**：资产给水面 mesh 设 `mesh.userData.water = true`，viewer 自动升级为低粗糙度 Standard 波动材质（IBL 反射 + 顶点波，见 pool_v1）
- **视角预设**：鸟瞰 / 街景 / 环绕（自动旋转）按钮
- **GLB 导出**：viewer「导出 GLB」按钮，输出含地形+实例的 .glb，可进 Blender / three.js editor
- **材质去重**：构建后按外观键合并材质（500 实例压到 ~33 材质）；发光/水面材质不参与合并

### 阶段 6b：交互编辑闭环（用户指令含"编辑"时触发）

用户指令出现"编辑/修改这个/选中"等意图时，启动可视化编辑回路：

1. **单进程服务**（唯一服务，承担预览+编辑，勿另起 http.server）：
   ```bash
   node engine/edit-server.mjs --port 8000 --root /workspace
   ```
2. **给用户编辑链接**：`http://<host>:8000/scenes/<name>/world.html#edit`（`#edit` 直达编辑态；页面内也可点"编辑"按钮进入/退出）
3. **页面内交互**（互斥设计）：进入编辑态后其余按钮（鸟瞰/街景/环绕/时间/GLB）自动隐藏；左键点选/再点取消（可多选，Esc 清空）；选中后底部展开输入框写改进意图 → "提交给 Agent"；点"退出编辑"恢复原界面
4. **接收请求**：提交落盘 `scenes/<name>/edit-requests/ed-NNN.json`（`{instance_ids, asset_ids, intent}`），服务终端同步打印；无后端托管时页面降级为剪贴板 JSON
5. **转换为补丁**：按意图把 `instance_ids` 映射为 `--patch` 操作（`reparam`/`move`/`delete`；新增走 `add`，需给 zone_id + 合法 params）。语义拿不准先反问；参数必须在资产 `params_schema` 范围内
6. **版本另存 + 重建**：
   ```bash
   # 同一轮编辑的首次保存加 --new-session，本轮后续保存省略
   node engine/index.mjs --scene scenes/<name> --patch <patch>.json --edit-save --new-session
   ```
   产物：`world.html`（实时版，页面 2s 轮询自动刷新）+ `world_E<会话>.<序号>.html` 快照（E1.1、E1.2…下一轮 E2.1），状态记在 `edit-state.json`
7. 编辑模式下点击单对象仍可查看参数面板（退出编辑态后）；普通模式行为与之前一致

### 阶段 7：视觉校验

```bash
node engine/visual-check.mjs scenes/<name>/world.html
```

- verdict PASS → 交付
- FAIL → 看 issues 定位（黑帧查 winding/材质、色少查实例构建、console 错误查资产代码）
- 需要人眼细看时：`node engine/screenshot.mjs <html> <png> --view top|close|side`，识图能力可用则读图复查（穿模/悬浮/贴图异常这类像素统计查不出的问题）

### 阶段 8：交付

- 预览：静态服务器（`python3 -m http.server 8000 --directory /workspace` 后台终端）+ `request_preview`，交付 `<url>/scenes/<name>/world.html`
- 汇报：实例数、求解率、迭代轮次与每轮修复内容

## 踩坑速查表（全部实测发生过）

| 症状 | 根因 | 解法 |
|---|---|---|
| 4 资产批量报 origin contract violated | 不对称部件/随机偏移使 bbox 中心偏离原点 | origin normalization（见阶段 3 第 2 条） |
| `Param 'x' below asset minimum` | 规划参数范围超出资产定义 | 对齐两边范围 |
| 伞/大型资产全部 `keep_inside_bounds` 失败 | 可行域为零（footprint+safety+排除区 ≥ zone） | 扩 zone / 缩资产参数上限 / 减小 footprint offset |
| 密集带状摆放批量 `no_overlap` 失败 | 为圆近似时代设计的 min_distance 过大，与精确碰撞叠加后排除区吞掉整个带 | 删多余的 min_distance，让 no_overlap 精确碰撞自己表达"环绕"语义 |
| 地形全黑但物体正常 | 三角 winding 顺时针 → 法线朝 -Y | 俯视逆时针：`(x0,z0),(x1,z1),(x1,z0)` 型顺序 |
| readPixels 全 0 | WebGL preserveDrawingBuffer=false | render 后同一 JS 任务内同步读 |
| 注入脚本后 HTML 语法错误 | 大代码块含 `$&`/`</script` | replace 用函数形式 replacement + `<`→`\u003c` + `</script`→`<\/script` |
| module 内代码浏览器不可见 | ESM 顶层符号不进全局 | 末尾对象字面量 shim 挂 window（勿用块内逗号表达式序列） |
| refine 阶段 `Param 'x' below asset minimum` | 细化用了超出资产范围的参数（如层内矮灯 pole_height 2.2 < min 2.6） | 放宽资产参数下限（合理参数化）或改用范围内值；先估净高：层高-板厚 > 资产 height 表达式值 |
| 锚定 zone 实例拍在楼体轮廓外/高度错 | 局部坐标写成世界坐标，或 elevation 忘写锚定 flat 高度 | boundary/elevation 都用锚点局部系；高度 = k*层高+板厚（相对锚实例底面） |
| roof 层子件穿楼顶机房 | no_overlap 对锚父实例豁免，子件不会避让父体内部结构 | roof zone 边界主动避开父体凸出物（如收窄成条带） |
| 冷启动首次 visual-check/screenshot 报 `__WORLD__ undefined` | swiftshader 冷启动慢，固定 sleep 赶不上脚本执行完 | 已改 `waitForFunction(__WORLD__)`；若再出现，加大 timeout 而非重装依赖 |
| 内嵌 addons 后页面报 `Identifier 'Pass' has already been declared` | 打包器把相对导入的符号名也收进了 `window.THREE` 解构，与拼接作用域同名类冲突 | 只收集 `from 'three'` 的符号名（packer bundleAddons 已修） |
| 黄昏/夜晚场景 visual-check FAIL（avgLum < 15） | time_of_day 太晚 + 暮光光照下限过低，近黑帧 | 时间设 16.5-17.5 区间；已抬高暮光下限（sun 0.55 / hemi 0.32） |
| 压测场景 squash/尺寸参数批量 EXPAND 报错 | 规划 min/max 未对齐资产定义（300+ 实例时报错刷屏） | 写计划前先查 definition.json 的 params_schema 范围 |
| 铺装区上的功能件（车/别墅/泳池）被 `no_placement_zone` 全灭 | no_placement 区全局生效，盖住了它想保护的铺装 zone 自己的放置 | 禁放区写 `except_zones: [同范围 zone_id]` 豁免铺装区自身 |
| 大块禁放区中心仍长出树/石头 | 旧实现 `pointInPolygon && distToEdge<r` 只挡边缘环带 | 已改 `\|\|`（solve.mjs）；升级引擎后旧场景需重跑全链路 |
| 各地块互不相连、像浮岛 | zones 各自定义零散矩形，无统一总图 | 先画一张连续基底（大 noise 草坪 zone 覆盖全地块），功能平台 flat 抬高 0.13-0.16 叠加其上，平台间距为 0（共享边界线），再用 except_zones 禁放区保护路面 |
| 平台边缘生硬、像贴皮/颜色断层 | 旧 viewer 每 zone 各建一张网格（平色+法线断裂+高度悬崖） | viewer 已改单张统一晶格地形（1.4m 高度/颜色过渡带 + 世界空间斑驳）；规划侧按阶段 3b 规范走，lint 会拦窄缝 |
| 编辑模式下点不到对象 | 编辑栏常驻展开，遮挡屏幕下方，点击落在栏上 | 输入框改为"选中后才出现"且上移至按钮行上方（bottom 56px）；编辑态下其余按钮隐藏 |
| 编辑按钮点不动 | 收起态提示条盖住底部按钮行 | 收起态整条隐藏（提示走 hud-help），不再拦截指针 |
| 提交后状态栏闪一下就空 | `clearEditSel()` 在设置状态文字之前执行，把文字清掉 | 先 clear 再写状态（viewer-template 已修） |
| GLB 导出点击即报 `Converting circular structure to JSON` | three r160 `Mesh.copy` 用 `JSON.parse(JSON.stringify(userData))` 深拷贝，运行时 `instanceRef→_object→userData` 循环引用必炸 | 导出前 stash 清空 userData，clone 后恢复（viewer-template 已修） |
| 想全局调 IBL 强度找不到 `scene.environmentIntensity` | r160 尚无该属性 | 逐材质 `envMapIntensity`（viewer 已按 `userData.envBase` 昼夜调制） |
| 改了 viewer 模板后想重新打包又怕求解结果漂移 | 重跑 base 会重置 solved-instances.json | 用 `--repack` 模式，只重打包 |

## 引擎固定层（禁止修改）

坐标系（Y 向上、地面 Y=0）、双 ID 体系、词表、`createAsset` 签名、求解/碰撞/打包逻辑、refine 的局部→世界变换与 Y 分离规则、addons 内嵌打包器均属程序固定层。发现引擎缺陷按"科学完善"原则最小化修改并回归五个场景（`scenes/demo`、`scenes/villa`、`scenes/bicycle`、`scenes/campus`、`scenes/forest`——campus 覆盖 base→refine→refine→patch 全链路，forest 为 530 实例压测）。

## 文件清单

```
SKILL.md                  本文档（Agent 工作流）
engine/index.mjs          CLI：--scene / --refine / --patch 三模式管线
engine/packer.mjs         world.html 打包（内嵌 three + addons + viewer）
engine/viewer-template.html  查看器：统一地形、时间系统、GLB 导出、#edit 编辑模式、#debug
engine/edit-server.mjs    编辑桥服务：静态托管 + POST /edit-request 落盘
engine/test-edit-flow.mjs 编辑闭环 e2e 回归（playwright）
engine/screenshot.mjs     截图（--view top/close/side）
engine/visual-check.mjs   像素统计视觉校验
engine/lib/               schema/expand/solve/geom/elevation/rng/registry/validate-assets/plan-lint
engine/assets/<id>/       16 个参数化资产（definition.json + asset.js）
scenes/                   5 个回归场景（villa/campus 含 refine+patch 链）
```
