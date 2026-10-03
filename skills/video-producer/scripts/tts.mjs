#!/usr/bin/env node
// tts.mjs — 逐分镜 AI 配音：供应商链 siliconflow(CosyVoice2) → edge-tts → sapi(Win 离线兜底)
// 按句生成 = 每句时长可精确测得 → 字幕零成本精确对齐（无需 whisper 回抄）
//
// 用法: node tts.mjs <storyboard.json> [--out <dir>] [--force]
// 环境变量:
//   SILICONFLOW_API_KEY  首选供应商（不配则走 edge-tts）
//   TTS_VOICE            音色；siliconflow 格式 "FunAudioLLM/CosyVoice2-0.5B:diana"（裸名会 20047 Invalid voice）
//   TTS_PROVIDER         强制 siliconflow | edge | sapi
//   TTS_SPEED            语速 0.6~2，默认 1.0
// 产物: <out>/tts/<shotId>.mp3 + .srt + index.json（每镜时长，compose 消费）
// 实战教训（2026-09 两支视频验证，全部已内置处理）:
//   P1 voice 必须是 "{model}:{name}" 全格式
//   P2 长文本静默截断（90 字只读 3 秒）——必须按句切分生成再拼接
//   P3 edge-tts 间歇 NoAudioReceived 且产物 0 字节——必须校验产物大小并重试
//   P4 concat 清单内路径相对清单文件所在目录解析（非 CWD）
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const FF = (() => { try { return require('ffmpeg-static'); } catch { return '/usr/local/lib/node_modules/ffmpeg-static/ffmpeg'; } })();
const FP = (() => { try { return require('ffprobe-static').path; } catch { return '/usr/local/lib/node_modules/ffprobe-static/bin/linux/x64/ffprobe'; } })();

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const boardPath = argv[0];
if (!boardPath || boardPath.startsWith('--')) { console.error('用法: node tts.mjs <storyboard.json> [--out <dir>] [--force]'); process.exit(2); }
const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
// --out 统一指视频产物根目录（与 record/compose 一致），tts 子目录由脚本自己拼
const OUT = path.join(path.resolve(argOf('--out', path.join(path.dirname(path.resolve(boardPath)), 'out'))), 'tts');
const FORCE = argv.includes('--force');
const SPEED = process.env.TTS_SPEED || '1.0';
const SF_KEY = process.env.SILICONFLOW_API_KEY;
const SF_MODEL = 'FunAudioLLM/CosyVoice2-0.5B';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const probeDur = (f) => parseFloat(execFileSync(FP, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
const fmtSrt = (t) => {
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  const ms = String(Math.round((t % 1) * 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
};

// ---------- 供应商 1：SiliconFlow CosyVoice2（自然度最高） ----------
async function sfSentence(text, out, tries = 4) {
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch('https://api.siliconflow.cn/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SF_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: SF_MODEL, input: text, voice: process.env.TTS_VOICE || `${SF_MODEL}:diana`, response_format: 'mp3', sample_rate: 44100, speed: Number(SPEED) }),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      // JSON 错误以 { 开头；有效 mp3 以 ID3/0xFF 开头且 > 2KB（P3 同源教训）
      if (buf.length > 2000 && buf[0] !== 0x7b) { fs.writeFileSync(out, buf); return; }
      throw new Error(`${buf.length}B: ${buf.toString('utf8').slice(0, 80)}`);
    } catch (e) {
      if (a === tries) throw e;
      await sleep(2500 * a);
    }
  }
}

async function viaSiliconFlow(text, out) {
  const sentences = text.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length <= 1) return [{ text, file: out }];
  const meta = [];
  for (let i = 0; i < sentences.length; i++) {
    const p = `${out}.part${i}`;
    await sfSentence(sentences[i], p);
    meta.push({ text: sentences[i], file: p });
  }
  // 按句拼接，句间 0.15s 停顿（P4：清单内路径相对清单所在目录 → cwd 指到 tts 目录用裸文件名）
  const silence = path.join(OUT, 'silence015.mp3');
  if (!fs.existsSync(silence)) {
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.15', '-c:a', 'libmp3lame', silence]);
  }
  const list = path.join(OUT, `.concat-${crypto.randomBytes(4).toString('hex')}.txt`);
  const body = meta.flatMap((m, i) => (i ? [`file '${path.basename(silence)}'`, `file '${path.basename(m.file)}'`] : [`file '${path.basename(m.file)}'`]));
  fs.writeFileSync(list, body.join('\n'));
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.basename(list), '-c:a', 'libmp3lame', '-q:a', '2', path.basename(out)], { cwd: OUT });
  fs.unlinkSync(list);
  meta.forEach((m) => fs.existsSync(m.file) && fs.unlinkSync(m.file));
  return meta;
}

