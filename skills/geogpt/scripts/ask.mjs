#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import {
  ask, clip, DEFAULT_MODEL, newSession, ragCommon, ragPersonal, sleep,
} from './lib.mjs';
import { DEFAULT_MAX_CHARS, loadDocs, selectChunks } from './localdoc.mjs';

const HELP = `geoGpt 问答 / 检索增强

用法：
  node ask.mjs "问题" [选项]
  node ask.mjs "这篇论文的锆石年龄数据" --file paper.md [选项]
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
  --file <路径>           用本地论文/报告当材料，可重复传多个（.md/.txt/.csv 等文本）
                          PDF/Word 先转 Markdown 再传，脚本不硬解二进制
  --file-k <n>            本地文档最多注入几段，默认 6（整篇不足 --max-chars 时全量注入）
  --max-chars <n>         本地材料总字数预算，默认 ${DEFAULT_MAX_CHARS}
                          实测 1.8 万字正常、18 万字服务端挂死，别把预算拉满
  --show-reasoning        一并打印思考过程
  --allow-ungrounded      材料一条都没命中时也照答（默认中止，避免把模型记忆当成文档内容）
  --no-context            只输出答案，不打印 sessionId 等元信息
  --out <file>            结果写入文件（批量模式建议开）
  --delay <ms>            批量模式条目间隔，默认 400（配额 RPM 1000）
  --timeout <sec>         单次问答超时，默认 300
  --shared-session        批量模式共用一个会话（默认每行独立会话，避免上下文串味）
  -h, --help              帮助
`;

