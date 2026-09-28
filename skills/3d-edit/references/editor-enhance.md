# Editor Enhance — 人工编辑通道架构（v1.3 新增）

## 一句话结论

人和 agent 写的是**同一条 patch 命令流**。编辑器不是"另一个系统"，只是 kit 的第二个前端：
面板拖一下 = `commit([{op:'entity',...}])` = agent 的 `CITY.entity(...)` = 文件里 patches 区多一行 JSON。
因此任何手动改动天然可序列化、可撤销、可被 agent 续改，反之亦然。

## 三层职责（谁管什么，边界在哪）

| 层 | 文件 | 职责 | 明确不做 |
|---|---|---|---|
| 运行时 | `assets/editkit.js`（v1.3，注入场景 kit 区） | 寻址/读写/命令流/历史/gizmo 代理/事件总线/落盘 | 不写一个 DOM，不认得面板 |
| 宿主 UI | `assets/editor.html`（`editor <file> --install` 装到场景同目录） | 五个页签（参数/选中/对象/加物件/历史）、快捷键、草稿提示 | 零 three 依赖，不碰 WebGL |
| 写回 | `scripts/edit3d.mjs serve` 的 `POST /__save` | 校验 op 合法性 → `.bak` → 只重写 patches 区 | 不动生成代码，不接整场景序列化 |

**为什么宿主必须独立文档**（5.B 决策）：跨 document 的 `instanceof`、模块身份、材质类都会分裂。
所以 TransformControls 由 **kit 在场景自己的模块图里动态 import**（`three/addons/...`，锁 0.160.0），
宿主页只通过 `fr.contentWindow.CITY` 调 API。实测同 realm 装载成立：`gizmoState().lib === 'TransformControls'`。

## 数据契约（patches 区里能出现的五种 op）

```js
{op:'param',  path:'fog', value:0.002}                        // P1 参数（MANIFEST 驱动）
{op:'entity', id:'landmark.tallest', prop:'color', value:'#ff2d55'}   // P2 实体
{op:'preset', value:5}                                        // 机位，不入历史、不落盘
{op:'add',    id:'prop-1-box', kind:'box', props:{size:10, color:'#d8dde3', pos:[x,y,z]}}
{op:'remove', id:'prop-1-box'}                                // 只能删 op:add 加出来的物件
```

- `prop` 白名单：变换 `visible/translate/scale/rotateY/rotate`；材质 `color/emissive/emissiveIntensity/opacity/roughness/metalness/intensity`。
- `kind` 白名单 = kit 的 `KIND_GEO` = `box/cyl/cone/sphere/torus/plane`（`CITY.prefabs()` 可查）。
- 原生几何（楼群/路面/江面）**不能删**：它归生成规则管 → 用 `visible:false` 隐藏，或走 P3 锚点手术。
  这条限制在 UI 上有两处硬提示（「删除」按钮只对 `props` 组出现；remove 报错文案直接指路）。

## 撤销语义（人工通道最容易翻车的地方，实测校准过）

| 场景 | 机制 | 结果 |
|---|---|---|
| 拖 gizmo / 拖滑块 | 拖动中 `commit(..., {silent:true})` 只预览不记账，`liveBase` 存下"按下那一刻"的旧值；松手记 1 步 | 撤销一步 = 一次拖动，回到按下前（不是最后一次预览值） |
| 同属性 500ms 内连续提交 | `merge` 窗口覆盖上一条 | 滚轮/连拖不堆出几十条历史 |
| 拖回原位 / 改成同一个值 | `liveBase` 相等 或 `sameVal(prev,value)` → `noop:true` | 不占撤销步、不落盘（颜色 `0xff2d55` 与 `'#ff2d55'` 视为同值） |
| add ↔ remove | `invOf` 存完整 add patch 作逆操作 | 删了能撤销回来，物件原样重建 |
| 机位 preset | `commit` 里 `continue` | 永不入历史 |

## 拾取与"编辑器替身"隔离

