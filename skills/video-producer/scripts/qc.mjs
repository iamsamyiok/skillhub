#!/usr/bin/env node
// qc.mjs — 成片质检：时长对账 / 分辨率帧率 / 响度 LUFS / 字幕覆盖 / 基线漂移
// 借鉴 hyperframes 的 verify 思想：每个已知坑固化成一条可执行检查，输出结构化 qc.json 可直接进 CI 或由 agent 判读。
//
// 用法: node qc.mjs <storyboard.json> [--out <dir>] [--baseline <qc.json>] [--draft]
// 产物: <out>/qc.json（ok + checks[]）；有失败项时退出码 1
import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const FF = (() => { try { return require('ffmpeg-static'); } catch { return '/usr/local/lib/node_modules/ffmpeg-static/ffmpeg'; } })();
const FP = (() => { try { return require('ffprobe-static').path; } catch { return '/usr/local/lib/node_modules/ffprobe-static/bin/linux/x64/ffprobe'; } })();

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const boardPath = argv[0];
if (!boardPath || boardPath.startsWith('--')) { console.error('用法: node qc.mjs <storyboard.json> [--out <dir>] [--baseline <qc.json>] [--draft]'); process.exit(2); }
const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
const OUT = path.resolve(argOf('--out', path.join(path.dirname(path.resolve(boardPath)), 'out')));
const DRAFT = argv.includes('--draft');
const FINAL = path.join(OUT, DRAFT ? 'final-draft.mp4' : 'final.mp4');

const checks = [];
let measuredLufs = null;
const add = (name, pass, detail) => { checks.push({ name, pass, detail }); if (!pass) console.error(`  [FAIL] ${name}: ${detail}`); else console.log(`  [ok] ${name}: ${detail}`); };

// ---------- ffprobe ----------
const probe = (f) => JSON.parse(execFileSync(FP, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f]).toString());
const durOf = (f) => parseFloat(execFileSync(FP, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const lufsOf = (f) => {
  // ebur128 摘要打印在 stderr，必须用 spawnSync 捕获
  const r = spawnSync(FF, ['-hide_banner', '-nostats', '-i', f, '-filter_complex', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/I:\s+(-?\d+\.?\d*)\s+LUFS/);
  return m ? parseFloat(m[1]) : null;
};

console.log(`质检对象: ${FINAL}`);
if (!fs.existsSync(FINAL)) {
  add('finalExists', false, `${FINAL} 不存在，先跑 compose.mjs`);
} else {
  const meta = probe(FINAL);
  const v = meta.streams.find((s) => s.codec_type === 'video');
  const a = meta.streams.find((s) => s.codec_type === 'audio');
  const dur = durOf(FINAL);

  add('videoStream', !!v, v ? `${v.codec_name} ${v.width}x${v.height} ${v.avg_frame_rate}` : '无视频流');
  const [W, H] = board.meta.resolution || [1920, 1080];
  const wantW = DRAFT ? 960 : W, wantH = DRAFT ? 540 : H;
  add('resolution', v && v.width === wantW && v.height === wantH, `${v?.width}x${v?.height} 期望 ${wantW}x${wantH}`);
  add('fps', v && v.avg_frame_rate === '30/1', `${v?.avg_frame_rate} 期望 30/1`);
  add('audioStream', !!a, a ? a.codec_name : '无音轨（缺配音时需 --allow-silent）');

  const timeline = JSON.parse(fs.readFileSync(path.join(OUT, 'timeline.json'), 'utf8'));
  add('totalDuration', Math.abs(dur - timeline.total) <= 0.5, `成片 ${dur.toFixed(2)}s vs 时间线 ${timeline.total}s`);

  const shortShots = timeline.shots.filter((s, i) => {
    const min = board.shots[i]?.minSec || 8;
    return s.dur < min - 0.05;
  });
  add('minSecPerShot', shortShots.length === 0, shortShots.length ? `过短: ${shortShots.map((s) => `${s.id} ${s.dur}s`).join(', ')}` : `全部 ${timeline.shots.length} 镜满足 minSec`);

  // 响度：loudnorm 目标 I=-16，容忍 -18~-13；baseline 漂移阈值 1.5 LU
  if (a) {
    const lufs = lufsOf(FINAL);
    measuredLufs = lufs;
    if (lufs === null) add('loudness', false, 'ebur128 未能解析出综合响度');
    else {
      const inRange = lufs >= -18 && lufs <= -13;
      let detail = `${lufs} LUFS（目标 -18~-13）`;
      let pass = inRange;
      const baselinePath = argOf('--baseline');
      if (baselinePath && fs.existsSync(baselinePath)) {
        const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
        const baseLufs = base.summary?.lufs;
        if (baseLufs != null) {
          const drift = Math.abs(lufs - baseLufs);
          if (drift > 1.5) { pass = false; detail += `；基线漂移 ${drift.toFixed(2)} LU（阈值 1.5）`; }
          else detail += `；基线漂移 ${drift.toFixed(2)} LU`;
        }
      }
      add('loudness', pass, detail);
    }
  }

  // 字幕覆盖：每条 narration 至少产出 cue
  const srtPath = path.join(OUT, DRAFT ? 'draft.srt' : 'final.srt');
  if (fs.existsSync(srtPath)) {
    const cueCount = fs.readFileSync(srtPath, 'utf8').trim().split(/\r?\n\r?\n/).filter((b) => b.includes('-->')).length;
    const narrShots = board.shots.filter((s) => String(s.narration || '').trim()).length;
    add('subtitleCues', cueCount >= narrShots, `${cueCount} cues / ${narrShots} 个有旁白的分镜`);
  } else add('subtitleCues', false, `${srtPath} 缺失（compose 未生成字幕）`);

  // 配音覆盖：tts/index.json 覆盖所有有旁白的分镜
  const idxPath = path.join(OUT, 'tts', 'index.json');
  if (fs.existsSync(idxPath)) {
    const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
    const missing = board.shots.filter((s) => String(s.narration || '').trim() && !idx[s.id]).map((s) => s.id);
    add('ttsCoverage', missing.length === 0, missing.length ? `缺配音: ${missing.join(', ')}` : '全部有旁白分镜已配音');
  } else add('ttsCoverage', false, 'tts/index.json 缺失（tts.mjs 未跑或失败）');

  // baseline：时长漂移
  const baselinePath = argOf('--baseline');
  if (baselinePath && fs.existsSync(baselinePath)) {
    const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const bd = base.summary?.duration;
    if (bd != null) {
      const drift = Math.abs(dur - bd);
      add('durationDrift', drift <= 0.5, `|${dur.toFixed(2)} - 基线 ${bd}| = ${drift.toFixed(2)}s（阈值 0.5s）`);
    }
  }
}

const ok = checks.every((c) => c.pass);
const qc = { ok, generatedAt: new Date().toISOString(), board: path.resolve(boardPath), final: path.resolve(FINAL), summary: { duration: fs.existsSync(FINAL) ? +durOf(FINAL).toFixed(2) : null, lufs: measuredLufs }, checks };
fs.writeFileSync(path.join(OUT, 'qc.json'), JSON.stringify(qc, null, 2));
console.log(`\nqc.json: ${qc.ok ? 'PASS' : 'FAIL'}（${checks.filter((c) => c.pass).length}/${checks.length} 通过）`);
process.exit(ok ? 0 : 1);
