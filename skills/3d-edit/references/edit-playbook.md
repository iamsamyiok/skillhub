# Edit Playbook — 局部修改路由手册（v1.2s 核心新增）

## 核心认知：局部修改 ≠ 重新生成

强模型（Claude Opus 5.x / Fable 5.2）做"大型 HTML 3D 图的局部修改"，靠的不是更聪明地重写整文件，
而是**产物本身被设计成局部可寻址**。本 skill 的模板天生满足此点。收到"改一小块"类诉求时，
禁止全文重写，按下面的优先级路由——越靠前越确定性、越可回滚、越省 token。

## 三级优先级（先试上一级，不满足才降级）

| 级别 | 手段 | 适用 | 落点 | 回滚 |
|---|---|---|---|---|
| P1 参数 | MANIFEST patch | 全局观感：密度/雾/辉光/配色/规模/车流 | `window.__3D_EDITS__` patches 区，几何代码零改动 | undo / reset |
| P2 实体 | entity patch | 单个可指认对象：那栋楼、江面、车群 | 同上（`{op:'entity',id,prop,value}`），id 跨 rebuild 稳定 | undo |
| P2+ 增删 | add / remove patch | 摆一个新亭子、挪走刚加的那个物件 | `{op:'add',id,kind,props}` / `{op:'remove',id}`；kind ∈ box/cyl/cone/sphere/torus/plane，remove 只能删 add 出来的 | undo |
| P3 规则 | 锚点代码手术 | 形状/拓扑/新玩法：河道改弯道、楼高公式、加桥 | `/*@锚点名@*/` 标记的函数/表，str_replace 唯一锚点 | git/备份文件 |

> P1/P2 只写数据不改代码：patches 区在页面加载时由 kit 回放，天然可撤销、可 diff、离线可校验。
> P3 才动代码，且必须走"对照对"复核（见下），因为规则层的改动可能有全局副作用。

## 诉求 → 手术位置 路由表

| 用户说法 | 级别 | 操作 |
|---|---|---|
| "楼密一点 / 稀疏些" | P1 | `CITY.set('buildDensity', ±)` 或 `node edit3d.mjs apply f.html --set buildDensity=0.7` |
| "再亮一点 / 辉光收一点" | P1 | `CITY.nudge('bloom.strength', ±1)`（相对增量，不猜绝对值） |
| "雾再大 / 远景看不清" | P1 | `CITY.set('fog', v)`（hot，立即生效无需 rebuild） |
| "整体换成暖色调 / 天顶蓝一点" | P1 | `CITY.find('天')` 定位 `pal.skyTop` → set 颜色 |
| "城市再宏大 / 范围大些" | P1 | `--set gridN=60`（注意性能预算，见 recipes 性能表） |
| "换一座城 / 再来一次" | P1 | `--set seed=<新数>`（确定性，同 seed 必得同城） |
| "画面正中间那栋楼改成红色" | P2 | 截图上估归一化坐标 → `CITY.pick(nx,ny)` 拿实体 id → `CITY.entity(id,{color:'0xc23b3b'})` |
| "最高楼打光强些" | P2 | `CITY.find('地标')` → `landmark.tallest` → entity patch |
| "把江面调亮" | P2 | `CITY.entity('river',{emissiveIntensity:1.6})` |
| "那栋楼往左挪一点"（id 已知） | P2 | `CITY.entity('bld-23-23',{translate:[dx,0,0]})` |
| "河改直 / 往东弯得更狠" | P3 | `@river-fn@` 锚点内 `riverX` 公式手术 |
| "CBD 楼再高、天际线更陡" | P3 | `@cbd-height@` 锚点内高度分布公式 |
| "窗光改成横长条 / 亮窗比例" | P3 | `@window-texture@` 锚点内 `windowTexture()` |
| "车流加到 8 车道" | P3 | `@car-lanes@` 锚点内 `for (let a = 0; a < 6; a++)`（先试 P1 `carCount`） |
| "预设机位重新排" | P3 | `@presets@` 锚点内 `refreshPresets()` 表 |

命中不了表时：`node edit3d.mjs find <file> <口语词>`（离线）或 `CITY.find('<词>')`（浏览器内，走 aliases 模糊匹配）。

## 用户指着截图说"那个"——pick 定位流程

1. 拿用户截图，估目标中心的**归一化屏幕坐标** `nx=(px/W)*2-1`，`ny=1-(py/H)*2`；
2. 浏览器里先 `CITY.snap(k)` 或用 `CITY.setCam(p,t)` 复现机位（坐标必须以当时的相机为准）；
3. `CITY.pick(nx, ny)` → `{id,label,group,hit,dist}`。命中 `bld-i-j` / `landmark.*` / `river` 等语义 id 即可做 P2 patch；
4. 返回 `id:null`（命中了未注册几何，如地面/天空球）→ 说明诉求本质是 P3 规则层，转锚点手术；
5. 拿不准时可对邻近几个点各 pick 一次取众数；`label` 含高度等特征，可与截图目测对照。

