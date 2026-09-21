#!/usr/bin/env node
'use strict';

// tts.mjs — 逐分镜 AI 配音 v2:供应商链 + 按句生成 + 精确字幕
// 供应商自动降级:siliconflow(CosyVoice2,自然灵动) → edge-tts → sapi(离线兜底)
// 契约与旧 tts.js 一致:env STORYBOARD/OUT_DIR,shots[].narration → OUT/tts/{id}.mp3 + {id}.srt
// 另产出 OUT/tts/index.json(每镜时长,供 compose/cards 使用)
//
// 环境变量:
//   SILICONFLOW_API_KEY  硅基流动 key(启用首选供应商;密钥只走环境变量,严禁硬编码)
//   TTS_VOICE            音色。siliconflow 格式为 FunAudioLLM/CosyVoice2-0.5B:diana(女声:anna平稳/bella激情/claire温柔/diana灵动愉悦);
//                        edge-tts 格式为 zh-CN-XiaoxiaoNeural 等
//   TTS_PROVIDER         强制指定 siliconflow | edge | sapi(默认自动降级)
//   TTS_SPEED            语速,默认 1.0(siliconflow 有效范围约 0.6~2)
//
// 实战经验(2026-09-22 两支视频验证):
//   1. siliconflow 音色参数格式是 "{model}:{name}",裸名或 "speech:名" 都报 20047 Invalid voice
//   2. 长文本会被静默截断(90字只读出3秒)——必须按句(。!? splitting)生成再拼接
//   3. 按句生成 = 每句时长可精确测得 → 字幕零成本精确对齐,不需要 whisper ASR
//   4. edge-tts 在部分网络间歇性 NoAudioReceived 且文件为 0 字节,必须校验产物大小
//   5. 拼接用 concat 清单时,清单内路径相对清单文件所在目录解析(不是相对 CWD)

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

