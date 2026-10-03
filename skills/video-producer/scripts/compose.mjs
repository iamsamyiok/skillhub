#!/usr/bin/env node
// compose.mjs — 合成：帧序列 → 变速对齐 → 定格补齐 → 拼接 → 令牌化 ASS 字幕 → 配音+bgm 闪避混音 → 成片
// 借鉴 hyperframes：①设计令牌（frame.md 思想）——字幕/片尾卡样式全部来自 design.json，代码只读令牌；
// ②语音闪避（voiceover carve）——bgm 在语音频段自动压低；③draft 快速回路——低码率全链预览，先看节奏再精修。
//
// 用法: node compose.mjs <storyboard.json> [--out <dir>] [--draft] [--allow-silent] [--force]
// 依赖: <out>/frames/<id>/%06d.jpg + frames/_meta.json（record.mjs 产物）、<out>/tts/<id>.mp3+.srt（tts.mjs 产物）
// 产物: <out>/final.mp4 或 final-draft.mp4、final.srt、final.ass、timeline.json
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const FF = (() => { try { return require('ffmpeg-static'); } catch { return '/usr/local/lib/node_modules/ffmpeg-static/ffmpeg'; } })();
const FP = (() => { try { return require('ffprobe-static').path; } catch { return '/usr/local/lib/node_modules/ffprobe-static/bin/linux/x64/ffprobe'; } })();

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const boardPath = argv[0];
if (!boardPath || boardPath.startsWith('--')) { console.error('用法: node compose.mjs <storyboard.json> [--out <dir>] [--draft] [--allow-silent] [--force]'); process.exit(2); }
const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
const BOARD_ROOT = path.dirname(path.resolve(boardPath));
// path.resolve：concat 清单条目按清单所在目录解析，相对路径会二次拼接（P4），必须绝对路径
const OUT = path.resolve(argOf('--out', path.join(BOARD_ROOT, 'out')));
const DRAFT = argv.includes('--draft');
const ALLOW_SILENT = argv.includes('--allow-silent');
const FORCE = argv.includes('--force');

// ---------- 设计令牌（frame.md 思想：视觉决策集中在 design.json） ----------
const DEFAULT_DESIGN = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'assets', 'design.json'), 'utf8'));
const DESIGN = (() => {
  const p = argOf('--design', path.join(BOARD_ROOT, 'design.json'));
  if (fs.existsSync(p)) return { ...DEFAULT_DESIGN, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
  return DEFAULT_DESIGN;
})();

// #RRGGBB / #AARRGGBB → ASS &HAABBGGRR&
const cssToAss = (hex) => {
  const h = hex.replace('#', '');
  const [rr, gg, bb, aa] = h.length === 8 ? [h.slice(2, 4), h.slice(4, 6), h.slice(6, 8), h.slice(0, 2)] : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6), '00'];
  return `&H${aa.toUpperCase()}${bb.toUpperCase()}${gg.toUpperCase()}${rr.toUpperCase()}&`;
};

const T = DESIGN.subtitle;
const EC = DESIGN.endCard;
const [RES_W, RES_H] = board.meta.resolution || [1920, 1080];
const OUT_W = DRAFT ? 960 : RES_W;
const OUT_H = DRAFT ? 540 : RES_H;
const OUT_FPS = 30;
const CRF = DRAFT ? '30' : '21';
const PRESET = DRAFT ? 'veryfast' : 'medium';
const FINAL = path.join(OUT, DRAFT ? 'final-draft.mp4' : 'final.mp4');
const VOICE_OK = fs.existsSync(path.join(OUT, 'tts', 'index.json'));