## P3 锚点手术规程（str_replace 纪律）

- 每个锚点 `/*@name@*/` 在文件内**唯一**（`check` 会验），Edit 时用"锚点行 + 下一行"作 old_string 即可唯一定位；
- 一次手术只碰一个锚点；改前先跑 `node edit3d.mjs check <file>` 确认基线全绿；
- 模板出厂 5 锚点：`river-fn` `window-texture` `cbd-height` `car-lanes` `presets`。
  扩展场景（自己从模板改出的新文件）应继续按此格式给新的规则函数钉锚点——**锚点是给未来修改留的把手**。
- **机位表跟尺寸走**：`@*-rule@` 里任何决定物体外形/位置的常数被改（本例把扶手后倾从 0.05 加到 0.105、
  横把跨度系数 0.86→0.99），`@presets@` 就是按旧外形算的，必须同步重算再截图。
  实证：改完后"握把特写"机位从正常特写糊成端盖微距，靠把该位从 `[-0.55,·,0.36]` 外移到
  `[-0.98,·,0.70]` 才恢复（`trolley.html` 的 `/*@presets@*/` 第 5 条注释即此教训）。

## MANIFEST 的 effect 怎么选（加新参数时的前置纪律）

`effect` 不是性能选项，是**一致性选项**。选错会让"数据层已生效、视图层没跟上"或反之：

| 参数改的东西 | 该用 | 原因 |
|---|---|---|
| 只碰渲染参数（光强/颜色/曝光/雾/辉光/自转） | `hot` + `apply` | 不动几何，拖滑块即时生效，体验最好 |
| 由 build* 生成的几何（尺寸/数量/seed/配色进材质） | `rebuild` | 必须重跑建模函数 |
| **开关"一整层"（标注层、辅助线、调试可视化）** | `rebuild`，**不要用 hot** | hot 的 `apply` 直接写 `group.visible`，**绕过 kit 的实体 props 记录**：`CITY.entProp(id,'visible')` 与人工编辑面板会显示过期值 |

实证（`trolley.html` 的 `showDims`）：`effect:'hot'` + `apply: v => dimsRoot.visible = v` 时，画面里
"H 950 / 750 mm"标注已出现，但 `CITY.entProp('dims','visible')` 仍返回 `false`（面板显示"关着"）。
改成 `effect:'rebuild'` 后 `patched=true / off=false / on=true` 三者一致。

配套两条注册纪律：
- 隐藏 group 实体注册**必须显式** `SCENE.reg(id, grp, { kind:'group', props:{ visible: !!CONFIG.xxx } })`——
  kit 的 `reg()` 会把 object/group 按 DEFV 复位成 `visible:true`，不显式给就永远关不掉。
- `rebuild` 前 kit 会按 home 复位 group 变换，所以**别把一次性偏移写进 group 的 position**（会被抹平）；
  要偏移就写进子件或注册进 `home`。

## API 形状速记（探针脚本里最容易写错的三个）

- `CITY.stats` 是 getter **属性**（`CITY.stats.parts`），`CITY.stats()` 会抛 `is not a function`；
- `CITY.describe()` 返回**对象**（`{id,label,kind,group,target,editable,visible}`），不是字符串，别 `.slice()`；
- 后台标签页 `CITY.stats.drawCalls` 是跨多次 render 的**累计值**（本例同一场景读到 239/280/932，真值 122/5136 tris（标注层关，出厂态）与 126/5424（标注层开，交付截图态）——**报数要说明当时是哪个态**）。
  取真值：`const t=SCENE.three; t.renderer.info.reset(); t.renderer.render(t.scene,t.camera); t.renderer.info.render.calls`。


## 对照对复核（改后必跑，防"改 A 坏 B"）

规则层改动有全局副作用（如河形变了会牵连机位 5、建筑落地分布）。因此 P3 手术与任何 rebuild 级 P1 patch 之后：

1. **改前**：`snap(1..6)` 各截一张存为 `before-N.png`（evaluate 里循环 `CITY.shot` 存 dataURL 时分 2~3 张一批，防超时）；
2. **改后**：同 seed、同机位再截 `after-N.png`；
3. **逐对目检**：目标变化应只出现在预期区域；未指定机位出现无关差异（整体错位、楼消失、水面破面）→ 回滚本次手术重来；
4. P1/P2 的 **hot 级**改动（雾/辉光/颜色）只影响渲染参数、不动几何，只需默认机位 + 受影响实体近景各 1 张。
- **像素级复核替代目检**（后台标签页截图不可用时）：`CITY.shot` 取 dataURL → 画进 canvas 采样。patch 前后各采一次做全图 diff，
  统计变化像素占比与包围盒——局部修改应只出小面积紧凑 diff 区（实测单体 translate 改 40 单位 ≈ 1.7% 像素、50×153 竖条）。