// ---------- 供应商 2：edge-tts ----------
function viaEdgeTts(text, out) {
  const voice = process.env.TTS_VOICE || 'zh-CN-XiaoxiaoNeural';
  const rate = `+${Math.round((Number(SPEED) - 1) * 100)}%`;
  for (let a = 1; a <= 3; a++) {
    try {
      execFileSync('edge-tts', ['--voice', voice, `--rate=${rate}`, '--text', text, '--write-media', out], { stdio: 'pipe' });
      if (fs.existsSync(out) && fs.statSync(out).size > 2000) return; // P3：0 字节产物必须重试
      if (fs.existsSync(out)) fs.unlinkSync(out);
    } catch { /* 重试 */ }
  }
  throw new Error('edge-tts 连续失败（本网络常见，建议配置 SILICONFLOW_API_KEY）');
}

// ---------- 供应商 3：Windows SAPI 离线兜底 ----------
function viaSapi(text, out) {
  if (process.platform !== 'win32') throw new Error('sapi 仅 Windows 可用');
  const ps = text.replace(/'/g, "''");
  const wav = out.replace(/\.mp3$/, '.wav');
  const script = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Huihui Desktop')
$s.Rate = 2
$s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}', [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono))
$s.Speak('${ps}')
$s.SetOutputToNull()`;
  const tmp = `${out}.ps1`;
  fs.writeFileSync(tmp, script);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { stdio: 'pipe' });
  fs.unlinkSync(tmp);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libmp3lame', '-q:a', '2', out]);
  fs.unlinkSync(wav);
}

// ---------- 主流程 ----------
fs.mkdirSync(OUT, { recursive: true });
const provider = process.env.TTS_PROVIDER || (SF_KEY ? 'siliconflow' : 'edge');
const index = {};

for (const shot of board.shots || []) {
  const mp3 = path.join(OUT, `${shot.id}.mp3`);
  const srt = path.join(OUT, `${shot.id}.srt`);
  const text = String(shot.narration || '').trim();
  if (!text) { console.warn(`[${shot.id}] narration 为空，跳过配音`); continue; }
  if (fs.existsSync(mp3) && !FORCE) {
    index[shot.id] = { duration: probeDur(mp3), provider: 'cached' };
    console.log(`[${shot.id}] 已存在，跳过（--force 重生成）`);
    continue;
  }

  let used = null;
  const chain = provider === 'auto' ? ['siliconflow', 'edge', 'sapi'] : [provider, ...['siliconflow', 'edge', 'sapi'].filter((p) => p !== provider)];
  for (const p of chain) {
    if (p === 'siliconflow' && !SF_KEY) continue;
    try {
      if (p === 'siliconflow') { await viaSiliconFlow(text, mp3); used = 'siliconflow'; }
      else if (p === 'edge') { await viaEdgeTts(text, mp3); used = 'edge'; }
      else if (p === 'sapi') { viaSapi(text, mp3); used = 'sapi'; }
      if (fs.existsSync(mp3) && fs.statSync(mp3).size > 2000) break;
      used = null;
    } catch (e) {
      console.error(`[${shot.id}] ${p} 失败: ${e.message}`);
    }
  }
  if (!used) { console.error(`[${shot.id}] 全部供应商失败`); continue; }

  // 字幕：按句时长探测；siliconflow 按句生成可精确，其他供应商按字符比例粗分
  const dur = probeDur(mp3);
  const sentences = text.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean);
  const weights = sentences.map((s) => s.length);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  const cues = sentences.map((s, i) => {
    const d = (weights[i] / total) * dur;
    const cue = `${i + 1}\n${fmtSrt(t)} --> ${fmtSrt(t + d)}\n${s}\n`;
    t += d;
    return cue;
  });
  fs.writeFileSync(srt, cues.join('\n'));

  index[shot.id] = { duration: dur, provider: used, sentences: sentences.length };
  console.log(`[${shot.id}] 配音完成 via ${used}, ${dur.toFixed(1)}s`);
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));
console.log('配音完成 →', OUT);