function parseArgs(argv) {
  const opts = { module: DEFAULT_MODEL, groundK: 3, minScore: 0.9, minDistance: 0.3, delay: 400, timeout: 300000, files: [], fileK: 6, maxChars: DEFAULT_MAX_CHARS };
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
      case '--file':
        if (!argv[i + 1]) { console.error('--file 后面要跟文件路径'); process.exit(1); }
        opts.files.push(argv[++i]);
        break;
      case '--file-k': opts.fileK = Number(argv[++i]); break;
      case '--max-chars': opts.maxChars = Number(argv[++i]); break;
      case '--show-reasoning': opts.showReasoning = true; break;
      case '--allow-ungrounded': opts.allowUngrounded = true; break;
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

async function buildContext(opts, docs, question) {
  const parts = [];
  let count = 0;
  if (opts.ground) {
    const lib = opts.personal
      ? await ragPersonal(opts.ground, { topK: opts.groundK, minDistance: opts.minDistance })
      : await ragCommon(opts.ground, { topK: opts.groundK, minScore: opts.minScore });
    if (!opts.personal && /[\u4e00-\u9fa5]/.test(opts.ground)) {
      console.error('[geogpt] 警告：公共库检索词含中文。纯中文实测 0 命中，命中的只会是其中夹带的英文缩写，请改用英文术语。');
    }
    console.error(`[geogpt] ${opts.personal ? '个人库' : '公共库'}召回 ${lib.hits.length} 段`);
    if (!lib.hits.length) {
      console.error('[geogpt] 公共/个人库未取到材料');
    } else {
      count += lib.hits.length;
      parts.push(lib.hits
        .map((h, i) => `[文献${i + 1}] ${h.metadata?.title ?? '未知'} (chunk ${h.metadata?.chunk_index ?? '?'})\n${h.page_content}`)
        .join('\n\n'));
    }
  }
  if (docs.chunks.length) {
    const text = selectChunks(docs.chunks, question, { k: opts.fileK, maxChars: opts.maxChars });
    if (!text) {
      console.error('[geogpt] 本地文档关键词零命中，未注入材料。可加 --file-k 放宽或提高 --max-chars 整篇喂入。');
    } else {
      const n = text.split(/\n\n(?=\[本地)/).length;
      console.error(`[geogpt] 本地文档注入 ${n} 段`);
      count += n;
      parts.push(text);
    }
  }
  return { text: parts.join('\n\n'), count };
}

async function runOne({ question, opts, sessionId, docs }) {
  const { text: context, count } = await buildContext(opts, docs, question);
  const wantEvidence = Boolean(opts.ground) || docs.chunks.length > 0;
  if (wantEvidence && !count && !opts.allowUngrounded) {
    return { answer: '', reasoning: '', contextHits: 0, skipped: true };
  }
  if (context) {
    console.error(`[geogpt] 证据增强：${count} 段材料，共 ${context.length} 字`);
  }
  const text = context
    ? `请仅依据下列材料回答，材料中没有的不要编造，并在答案里标注引用的材料编号（如${opts.ground && docs.chunks.length ? '[文献1]、[本地2]' : opts.ground ? '[文献1]' : '[本地1]'}）。材料未覆盖的直接说不知道。\n\n===材料===\n${context}\n===材料结束===\n\n问题：${question}`
    : question;
  const { answer, reasoning } = await ask({ sessionId, text, module: opts.module, timeoutMs: opts.timeout });
  return { answer, reasoning, contextHits: count };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const out = [];
  const emit = (s = '') => { out.push(s); if (!opts.out) console.log(s); };

  let docs = { chunks: [], notes: [] };
  if (opts.files.length) {
    docs = loadDocs(opts.files);
    for (const n of docs.notes) console.error(`[geogpt] ${n}`);
    if (!docs.chunks.length) {
      console.error('[geogpt] --file 指定的文件没有一个能读成文本。按要求不应静默降级成无依据问答，已中止。');
      process.exit(1);
    } else {
      console.error(`[geogpt] 本地文档 ${opts.files.length} 个，切片 ${docs.chunks.length} 段`);
    }
  }
  if (opts.maxChars > 30000) {
    console.error(`[geogpt] 警告：--max-chars ${opts.maxChars} 偏大，实测 18 万字输入会挂死不返回，建议不超过 2 万。`);
  }

  if (opts.batch) {
    const questions = readFileSync(opts.batch, 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (!questions.length) { console.error('批量文件为空'); process.exit(1); }
    const sessionId = opts.sharedSession ? await newSession() : null;
    if (sessionId) console.error(`[geogpt] 共用会话 ${sessionId}`);
    let empties = 0;
    let skipped = 0;
    for (let i = 0; i < questions.length; i++) {
      const sid = sessionId ?? await newSession();
      console.error(`[geogpt] (${i + 1}/${questions.length}) ${clip(questions[i], 60)}`);
      const r = await runOne({ question: questions[i], opts, sessionId: sid, docs });
      emit(`### ${i + 1}. ${questions[i]}`);
      emit('');
      if (r.skipped) {
        emit('(跳过：材料零命中。加 --allow-ungrounded 可强行作答，但答案将来自模型记忆而非你的材料)');
        skipped++;
      } else {
        emit(r.answer || '(空回答)');
        if (!r.answer.trim()) empties++;
      }
      emit('');
      if (i < questions.length - 1) await sleep(opts.delay);
    }
    if (skipped) {
      console.error(`[geogpt] ${skipped}/${questions.length} 条因材料零命中被跳过`);
      process.exitCode = 2;
    }
    if (empties) {
      console.error(`[geogpt] ${empties}/${questions.length} 条空回答`);
      process.exitCode = 2;
    }
  } else {
    if (!opts.question) { console.log(HELP); process.exit(1); }
    const sessionId = opts.session ?? await newSession();
    if (!opts.session && !opts.noContext) console.error(`[geogpt] sessionId=${sessionId}（多轮追问请加 --session ${sessionId}）`);
    const r = await runOne({ question: opts.question, opts, sessionId, docs });
    if (r.skipped) {
      console.error('[geogpt] 材料零命中，已中止：答案若来自模型记忆，会被误当成文档结论。确认无所谓时加 --allow-ungrounded。');
      process.exit(1);
    }
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