const seconds = (f) => parseFloat(execFileSync(FP, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const run = (args, quiet = true) => execFileSync(FF, args, { stdio: quiet ? 'pipe' : 'inherit' });
const ttsOf = (id, ext) => path.join(OUT, 'tts', `${id}.${ext}`);
const clipOf = (id) => path.join(OUT, 'clip', `${id}.mp4`);

fs.mkdirSync(path.join(OUT, 'clip'), { recursive: true });
const fmeta = fs.existsSync(path.join(OUT, 'frames', '_meta.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'frames', '_meta.json'), 'utf8')) : {};
const FRAME_FPS = fmeta.fps || board.meta.fps || 12;

// ---------- 逐分镜：变速 + 分辨率统一 + 定格补齐/截断 ----------
const timeline = [];
let offset = 0;
for (const shot of board.shots) {
  const info = fmeta.shots?.[shot.id];
  const frameDir = path.join(OUT, 'frames', shot.id);
  const nFrames = info?.frames ?? fs.readdirSync(frameDir).filter((f) => f.endsWith('.jpg')).length;
  const clip = clipOf(shot.id);
  if (!fs.existsSync(clip) || FORCE) {
    const speed = shot.speed || 1;
    const rawDur = nFrames / FRAME_FPS / speed;
    const ttsDur = fs.existsSync(ttsOf(shot.id, 'mp3')) ? seconds(ttsOf(shot.id, 'mp3')) : 0;
    if (!ttsDur && !ALLOW_SILENT) { console.error(`[${shot.id}] 缺配音且未给 --allow-silent（tts.mjs 失败或未跑）`); process.exit(1); }
    const target = Math.max(ttsDur + 1.0, shot.minSec || 8);
    const vf = [`setpts=${(1 / speed).toFixed(4)}*PTS`, `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease`, `pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2`, `fps=${OUT_FPS}`].join(',');
    const tmp = path.join(OUT, 'clip', `${shot.id}_t.mp4`);
    run(['-y', '-framerate', String(FRAME_FPS), '-i', path.join(frameDir, '%06d.jpg'), '-vf', vf, '-an', '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-pix_fmt', 'yuv420p', tmp]);
    const dur = seconds(tmp);
    if (dur < target) run(['-y', '-i', tmp, '-vf', `tpad=stop_mode=clone:stop_duration=${(target - dur + 0.2).toFixed(2)}`, '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-pix_fmt', 'yuv420p', clip]);
    else run(['-y', '-i', tmp, '-t', target.toFixed(2), '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-pix_fmt', 'yuv420p', clip]);
    fs.unlinkSync(tmp);
  }
  const dur = seconds(clip);
  timeline.push({ id: shot.id, name: shot.name, dur: +dur.toFixed(2), offset: +offset.toFixed(2), frames: nFrames });
  offset += dur;
  console.log(`[${shot.id}] ${dur.toFixed(1)}s @ ${timeline[timeline.length - 1].offset.toFixed(1)}s${DRAFT ? ' (draft)' : ''}`);
}
fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ total: +offset.toFixed(2), fps: OUT_FPS, resolution: [OUT_W, OUT_H], shots: timeline }, null, 2));

// ---------- 拼接视频 ----------
const listFile = path.join(OUT, 'clip', 'list.txt');
fs.writeFileSync(listFile, board.shots.map((s) => `file '${clipOf(s.id)}'`).join('\n') + '\n');
const concatOut = path.join(OUT, DRAFT ? 'concat-draft.mp4' : 'concat.mp4');
if (!fs.existsSync(concatOut) || FORCE) run(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', concatOut]);

// ---------- SRT（时间线偏移合并，供平台 CC 上传） ----------
const fmtSrt = (t) => {
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  const ms = String(Math.round((t % 1) * 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
};
const parseSrt = (text) => text.trim().split(/\r?\n\r?\n/).map((blk) => {
  const lines = blk.split(/\r?\n/);
  const m = lines[1].match(/(\d+):(\d+):(\d+),(\d+)\s*-->\s*(\d+):(\d+):(\d+),(\d+)/);
  const toSec = (h, mn, s, ms) => +h * 3600 + +mn * 60 + +s + +ms / 1000;
  return { start: toSec(...m.slice(1, 5)), end: toSec(...m.slice(5, 9)), text: lines.slice(2).join('\n') };
});

// ---------- ASS（样式全部来自设计令牌） ----------
const assTime = (t) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};
const assEscape = (t) => t.replace(/\n/g, '\\N').replace(/[{}]/g, '');
let events = '';
board.shots.forEach((shot, i) => {
  const seg = timeline[i];
  const srtPath = ttsOf(shot.id, 'srt');
  if (!fs.existsSync(srtPath)) return;
  for (const c of parseSrt(fs.readFileSync(srtPath, 'utf8'))) {
    events += `Dialogue: 0,${assTime(seg.offset + c.start)},${assTime(seg.offset + Math.min(c.end, seg.dur))},Default,,0,0,0,,${assEscape(c.text)}\n`;
  }
});
// 片尾卡（令牌化：出现时刻/字号/颜色可配；取末镜，不硬编码镜 id）
const last = timeline[timeline.length - 1];
const card = board.meta.endCard;
if (card?.length) {
  const cardStart = last.offset + last.dur * (EC.at ?? 0.42);
  const events_ = `Dialogue: 1,${assTime(cardStart)},${assTime(last.offset + last.dur)},EndCard,,0,0,0,,{\\an5\\fs${EC.titleSize}\\b1\\1c${cssToAss(EC.titleColor)}\\3c${cssToAss(DESIGN.palette.shadow)}\\3a&H10&\\bord2.4\\shad2}${assEscape(card[0])}\\N{\\fs${EC.subSize}\\b0\\1c${cssToAss(EC.subColor)}\\3c${cssToAss(DESIGN.palette.shadow)}\\3a&H10&\\bord1.6}${assEscape(card[1] || '')}\n`;
  events += events_;
}
const assFile = path.join(OUT, DRAFT ? 'draft.ass' : 'final.ass');
fs.writeFileSync(assFile, `[Script Info]
ScriptType: v4.00+
PlayResX: ${OUT_W}
PlayResY: ${OUT_H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${T.font},${Math.round(T.size * OUT_H / RES_H)},${cssToAss(T.color)},&H000000FF,${cssToAss(T.border)},${cssToAss(T.back)},0,0,0,0,100,100,0,0,1,${(T.outline * OUT_H / RES_H).toFixed(1)},${(T.shadow * OUT_H / RES_H).toFixed(1)},2,${Math.round(T.marginX * OUT_W / RES_W)},${Math.round(T.marginX * OUT_W / RES_W)},${Math.round(T.marginV * OUT_H / RES_H)},1
Style: EndCard,${T.font},${Math.round(EC.titleSize * OUT_H / RES_H)},${cssToAss(EC.titleColor)},&H000000FF,${cssToAss(DESIGN.palette.shadow)},&H7A000000,1,0,0,0,100,100,0,0,1,2.4,2,5,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}`);
fs.writeFileSync(path.join(OUT, DRAFT ? 'draft.srt' : 'final.srt'), board.shots.map((s, i) => {
  const p = ttsOf(s.id, 'srt');
  return fs.existsSync(p) ? parseSrt(fs.readFileSync(p, 'utf8')).map((c) => ({ ...c, start: c.start + timeline[i].offset, end: c.end + timeline[i].offset })) : [];
}).flat().map((c, i) => `${i + 1}\n${fmtSrt(c.start)} --> ${fmtSrt(Math.min(c.end, timeline[timeline.length - 1].offset + timeline[timeline.length - 1].dur))}\n${c.text}\n`).join('\n'));

// ---------- 音频：配音 loudnorm + bgm 闪避（voiceover carve） ----------
// concat 产物是纯视频流（逐镜 -an 编码），音频轨在这里独立构建
const total = seconds(concatOut);
const finalAudio = path.join(OUT, DRAFT ? 'audio-draft.m4a' : 'audio.m4a');
const bgmPath = board.meta.bgm ? path.resolve(BOARD_ROOT, board.meta.bgm) : null;
const bgmOk = !!bgmPath && fs.existsSync(bgmPath);

// 1) 旁白轨：逐段补齐/截断到段长后拼接（缺配音段用静音垫齐，需 --allow-silent 放行）
let hasVoice = false;
if (VOICE_OK) {
  const aList = path.join(OUT, 'clip', 'alist.txt');
  const aLines = [];
  board.shots.forEach((shot, i) => {
    const seg = timeline[i];
    const src = ttsOf(shot.id, 'mp3');
    const segA = path.join(OUT, 'clip', `a_${shot.id}.m4a`);
    if (fs.existsSync(src)) run(['-y', '-i', src, '-af', 'apad', '-t', String(seg.dur), '-c:a', 'aac', '-b:a', '160k', segA]);
    else run(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(seg.dur), '-c:a', 'aac', '-b:a', '96k', segA]);
    aLines.push(`file '${segA}'`);
  });
  fs.writeFileSync(aList, aLines.join('\n') + '\n');
  run(['-y', '-f', 'concat', '-safe', '0', '-i', aList, '-c:a', 'aac', '-b:a', '160k', path.join(OUT, 'clip', 'narration.m4a')]);
  hasVoice = true;
}

// 2) 混音图
const inputs = ['-y'];
const filters = [];
let label;
if (hasVoice) {
  inputs.push('-i', path.join(OUT, 'clip', 'narration.m4a'));
  // loudnorm 单遍输出 192kHz，混音前必须重采样回 44.1k，否则 sidechain/amix 时长错乱
  filters.push('[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[voice]');
  label = '[voice]';
  if (bgmOk) {
    inputs.push('-stream_loop', '-1', '-i', bgmPath);
    filters.push(`[1:a]volume=${board.meta.bgmVolume ?? 0.4},atrim=0:${total.toFixed(2)},afade=t=out:st=${Math.max(0, total - 1.6).toFixed(2)}:d=1.5[bed]`);
    // 滤镜图标签只能被消费一次：voice 既要当侧链又要进 amix，必须 asplit 分身
    filters.push('[voice]asplit=2[va][vb]');
    // 语音作侧链压低 bed（hyperframes voiceover carve 思想）
    filters.push('[bed][va]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=350[duck]');
    filters.push('[duck][vb]amix=inputs=2:duration=first:normalize=0[mix]');
    label = '[mix]';
  }
} else if (bgmOk) {
  inputs.push('-i', bgmPath);
  filters.push(`[0:a]volume=${board.meta.bgmVolume ?? 0.4},atrim=0:${total.toFixed(2)},afade=t=out:st=${Math.max(0, total - 1.6).toFixed(2)}:d=1.5[bed]`);
  label = '[bed]';
} else {
  inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
  label = '0:a';
}
const audioArgs = [...inputs, '-map', label];
if (filters.length) audioArgs.push('-filter_complex', filters.join(';'));
audioArgs.push('-t', total.toFixed(2), '-c:a', 'aac', '-b:a', '160k', finalAudio);
run(audioArgs, false);

// ---------- 合成 ----------
run(['-y', '-i', concatOut, '-i', finalAudio, '-vf', `ass='${assFile}'`, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-shortest', FINAL], false);
console.log(`\n成片完成: ${FINAL}（${seconds(FINAL).toFixed(1)}s, ${OUT_W}x${OUT_H}${DRAFT ? ' draft' : ''}）`);
