---
name: cad&svg-edit
description: 融合「CAD 创建」与「SVG 精准编辑」的单一技能。根据用户意图自动路由：从零创建 CAD 图形（cad 无头引擎，输出 SVG/PNG/CSV/DXF）走 CAD-CREATE；修改已存在的 SVG（持久 id 寻址、空间/文本过滤、可视化点选、版本化保存）走 SVG-EDIT；若目标 SVG 由 cad 脚本生成，优先源脚本重生成。Use when drawing/plotting CAD graphics, mechanical parts, floor plans (export SVG/PNG/CSV/DXF), OR editing/modifying existing SVG files (text, color, position, batch changes).
agent_created: true
version: 2.1.0
---

# CAD & SVG-Edit（融合技能）

一个技能覆盖「从零创建」与「精准修改」两类需求，按用户意图**自动路由**到对应功能区，避免在两套 skill 间手动切换。

- **技能根目录 `<skill>`**（下文命令中的 `<skill>` 均指代，用实际安装路径替换）：
  任意放置目录均可，如 `~/.workbuddy/skills/cad-svg-edit`

---

## 路由决策（先判断，再执行）

| 用户意图 | 路由到 | 能力来源 |
|---|---|---|
| 从零画一张新图 / 零件 / 平面图 / 示意图；要生成 SVG / PNG / CSV | **A. CAD-CREATE** | cad 无头引擎 |
| 修改一张**已存在**的 SVG（改字 / 改色 / 移位 / 增删 / 批量 / 空间点名） | **B. SVG-EDIT** | svg_toolkit 确定性修改 |
| 要改的 SVG 恰由本技能 cad 引擎的生成脚本产出 | **B 的「源脚本路线」优先**：改脚本参数用 CAD-CREATE 重生成 | cad 引擎 |
| 需要 3D 实体（STEP/STL）、工程图 PDF、可制造性检查、3D 打印 | **外部转介** → [text-to-cad](https://github.com/earthtojake/text-to-cad)（build123d 内核） | 生态互补 |

判断要点：
- 目标文件**已存在且要"改"** → SVG-EDIT。
- 尚**无图形、要"造"** → CAD-CREATE。
- 语义模糊（如"把平面图里那个房间放大"）：目标已存在 → 走 SVG-EDIT；若需结构性改动且原图由 cad 脚本生成 → 切 CAD-CREATE 重生成（精度更高、联动一致）。

---

## 环境要求（跨平台，v2.1 起零硬编码路径）

- **Node ≥ 16**（CAD-CREATE 无头引擎唯一依赖）：`node` 在 PATH 中即可
- **Python 3**（仅 SVG-EDIT 需要，含标准库即可，lxml 可选）：`python3` 在 PATH 中
- resvg（仅 PNG 视觉复核需要，缺省自动跳过并提示）
- 一键自检：`node <skill>/engine/cad-engine.js doctor` → 输出引擎版本 / Node / Python 状态 / 冒烟结果（Linux / Windows / macOS 通用）

> 坐标约定：**X 右，Y 下**（SVG 系），原点(0,0)，角度用度，弧 `ccw:true`=逆时针。单位=像素(世界坐标)。

---

# A. CAD-CREATE（创建）

> 原 `cad-creat`（cad-driver）能力。无头引擎优先，浏览器可视化预览可选。

把绘图运行时直接集成进 skill 目录，agent 无需浏览器即可精确驱动出图：
- **主运行时（无头）**：`<skill>/engine/cad-engine.js` —— 纯 JS，零原生依赖，输出 **SVG / PNG / CSV / DXF** 四种格式，每条操作返回结构化 JSON ack，内置几何校验闭环。
- **可视化预览（可选）**：`<skill>/assets/cad-draw.html` —— 浏览器打开可看绘制结果、点按钮下载；供人查看/截图复核。

## 目录
```
cad-svg-edit/
├── SKILL.md
├── CHANGELOG.md            # 版本更新日志
├── engine/cad-engine.js   # 无头引擎（cadAPI v2.1-headless，含 doctor 自检）
├── assets/cad-draw.html   # 可选可视化预览页
├── assets/preview.html    # SVG-EDIT 点选编辑页
├── examples/              # 示例 draw 脚本
│   ├── gear.js  house.js  nut.js  flange.js  bad.js
├── test/run-tests.js      # 回归测试（doctor + 全部示例 + 负例）
├── scripts/               # SVG-EDIT 编辑工具
│   ├── svg_toolkit.py  daemon.mjs  next_name.mjs  render_png.mjs
└── references/            # SVG-EDIT 参考文档
    ├── grounding.md  operations.md
```

## 两种模式对比

| 模式 | 入口 | 浏览器 | 输出 | 适用 |
|------|------|--------|------|------|
| **无头（推荐）** | `node engine/cad-engine.js draw.js` | 不需要 | SVG+PNG+CSV+DXF 文件 + JSON 摘要 | agent 自动出图、批量、CI |
| 可视化 | 浏览器打开 `assets/cad-draw.html` | 需要 | 页面按钮下载 SVG/PNG | 人查看、截图复核 |

## 无头模式（核心）

### 调用方式
用 Node 运行一个 **draw 脚本**（`node` 需在 PATH 中，Windows/macOS/Linux 相同），脚本里直接用全局 `cadAPI`（与浏览器同名同签名）：

```bash
# <skill> 替换为本技能实际目录；先跑 doctor 确认环境
node <skill>/engine/cad-engine.js doctor
node <skill>/engine/cad-engine.js \
      <skill>/examples/gear.js \
      --all --out "./out" --name gear
```

参数：
- `<draw.js>`：必填，绘图脚本（用 `cadAPI.*` 调用）。
- `--svg` / `--png` / `--csv` / `--dxf`：分别导出；`--all` 或省略则四项全导。
- `--out DIR`：输出目录（默认 `.`）。
- `--name NAME`：文件名前缀（默认 `cad-drawing`）。

运行后打印 JSON 摘要：`{name, count, svg, csv, dxf, png:{path,bytes,width,height}}`。

### draw 脚本写法（与浏览器完全一致）
```js
cadAPI.clear();
const r = cadAPI.circle(0, 0, 50);   // 返回 {id, bbox}
cadAPI.fit();
return JSON.stringify({id: r.id, bbox: r.bbox});  // 可选：回传信息
```

### 也可 require 作为模块
```js
const { api, toCSV, toDXF } = require("<skill>/engine/cad-engine.js");
api.clear(); api.rect(0,0,100,60);
require("fs").writeFileSync("a.csv", toCSV());
require("fs").writeFileSync("a.dxf", toDXF());
```

## 输出格式

| 格式 | 说明 | 用途 |
|------|------|------|
| **SVG** | 矢量，几何/标注/文字精确 | 出版、再编辑、网页嵌入 |
| **PNG** | 软件光栅化（纯 JS 编码器，无原生依赖），白底线稿，含尺寸标注数值与文字 | 快速预览、贴图、不支持矢量的场景 |
| **CSV** | 每个图形的结构化几何表（见下） | agent/用户读取坐标、做数据校验、进表格 |
| **DXF** | R12 ASCII 实体（LINE/CIRCLE/ARC/POLYLINE/TEXT 等），Y 轴已翻转为 CAD 惯例（Y 向上） | 激光切割下料、导入 AutoCAD/Fusion/SolidWorks 等 CAD 软件 |

### CSV 表结构
表头：`id,type,layer,stroke,strokeW,fill,geometry,length,area`
- `geometry`：按类型输出的关键坐标（line→p1/p2，circle→c/r，rect→x/y/w/h，polyline/polygon/spline→points…）。
- `length`/`area`：调用 `cadAPI.length`/`cadAPI.area` 的数值（无则空）。
- 含逗号/引号的值已按 RFC4180 转义。

示例行：`1,circle,0,#000,2,none,"c=(0,0) r=120",753.98,45238.93`

## 标准工作流（无头）
```
1. cadAPI.clear()
2. 创建图形 → 收集 id（每个 API 返回 {id, bbox}）
   ↳ 用 keyPoints(id) 引用特征点，避免坐标重算
3. 变换/阵列（用 id）
4. cadAPI.verify()  → {count, validate, issues, dims, bbox, snapshot(SVG dataURL)}
5. 校验闭环：validate 失败 → diagnose().suggestions → deleteShape → 复检
6. 导出：运行 CLI 得到 SVG/PNG/CSV/DXF（或脚本内 api.exportSVG() / api.exportDXF() 等）
7. 返回 JSON 摘要（count/bbox/文件路径）给调用方
```

**关键**：画完必调 `cadAPI.fit()`（无头下仅算包围盒，不影响几何）。

## API 速查

### 创建类（返回 `{id, bbox}`）
`line(x1,y1,x2,y2,style?)` · `circle(cx,cy,r,style?)` · `rect(x,y,w,h,style?)` · `polyline(points,style?)` · `polygon(points,style?)` · `spline(points,closed?,style?)` · `arc(cx,cy,r,a1,a2,ccw?,style?)` · `ellipse(cx,cy,rx,ry,rotDeg?,style?)` · `text(x,y,str,size?,style?)` · `dimLine(x1,y1,x2,y2,style?)` · `dimRadius(circleId,style?)` · `point(x,y,style?)`

`style`：`{stroke:"#1a1a1a", strokeW:2, fill:"none"}`。

### 变换/编辑（接受单个 id 或数组，返回 bbox）
`move(ids,dx,dy)` · `rotate(ids,cx,cy,deg)` · `mirror(ids,x1,y1,x2,y2)` · `scale(ids,cx,cy,factor)` · `clone(ids,dx,dy)` · `arrayRect(ids,rows,cols,dx,dy)` · `arrayPolar(ids,cx,cy,count,angleDeg?,rotateItems?)` · `deleteShape(ids)` · `setStyle(id,{...})`

### 查询
`list()` · `get(id)` · `bbox(ids?)` · `area(id)` · `length(id)` · `count()` · `byType(type)` · `keyPoints(id)`（圆心/象限/顶点等特征点）

### 几何校验（闭环）
`checkParallel(id1,id2,tol?)` · `checkPerpendicular(...)` · `checkTangent(...)` · `findIntersections(...)` · `containsPoint(id,x,y)` · `distance(id1,id2)` · `validate()` · `diagnose()` · `autoDim(ids?,opts?)` · `verify(ids?)`

### 视图/导出/批量
`fit()` · `snapshot()`(SVG dataURL) · `exportSVG()` · `exportDXF()`(R12 ASCII, Y 轴已翻转) · `exportSVGDataUrl()` · `exportPNGDataUrl()`(Promise→PNG dataURL) · `loadJSON({shapes})` · `clear()` · `undo()`/`redo()` · `setDisplay({bgColor?})` · `help()` · `version()`

### keyPoints 特征点（防坐标重算）
circle→圆心+4象限点；arc→圆心+起终点；ellipse→圆心+4端；rect→9点；line/dimLine→端点1/2+中点；polyline/polygon/spline→P0…Pn+首末中点。

## 菜谱库

### 齿轮
```js
cadAPI.clear();
const R=120, rp=100, hole=40;
cadAPI.circle(0,0,R,{stroke:"#000",strokeW:2,fill:"none"});
cadAPI.circle(0,0,hole,{stroke:"#000",strokeW:2,fill:"none"});
const t = cadAPI.rect(-8, rp-10, 16, 20, {fill:"#888"});
cadAPI.arrayPolar(t.id, 0, 0, 12, 360, true);
cadAPI.rect(-6, hole-3, 12, 10, {fill:"#fff"});
const dc = cadAPI.circle(0,0,R); cadAPI.dimRadius(dc.id);
cadAPI.text(-30,-R-20,"GEAR Z=12",14);
cadAPI.fit();
```

### 法兰盘（多孔环阵）
```js
cadAPI.clear();
cadAPI.circle(0,0,150,{strokeW:3,fill:"none"});
cadAPI.circle(0,0,130,{strokeW:1,fill:"none"});
cadAPI.circle(0,0,40,{strokeW:2,fill:"none"});
const b = cadAPI.circle(100,0,12,{strokeW:2,fill:"none"});
cadAPI.arrayPolar(b.id,0,0,8,360,true);
cadAPI.fit();
```

### 矩形阵列（孔板）
```js
cadAPI.clear();
const h = cadAPI.circle(0,0,10,{fill:"none"});
cadAPI.arrayRect(h.id, 4, 6, 50, 50);
cadAPI.fit();
```

### 房屋
```js
cadAPI.clear();
cadAPI.rect(-80,-20,160,100,{strokeW:3,fill:"#f5f5f5"});
cadAPI.polygon([[-100,-20],[0,-100],[100,-20]],{stroke:"#c0392b",strokeW:3,fill:"#e74c3c"});
cadAPI.rect(-30,10,25,70,{stroke:"#5a3a22",strokeW:2,fill:"#8b5a2b"});
cadAPI.rect(20,10,35,35,{strokeW:2,fill:"#aee"});
cadAPI.text(-50,-110,"My House",16);
cadAPI.fit();
```

### 螺母（俯视 + 前视）
```js
cadAPI.clear();
const R=57.735, Rc=46, r=25;                 // 对边距 s=100, 孔半径 R25
const sf=+(R*Math.sqrt(3)/2).toFixed(2);
const hex=(rad)=>{const p=[];for(let i=0;i<6;i++){const a=i*60*Math.PI/180;p.push([+(rad*Math.cos(a)).toFixed(2),+(rad*Math.sin(a)).toFixed(2)]);}return p;};
const o=hex(R), inn=hex(Rc);
cadAPI.polygon(o,{strokeW:2.5,fill:"none"});
cadAPI.polygon(inn,{strokeW:1.5,fill:"none"});
for(let i=0;i<6;i++)cadAPI.line(o[i][0],o[i][1],inn[i][0],inn[i][1],{strokeW:1});
const b=cadAPI.circle(0,0,r,{strokeW:2,fill:"none"}); cadAPI.dimRadius(b.id);
cadAPI.line(-80,0,80,0,{stroke:"#999",strokeW:1}); cadAPI.line(0,-80,0,80,{stroke:"#999",strokeW:1});
cadAPI.dimLine(94,-sf,94,sf,{strokeW:1});
const fy=215,hH=42,xL=-sf,xR=sf,c=12,yT=fy-hH,yB=fy+hH;
cadAPI.polygon([[xL,yT+c],[xL+c,yT],[xR-c,yT],[xR,yT+c],[xR,yB-c],[xR-c,yB],[xL+c,yB],[xL,yB-c]],{strokeW:2.5,fill:"none"});
cadAPI.line(-72,fy,72,fy,{stroke:"#999",strokeW:1});
cadAPI.dimLine(xL-32,yT,xL-32,yB,{strokeW:1});
cadAPI.dimLine(xL,yB+32,xR,yB+32,{strokeW:1});
cadAPI.fit();
```

### 带闭环矫正
```js
cadAPI.clear();
cadAPI.circle(0,0,120,{fill:"none"});
cadAPI.circle(0,0,40,{fill:"none"});
const t = cadAPI.rect(-8, 90, 16, 20, {fill:"#888"});
cadAPI.arrayPolar(t.id, 0, 0, 12, 360, true);
cadAPI.fit();
const v = cadAPI.validate();
if (!v.ok) { cadAPI.diagnose().suggestions.forEach(s => { if (s.action==="delete") cadAPI.deleteShape(s.id); }); cadAPI.fit(); }
return JSON.stringify({count:cadAPI.count(), validate:v.ok});
```

## 可视化预览（可选，浏览器）
若需人眼查看或截图复核：
1. 用浏览器打开 `<skill>/assets/cad-draw.html`（或本地 http server 托管）。
2. 在控制台/执行桥用 `cadAPI.*` 绘制（同签名）。
3. 点页面 **⬇ SVG / ⬇ PNG** 下载，或 `cadAPI.exportSVG()` 取字符串。

## 错误处理
- API 抛 `Error`，CLI 以非 0 退出并打印 `ERR <msg>`。
- 常见：`r 须为正数`、`polyline 至少 2 点`、`dimRadius 需要有效的 circle id`。
- 收到错误修正参数重试，勿重复盲调。`arrayPolar`/`arrayRect` 限制 ≤5000。

## 验证闭环（三层）
1. 数据层：`count()` / `bbox()` / `list()` 统计类型。
2. 几何层：`validate()` / `diagnose()`。
3. 关系层（按需）：`distance()` / `checkParallel()` / `checkTangent()`。
三层通过后再导出。无头模式下 `verify()` 返回的 `snapshot` 是 SVG dataURL，可存文件复核；PNG/CSV/DXF 即最终交付物。

## 自检与回归（v2.1 新增）

```bash
# 环境自检：引擎版本 / Node / Python / 冒烟绘图
node <skill>/engine/cad-engine.js doctor

# 回归测试：doctor + 4 个正例示例（gear/house/nut/flange 全格式导出）+ bad.js 负例
node <skill>/test/run-tests.js   # 期望输出 ALL_PASS
```

---

# B. SVG-EDIT（编辑）

> 原 `svg-edit-v1.1` 能力。把任意 SVG 解析成「可寻址元素目录」，用确定性命令对指定元素精准修改，渲染/校验复核后交付。全程不依赖 LLM 自由生成 SVG 代码，规避幻觉与结构性破坏。

融合来源：
- **svg-edit（本机 v1.0）**：se-N 持久 id 寻址、浏览器点选页、daemon 零粘贴闭环、版本化保存、resvg 渲染。
- **svg-edit（qoder）**：空间/文本查询过滤器、AMBIGUOUS 多命中防护、.bak 备份 + 多级 undo、源脚本优先路由。

## 何时使用

- 用户要修改一张**已存在的 SVG** 中的指定内容（文字、颜色、位置、线宽、增删元素等）。
- 用户用自然语言点名"某部分"——含**空间方位描述**（"左上角那个框""穿过中间的线""右下角的圆"）。
- **不适用**：从零生成新图（用 **A. CAD-CREATE**）；重塑复杂路径几何（建议重生成）。

## 路线选择（先判断，按序降级）

1. **源脚本路线（优先）**：目标 SVG 若由参数化脚本生成（如 **A. CAD-CREATE** 的生成脚本），
   改脚本参数重生成——精度最高、联动天然一致。硬改交付图会在下次重跑脚本时被覆盖。
2. **可视化点选路线（用户体验最佳）**：启动 daemon，agent 用 `?file=` 开编辑页，
   用户点选组件 + 一句话提交 → 自动接单执行（见下「直连模式」）。
3. **过滤器查询路线（用户不在场/纯 CLI）**：用 `query` 的文本/属性/空间过滤器定位
   （见 `<skill>/references/grounding.md` 的 NL→过滤器映射表）。
4. **VLM 视觉兜底**：空间描述复杂且过滤器失灵时，`render_png.mjs` 出 PNG 借视觉定位反查 id。

## 直连模式（用户点选 + 零粘贴，交互首选）

> 注意：daemon 固定占用端口 8620，**全局只需一个实例**（新旧 skill 的 daemon 脚本相同）。

1. 启动守护进程（唯一后台任务）：`node <skill>/scripts/daemon.mjs` → `http://127.0.0.1:8620/`；
   它同时负责：托管编辑页（`?file=` 注入开页）+ 接收提交 + 回传结果 + 1 秒轮询 pending_edits
   （见新请求自行退出，日志 `[wake] req_*.json`，借后台任务通知唤醒 agent）；
2. 确保目标 SVG 在工作区根目录（用户项目根，即 agent 的当前工作目录；不在则先拷贝进来）；
3. agent 打开编辑页：present_files `http://127.0.0.1:8620/?file=<文件名>.svg`；
4. 用户：点选组件（可多选，橙色高亮 + id 徽标）→ 底部输入框写要求 → 回车；
5. 页面 POST `/submit` → 落盘 `pending_edits/req_<reqid>.json`（含 reqid/file/ids/instruction/svgText）；
6. daemon 捕获 → 自行退出 → 唤醒 agent → 按下方「接单协议」执行；
7. 页面轮询 `/output/<reqid>` 拿到结果自动重载画布，文件名更新为新版本号。

降级链：file:// 打开页面（无 daemon）→ 复制指令让用户粘贴；页面等待 180 秒未出结果 → 复制指令兜底。

## 接单协议（agent 被唤醒后照此执行）

当 daemon 唤醒（`pending_edits/` 出现 `req_*.json`）时：
1. 列出 `pending_edits/` 全部 `req_*.json`（可能积压多单），逐一处理；
2. 读请求：`{reqid, file, ids, instruction, svgText}`；`svgText` 是画布当前态（= 最新版本内容），**以它为编辑输入**；
3. 写工作副本：把 `svgText` 存到 `pending_edits/uploads/<file>`（file 为页面当前版本名）；
4. 用 `svg_toolkit.py` 按 `instruction` 对 `ids` 确定性修改（id 定位，勿改源码）。**多 id 同操作务必批量**：同位移用 `move id1 id2 ...` 或 `--batch`，并加 `--no-backup`；→ 统一 `validate`；
5. 版本化保存：`node <skill>/scripts/next_name.mjs <file>` 得新名（`demo.svg`→`demo_v1.1.svg`），
   把改好的 SVG **另存为工作区根的新版本文件**；铁律：**绝不改动原文件和旧版本文件**；
6. 回传：最终 SVG 写 `pending_edits/outputs/<reqid>.svg`；元数据写 `outputs/<reqid>.meta.json`
   （`{"outfile":"<新版本文件名>","summary":"<一行中文摘要>"}`，页面靠这两个文件回传，缺一不可）；
7. 把 `req_<reqid>.json` 移入 `pending_edits/done/`；全部订单处理完后**重启一次 `daemon.mjs`** 等待下一单；
8. 在回复中用中文简短汇报：改了什么、新版本文件名、原文件未动。

## 性能优化（批量编辑必读）

> 慢的唯一根因：**每个变更命令都独立启动一个 Python 进程 + 重解析整份 SVG + 写一份 `.bak`**。
> 逐元素循环调用 = 上百次进程启动，这是主要耗时。务必按以下方式批量化。

### 三条铁律
1. **同一位移的多个元素 → 一条命令**。用多 id 或过滤器，不要 for 循环：
   ```bash
   # 同一位移：多个 id 一次搞定（单进程）
   python svg_toolkit.py move <svg> se-3 se-4 se-5 ... se-52 --dx -20 --dy 0
   # 同视图若共享 transform，用过滤器一条搞定
   python svg_toolkit.py move <svg> --fattr=transform=translate(415,0) --all --dx 0 --dy 28
   ```
2. **不同元素不同位移 → `--batch` 一条命令**（单进程，逐 id 指定）：
   ```bash
   python svg_toolkit.py move <svg> --batch se-3:-20,0 se-4:-16,0 se-120:-16,0 --no-backup
   ```
3. **批量编辑加 `--no-backup`**：避免上百份 `.bak` 拖慢 + 事后清理。
   收尾时用一次 `backup` 或依赖版本化另存（`next_name.mjs`）保留可回退点即可。

### 重排视图类任务的标准手法
视图元素通常各自带 `transform`。按下表分组，**每组一条命令**（而非逐元素）：

| 分组依据 | 命令形态 | 进程数 |
|---|---|---|
| 底视图（共享 `translate(415,0)`） | `move --fattr=transform=translate(415,0) --all --dx 0 --dy 28` | 1 |
| 正视图（同位移 -20,0） | `move se-3..se-52 --dx -20 --dy 0` | 1 |
| 侧/后视图（不同位移） | `move --batch se-54:-8,0 ... se-63:48,0 ... --no-backup` | 1 |

→ 百级元素从 ~100 次进程降到 3–4 次，提速一个数量级。

### 校验策略
批量改动后仍每步 `validate`；但多组移动可在全部完成后**统一校验一次**（而非每组校验），进一步省时。

### 步骤 0：建目录
```
python <skill>/scripts/svg_toolkit.py index <svg> --json
```
自动为无 id 元素补 `se-N`（写回前自动备份）。把目录当"地图"，后续定位引用真实 id。

### 步骤 1：定位"指定部分"（按序降级，详见 references/grounding.md）
- 用户已点选（页面提交的 `ids`）→ 直接用；
- 文字描述含明确文字/类型/颜色 → `query --text=XX` / `--tag=circle --fattr=stroke=#c00`；
- 空间方位描述 → `query --bbox=x,y,w,h --tag=rect` / `--point=x,y --radius=30`；
- 仍歧义 → 渲染 PNG 视觉定位，或请用户点选。

> 铁律：编辑只落到 `query`/`index` 得到的真实元素；禁止凭空改写 SVG 源码。

### 步骤 2：确定性修改
- 改属性：`update <svg> <id> --fill ... --stroke-width ...`（或过滤器 + `--all` 批量，加 `--no-backup` 免堆积备份）
- 改文字：`text <svg> <id> --set "新文字"`（批量同文字加 `--all`）
- 平移：`move`（见下方批量语法，**优先批量**）
- 缩放/旋转：`scale` / `rotate`（仅单 id）
- 删除/插入：`delete` / `insert`（批量加 `--all` / `--no-backup`）
- **批量平移语法**（性能关键，见上方「性能优化」）：
  - 多 id 同位移：`move <svg> id1 id2 id3 --dx N --dy N`
  - 逐 id 不同位移：`move <svg> --batch id1:dx,dy id2:dx,dy ... --no-backup`
  - 过滤器整体：`move <svg> --fattr=transform=... --all --dx N --dy N`
- 多命中的变更命令会报 **AMBIGUOUS** 并列候选——收窄过滤器或明确加 `--all`，勿盲目 `--all`。

### 步骤 3：校验闭环（每次编辑后必跑）
```
python <skill>/scripts/svg_toolkit.py validate <svg>
```
- 检查重复 id、悬空引用（`url(#..)`、`href`）；报错立即停止，先 `undo` 或排查再继续。
- 需要肉眼复核：`node <skill>/scripts/render_png.mjs <svg> out.png` → Read 图片检查。

### 步骤 4：交付
- 版本化另存（`next_name.mjs`）或 `export`；回报改动明细（改了哪些 id、变成什么）与文件路径。

## 安全机制（四层）

| 层 | 机制 |
|----|------|
| 1 | **版本化保存**：改动另存 `原名_v1.N.svg`，原文件与旧版本永不改动 |
| 2 | **自动备份**：变更命令写盘前生成 `<file>.bak-<时间戳>`；`undo` 多级回退、`backups` 列出。批量编辑用 `--no-backup` 跳过，靠版本化另存保留回退点 |
| 3 | **AMBIGUOUS 防护**：过滤器多命中拒绝执行并列候选，防误伤 |
| 4 | **validate**：重复 id / 悬空引用检查，复杂编辑小步迭代每步校验 |

## 能力边界（如实告知用户）

- **可靠**：改颜色/线宽/填充/透明度、改文字、平移、缩放、旋转、删除、插入、按过滤器批量改。
- **困难/不支持**：重塑路径几何（如"把这段墙改成折线"）、从无到有的复杂绘图、
  未标注语义的自动理解。此类需求建议改用 **A. CAD-CREATE** 重新生成（源脚本路线）。

## 关键文件

| 文件 | 作用 |
|------|------|
| `<skill>/scripts/svg_toolkit.py` | 核心：index/query/read/update/text/move/scale/rotate/delete/insert/validate/export/backup/undo/backups |
| `<skill>/scripts/daemon.mjs` | 直连模式单守护进程（唯一后台任务）：托管编辑页 + 接收提交 + 回传结果 + 轮询请求，端口 8620 |
| `<skill>/scripts/next_name.mjs` | 版本命名：`demo.svg`→`demo_v1.1.svg`，已有版本小号 +1 |
| `<skill>/scripts/render_png.mjs` | 可选：SVG→PNG（视觉复核/VLM 定位），依赖 `@resvg/resvg-js` |
| `<skill>/assets/preview.html` | 可点选编辑页：由 agent `?file=` 打开；多选组件 + 回车提交；结果自动重载 |
| `<skill>/references/grounding.md` | 自然语言→元素的定位策略 + NL→过滤器映射表 |
| `<skill>/references/operations.md` | 全部命令示例、bbox 估算说明、能力边界 |

## 错误处理
- 任何命令出错打印 `ERR <msg>` 并退出非 0；读取后修正参数重试，勿重复盲调。
- `AMBIGUOUS`（退出码 2）：收窄过滤器或 `--all`；先 `query` 目测命中清单再决定。
- validate 报 `duplicate_id` / `dangling_ref`：立即停止编辑，`undo` 回退后排查来源。
- 渲染后图形错乱：先 `validate`；通过但视觉不对 = 语义选错目标，`undo` 后重新 query。
- `render_png.mjs` 缺 resvg 时打印安装提示并退出码 2，不阻断主流程（改用 query/页面定位）。
