"""
3Blue1Brown 风格动画模板（可直接运行）
====================================
用法：
    manim render template.py Demo -q m
输出：media/videos/template/720p30/Demo.mp4（无声画面）

本模板演示「有声视频双轨制」的标准结构：
  - 顶部 BEATS 是唯一真相源：(解说词, 消化停顿秒数)
  - construct 按 BEATS 循环驱动视觉与字幕
  - beat() 只做画面与字幕，**绝不调用 add_sound**（配音交给 gen_audio.py + synthesize.py）
  - 底部字幕安全带：内容区上移，字幕只显示在底部条带，不压画面
照着改 BEATS 与视觉即可产出你自己的科普视频。

配音/合成（在本文件同目录执行）：
    python3 gen_audio.py template.py
    manim render template.py Demo -q m
    python3 synthesize.py template.py media/videos/template/720p30/Demo.mp4 final.mp4
"""

from manim import *

# ---------- 0. 3b1b 美学基础 ----------
FONT = "Noto Sans CJK SC"
BG = "#0E1116"            # 近黑深蓝背景
OFF = 0.9                 # 内容区整体上移量（给底部字幕让位）
SUB_Y = -3.35             # 底部字幕安全带中心 Y


def cn(text, **kwargs):
    """中文文本：统一字体，避免豆腐块。"""
    kwargs.setdefault("font", FONT)
    return Text(text, **kwargs)


def wrap(text, width=24):
    """过长字幕按字数硬换行，避免超出屏幕。"""
    lines, cur = [], ""
    for ch in text:
        cur += ch
        if len(cur) >= width:
            lines.append(cur); cur = ""
    if cur:
        lines.append(cur)
    return "\n".join(lines)


# ---------- 1. 唯一真相源：解说词 + 停顿 ----------
BEATS = [
    ("欢迎来到 3Blue1Brown 风格动画模板。", 1.0),
    ("我们用一个纸带小机器，讲清「状态机」的概念。", 1.0),
    ("纸带被分成一个个格子，读写头在某一格上。", 0.8),
    ("每一步，它读当前格、改写、再移动。", 0.8),
    ("状态寄存器记录它现在处于哪种模式。", 0.8),
    ("规则让它逐步推进，直到停机。", 1.2),
]


class Demo(Scene):
    def construct(self):
        self.camera.background_color = BG

        # ---------- 标题 ----------
        title = cn("状态机 · State Machine", font_size=72, color=BLUE).shift(UP * 0.6)
        self.play(Write(title), run_time=1.4)
        self.wait(1.0)
        self.play(title.animate.scale(0.5).to_corner(UL, buff=0.5), run_time=0.8)
        self.wait(0.2)

        # ---------- 纸带 + 读写头 + 状态机（内容上移 OFF）----------
        n, cw = 9, 0.95
        init = ["·"] * n
        for i, s in enumerate(["1", "0", "1", "1"]):
            init[3 + i] = s
        cells, syms = [], []
        for i in range(n):
            sq = Square(side_length=cw * 0.92).set_stroke(BLUE, 2)
            sq.move_to([(i - (n - 1) / 2) * cw, OFF, 0])
            blank = init[i] == "·"
            sym = cn(init[i], font_size=40, color=GREY if blank else WHITE).move_to(sq)
            cells.append(sq); syms.append(sym)
        centers = [c.get_center() for c in cells]

        self.play(*[Create(sq) for sq in cells], *[FadeIn(s) for s in syms], run_time=1.2)
        head = Rectangle(width=cw * 1.04, height=cw * 1.04).set_stroke(YELLOW, 4).move_to(centers[6])
        arrow = Arrow(start=centers[6] + UP * 0.95, end=centers[6] + UP * 0.45, color=YELLOW, buff=0.05)
        self.play(Create(head), GrowArrow(arrow), run_time=0.6)
        sbox = Rectangle(width=1.8, height=1.0).set_stroke(GREEN, 3).to_edge(RIGHT).shift(UP * 1.6 + UP * OFF)
        stxt = cn("q₀", font_size=38, color=GREEN).move_to(sbox)
        self.play(Create(sbox), FadeIn(stxt, shift=UP * 0.2), run_time=0.6)

        # ---------- 按 BEATS 驱动：纯视觉 + 底部字幕（不写音频）----------
        steps = [
            (6, "1", "0", "L", "q₀"),
            (5, "1", "0", "L", "q₀"),
            (4, "0", "1", "H", "q✓"),
        ]
        idx = 6
        beat_visuals = {
            2: Create(VGroup(*cells)),
            3: head.animate.set_stroke(RED, 4),
            4: sbox.animate.set_stroke(YELLOW, 3),
            5: None,
        }
        # 跳过 0/1 标题段（用纯字幕），2..5 用对应视觉
        for i, (text, digest) in enumerate(BEATS):
            if i < 2:
                self.beat(i, digest, visual=None)
            elif i == 5:
                self.beat(i, digest, visual=self.celebrate(cells, syms))
            else:
                self.beat(i, digest, visual=beat_visuals.get(i))

        # 规则演算（额外演示，可不配解说）
        for gi, rd, wr, mv, nst in steps:
            self.play(head.animate.move_to(centers[gi]), run_time=0.4)
            self.play(syms[gi].animate.scale(1.35).set_color(YELLOW), run_time=0.22)
            self.play(syms[gi].animate.scale(1 / 1.35).set_color(WHITE), run_time=0.22)
            new_sym = cn(wr, font_size=40, color=WHITE).move_to(syms[gi].get_center())
            self.play(Transform(syms[gi], new_sym), run_time=0.4)
            self.play(Transform(stxt, cn(nst, font_size=38, color=GREEN).move_to(sbox)), run_time=0.3)
            if mv == "L":
                idx = gi - 1
                self.play(head.animate.move_to(centers[idx]), run_time=0.4)
            self.wait(0.4)

        result = cn("结果：1011 + 1 = 1100  ✓", font_size=30, color=GREEN).move_to([0, SUB_Y, 0])
        self.play(FadeIn(result, shift=UP * 0.2), run_time=0.5)
        self.wait(1.2)

        # ---------- 收尾 ----------
        self.play(FadeOut(VGroup(*cells, *syms, head, arrow, sbox, stxt, result)), run_time=0.6)
        end = cn("一句话结论，点题。", font_size=34, color=BLUE)
        self.play(FadeIn(end, shift=DOWN * 0.3), run_time=0.6)
        self.wait(1.5)

    # ============ 字幕 + 视觉同步（无声）============
    def beat(self, i, digest=1.0, visual=None):
        """只做画面与底部字幕，不调用 add_sound。"""
        new = cn(wrap(BEATS[i][0]), font_size=22, color="#DCE8FF", line_spacing=1.1)
        new.move_to([0, SUB_Y, 0])
        self.play(FadeIn(new, shift=UP * 0.15), run_time=0.3)
        if visual is not None:
            if isinstance(visual, list):
                self.play(*visual, run_time=0.8)
            else:
                self.play(visual, run_time=0.8)
        else:
            self.wait(0.8)
        self.wait(digest)
        self.play(FadeOut(new), run_time=0.3)
        self.remove(new)

    def celebrate(self, cells, syms):
        return [c.animate.set_stroke(GREEN, 3) for c in cells] + \
               [s.animate.set_color(GREEN) for s in syms]
