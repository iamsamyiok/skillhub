#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import {
  ask, clip, DEFAULT_MODEL, newSession, ragCommon, ragPersonal, sleep,
} from './lib.mjs';

const HELP = `geoGpt 问答 / 检索增强

用法：
  node ask.mjs "问题" [选项]
  node ask.mjs --batch questions.txt [选项]

选项：
  --session <id>          复用会话以延续多轮上下文；缺省则新建并在首行打印 sessionId
  --module <name>         模型名，默认 ${DEFAULT_MODEL}
                          可选 Qwen2.5-72B-GeoGPT / GeoGPT-R1-Preview / DeepSeekR1-GeoGPT
  --ground "<英文词>"     先用公共库召回文献片段拼进问题做证据增强（公共库必须用英文）
  --personal              --ground 改查个人库（中英文均可）
  --ground-k <n>          召回条数，默认 3
  --min-score <f>         公共库 metadata.score 下限，默认 0.9
  --min-distance <f>      个人库 metadata.distance 下限，默认 0.3
  --show-reasoning        一并打印思考过程
  --no-context            只输出答案，不打印 sessionId 等元信息
  --out <file>            结果写入文件（批量模式建议开）
  --delay <ms>            批量模式条目间隔，默认 400（配额 RPM 1000）
  --timeout <sec>         单次问答超时，默认 300
  --shared-session        批量模式共用一个会话（默认每行独立会话，避免上下文串味）
  -h, --help              帮助
`;

function parseArgs(argv) {
  const opts = { module: DEFAULT_MODEL, groundK: 3, minScore: 0.9, minDistance: 0.3, delay: 400, timeout: 300000 };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      case '--session': opts.session = argv[++i]; break;
      case '--module': opts.module = argv[++i]; break;
      case '--ground': opts.ground = argv[++i]; break;
      case '--personal': opts.personal = true; break;
      case '--ground-k': opts.groundK = Number(argv[++i]); break;
      case '--min-score': opts.minScore = Number(argv[++i]); break;
      case '--min-distance': opts.minDistance = Number(argv[++i]); break;
      case '--show-reasoning': opts.showReasoning = true; break;
      case '--no-context': opts.noContext = true; break;
      case '--out': opts.out = argv[++i]; break;
      case '--delay': opts.delay = Number(argv[++i]); break;
      case '--timeout': opts.timeout = Number(argv[++i]) * 1000; break;
      case '--shared-session': opts.sharedSession = true; break;
      case '--batch': opts.batch = argv[++i]; break;
      default:
        if (a.startsWith('--')) { console.error(`未知选项 ${a}`); process.exit(1); }
        pos.push(a);
    }
  }
  opts.question = pos.join(' ').trim();
  return opts;
}

async function buildContext(opts) {
  if (!opts.ground) return '';
  const lib = opts.personal
    ? await ragPersonal(opts.ground, { topK: opts.groundK, minDistance: opts.minDistance })
    : await ragCommon(opts.ground, { topK: opts.groundK, minScore: opts.minScore });
  if (!opts.personal && /[\u4e00-\u9fa5]/.test(opts.ground)) {
    console.error('[geogpt] 警告：公共库检索词含中文。纯中文实测 0 命中，命中的只会是其中夹带的英文缩写，请改用英文术语。');
  }
  console.error(`[geogpt] ${opts.personal ? '个人库' : '公共库'}召回 ${lib.hits.length} 段`);
  if (!lib.hits.length) {
    console.error('[geogpt] 证据增强未取到材料，本次将退化为无依据问答。');
    return '';
  }
  return lib.hits
    .map((h, i) => `[${i + 1}] ${h.metadata?.title ?? '未知'} (chunk ${h.metadata?.chunk_index ?? '?'})\n${h.page_content}`)
    .join('\n\n');
}

async function runOne({ question, opts, sessionId }) {
  const context = await buildContext(opts);
  const text = context
    ? `请仅依据下列文献材料回答，材料中没有的不要编造。\n\n===材料===\n${context}\n===材料结束===\n\n问题：${question}`
    : question;
  const { answer, reasoning } = await ask({ sessionId, text, module: opts.module, timeoutMs: opts.timeout });
  return { answer, reasoning, contextHits: context ? context.split('\n\n').length : 0 };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const out = [];
  const emit = (s = '') => { out.push(s); if (!opts.out) console.log(s); };

  if (opts.batch) {
    const questions = readFileSync(opts.batch, 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (!questions.length) { console.error('批量文件为空'); process.exit(1); }
    const sessionId = opts.sharedSession ? await newSession() : null;
    if (sessionId) console.error(`[geogpt] 共用会话 ${sessionId}`);
    let empties = 0;
    for (let i = 0; i < questions.length; i++) {
      const sid = sessionId ?? await newSession();
      console.error(`[geogpt] (${i + 1}/${questions.length}) ${clip(questions[i], 60)}`);
      const r = await runOne({ question: questions[i], opts, sessionId: sid });
      emit(`### ${i + 1}. ${questions[i]}`);
      emit('');
      emit(r.answer || '(空回答)');
      emit('');
      if (!r.answer.trim()) empties++;
      if (i < questions.length - 1) await sleep(opts.delay);
    }
    if (empties) {
      console.error(`[geogpt] ${empties}/${questions.length} 条空回答`);
      process.exitCode = 2;
    }
  } else {
    if (!opts.question) { console.log(HELP); process.exit(1); }
    const sessionId = opts.session ?? await newSession();
    if (!opts.session && !opts.noContext) console.error(`[geogpt] sessionId=${sessionId}（多轮追问请加 --session ${sessionId}）`);
    const r = await runOne({ question: opts.question, opts, sessionId });
    if (opts.showReasoning) {
      emit('=== 思考过程 ===');
      emit(r.reasoning);
      emit('');
    }
    emit(r.answer || '(空回答)');
    if (!r.answer.trim()) {
      console.error('[geogpt] 空回答。常见原因是 --session 传了无效 id（服务端不报错、直接返空），去掉 --session 重试。');
      process.exitCode = 2;
    }
    if (!opts.noContext) emit(`\n[geogpt] sessionId=${sessionId}`);
  }

  if (opts.out) {
    writeFileSync(opts.out, out.join('\n') + '\n', 'utf8');
    console.error(`[geogpt] 已写入 ${opts.out}`);
  }
}

main();