gizmo 挂的是隐形代理 `Object3D`（`name:'3d-edit:anchor'`），带 home 相对变换；实例（InstancedMesh 里的一栋楼）
因此也能被拖。所有编辑器替身打 `userData.__3d_widget`，`pick`/包围盒/导出统一跳过 —— 实测画面中心 pick
返回真实楼 `bld-25-26` 而不是锚点。

## 三个开源项目的借鉴对照（采纳了什么、淘汰了什么、为什么）

| 来源 | 采纳 | 淘汰 | 淘汰原因 |
|---|---|---|---|
| **three.js Editor** (`examples/jsm/editor`) | ① 属性面板由"数据描述"驱动行工厂（本方案 `ctl()` 读 MANIFEST，缺项自动隐藏）；② 侧栏按对象类型分块；③ 命令栈 = `{before,after}` 纯数据；④ 快捷键表（G 模式 / F 聚焦 / Del 隐藏 / Ctrl+Z/Y/S） | `ObjectLoader` 整场景序列化、`Editor.js` 的几何/材质新建 UI | 单文件场景的"真源"是生成规则，序列化整场景 = 把程序化城市变成几万行死数据，agent 再也读不懂 |
| **ShadowEditor** | ① 视口内直接拖 gizmo + 拖完才记账的交互节奏；② "选中即高亮 + 属性页"的信息架构；③ 场景树按组聚合（本方案组芯片 + 搜索，1702 个实例不铺满列表） | 服务端 + 数据库 + 资源管理器 + ~50 个手写属性面板 | 它是"平台"，我们要的是"单个 HTML 的编辑层"；手写面板数 = 维护成本线性爆炸 |
| **threepipe** | ① `uiConfig` 声明式生成控件（与 `ctl()` 同构）；② 插件式隔离：编辑器对象与渲染主场景解耦（本方案 `__3d_widget`）；③ 变换控件与相机控制互锁（拖 gizmo 时 `controls.enabled=false`，松手恢复） | 整套插件容器 / 依赖注入框架 | 单文件零构建产物塞不下，收益全被"人机同源 + MANIFEST"覆盖 |

## 已知边界（诚实清单，别当 bug 报）

1. **TransformControls 走 CDN**：首次挂 gizmo 才动态 import；断网时面板降级为数值行（位置/缩放/绕Y 滑块仍可用），
   宿主页会显示"gizmo 未装载"。这是用户明确接受的依赖（决策 8）。
2. **实例材质共享**：改一栋楼的颜色 = 改整个 InstancedMesh 的 `instanceColor` 单项可以，但 `emissive` 这类
   材质级属性影响全部同类。UI 选中实例时直接给黄条警告。
3. **`add` 出来的物件不跟地形走**：rebuild 后仍在原位（`props` 独立于生成规则）；若场景提供 `SCENE.groundY(x,z)`，
   `addOne` 会自动贴地，本 city 场景没提供 → 落点 y 由"点画面取落点"的 pick 命中点给出。
4. **宿主页只认 kit v1.3+**：`check` 会显式报"低于 v1.3 时 editor.html 会拒绝装载"；老文件先 `sync`。
5. **写回只认 serve 起的目录**：`POST /__save` 校验文件名 `^[\w.\-]+\.html?$`、拒绝越界路径、拒绝非法 op，
   写前落 `.bak`。用别的静态服务器打开时，改用「导出 / 复制给AI」把 patches 文本带走。

## 上手（三条命令）

```
node scripts/edit3d.mjs sync    <file>          # 升到 kit v1.3（契约需含 three.controls）
node scripts/edit3d.mjs editor  <file> --install # 装 editor.html 到同目录
node scripts/edit3d.mjs serve   <file> --port 8765
# 浏览器打开 http://localhost:8765/editor.html?src=<file>
```

用户只想"看"不想"改"时给 `?src=<file>` 页里的「↗ 纯预览」链接；成品交付时 editor.html 可以整个不给，
场景文件本身一个字节都没多。
