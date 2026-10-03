"""
尼泊尔介绍 · 3Blue1Brown 风格动画
================================
用法：
    manim render nepal.py NepalIntro -q m
输出：media/videos/nepal/720p30/NepalIntro.mp4（无声画面）

双轨制流程（见 manim-3b1b skill）：
  - 顶部 BEATS 是唯一真相源：(解说词, 消化停顿秒数)
  - construct 按 BEATS 驱动视觉与底部字幕；beat() 只做画面，绝不调用 add_sound
  - 每段时间长度严格等于 synthesize.py 的音频时间模型 advance[i]
    = max(0.2, dur_i-0.4) + digest_i + 0.6  （dur 来自 audio/segs.json）
    从而保证渲染出的画面与最终配音逐段对齐、不出现静帧
  - 配音/合成：
      /usr/bin/python3 <skill>/scripts/gen_audio.py nepal.py
      manim render nepal.py NepalIntro -q m
      /usr/bin/python3 <skill>/scripts/synthesize.py nepal.py \
          media/videos/nepal/720p30/NepalIntro.mp4 nepal.mp4
"""

from manim import *

# ---------- 0. 3b1b 美学基础 ----------
FONT = "Noto Sans CJK SC"
BG = "#0E1116"
OFF = 0.9                 # 内容区整体上移量（给底部字幕让位）
SUB_Y = -3.35             # 底部字幕安全带中心 Y


def cn(text, **kwargs):
    kwargs.setdefault("font", FONT)
    return Text(text, **kwargs)


def wrap(text, width=30):
    """按宽度断行，但避免把标点孤立到下一行。"""
    NO_BREAK = "。，、；：！？—）》”"
    lines, cur = [], ""
    for ch in text:
        cur += ch
        if len(cur) >= width and ch not in NO_BREAK:
            lines.append(cur)
            cur = ""
    if cur:
        lines.append(cur)
    return "\n".join(lines)


# ---------- 1. 唯一真相源：解说词 + 停顿 ----------
BEATS = [
    ("尼泊尔，一个坐落在喜马拉雅南麓的山国。", 1.2),
    ("它北靠中国，南、东、西三面与印度接壤，是典型的内陆国。", 1.2),
    ("国土面积约 14.7 万平方公里，人口约 3110 万（2024 年）。", 1.0),
    ("首都，是加德满都。", 0.8),
    ("地形南北差异巨大：从南部的平原，一路抬升到北部的雪山。", 1.2),
    ("最低点仅 60 米，而最高点——珠穆朗玛峰，海拔 8848 米。", 1.2),
    ("全球海拔最高的十座山峰中，有八座都在尼泊尔境内或边界。", 1.2),
    ("珠峰，1953 年由希拉里与丹增·诺盖首次登顶。", 1.2),
    ("经济以农业为主，2024 年 GDP 约 437 亿美元，人均约 1381 美元。", 1.2),
    ("产业上，服务业占六成以上，农业约占四分之一。", 1.0),
    ("宗教以印度教为主，约占八成；佛教也深植于此——蓝毗尼是佛陀诞生地。", 1.2),
    ("2008 年，尼泊尔废除君主制，成为联邦民主共和国，下辖 7 个省。", 1.2),
    ("雪山、信仰与徒步者的国度——这就是尼泊尔。", 1.6),
]


