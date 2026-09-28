# 定位策略（Grounding）：自然语言 → 具体元素

## 四档策略（按可靠性与成本排序）

### 策略 0：用户点选（最可靠，交互场景首选）
用户在 `assets/preview.html` 编辑页点选组件，页面提交的 `ids` 就是最终目标，跳过一切推断。

### 策略 1：语义 id / 明确属性
用户描述含明确 id、文字内容、标签类型或颜色时，直接 `query` 匹配：
```bash
PY=.../svg_toolkit.py
python $PY query f.svg --text=设备间            # 文本子串（不区分大小写）
python $PY query f.svg --tag=circle --fattr=stroke=#c00   # 类型+颜色
python $PY query f.svg --id=se-4               # 已知 id
```

### 策略 2：空间过滤器（自然语言方位 → 几何区域）
bbox 为启发式估算：rect/circle/ellipse/line/image 精确；polyline/polygon/path 取坐标点集
（贝塞尔控制点会略放大）；text 按字号×字宽估算（CJK 1em、ASCII 0.58em）；g 取子元素并集。
**够用于筛选定位，勿当精确几何。**

| 用户说法 | 过滤器 |
|---|---|
| "左上角那个框" | `query --bbox=0,0,400,300 --tag=rect` |
| "穿过中间的那条线" | `query --point=250,180 --radius=10 --tag=line` |
| "右下角的圆形" | `query --bbox=300,250,200,150 --tag=circle` |
| "整个底视图挪一下" | 先 `query --bbox=<视图外接矩形>` 圈定成员 → `move ... --all` |
| "红色那些元素" | `query --fattr=stroke=#c00` 或 `--fattr=fill=#c00` |

注意：
- `--bbox` 是**相交**语义（元素 bbox 与区域有重叠即命中），区域重叠时先 query 目测清单；
- `--point` 命中 = 点落在元素 bbox 外扩 `--radius` 像素的范围内；
- 多命中会报 **AMBIGUOUS** 并列候选（含 id/tag/bbox/text），收窄或加 `--all`。

### 策略 3：VLM 视觉兜底
空间描述复杂且过滤器失灵时：
```bash
node <skill>/scripts/render_png.mjs <svg> out.png --zoom 2
```
Read 图片 → 视觉识别目标位置与类型 → 换算回 SVG 坐标 → `query --point/--bbox` 反查 id。

## 定位铁律

- 编辑动作只落到 `index`/`query` 返回的**真实元素**（优先用其持久 id）；
- 每次 insert/delete 后目录会变，**变更后重新 query/index** 再做下一步；
- 宁可多一轮 query，不可猜着改。
