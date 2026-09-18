'use strict';

// video/compose.js — FFmpeg 合成：变速对齐 → 末帧定格补齐 → 拼接 → 字幕 → 成片
// 产物: video/out/final.mp4 + video/out/final.srt

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const OUT = process.env.OUT_DIR || path.join(ROOT, 'out');
const BOARD = JSON.parse(fs.readFileSync(process.env.STORYBOARD || path.join(ROOT, 'storyboard.json'), 'utf8'));
const FF = '/usr/local/lib/node_modules/ffmpeg-static/ffmpeg';
const FP = '/usr/local/lib/node_modules/ffprobe-static/bin/linux/x64/ffprobe';

const FRAME_FPS = 12;
const RAW = (id) => path.join(OUT, 'frames', id); // 帧序列目录 %06d.jpg @12fps
const TTS = (id, ext) => path.join(OUT, 'tts', `${id}.${ext}`);
const CLIP = (id) => path.join(OUT, 'clip', `${id}.mp4`);

const seconds = (file) => {
  const out = execFileSync(FP, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
  return parseFloat(out);
};

const run = (args, quiet = true) => {
  execFileSync(FF, args, { stdio: quiet ? 'pipe' : 'inherit' });
};

fs.mkdirSync(path.join(OUT, 'clip'), { recursive: true });

// ---------- 逐分镜裁剪对齐 ----------
const timeline = []; // {id, dur, offset}
let offset = 0;

for (const shot of BOARD.shots) {
  const target = Math.max(seconds(TTS(shot.id, 'mp3')) + 1.0, shot.minSec || 8);
  const speed = shot.speed || 1;
  const clip = CLIP(shot.id);
  if (!fs.existsSync(clip) || process.argv.includes('--force')) {
    // 帧序列(12fps) → 变速 + 统一分辨率 + 30fps；时长=帧数/12/speed
    const vf = [`setpts=${1 / speed}*PTS`, 'scale=1920:1080:force_original_aspect_ratio=decrease', 'pad=1920:1080:(ow-iw)/2:(oh-ih)/2', 'fps=30'];
    const tmp = path.join(OUT, 'clip', `${shot.id}_t.mp4`);
    run(['-y', '-framerate', String(FRAME_FPS), '-i', path.join(RAW(shot.id), '%06d.jpg'), '-vf', vf.join(','), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', tmp]);
    // 末帧定格补齐或截断至 target
    const dur = seconds(tmp);
    if (dur < target) {
      run(['-y', '-i', tmp, '-vf', `tpad=stop_mode=clone:stop_duration=${(target - dur + 0.2).toFixed(2)}`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', clip]);
    } else {
      run(['-y', '-i', tmp, '-t', target.toFixed(2), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', clip]);
    }
    fs.unlinkSync(tmp);
  }
  const dur = seconds(clip);
  timeline.push({ id: shot.id, name: shot.name, dur, offset });
  offset += dur;
  console.log(`[${shot.id}] ${shot.name} → ${dur.toFixed(1)}s @offset ${timeline[timeline.length - 1].offset.toFixed(1)}s`);
}

// ---------- 拼接 ----------
const listFile = path.join(OUT, 'clip', 'list.txt');
fs.writeFileSync(listFile, BOARD.shots.map((s) => `file '${CLIP(s.id)}'`).join('\n') + '\n');
const concatOut = path.join(OUT, 'concat.mp4');
run(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', concatOut]);

// ---------- 字幕（按时间线偏移合并 SRT） ----------
const fmt = (t) => {
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  const ms = String(Math.round((t - Math.floor(t)) * 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
};
const parseSrt = (text) => {
  return text.trim().split(/\r?\n\r?\n/).map((blk) => {
    const lines = blk.split(/\r?\n/);
    const m = lines[1].match(/(\d+):(\d+):(\d+),(\d+)\s*-->\s*(\d+):(\d+):(\d+),(\d+)/);
    const toSec = (h, mn, s, ms) => +h * 3600 + +mn * 60 + +s + +ms / 1000;
    return { start: toSec(m[1], m[2], m[3], m[4]), end: toSec(m[5], m[6], m[7], m[8]), text: lines.slice(2).join('\n') };
  });
};
let cueIdx = 1;
let srtAll = '';
BOARD.shots.forEach((shot, i) => {
  const seg = timeline[i];
  const cues = parseSrt(fs.readFileSync(TTS(shot.id, 'srt'), 'utf8'));
  for (const c of cues) {
    srtAll += `${cueIdx++}\n${fmt(seg.offset + c.start)} --> ${fmt(seg.offset + Math.min(c.end, seg.dur))}\n${c.text}\n\n`;
  }
});
const srtFile = path.join(OUT, 'final.srt');
fs.writeFileSync(srtFile, srtAll);

// ---------- ASS 字幕（对白 + 片尾卡统一渲染；ffmpeg-static 无 drawtext，libass 可用） ----------
process.env.FONTCONFIG_FILE = path.join(ROOT, 'assets', 'fontconfig.conf');

const assTime = (t) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};
const assEscape = (t) => t.replace(/\n/g, '\\N').replace(/[{}]/g, '');
let events = '';
BOARD.shots.forEach((shot, i) => {
  const seg = timeline[i];
  const cues = parseSrt(fs.readFileSync(TTS(shot.id, 'srt'), 'utf8'));
  for (const c of cues) {
    events += `Dialogue: 0,${assTime(seg.offset + c.start)},${assTime(seg.offset + Math.min(c.end, seg.dur))},Default,,0,0,0,,${assEscape(c.text)}\n`;
  }
});
// 片尾卡：安装命令 + 项目地址（居中两行，可由 storyboard.meta.endCard 覆盖）
const endCard = BOARD.meta.endCard || ['npx local-knowledge-graph', 'github.com/iamsamyiok/local-knowledge-graph'];
const s8 = timeline.find((t) => t.id === 's8');
const cardStart = s8.offset + s8.dur * 0.42;
const cardEnd = s8.offset + s8.dur;
events += `Dialogue: 1,${assTime(cardStart)},${assTime(cardEnd)},EndCard,,0,0,0,,{\\an5\\fs64\\b1\\1c&HFFFFFF&\\3c&H4A2A1A&\\3a&H10&\\bord2.4\\shad2}${endCard[0]}\\N{\\fs30\\b0\\1c&HBFD8FF&\\3c&H4A2A1A&\\3a&H10&\\bord1.6}${endCard[1]}\n`;

const assFile = path.join(OUT, 'final.ass');
fs.writeFileSync(assFile, `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans CJK SC,46,&H00FFFFFF,&H000000FF,&HAA1A2A4A,&H7A000000,0,0,0,0,100,100,0,0,1,1.6,0.8,2,70,70,52,1
Style: EndCard,Noto Sans CJK SC,64,&H00FFFFFF,&H000000FF,&HAA1A2A4A,&H7A000000,1,0,0,0,100,100,0,0,1,2.4,2,5,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}`);

// ---------- 音频轨：每镜配音 + 静音补齐到段长后拼接 ----------
const aList = path.join(OUT, 'alist.txt');
const aLines = BOARD.shots.map((shot, i) => {
  const seg = timeline[i];
  const segA = path.join(OUT, 'clip', `a_${shot.id}.m4a`);
  // 配音总比段长短（段长=max(tts+1s,minSec)），apad 补静音、超长截断
  run(['-y', '-i', TTS(shot.id, 'mp3'), '-af', 'apad', '-t', String(seg.dur), '-c:a', 'aac', '-b:a', '160k', segA]);
  return `file '${segA}'`;
});
fs.writeFileSync(aList, aLines.join('\n') + '\n');
const audioAll = path.join(OUT, 'audio.m4a');
run(['-y', '-f', 'concat', '-safe', '0', '-i', aList, '-c:a', 'aac', '-b:a', '160k', audioAll]);

const finalOut = path.join(OUT, 'final.mp4');
run([
  '-y', '-i', concatOut,
  '-i', audioAll,
  '-vf', `ass='${assFile}'`,
  '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p',
  '-c:a', 'copy', '-shortest',
  finalOut,
], false);

console.log(`\n成片完成: ${finalOut}（${seconds(finalOut).toFixed(1)}s）`);
console.log(`字幕: ${srtFile} / ${assFile}`);