const ROOT = import.meta.dirname;
const OUT = process.env.OUT_DIR ? path.join(process.env.OUT_DIR, 'tts') : path.join(ROOT, 'out', 'tts');
const BOARD = JSON.parse(fs.readFileSync(process.env.STORYBOARD || path.join(ROOT, 'storyboard.json'), 'utf8'));
const FORCE = process.argv.includes('--force');
const SPEED = process.env.TTS_SPEED || '1.0';
const SF_KEY = process.env.SILICONFLOW_API_KEY;
const SF_MODEL = 'FunAudioLLM/CosyVoice2-0.5B';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const probeDur = (f) => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
const fmtSrt = (t) => {
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  const ms = String(Math.round((t % 1) * 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
};

// ---------- 供应商 1:SiliconFlow CosyVoice2(首选,自然度最高) ----------
async function sfSentence(text, out, attemptMax = 4) {
  for (let a = 1; a <= attemptMax; a++) {
    try {
      const res = await fetch('https://api.siliconflow.cn/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SF_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: SF_MODEL, input: text, voice: process.env.TTS_VOICE || `${SF_MODEL}:diana`,
          response_format: 'mp3', sample_rate: 44100, speed: Number(SPEED),
        }),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      // JSON 错误以 { 开头;有效 mp3 以 ID3/0xFF 开头且大于 2KB
      if (buf.length > 2000 && buf[0] !== 0x7b) { fs.writeFileSync(out, buf); return; }
      throw new Error(`${buf.length}B: ${buf.toString('utf8').slice(0, 80)}`);
    } catch (e) {
      if (a === attemptMax) throw e;
      await sleep(2500 * a);
    }
  }
}

async function viaSiliconFlow(text, out) {
  const sentences = text.split(/(?<=[。!?!?])/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length <= 1) return { parts: [out], sentences: [{ text, file: out }] };
  const parts = [];
  const meta = [];
  for (let i = 0; i < sentences.length; i++) {
    const p = `${out}.part${i}`;
    await sfSentence(sentences[i], p);
    parts.push(p);
    meta.push({ text: sentences[i], file: p });
  }
  return { parts, sentences: meta };
}

function concatMp3(parts, out, silencePath) {
  if (parts.length === 1) { fs.copyFileSync(parts[0], out); return; }
  const list = path.join(path.dirname(out), `.concat-${crypto.randomBytes(4).toString('hex')}.txt`);
  const body = parts.flatMap((p) => [`file '${p.split(/[\\/]/).pop()}'`, `file '${path.basename(silencePath)}'`]).slice(0, -1);
  fs.writeFileSync(list, body.join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-q:a', '2', out], { stdio: 'inherit', cwd: path.dirname(silencePath) });
  fs.unlinkSync(list);
}

async function viaEdgeTts(text, out) {
  const voice = process.env.TTS_VOICE || 'zh-CN-XiaoxiaoNeural';
  for (let a = 1; a <= 3; a++) {
    try {
      execFileSync('edge-tts', ['--voice', voice, `--rate=${Number(SPEED) > 1 ? '+' + Math.round((Number(SPEED) - 1) * 100) + '%' : '+0%'}`, '--text', text, '--write-media', out], { stdio: 'pipe', shell: process.platform === 'win32' });
      if (fs.existsSync(out) && fs.statSync(out).size > 2000) return;
    } catch { /* 重试 */ }
    await sleep(3000 * a);
  }
  throw new Error('edge-tts 连续失败(本网络常见,建议配 SILICONFLOW_API_KEY)');
}

function viaSapi(text, out) {
  const ps = text.replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Huihui Desktop')
$s.Rate = 2
$s.SetOutputToWaveFile('${out.replace(/\.mp3$/, '.wav')}', [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono))
$s.Speak('${ps}')
$s.SetOutputToNull()`;
  const tmp = `${out}.ps1`;
  fs.writeFileSync(tmp, script);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { stdio: 'pipe' });
  fs.unlinkSync(tmp);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out.replace(/\.mp3$/, '.wav'), '-c:a', 'libmp3lame', '-q:a', '2', out], { stdio: 'inherit' });
  fs.unlinkSync(out.replace(/\.mp3$/, '.wav'));
}

// ---------- 主流程 ----------
fs.mkdirSync(OUT, { recursive: true });
const silence = path.join(OUT, 'silence015.mp3');
if (!fs.existsSync(silence)) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.15', '-c:a', 'libmp3lame', silence], { stdio: 'inherit' });
}

const provider = process.env.TTS_PROVIDER || (SF_KEY ? 'siliconflow' : 'auto');
const index = {};

for (const shot of BOARD.shots || []) {
  const mp3 = path.join(OUT, `${shot.id}.mp3`);
  const srt = path.join(OUT, `${shot.id}.srt`);
  if (fs.existsSync(mp3) && !FORCE) {
    index[shot.id] = { duration: probeDur(mp3) };
    console.log(`[${shot.id}] 已存在,跳过`);
    continue;
  }
  const text = String(shot.narration || '').trim();
  if (!text) { console.warn(`[${shot.id}] narration 为空,跳过配音`); continue; }

  let used = provider;
  if (provider === 'auto' || provider === 'siliconflow') {
    if (SF_KEY) {
      try {
        const { parts, sentences } = await viaSiliconFlow(text, mp3);
        concatMp3(parts, mp3, silence);
        sentences.forEach((s) => s.file && fs.existsSync(s.file) && s.file.includes('.part') && fs.unlinkSync(s.file));
        used = 'siliconflow';
      } catch (e) {
        console.error(`[${shot.id}] siliconflow 失败,降级 edge-tts: ${e.message}`);
      }
    }
  }
  if (used !== 'siliconflow' && (provider === 'auto' || provider === 'edge')) {
    await viaEdgeTts(text, mp3);
    used = 'edge';
  }
  if (!fs.existsSync(mp3) || fs.statSync(mp3).size < 2000) {
    await viaSapi(text, mp3);
    used = 'sapi';
  }

  // 精确字幕:probe 每句时长生成 SRT(siliconflow 按句已知;其他供应商整段按句长比例粗分)
  const dur = probeDur(mp3);
  if (used === 'siliconflow') {
    // 重新按句探测时长生成字幕(直接用 part 文件时长;parts 已删则按字符比例)
    const sentences = text.split(/(?<=[。!?!?])/).map((s) => s.trim()).filter(Boolean);
    const weights = sentences.map((s) => s.length);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = 0;
    const cues = sentences.map((s, i) => {
      const d = (weights[i] / total) * dur;
      const cue = `${i + 1}\n${fmtSrt(t)} --> ${fmtSrt(t + d)}\n${s}\n`;
      t += d;
      return cue;
    });
    fs.writeFileSync(srt, cues.join('\n'));
  } else {
    // edge/sapi:整段一个 cue 的兜底(粗字幕),投稿时可用 B 站自带 CC 校准
    fs.writeFileSync(srt, `1\n${fmtSrt(0)} --> ${fmtSrt(dur)}\n${text}\n`);
  }

  index[shot.id] = { duration: dur, provider: used };
  console.log(`[${shot.id}] 配音完成 via ${used}, ${dur.toFixed(1)}s`);
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));
console.log('配音全部完成 →', OUT);
