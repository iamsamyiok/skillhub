#!/usr/bin/env node
'use strict';

// video/tts.js — 逐分镜生成 AI 配音（mp3 + SRT 字幕）
// 音色: 晓晓（zh-CN-XiaoxiaoNeural）；字幕按词组分段，供合成时偏移拼接

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = process.env.OUT_DIR ? path.join(process.env.OUT_DIR, 'tts') : path.join(ROOT, 'out', 'tts');
const BOARD = JSON.parse(fs.readFileSync(process.env.STORYBOARD || path.join(ROOT, 'storyboard.json'), 'utf8'));
const VOICE = process.env.TTS_VOICE || 'zh-CN-XiaoxiaoNeural';

fs.mkdirSync(OUT, { recursive: true });
for (const shot of BOARD.shots) {
  const mp3 = path.join(OUT, `${shot.id}.mp3`);
  const srt = path.join(OUT, `${shot.id}.srt`);
  const need = !fs.existsSync(mp3) || process.argv.includes('--force');
  if (!need) { console.log(`[${shot.id}] 配音已存在，跳过`); continue; }
  const text = shot.narration.replace(/"/g, '');
  execSync(
    `edge-tts --voice ${VOICE} --text "${text}" --write-media "${mp3}" --write-subtitles "${srt}"`,
    { stdio: 'inherit' },
  );
  console.log(`[${shot.id}] 配音完成 ${shot.name}`);
}
console.log('配音全部完成 →', OUT);
