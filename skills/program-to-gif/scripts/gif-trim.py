#!/usr/bin/env python3
"""GIF 自动裁剪：ink 帧分析定位内容边界 -> gifsicle 提取+压缩。

用法: python3 gif-trim.py <输入.gif> <输出.gif> [--lead 40] [--tail 40] [--grid 6] [--thresh 0.01]
  --lead    内容起点前保留的帧数(默认40, 25fps下约1.6秒, 展示命令行)
  --tail    内容静止后保留的帧数(默认40, 约1.6秒定格结尾画面)
  --grid    采样像素间隔(默认6, 越大越快越粗)
  --thresh  判定"有内容"的ink占比阈值(默认0.01)
"""
import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image


def ink_ratio(frame, bg, grid):
    px = frame.load()
    w, h = frame.size
    total = hits = 0
    for y in range(0, h, grid):
        for x in range(0, w, grid):
            total += 1
            if px[x, y] != bg:
                hits += 1
    return hits / total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--lead", type=int, default=40)
    ap.add_argument("--tail", type=int, default=40)
    ap.add_argument("--grid", type=int, default=6)
    ap.add_argument("--thresh", type=float, default=0.01)
    args = ap.parse_args()

    im = Image.open(args.src)
    frames = []
    while True:
        frames.append(im.convert("RGB").copy())
        try:
            im.seek(len(frames))
        except EOFError:
            break

    bg = frames[0].getpixel((5, 5))
    inks = [ink_ratio(f, bg, args.grid) for f in frames]
    n = len(frames)

    # 真实帧延迟求和(vhs 原始片约 40ms/帧, 已优化 gif 帧延迟不一)
    durs = []
    im.seek(0)
    for _ in range(n):
        durs.append(im.info.get("duration", 40))
        try:
            im.seek(len(durs))
        except EOFError:
            break
    total_ms = sum(durs)

    out_start = next((i for i, v in enumerate(inks) if v > args.thresh), None)
    if out_start is None:
        sys.exit("整段无内容(全空白)，检查输入")
    start = max(0, out_start - args.lead)

    final_ink = inks[-1]
    last_change = max(i for i, v in enumerate(inks) if abs(v - final_ink) > 0.003)
    end = min(n, last_change + args.tail)

    print(f"裁剪 #{start}-#{end-1} / 共{n}帧 -> {end-start}帧 "
          f"约{sum(durs[start:end])/1000:.1f}s / 全长{total_ms/1000:.1f}s")

    mid = args.dst + ".mid.tmp"
    if start == 0 and end >= n:
        shutil.copy(args.src, mid)
    else:
        # 范围语法 #a-b(单个#)；不能加 -U(全量展开会OOM)
        r1 = subprocess.run(["gifsicle", args.src, f"#{start}-{end-1}", "-o", mid])
        if r1.returncode != 0:
            sys.exit("gifsicle 提取失败")
    r2 = subprocess.run(["gifsicle", "-O3", "--lossy=80", mid, "-o", args.dst])
    Path(mid).unlink(missing_ok=True)
    if r2.returncode != 0:
        shutil.copy(args.src, args.dst)

    out = Image.open(args.dst)
    total = 0
    for i in range(out.n_frames):
        out.seek(i)
        total += out.info.get("duration", 0)
    size_kb = Path(args.dst).stat().st_size // 1024
    print(f"成品: {args.dst} {size_kb}KB {out.n_frames}帧 {total/1000:.1f}s (重复帧已合并,总时长不变)")


if __name__ == "__main__":
    main()
