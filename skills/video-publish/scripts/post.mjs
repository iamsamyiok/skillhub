#!/usr/bin/env node
'use strict';

// post.mjs — 成片后期两件套(借鉴 MoneyPrinterTurbo 的 BGM/双比例实践)
//   node post.mjs bgm   <成片> <BGM文件>   混入背景音乐(人声闪避 ducking)
//   node post.mjs vertical <成片> [输出]   裁 9:16 竖版(抖音/小红书/视频号)
//
// 合规提醒:BGM 必须使用你有权使用的音乐(自有/授权/B站创作中心曲库内素材),
// 投稿时如平台提供正版曲库,优先在站内二次配置。

import fs from 'fs';
import { execFileSync } from 'child_process';

const [cmd, ...rest] = process.argv.slice(2);

function bgm(video, music) {
  if (!fs.existsSync(video) || !fs.existsSync(music)) { console.error('文件不存在'); process.exit(1); }
  const out = video.replace(/(\.\w+)?$/, '-bgm.mp4');
  const vol = process.env.BGM_VOLUME || '0.12'; // BGM 压到人声之下
  // 人声作为 sidechain 触发 BGM 闪避:threshold=0.02,大幅压低讲话时的 BGM
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-stream_loop', '-1', '-i', music,
    '-filter_complex',
    `[1:a]volume=${vol}[bgm];[0:a][bgm]sidechaincompress=threshold=0.02:ratio=8:attack=120:release=600[duck];[duck][1:a]amix=inputs=2:duration=first:dropout_transition=2[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log('BGM 混音完成 →', out);
}

function vertical(video, output) {
  if (!fs.existsSync(video)) { console.error('文件不存在'); process.exit(1); }
  const out = output || video.replace(/(\.\w+)?$/, '-vertical.mp4');
  // 1080p 横版 → 1080x1920 竖版:先放大到高 1920 再居中裁宽 1080
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video,
    '-vf', 'scale=-2:1920:flags=lanczos,crop=1080:1920:(iw-1080)/2:0,format=yuv420p',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'medium',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log('竖版裁切完成 →', out);
}

if (cmd === 'bgm' && rest.length >= 2) bgm(rest[0], rest[1]);
else if (cmd === 'vertical' && rest.length >= 1) vertical(rest[0], rest[1]);
else { console.error('用法: node post.mjs bgm <成片> <BGM> | node post.mjs vertical <成片> [输出]'); process.exit(1); }
