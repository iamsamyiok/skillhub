#!/usr/bin/env python3
"""
synthesize.py  —  用 ffmpeg 把配音合成进无声画面（替代 Manim add_sound）
=========================================================================
用法：
    python3 synthesize.py 你的视频.py silent.mp4 [final.mp4]
效果：
    读取视频脚本的 BEATS（取 digest 停顿）与 audio/segs.json（取每段时长）
    重建每段配音在视频中的精确起点
    用 ffmpeg adelay 对齐 + amix 混成一条音轨
    与无声画面 mux，加 -movflags +faststart（moov 前置，避免浏览器静音）
输出：final.mp4（默认 ./final.mp4），含完整音轨，任意播放器可出声。

⚠ 不要用 Manim 的 self.add_sound()：它会导致多段声音时序错乱、成品静音。
"""
import sys, os, json, importlib.util, subprocess

# beat 时间模型（须与视频脚本里的 beat() 一致）：
#   每段推进 = 字幕FadeIn(0.3) + play(max(0.2,dur-0.4)) + wait(digest) + 字幕FadeOut(0.3)
BEAT_OVERHEAD = 0.6   # 0.3 + 0.3 字幕淡入淡出


def load_beats(path):
    spec = importlib.util.spec_from_file_location("vidmod", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.BEATS


def main(video_path, silent_video, out_path):
    beats = load_beats(video_path)
    n = len(beats)
    segs = json.load(open("audio/segs.json"))
    assert len(segs) == n, f"segs.json 段数 {len(segs)} ≠ BEATS 段数 {n}"

    dur = {s["i"]: s["dur"] for s in segs}
    digest = [b[1] for b in beats]

    # 重建每段配音起点
    starts, T = {}, 0.0
    for i in range(n):
        starts[i] = T
        T += max(0.2, dur[i] - 0.4) + digest[i] + BEAT_OVERHEAD
    print(f"[时间轴] 模型总时长 {T:.2f}s（若与画面时长相差 <5s 即同步良好）")

    # 构造 ffmpeg 命令
    ins = ["-i", silent_video]
    for i in range(n):
        ins += ["-i", segs[i]["file"]]
    parts = []
    for i in range(n):
        delay_ms = int(round(starts[i] * 1000))
        parts.append(f"[{i+1}]aresample=48000,adelay=delays={delay_ms}:all=1[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(n))
    parts.append(f"{mix}amix=inputs={n}:normalize=0[aout]")
    fc = ";".join(parts)

    cmd = (["ffmpeg", "-y"] + ins + ["-filter_complex", fc,
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
            "-movflags", "+faststart", out_path])
    print("[ffmpeg] 合成中...")
    r = subprocess.run(cmd, stderr=subprocess.PIPE)
    if r.returncode != 0:
        sys.exit("ffmpeg 失败：\n" + r.stderr.decode("utf8", "ignore")[-1500:])
    print(f"完成 → {out_path}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("用法：python3 synthesize.py 你的视频.py silent.mp4 [final.mp4]")
    out = sys.argv[3] if len(sys.argv) > 3 else "final.mp4"
    main(sys.argv[1], sys.argv[2], out)