- **夜景单体改色慎用 color**：实例色参与冷光漫反射后视觉几乎不可读（数据层已生效，`editLog` 的 prev 可证）。
  要"看得见地改一栋楼"，优先 translate/scale/visible；确需改色则同时提 `emissive` 或近景截图复核。

kit 日志锚点：console 出现 `[3d-edit] kit v1.3 ready params=... entities=...` 才代表编辑运行时装载成功；
只有 `[3d-edit] OK`（旧产物为 `[3d-creat] OK`）而无 kit ready = patches 区/SCENE 契约断了，先 `node edit3d.mjs check` 定位。

## edit3d.mjs 命令速查（离线操作产物文件）

```
node scripts/edit3d.mjs manifest <file>            # 参数说明书（path/effect/范围）
node scripts/edit3d.mjs find     <file> <口语词>   # 词 → 参数/实体候选
node scripts/edit3d.mjs entities <file> --like 楼  # 实体 id 列表
node scripts/edit3d.mjs apply    <file> --json '[{"op":"add","id":"kiosk-1","kind":"box","props":{"size":6,"pos":[10,3,10]}}]'
node scripts/edit3d.mjs list     <file>            # 当前 patches
node scripts/edit3d.mjs undo     <file> [n]         # 丢弃最后 n 条
node scripts/edit3d.mjs clear    <file>             # 回出厂
node scripts/edit3d.mjs check    <file>             # 结构体检（含 kit v1.3/契约 controls/op 合法性/宿主页在位），exit 0 全绿 / 3 有问题
node scripts/edit3d.mjs sync     <file>             # 用技能内 editkit.js 刷新 kit 区
node scripts/edit3d.mjs upgrade  <file>             # 给无 kit 的老文件注入 patches+kit 区（还需补 SCENE 契约）
node scripts/edit3d.mjs editor   <file> [--install|--remove|--status]  # 人工编辑宿主页 editor.html 装卸
node scripts/edit3d.mjs serve    <dir|file.html> --port 8765  # 本地 http + POST /__save 写回（file:// 下 module 不执行）
```

浏览器内等价物（kit API，挂在 `window.CITY`）：
`find / manifest / entities / describe / get / set / nudge / entity / patch / pick / select / xform / gizmo / ungiz / add / remove / prefabs / history / undo / redo / editLog / save / saveFile / pendingRestore / restore / discardDraft / reset / surface / snap / shot`。
两边写回同一数据源（patches 区）：浏览器里调满意后 `CITY.saveFile()`（serve 起时直接落盘）或 `CITY.save()` 打印 JSON，改用 `apply --json` 固化。

## 人工通道（用户自己动手改，v1.3）

`editor.html?src=<file>` 宿主页 = kit 的第二个前端，五个页签（参数/选中/对象/加物件/历史）+ 快捷键
（G 切模式 / F 聚焦 / Del 隐藏 / Ctrl+Z·Y·S）。它**零 three 依赖**，只通过 `iframe.contentWindow.CITY` 调 API，
所以场景文件里不会多一个字节。要点：

- 拖 gizmo / 拖滑块 = 一步撤销（拖动中只预览不记账，松手记账并回到"按下那一刻"）；改成同值不占撤销步。
- 「删除」只对 `op:add` 加出来的物件出现；原生几何要隐藏或走 P3 手术。
- 实例（楼群/车流里的一个）能拖自己的位置缩放，但材质属性是整个网格共享的 —— 面板里有黄条警告。
- 用户改完 agent 才看得见：`edit3d.mjs list <file>` 读 patches；用户没点保存时草稿在 localStorage（`pendingRestore()`）。
- **交付"能自己改的页面"的三步交接**（用户说"我想手动编辑"时就走这条，别只给文件路径）：
  ① `editor <file> --status` 确认宿主在位且 kit≥v1.3；② `serve <file> --port <p>`（保存要写盘，serve 必须在）；
  ③ 交地址 `http://127.0.0.1:<p>/editor.html?src=<file>` 并说明"改完点 💾 保存才落盘"。
- **人工链路自证（agent 侧，不要求用户配合）**：宿主页是 iframe 套场景，跨 document 取 API 用
  `document.querySelector('iframe').contentWindow.CITY`；点击画布后读 `CITY.describe()` 应返回被选实体
  （证明拾取通）；`CITY.set(path,v)` 造一条改动后 `fetch('/__save?file=<file>',{method:'POST',
  body:JSON.stringify(CITY.editLog())})` 应回 `{"ok":true,"count":N}`，再 `edit3d.mjs list` 看到该条
  （note 是参数中文名、无 AI note，即"人写的"）。测完 `clear` + 删 `.bak` + 清 localStorage。
- 架构与取舍见 `references/editor-enhance.md`。

## 交付差异

v1.2s 的交付物除单 HTML + 截图外，若本次任务包含修改，另附 `CITY.editLog()`（或 patches 区内容）
作为"改了什么"的机器可读清单——比自然语言变更说明可靠。
