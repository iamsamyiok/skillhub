#!/usr/bin/env node
import { clip, ragCommon, ragPersonal } from './lib.mjs';

const HELP = `geoGpt 知识库检索

用法：
  node rag.mjs "<检索词>" [选项]

选项：
  --personal            查个人库/团队库（中英文均可）；缺省查公共库（必须英文）
  --team                配合 --personal，查团队库而非个人库
  -k, --top <n>         返回条数，默认 5
  --min-score <f>       公共库 metadata.score 下限，默认 0.9
  --min-distance <f>    个人库 metadata.distance 下限，默认 0.3（越大越接近）
  --path <a,b>          个人库目录过滤，取自网页端 MyLibrary 路径；缺省全库
  --full                每段正文输出 3000 字（默认 500 字）
  --json                输出原始 JSON，便于管道处理
  -h, --help            帮助

注意：接口不会因为"不相关"返回空，一定会凑满 topK 条，所以阈值必须自己卡。
`;

function parseArgs(argv) {
  const opts = { top: 5, minScore: 0.9, minDistance: 0.3 };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      case '--personal': opts.personal = true; break;
      case '--team': opts.team = true; break;
      case '-k': case '--top': opts.top = Number(argv[++i]); break;
      case '--min-score': opts.minScore = Number(argv[++i]); break;
      case '--min-distance': opts.minDistance = Number(argv[++i]); break;
      case '--path': opts.pathList = argv[++i].split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--full': opts.full = true; break;
      case '--json': opts.json = true; break;
      default:
        if (a.startsWith('--')) { console.error(`未知选项 ${a}`); process.exit(1); }
        pos.push(a);
    }
  }
  opts.query = pos.join(' ').trim();
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.query) { console.log(HELP); process.exit(1); }

if (!opts.personal && /[\u4e00-\u9fa5]/.test(opts.query)) {
  console.error('[geogpt] 警告：公共库检索词含中文。纯中文实测 0 命中，命中的只会是其中夹带的英文缩写，请改用英文术语，或加 --personal 查个人库。');
}

const lib = opts.personal
  ? await ragPersonal(opts.query, {
    topK: opts.top, isTeam: !!opts.team, pathList: opts.pathList ?? [], minDistance: opts.minDistance,
  })
  : await ragCommon(opts.query, { topK: opts.top, minScore: opts.minScore });

if (opts.json) {
  console.log(JSON.stringify(lib.hits, null, 2));
  process.exit(0);
}

const metric = opts.personal ? 'distance' : 'score';
console.log(`检索词: ${opts.query}`);
console.log(`库: ${opts.personal ? (opts.team ? '团队库' : '个人库') : '公共库'} | 向量化 ${lib.vectorTime == null ? 'n/a' : `${lib.vectorTime.toFixed(2)}s`} | 过阈值后 ${lib.hits.length} 段\n`);

if (!lib.hits.length) {
  console.log(opts.personal
    ? '无命中。个人库文档太少或全不相关，试 --min-distance 0 看原始召回内容，或确认 MyLibrary 已上传文档。'
    : '无命中。纯中文检索在公共库不生效，请改用英文术语；也可调低 --min-score。');
  process.exit(0);
}

lib.hits.forEach((h, i) => {
  const m = h.metadata ?? {};
  console.log(`--- [${i + 1}] ${m.title ?? '(无标题)'}`);
  console.log(`    ${metric}=${m[metric] ?? 'n/a'} | document_id=${m.document_id} | chunk=${m.chunk_index} | type=${m.text_type}`);
  if (m.section) console.log(`    章节: ${clip(m.section, 80)}`);
  console.log(`    ${clip(h.page_content, opts.full ? 3000 : 500)}`);
  console.log('');
});