class NepalIntro(Scene):
    def construct(self):
        self.camera.background_color = BG

        # ---- 加载音频时长，构建与 synthesize.py 一致的时间模型 ----
        import json, os
        self.adv = []
        try:
            segs = json.load(open("audio/segs.json"))
            dur = {s["i"]: s["dur"] for s in segs}
        except Exception:
            dur = {}
        for i, (_, digest) in enumerate(BEATS):
            d = dur.get(i, 4.0)
            self.adv.append(max(0.2, d - 0.4) + digest + 0.6)

        # ============ Beat 0：标题（与首句配音同步） ============
        title = cn("尼泊尔 · 雪山之下的国度", font_size=64, color=BLUE).shift(UP * 0.5)
        t0 = self.subtitle(0)
        self.play(FadeIn(t0, shift=UP * 0.15), Write(title), run_time=1.4)
        self.play(title.animate.scale(0.36).to_corner(UL, buff=0.35), run_time=0.7)
        self.wait(max(0, self.adv[0] - 2.1 - 0.3))
        self.play(FadeOut(t0), run_time=0.3)
        self.remove(t0)

        # ============ Beat 1：位置地图 ============
        china = Rectangle(width=6.2, height=1.35, fill_color=RED, fill_opacity=0.14,
                          stroke_color=RED, stroke_width=2.5).move_to([0, 2.0, 0])
        india = Rectangle(width=6.2, height=1.35, fill_color=GREEN, fill_opacity=0.14,
                          stroke_color=GREEN, stroke_width=2.5).move_to([0, -1.7, 0])
        nepal = Rectangle(width=1.9, height=3.05, fill_color=BLUE, fill_opacity=0.30,
                          stroke_color=BLUE, stroke_width=3).move_to([0, 0.15, 0])
        cl = cn("中国", font_size=28, color=RED).move_to(china)
        il = cn("印度", font_size=28, color=GREEN).move_to(india)
        nl = cn("尼泊尔", font_size=26, color=WHITE).move_to(nepal)
        north = cn("北", font_size=20, color=YELLOW).next_to(china, UP, buff=0.1)
        south = cn("南", font_size=20, color=YELLOW).next_to(india, DOWN, buff=0.1)
        map_g = VGroup(china, india, nepal, cl, il, nl, north, south)
        self.beat(1, [Create(china), Create(india), Create(nepal),
                      FadeIn(VGroup(cl, il, nl), shift=UP * 0.2),
                      FadeIn(VGroup(north, south)),
                      nepal.animate.set_stroke(YELLOW, 5)], run=1.1)

        # ============ Beat 2-3：基本数据卡片 ============
        cards = self.make_cards([
            ("面积", "147,516 km²"),
            ("人口", "≈ 3,110 万"),
            ("首都", "加德满都"),
        ])
        self.beat(2, [FadeOut(map_g), *[FadeIn(c, shift=UP * 0.3) for c in cards]], run=1.0)
        self.beat(3, [cards[2].animate.set_stroke(YELLOW, 5)], run=0.5)

        # ============ Beat 4-5：地形剖面 ============
        prof = VMobject(stroke_color=BLUE, stroke_width=5)
        prof.set_points_smoothly([
            RIGHT * 5.2 + DOWN * 2.0,
            RIGHT * 2.2 + DOWN * 0.4,
            LEFT * 1.0 + UP * 1.4,
            LEFT * 5.2 + UP * 3.0,
        ])
        s_label = cn("南 · 平原 60m", font_size=20, color=GREY).move_to(RIGHT * 5.2 + DOWN * 2.6)
        n_label = cn("北 · 喜马拉雅", font_size=20, color=GREY).move_to(LEFT * 5.2 + UP * 3.5)
        self.beat(4, [FadeOut(VGroup(*cards)), Create(prof), FadeIn(s_label), FadeIn(n_label)], run=1.2)
        peak = prof.get_points()[-1]
        dot = Dot(peak, color=YELLOW, radius=0.16)
        pk_label = cn("珠穆朗玛峰 8848m", font_size=24, color=YELLOW).next_to(dot, UR, buff=0.25)
        self.beat(5, [GrowFromCenter(dot), FadeIn(pk_label, shift=UP * 0.2),
                      dot.animate.scale(1.5), dot.animate.scale(1 / 1.5)], run=1.2)

        # ============ Beat 6-7：八座高峰条形图 ============
        peaks = [
            ("安纳普尔纳", 8091), ("马纳斯鲁", 8163), ("道拉吉里", 8167),
            ("卓奥友", 8201), ("马卡鲁", 8463), ("洛子峰", 8516),
            ("干城章嘉", 8586), ("珠穆朗玛", 8848),
        ]
        bars, pgroup = self.make_peaks(peaks)
        title_p = cn("全球 10 大高峰 · 尼泊尔占 8 座", font_size=26, color=BLUE).to_edge(UP, buff=1.2)
        self.beat(6, [FadeOut(VGroup(prof, s_label, n_label, dot, pk_label)),
                      FadeIn(title_p, shift=DOWN * 0.2),
                      LaggedStart(*[Create(b) for b in bars], lag_ratio=0.07),
                      *[FadeIn(pgroup[k], shift=UP * 0.15) for k in pgroup]], run=1.8)
        self.beat(7, [bars[-1].animate.set_fill(YELLOW).set_stroke(YELLOW, 2)], run=0.6)

        # ============ Beat 8-9：经济 ============
        econ_title = cn("经济体量（2024）", font_size=26, color=BLUE).to_edge(UP, buff=1.2)
        gdp_bar = self.make_bar("GDP 总量", "≈ 437 亿美元", 1.0, BLUE, x0=-5.5).shift(UP * 0.9)
        pc_bar = self.make_bar("人均 GDP", "≈ 1,381 美元", 0.18, YELLOW, x0=-5.5).shift(DOWN * 0.2)
        self.beat(8, [FadeOut(VGroup(title_p, *bars, *[pgroup[k] for k in pgroup])),
                      FadeIn(econ_title, shift=DOWN * 0.2),
                      GrowFromEdge(gdp_bar, LEFT), GrowFromEdge(pc_bar, LEFT)], run=1.2)
        sector = self.make_stack([("服务业", 63, BLUE), ("农业", 24, YELLOW), ("工业", 13, GREEN)],
                                 x0=-5.5, width=11, y=-2.2)
        self.beat(9, [FadeIn(sector, shift=DOWN * 0.2)], run=0.8)

        # ============ Beat 10：宗教文化 ============
        rel_title = cn("宗教与文化", font_size=26, color=BLUE).to_edge(UP, buff=1.2)
        rel = self.make_stack([("印度教", 81, RED), ("佛教", 8, YELLOW),
                               ("伊斯兰", 5, GREEN), ("其他", 6, GREY)],
                              x0=-5.5, width=11, y=0.4)
        facts = VGroup(
            cn("蓝毗尼 — 佛陀诞生地", font_size=22, color=WHITE),
            cn("官方语言：尼泊尔语", font_size=22, color=WHITE),
        ).arrange(DOWN, buff=0.45, aligned_edge=LEFT).move_to([0, -1.9, 0])
        self.beat(10, [FadeOut(VGroup(econ_title, gdp_bar, pc_bar, sector)),
                       FadeIn(rel_title, shift=DOWN * 0.2),
                       FadeIn(rel, shift=DOWN * 0.2),
                       FadeIn(facts, shift=UP * 0.2)], run=1.2)

        # ============ Beat 11：政体时间线 ============
        tl_title = cn("从王国到共和国", font_size=26, color=BLUE).to_edge(UP, buff=1.2)
        line = Line(LEFT * 5, RIGHT * 5, color=GREY, stroke_width=4)
        m1768 = Dot(line.get_left(), color=BLUE, radius=0.14)
        m2008 = Dot(line.get_right(), color=GREEN, radius=0.14)
        l1768 = cn("1768 统一", font_size=22, color=BLUE).next_to(m1768, DOWN, buff=0.35)
        l2008 = cn("2008 共和国", font_size=22, color=GREEN).next_to(m2008, DOWN, buff=0.35)
        arrow_mid = Arrow(start=line.get_center() + DOWN * 0.5, end=line.get_center() + UP * 0.5,
                          color=YELLOW, buff=0.05)
        self.beat(11, [FadeOut(VGroup(rel_title, rel, facts)),
                       FadeIn(tl_title, shift=DOWN * 0.2),
                       Create(line), GrowFromCenter(m1768), GrowFromCenter(m2008),
                       FadeIn(VGroup(l1768, l2008)), GrowArrow(arrow_mid)], run=1.4)

        # ============ Beat 12：结语 ============
        end = cn("雪山、信仰与徒步者的国度——这就是尼泊尔。", font_size=32, color=BLUE)
        end2 = cn("数据来源：维基百科 / CIA 等公开资料（2024）", font_size=18, color=GREY).next_to(end, DOWN, buff=0.4)
        self.beat(12, [FadeOut(VGroup(tl_title, line, m1768, m2008, l1768, l2008, arrow_mid)),
                       FadeIn(end, shift=DOWN * 0.3), FadeIn(end2, shift=DOWN * 0.2)], run=1.2)

    # ============ 字幕 + 视觉同步（无声，严格按时长模型） ============
    def subtitle(self, i):
        return cn(wrap(BEATS[i][0]), font_size=22, color="#DCE8FF", line_spacing=1.15).move_to([0, SUB_Y, 0])

    def beat(self, i, anims=None, run=0.6):
        new = self.subtitle(i)
        if anims:
            self.play(FadeIn(new, shift=UP * 0.15), *anims, run_time=run)
        else:
            self.play(FadeIn(new, shift=UP * 0.15), run_time=0.35)
            run = 0.35
        self.wait(max(0.0, self.adv[i] - run - 0.3))
        self.play(FadeOut(new), run_time=0.3)
        self.remove(new)

    # ============ 构件 ============
    def make_cards(self, items):
        cards = []
        w, h = 3.4, 1.7
        for k, (lab, val) in enumerate(items):
            rect = Rectangle(width=w, height=h, fill_color=BLACK, fill_opacity=0.9,
                             stroke_color=BLUE, stroke_width=2.5)
            l = cn(lab, font_size=24, color=GREY).next_to(rect.get_top(), DOWN, buff=0.45)
            v = cn(val, font_size=30, color=WHITE).next_to(rect.get_center(), DOWN, buff=0.15)
            cards.append(VGroup(rect, l, v))
        cards[0].move_to([-3.9, 0.3, 0])
        cards[1].move_to([0, 0.3, 0])
        cards[2].move_to([3.9, 0.3, 0])
        return cards

    def make_peaks(self, peaks):
        bars = []
        labels = {}
        x0, top, bottom = -5.5, 1.7, -2.7
        span = top - bottom
        n = len(peaks)
        step = span / n
        max_h = 8848.0
        for k, (name, h) in enumerate(peaks):
            y = bottom + step * (k + 0.5)
            length = (h / max_h) * 10.0
            is_everest = (name == "珠穆朗玛")
            col = YELLOW if is_everest else BLUE
            bar = Rectangle(width=length, height=step * 0.7,
                            fill_color=col, fill_opacity=0.85, stroke_color=col, stroke_width=1)
            bar.move_to([x0 + length / 2, y, 0])
            bars.append(bar)
            lbl = cn(f"{name}  {h:,}m", font_size=17, color=WHITE if is_everest else "#C9D6E5")
            lbl.next_to(bar, RIGHT, buff=0.12)
            labels[k] = lbl
        return bars, labels

    def make_bar(self, label, val, frac, color, x0):
        g = VGroup()
        full = 11.0
        track = Rectangle(width=full, height=0.55, fill_color="#1c2230", fill_opacity=1,
                          stroke_color="#2a3346", stroke_width=1.5).move_to([x0 + full / 2, 0, 0])
        bar = Rectangle(width=full * frac, height=0.55, fill_color=color, fill_opacity=0.9,
                        stroke_width=0).move_to([x0 + full * frac / 2, 0, 0])
        lab = cn(label, font_size=20, color=WHITE).move_to([x0 - 1.2, track.get_y(), 0])
        lab2 = cn(val, font_size=20, color=color).next_to(bar, RIGHT, buff=0.12)
        g.add(track, bar, lab, lab2)
        return g

    def make_stack(self, parts, x0, width, y):
        """堆叠条：宽段标签放条内，窄段汇总为图例放条下方。"""
        g = VGroup()
        total = sum(p[1] for p in parts)
        x = x0
        legend = []
        for name, pct, color in parts:
            w = width * pct / total
            seg = Rectangle(width=w, height=0.7, fill_color=color, fill_opacity=0.9,
                            stroke_color=BG, stroke_width=2)
            seg.move_to([x + w / 2, y, 0])
            lab = cn(f"{name} {pct}%", font_size=18, color=WHITE)
            if w > 1.6:
                lab.move_to(seg.get_center())
                g.add(seg, lab)
            else:
                g.add(seg)
                legend.append((name, pct, color))
            x += w
        if legend:
            items = []
            for name, pct, color in legend:
                sw = Square(side_length=0.22, fill_color=color, fill_opacity=0.9,
                            stroke_width=0)
                tx = cn(f"{name} {pct}%", font_size=16, color=WHITE)
                items.append(VGroup(sw, tx).arrange(RIGHT, buff=0.12))
            lg = VGroup(*items).arrange(RIGHT, buff=0.5)
            lg.move_to([x0 + width / 2, y - 0.85, 0])
            g.add(lg)
        return g
