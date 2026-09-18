---
name: vision-for-dev
description: 视觉辅助开发技能：用「识图模型审查 + 像素级测量 + 源码交叉验证」三轨闭环排障 GUI 程序界面问题（豆腐块乱码、按钮重叠、布局错位、黑边阴影、字体渲染等），覆盖交叉编译 + Wine/Xvfb 虚拟显示运行 + 自动化交互截图 + 网页交付的全流程。当用户想"界面显示不对/截图看看效果/识图检查界面/修复显示问题/做功能截图页面"时使用。
version: 1.0.0
category: 开发调试
tags: [视觉辅助开发, 识图审查, GUI排障, Wine, 截图自动化, vision-for-dev]
---

# vision-for-dev — 识图模型协作排障 GUI 程序界面问题

用「识图模型（vision）发现现象 → 像素测量确认数值 → 源码阅读定位根因」三轨闭环排障 GUI 程序界面问题。vision 是眼睛，像素是尺子，源码是答案。

## 核心闭环

```
截全状态图 → vision 结构化审查 → 像素/源码交叉验证 → 最小修复
→ 重编译 → 同状态重截 → 同清单复验 → 客观复核 → 交付
```

任何一环缺省都会返工。最常见的事故是：凭 vision 一句话结论直接改代码——vision 的感官描述经常错，数值必须实测。

## 环境与截图（一次配好）

```bash
# 交叉编译工具链（Debian/Ubuntu）
apt-get install -y gcc-mingw-w64-x86-64-win32 wine xvfb imagemagick xdotool x11-utils fonts-wqy-microhei

# 虚拟显示（后台常驻）
Xvfb :99 -screen 0 1440x900x24

# 编译 + 运行（窗口程序必须后台跑）
x86_64-w64-mingw32-gcc app.c -o App.exe -lgdi32 ... 
DISPLAY=:99 WINEPREFIX=/tmp/wineprefix WINEDEBUG=-all wine ./App.exe

# 截图前先拿窗口信息：id / rect / 标题
xwininfo -root -tree
import -window <winid> shot.png        # 截单个窗口
import -window root shot.png           # 截全屏（浮窗/弹窗场景）
```

**wine 排障坑（先记住再动手）**：
- stderr 全缓冲：重定向到文件后 timeout 杀进程会丢日志，勿凭「无输出」判断程序没跑；需要日志时 `fflush(stderr)` 或写文件
- 单实例 mutex 残留会阻止二次启动（FindWindowW 无窗口直接 return 0），重启前清理
- UI 线程卡死时进程还活着：用 `xwininfo` 判断窗口是否存活，别只看进程

## vision 审查的正确姿势

1. **截全状态**：编辑/预览/每个浮窗/对话框/菜单都截一张，只看主界面会漏问题
2. **固定问题清单**：每次审查问同样的结构化问题（当前视图？有无乱码豆腐块？按钮布局有无重叠？标题字号层级？），修前修后同清单对比
3. **一次只问 1-2 个具体问题**：多问合并会导致回答截断、多个列表项被合并成一行报出来
4. **局部裁剪放大再问**：`convert img.png -crop WxH+X+Y +repage -resize 200% out.png`，整图问细节不可靠

### vision 已知误判模式（必须交叉验证）

| 误判模式 | 后果 | 对策 |
|---|---|---|
| crop 区域方向搞反 | 内容张冠李戴，结论全错 | 裁剪前用 xwininfo 核实左右栏内容 |
| 多问题合并回答 | 关键项被截断 | 单次只问 1-2 个问题 |
| 灰色 1px 窗口边框 | 误判为「还有黑边」 | 像素复核暗像素占比，矛盾时信像素 |
| 报坐标 | 合并行/截断导致坐标错误 | 悬停高亮 + 像素找高亮行反推 |
| 字号/间距等数值 | 感官判断不稳定 | PIL/convert 实测像素行高 |

## 像素测量工具箱（数值结论的唯一来源）

```python
from PIL import Image
px = Image.open('shot.png').convert('RGB').load()

# 1. 扫文字行（暗像素行聚类）→ 验证字号层级
for y in range(h):
    dark = sum(1 for x in range(w) if sum(px[x,y]) < 384)

# 2. 找高亮行（如菜单悬停蓝色高亮）→ 客观定位交互目标
if 100 < r < 200 and 170 < g < 230 and 220 < b < 255: ...

# 3. 找彩色节点/元素（图谱节点、图表）→ 判断画布是否为空
abs(r-g) + abs(g-b) > 40  # 排除灰白黑

# 4. 裁剪四边暗像素占比 = 0% 才允许交付
```

矛盾裁决规则：**vision 与像素矛盾时，信像素**。

## 根因定位：现象 → 源码

- 「按钮重叠」→ 读布局函数，常见 bug 是两个 id 的坐标公式相同（如 `14 + 2*72` 复制粘贴后忘改系数）
- 「中文豆腐块」→ 搜硬编码字体名：Windows 上 GDI font-linking 会兜底 CJK，Wine 不会；修复用「字体存在性枚举（EnumFontFamiliesExW）+ CJK 字形检测（GetGlyphIndicesW 测'中永'）+ 候选链」，且只走 Wine 分支保持 Windows 原行为
- 「黑边/阴影」→ 先分清三层来源：Xvfb root 纯黑桌面背景、Wine CS_DROPSHADOW 窗口投影、程序自绘边框
- **最小修复**：只改问题点，不重构；保持原平台行为不变

## Xvfb 无窗口管理器的 UI 自动化

无 WM 时没有焦点管理，交互组合拳：

- 键盘事件进黑洞（XGetInputFocus 返回 1），`xdotool key --window` 也不可靠
- **唯一可靠组合：鼠标点开菜单（TrackPopupMenu/弹层有自己的键盘 grab）+ `xdotool key Down/Return` 键盘导航选中**
- 每次菜单操作前**先点窗口内部恢复焦点**——焦点漂移会让菜单弹不出、后续所有按钮点击失效
- 菜单项定位：鼠标悬停目标行 → 截图 → 像素找高亮行 y → 按项高换算其他项坐标 → 点击
- 浮窗（TOOLWINDOW）是独立 X 窗口：`import -window <winid>` 截不到内容时改截 root
- 交互脚本**逐条显式命令执行**（zsh 不做词分词，`set -- $var` 循环传参会拿到空参数）

## 交付标准（截图/宣传图）

1. root 全屏图必须按 `xwininfo` 查到的**窗口精确 rect 裁剪**——桌面黑背景 + 窗口投影都会变成「黑色阴影」
2. **禁用亮度 bbox 自动裁剪**——托盘等小窗口会把 bbox 撑大，裁完仍有黑边
3. 裁后像素复核四边暗像素占比 = 0% 才交付；vision 复核作辅助参考
4. 多状态图统一裁剪规格（同窗口尺寸），网页卡片展示才整齐

## 三条铁律

1. **现象用 vision，数值用像素**——识图模型是眼睛，测量工具才是尺子
2. **修前修后同状态对比**——状态不一致的对比毫无意义
3. **交付前客观复核**——像素指标不达标就返工，感官描述不作数
