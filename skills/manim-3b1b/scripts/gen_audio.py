#!/usr/bin/env python3
"""
gen_audio.py  —  从视频脚本的 BEATS 生成慢速中文配音
=====================================================
用法：
    python3 gen_audio.py 你的视频.py
效果：
    遍历脚本顶部的 BEATS = [(解说词, 停顿), ...]
    用 edge-tts 生成 audio/seg_NN.mp3（默认 0.85 倍速、自然女声）
    并用 ffprobe 记录每段真实时长 → audio/segs.json
依赖：edge-tts, ffmpeg
注意：若 import edge_tts 失败，说明当前 python 不是装了包的系统版本，
      改用 /usr/bin/python3 运行本脚本。
"""
import sys, os, json, asyncio, importlib.util, subprocess

VOICE = "zh-CN-XiaoxiaoNeural"   # 自然中文女声；男声可换 zh-CN-YunxiNeural
SLOW  = 0.85                     # 语速因子：<1 变慢（0.8 更慢 / 0.9 略慢）


def load_beats(path):
    spec = importlib.util.spec_from_file_location("vidmod", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "BEATS"):
        sys.exit("错误：视频脚本未定义 BEATS 列表")
    return mod.BEATS


async def gen_one(i, text):
    rate = f"{int(round((SLOW - 1) * 100))}%"   # 0.85 -> "-15%"
    comm = edge_tts.Communicate(text, VOICE, rate=rate)
    out = f"audio/seg_{i:02d}.mp3"
    await comm.save(out)
    dur = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", out]))
    return out, round(dur, 3)


async def main(video_path):
    beats = load_beats(video_path)
    os.makedirs("audio", exist_ok=True)
    segs = []
    for i, (text, digest) in enumerate(beats):
        out, dur = await gen_one(i, text)
        segs.append({
            "i": i, "text": text, "digest": digest,
            "file": os.path.abspath(out), "dur": dur,
        })
        print(f"  [{i:02d}] {dur:6.2f}s  {text[:28]}...")
    json.dump(segs, open("audio/segs.json", "w"), ensure_ascii=False, indent=2)
    print(f"\n完成：共 {len(segs)} 段，总时长 {sum(s['dur'] for s in segs):.1f}s → audio/segs.json")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("用法：python3 gen_audio.py 你的视频.py")
    import edge_tts  # 延迟导入，便于在错误时给出清晰提示
    asyncio.run(main(sys.argv[1]))
