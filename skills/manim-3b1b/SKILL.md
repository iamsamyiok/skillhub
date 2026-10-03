---
name: manim-3b1b
version: 1.0.0
category: 视频创作
tags: [Manim, 3Blue1Brown, 数学动画, 教学视频, 科普视频, 中文, 配音, 字幕, ffmpeg, 可视化]
description: 用 Manim（3Blue1Brown 官方动画引擎）制作 3b1b 风格的数学/概念讲解视频，支持中文 + 配音 + 字幕。当用户要求「做 3Blue1Brown 风格动画」「用 manim 做视频」「生成科普/教学动画视频」「把某个概念做成动画视频」「给讲解视频加配音/字幕」时触发。覆盖环境搭建、3b1b 美学规范、中文渲染、无 LaTeX 数学符号、场景编排、有声视频双轨制流程（edge-tts 配音 + ffmpeg 后期合成）、渲染与校验的全流程。
license: MIT
allowed-tools: Read, Write, Bash, Edit
---

# Manim 3Blue1Brown 风格动画视频 Skill

把任意数学/算法/概念做成 **3Blue1Brown 风格**的讲解视频：深色背景、干净无衬线字体、标志性的蓝/黄/绿/红配色、分段式逐帧揭示与平滑过渡。底层用 **Manim Community Edition**（3b1b 开源的 Python 动画引擎），产物是真实 `.mp4`。

> `<skill-directory>` 指本 skill 所在目录（`manim-3b1b/`）。

---

## 一、何时使用

- 用户要「3Blue1Brown 风格」「manim 风格」「科普/教学动画视频」。
- 需要把抽象概念（图灵机、数独、神经网络、傅里叶、梯度下降、算法流程…）可视化。
- 要的是**真视频文件（mp4，可含配音/字幕）**，而非静态图或网页。

---

## 二、环境搭建（首次必做）

```bash
bash <skill-directory>/scripts/install.sh
```

脚本等价手动执行（要点见踩坑清单）：

```bash
# 1) 系统依赖：ffmpeg（封装/合成）、cairo/pango（图形）、CJK 字体
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ffmpeg libcairo2-dev libpango1.0-dev pkg-config python3-dev libffi-dev \
  fonts-noto-cjk espeak-ng

# 2) Python 包（系统 Python，见坑#7）
sudo pip3 install --break-system-packages --ignore-installed typing-extensions manim
sudo pip3 install --break-system-packages --ignore-installed typing-extensions edge-tts gTTS pydub

# 3) 修复 click 版本冲突（见坑#6）：manim 依赖 cloup，需要 click>=8.5
sudo pip3 install --break-system-packages 'click>=8.5,<9'
```

> **为什么不用 LaTeX？** `MathTex` 需要整套 TeX Live（数百 MB~GB）。本 skill 用 **Unicode 数学符号 + 中文字体** 表达公式，渲染更快更稳，绝大多数科普动画足够。

> **Python 解释器**：`manim` 与 `edge-tts` 都装在**系统 Python**（`/usr/bin/python3`，通常为 3.12）。若当前 shell 的 `python3` 指向 pyenv 版本（如 3.11），`import edge_tts` 会失败——改用 `/usr/bin/python3` 跑配音/合成脚本即可。

---

## 三、3Blue1Brown 美学规范（照着做就「像」）

| 要素 | 取值 |
|------|------|
| 背景色 | 近黑深蓝 `#0E1116`（设 `self.camera.background_color = "#0E1116"`）|
| 主蓝（强调/标题） | `BLUE`（`#58C4DD`）|
| 黄（高亮/当前步/读写头） | `YELLOW`（`#FFFF00`）|
| 绿（成功/状态/结论） | `GREEN`（`#83C167`）|
| 红（警示/排除/不可判定） | `RED`（`#FC6255`）|
| 灰（次要/空白） | `GREY` |
| 中文字体 | `Noto Sans CJK SC`（已装）|
| 行距/留白 | 段落 `line_spacing≈1.1`；元素间 `buff` 给足 |

**中文封装**（每个脚本开头必加）：

```python
from manim import *
FONT = "Noto Sans CJK SC"
def cn(text, **kwargs):
    kwargs.setdefault("font", FONT)
    return Text(text, **kwargs)
```

之后所有中文一律 `cn("...")`，杜绝豆腐块。

**常用 Unicode 数学符号**：`δ`（转移）、`Σ`（字母表）、`→`（映射）、`×`（笛卡尔积）、`q₀ / q✓`（状态/停机）、`□`（空白）、`∑ ∏ ∫ ∂ ∇`（求和/积/积分/偏导/梯度）、`≈ ≤ ≥ ≠ √`。直接写进 `cn()` 即可。

---

