# 命令参考（svg_toolkit.py 全量）

变量约定：
```bash
PY="C:/Users/GSGS002/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
TK="C:/Users/GSGS002/.workbuddy/skills/cad-svg-edit/scripts/svg_toolkit.py"
NODE="C:/Users/GSGS002/.workbuddy/binaries/node/versions/22.22.2-2/node.exe"
```

## 查询类

### index —— 建立可寻址目录
```bash
"$PY" "$TK" index f.svg            # 表格：idx/id/tag/bbox/text
"$PY" "$TK" index f.svg --json     # 结构化（含 geom/style）
```
首次运行自动为无 id 元素补 `se-N` 并写回（写回前自动备份）。此后全图 id 稳定寻址。

### query —— 过滤器查询（v1.1 新增）
```bash
"$PY" "$TK" query f.svg --text=设备间                     # 文本子串
"$PY" "$TK" query f.svg --tag=text --limit=200            # 全部文字元素
"$PY" "$TK" query f.svg --fattr=stroke=#1d4e89            # 属性精确匹配
"$PY" "$TK" query f.svg --bbox=0,0,400,300 --tag=rect     # 区域相交
"$PY" "$TK" query f.svg --point=250,180 --radius=10       # 点命中（配 --radius）
"$PY" "$TK" query f.svg --tag=g --json                    # 结构化输出
```
过滤器之间是 AND 关系。输出行含 `id / tag / bbox / style / text`。

### read —— 单元素详情
```bash
"$PY" "$TK" read f.svg se-4        # 全部属性 + bbox + style + text（JSON）
```

## 变更类（写盘前自动备份为 <file>.bak-<时间戳>）

目标写法三选一：`id` 位置参数 | 过滤器（`--tag/--text/--fattr/--bbox/--point`）| 过滤器 + `--all`。
多命中不加 `--all` → 报 AMBIGUOUS（退出码 2）并列候选。

### update —— 改属性
```bash
"$PY" "$TK" update f.svg se-4 --fill "#e74c3c" --stroke-width 3
"$PY" "$TK" update f.svg se-4 --attr stroke-dasharray="6 4" opacity=0.8   # 任意属性
"$PY" "$TK" update f.svg --tag=line --fattr=stroke=#000 --stroke-width 2 --all  # 批量
```

### text —— 改文字
```bash
"$PY" "$TK" text f.svg se-2 --set "控制室平面图"
"$PY" "$TK" text f.svg --text=一层平面图 --set "控制室一层平面图"   # 按旧文字定位
```
`<text>` 的子元素会被移除并替换为纯文本；改 tspan 请用其 id 精确定位。

### move —— 平移（translate 前置，可逆）
```bash
"$PY" "$TK" move f.svg se-5 --dx 10 --dy 5
"$PY" "$TK" move f.svg --bbox=300,250,200,150 --dx 50 --all   # 整组平移

# 性能关键：批量平移（避免逐元素循环，单进程搞定）
"$PY" "$TK" move f.svg se-3 se-4 se-5 --dx -20 --dy 0          # 多 id 同位移
"$PY" "$TK" move f.svg --batch se-3:-20,0 se-4:-16,0 se-120:-16,0 --no-backup  # 逐 id 不同位移
"$PY" "$TK" move f.svg --fattr=transform=translate(415,0) --all --dx 0 --dy 28  # 共享 transform 整组
```
> 批量编辑务必加 `--no-backup`，否则每个元素都生成一份 `.bak`，百级元素会拖慢 + 堆积。

### scale / rotate —— 仅支持 id
```bash
"$PY" "$TK" scale f.svg se-4 --sx 1.5 --sy 1.5 --cx 200 --cy 180   # 绕指定中心
"$PY" "$TK" rotate f.svg se-5 --deg 30 --cx 300 --cy 170
```

### delete —— 删除
```bash
"$PY" "$TK" delete f.svg se-3
"$PY" "$TK" delete f.svg --tag=line --fattr=stroke=#0a0 --all
```

### insert —— 插入（自动补 id）
```bash
"$PY" "$TK" insert f.svg line --attr x1=10 y1=10 x2=100 y2=100 stroke=#0a0
"$PY" "$TK" insert f.svg text --attr x=50 y=330 font-size=14 fill=#999 --text "内部资料" --parent-id se-1
```

## 校验 / 导出 / 安全

```bash
"$PY" "$TK" validate f.svg          # 重复 id / 悬空引用（每次编辑后必跑）
"$PY" "$TK" export f.svg out.svg --pretty
"$PY" "$TK" backup f.svg            # 手动备份
"$PY" "$TK" undo f.svg              # 恢复最近备份（可连续回退多级）
"$PY" "$TK" backups f.svg           # 列出全部备份
```

## 渲染复核

```bash
NODE_PATH="C:/Users/GSGS002/.workbuddy/binaries/node/workspace/node_modules" \
  "$NODE" "C:/Users/GSGS002/.workbuddy/skills/cad-svg-edit/scripts/render_png.mjs" f.svg out.png --bg "#ffffff" --zoom 2
```
输出 PNG 后 Read 目检；中文渲染 OK（loadSystemFonts）。

## 版本化命名

```bash
"$NODE" "C:/Users/GSGS002/.workbuddy/skills/cad-svg-edit/scripts/next_name.mjs" demo.svg
# → demo_v1.1.svg；demo_v1.9.svg → demo_v1.10.svg；中文文件名同样适用
```

## 能力边界

- **可靠**：改色/线宽/填充/透明度、改文字、平移/缩放/旋转、删除、插入、按过滤器批量。
- **困难**：重塑路径几何（贝塞尔级编辑）、从零复杂绘图、未标注语义自动理解 → 用 cad-driver 重生成。
- bbox 为启发式（path 含控制点略放大、text 按字宽估算），用于筛选而非精确几何。
