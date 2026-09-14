---
name: slides-maker
description: >-
  Build, redesign, and critique clean, presentation-grade slide decks (.pptx) for any
  audience — 政策宣讲, 工作汇报, research/lab meetings, conference talks, stakeholder
  readouts. Use whenever the user wants to make, create, redo, or review slides/decks —
  "make slides for my project", "做个PPT", "把这份文档做成演示文稿". Interviews first,
  builds native editable PPTX with python-pptx (DeckKit component library), renders PNG
  via LibreOffice for a visual actor-critic loop. 中文排版专门优化（字体配对、行距、中英混排）.
  Upstream: https://github.com/addsumtech/slides_maker (MIT) — installed via SkillHub
  (@user_f486c577/slides-maker v5.4).
license: MIT
---

# Slide Maker（slides-maker）

把文档/主题做成**原生可编辑**的 PPTX：不是贴图，而是真文本框、真形状、真图表，
双击就能改。含 DeckKit 组件库（196个构建helper）、确定性布局lint、PNG渲染、
actor-critic 视觉审查闭环。中文排版有专门规则。

> 本仓库收录版本来自上游 addsumtech/slides_maker（MIT License）。
> 实战验证案例：惠州市居民住宅共有供水设施移交实施方案宣讲PPT（20页，深蓝政务风，
> 构建→渲染→lint两轮修复交付）。

## 安装依赖（Requirements）

### 必需（pip）

```bash
python -m pip install -r requirements.txt
```

即：

| 包 | 用途 |
|---|---|
| `python-pptx>=1.0.0` | PPTX 构建（核心引擎 DeckKit 基于它） |
| `PyMuPDF>=1.24.0` | PDF 解析 / 渲染后检查 |
| `Pillow>=10.0.0` | 文本度量（CJK/Latin 字宽） |
| `matplotlib>=3.8.0` | designed_charts（分布图/雷达图等） |
| `numpy>=1.24.0` | designed_charts 直接依赖 |

### 系统级（一次性安装，渲染与图标需要）

| 组件 | 用途 | 安装 |
|---|---|---|
| **LibreOffice** | Step5 PNG渲染（critic 视觉审查的前提） | Windows: `winget install TheDocumentFoundation.LibreOffice` 或清华镜像 MSI；macOS: `brew install --cask libreoffice`；Ubuntu: `sudo apt install libreoffice` |
| **Chrome / Chromium / Edge** | SVG 图标光栅化（首选后端） | Windows 自带 Edge 即可：设环境变量 `CHROME_BIN` 指向 `msedge.exe` |
| （可选）cairosvg | 无浏览器时的图标光栅化备选 | `pip install cairosvg`（Windows 需系统 libcairo，通常直接用 Edge 更省事） |

### 环境变量（Windows 实测可用值）

```bash
export CHROME_BIN="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
export SOFFICE="C:/Program Files/LibreOffice/program/soffice.com"   # 注意 .com（阻塞式），不是 .exe
export SLIDE_MAKER_NO_VERSION_CHECK=1   # 跳过启动时版本检查（离线/内网环境）
```

### 自检

```bash
python scripts/check_env.py --ensure   # 缺什么装什么；exit 0 = 全就绪
```

## 快速开始

1. 让 agent 读 `SKILL.md`（完整工作流：访谈 → 内容规划 → 设计 → DeckKit 构建 →
   渲染 lint → actor-critic → 交付）
2. 或直接用构建脚本模式：参照 `scripts/deckkit.py` 的 docstring +
   `python scripts/sigs.py --example <组件名>` 拿可运行的调用示例
3. 构建循环一键化：`python scripts/deck_cycle.py build_your_deck.py`
   （构建+构建期lint；加 `--render` 连渲染+渲染期lint一起跑）

## 目录结构

```
slides-maker/
├── SKILL.md            # 完整工作流（入口）
├── requirements.txt    # pip 依赖清单
├── agents/             # 子代理提示词（content-planner / slide-design / critic / arbiter …）
├── references/         # 设计规范（设计原则 / 中文排版 / 图表 / 图标 / 字体 …）
└── scripts/            # DeckKit 组件库 + 质检工具（deckkit.py / lint_deck.py / render_deck.py …）
```

## 许可

MIT（继承上游 addsumtech/slides_maker）