## 四、场景编排「套路」（可复制）

一个视频 = 一个 `Scene` 子类，内部按「段落」顺序 `play()`，用 `wait()` 控节奏。

1. **标题入场**：`Write(title)` + 缩小移到角落 `title.animate.scale(0.42).to_corner(UL, buff=0.5)`。
2. **分段揭示**：`Write`（手写体，标题/规则首选）/ `FadeIn(mobj, shift=DOWN*0.3)`（卡片/要点）/ `Create`（描边，方块图形）/ `GrowArrow`。
3. **排版**：`VGroup(...)` + `.arrange(DOWN, buff=0.4)` 或 `.arrange_in_grid(rows=2, cols=2, buff=(1.0,1.4))`。
4. **脉冲高亮**：`sym.animate.scale(1.35).set_color(YELLOW)` 再缩回——强调某格/某步。
5. **就地更新**：`Transform(old, new)` 后屏幕上仍是 `old` 对象，后续继续用 `old` 引用。
6. **移动指针**：`head.animate.move_to(centers[idx])`（先算好 `centers=[c.get_center() for c in cells]`）。
7. **底部字幕安全带**（重要，配有声视频必用，见第五节）：画面主体上移，底部留独立条带放字幕，**绝不让字幕压在内容区**。

---

## 五、★ 有声视频标准流程（双轨制）

> **核心原则**：Manim **只负责无声画面**；配音与音画合成**一律用 ffmpeg 后期完成**。
> **绝对不要**用 Manim 的 `self.add_sound()` 往场景里塞音频——它会导致多段声音时序错乱（成品 90%+ 帧静音）。这是本项目踩过的最深坑，详见坑#1。

整体架构：

```
[1] beats.py / video.py 顶部定义 BEATS = [(解说词, 停顿), ...]   ← 唯一真相源
[2] gen_audio.py   ──edge_tts──>  audio/seg_00.mp3 … + audio/segs.json(含每段时长)
[3] manim render   ──只出画面──>  silent.mp4   (construct 里不调 add_sound，按 BEATS 驱动视觉)
[4] synthesize.py  ──ffmpeg────>  final.mp4     (adelay 对齐 + amix 混音 + faststart 封装)
```

### 5.1 单一数据源 BEATS

在视频脚本顶部集中定义所有解说词与画面停顿：

```python
BEATS = [
    ("欢迎来到数独零基础教学。数独，是一种用逻辑填数字的游戏。", 1.0),
    ("本视频分两部分：先讲基础，再讲进阶。", 1.0),
    # ...(解说词, 该段结束后的消化停顿秒数)...
]
```

`BEATS` 同时驱动「配音生成」和「画面节奏」，保证音画一一对应、可复现。

### 5.2 生成配音（gen_audio.py）

```bash
python3 <skill-directory>/scripts/gen_audio.py 你的视频.py
```

脚本行为：遍历 `BEATS`，用 `edge_tts`（自然中文女声 `zh-CN-XiaoxiaoNeural`，默认 **0.85 倍速**）生成 `audio/seg_NN.mp3`，并用 `ffprobe` 记录每段真实时长，输出 `audio/segs.json`（`[{"i","text","digest","file","dur"}, ...]`）。

调参（改脚本顶部或在 `BEATS` 同文件）：`VOICE`（如 `zh-CN-YunxiNeural` 男声）、`SLOW`（0.8 更慢 / 0.9 略慢）。

### 5.3 渲染无声画面

```bash
cd /workspace
manim render 你的视频.py YourScene -q m        # 720p30
# 输出 media/videos/.../YourScene.mp4  （此时无音轨，正常）
```

`construct` 内用 `for i,(text,digest) in enumerate(BEATS): self.beat(i, digest, visual=...)` 驱动，**beat() 只放视觉与字幕，绝不调用 add_sound**。

### 5.4 合成音轨 + 封装（synthesize.py）

```bash
python3 <skill-directory>/scripts/synthesize.py 你的视频.py silent.mp4 final.mp4
```

脚本行为：
- 读取 `BEATS` 的 `digest` 与 `audio/segs.json` 的 `dur`，按 `beat` 时间模型 `advance = max(0.2, dur-0.4) + digest + 0.6` 重建每段配音在视频中的**精确起点**；
- 用 ffmpeg `adelay` 把每段对齐到对应起点、`amix` 混成一条音轨；
- 与无声画面 mux，加 **`-movflags +faststart`**（moov 前置，否则浏览器/预览面板静音，见坑#2）。

输出 `final.mp4` 即**最终交付物**（含音轨、可任意播放器出声）。

### 5.5 布局：字幕不挡画面

- 棋盘/主体整体上移（`OFF = 0.9` 等偏移），给底部留出独立条带；
- 字幕只显示在底部条带 `cn(text).move_to([0, SUB_Y, 0])`，与内容区在纵向上留有间隙；
- 画面区只保留图形与高亮，不叠加说明文字。

---

## 六、渲染与校验

```bash
# 复制成品
cp media/videos/<name>/720p30/<Scene>.mp4 ./silent.mp4

# ① 时长
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 final.mp4

# ② 含音轨且 moov 前置（faststart）
ffprobe -v error -show_entries stream=codec_type,codec_name -of default=noprint_wrappers=1 final.mp4
# 应同时出现 video(h264) 与 audio(aac)

# ③ 音频是否真有声（关键！避免再踩 add_sound 坑）
#    抽音轨算「非静音帧占比」，正常应 >50%；若 <10% 说明音频合成失败
python3 - <<'PY'
import subprocess, numpy as np
from pydub import AudioSegment
subprocess.run(["ffmpeg","-y","-i","final.mp4","-vn","-ac","1","-ar","22050","/tmp/a.wav"],stderr=subprocess.DEVNULL)
w=AudioSegment.from_wav("/tmp/a.wav")
s=np.array(w.get_array_of_samples()).astype(np.float32)/32768
frame=1102
e=np.array([np.sqrt(np.mean(s[i:i+frame]**2)) for i in range(0,len(s)-frame,frame)])
print("非静音帧占比=%.1f%%  dBFs=%.1f"%(100*np.mean(e>0.01),w.dBFS))
PY

# ④ 抽帧肉眼查中文/排版（避免豆腐块、布局错位）
ffmpeg -y -ss 00:00:15 -i final.mp4 -frames:v 1 /tmp/frame.png
```

> 渲染 CPU 密集，**后台运行**（`run_in_background`）更稳；`-q m` 通常几十秒~几分钟。

---

## 七、踩坑清单（务必记牢）

1. **🚫 Manim `add_sound()` 时序错乱**：多段 `add_sound` 会把声音压乱，成品 90%+ 帧静音，本地播放器听不到。**对策：彻底不用 add_sound，改用第五节 ffmpeg 双轨制合成。**
2. **🚫 moov 未前置 → 静音/缓冲**：Manim 默认输出 `moov` 在文件末尾，浏览器/内置预览面板读不到音轨而静音。**对策：合成时必加 `-movflags +faststart`，让 moov 前置。**
3. **PEP 668**：`pip install` 报错 → 加 `--break-system-packages`。
4. **typing_extensions 冲突**：Debian 自带该包无法卸载 → 加 `--ignore-installed typing-extensions`。
5. **中文豆腐块**：未装 `fonts-noto-cjk` 或未传 `font="Noto Sans CJK SC"` → 必装字体 + `cn()` 封装。
6. **click 被 gTTS 降级致 manim 崩**：装 gTTS 会把 `click` 降到 8.1.8，使 `cloup` 失效、`manim` 启动即报 `no attribute 'Command'`。**对策：装完所有包后 `pip3 install 'click>=8.5,<9' --break-system-packages` 修复。**
7. **Python 版本错位**：`manim`/`edge-tts` 装在系统 Python（`/usr/bin/python3`），而当前 shell `python3` 可能是 pyenv 3.11（无这些包）。`import edge_tts` 失败即改用 `/usr/bin/python3` 跑配音/合成脚本。
8. **缺 ffmpeg/cairo/pango**：分别装 `ffmpeg` 与 `libcairo2-dev libpango1.0-dev pkg-config python3-dev`。
9. **`Transform` 后引用**：`Transform(old,new)` 后屏幕仍是 `old`，后续继续用 `old`。
10. **字幕压画面**：解说文字必须放底部独立条带，绝不叠加在图形/棋盘上。

---

## 八、模板与脚本

- `scripts/template.py`：开箱即跑的 3b1b 模板。内置 `cn()`、深色背景、配色、**BEATS 单一数据源**、无声 `beat()` 驱动、底部字幕安全带，并带一个「纸带+读写头+状态机」示例。复制改 `BEATS` 与视觉即可出片。
- `scripts/gen_audio.py`：加载视频脚本的 `BEATS`，用 edge-tts 生成慢速中文配音 + `segs.json`。
- `scripts/synthesize.py`：加载 `BEATS` + `segs.json`，用 ffmpeg 重建时间轴、合成音轨、封装 faststart。
- `scripts/install.sh`：一键装齐系统依赖 + Python 包（含 TTS 工具与 click 修复）。

**标准工作流一句话**：`install.sh` → 写 `video.py`（定义 `BEATS` 与无声 `construct`）→ `gen_audio.py` 出配音 → `manim render` 出无声画面 → `synthesize.py` 合成 `final.mp4` → 按第六节校验。
