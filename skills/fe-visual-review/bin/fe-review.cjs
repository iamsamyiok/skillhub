#!/usr/bin/env node
/**
 * fe-review.cjs — 前端界面视觉审查（专治 LLM/Agent 生成页面）
 * 输入：网页 URL（自动截图）或本地图片路径
 * 输出：结构化问题报告（终端 markdown + 可选 JSON，供 Agent 直接消费）
 *
 * 识图引擎：AGNES agnes-2.5-flash（OpenAI 兼容 chat/completions，image_url 传 data URI）
 * 凭据来源：~/.secrets/credentials.env 中 AGNES_API_KEY / AGNES_BASE_URL / AGNES_MODEL（脚本自动读取）
 * 截图引擎：chrome-headless-shell（playwright 缓存，无需额外安装）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ---------- CLI ----------
const argv = process.argv.slice(2);
function argOf(flag, def) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
function hasFlag(flag) { return argv.includes(flag); }

if (argv.length === 0 || hasFlag('--help') || hasFlag('-h')) {
  console.log(`用法:
  fe-review <URL|图片路径> [选项]

选项:
  --out <file.md>     人类可读报告输出文件（默认仅打印到终端）
  --json <file.json>  结构化 JSON 输出（供 Agent/程序消费）
  --viewport <WxH>    截图视口，默认 1440x900
  --height <px>       截图窗口高度覆盖（长页面调大，如 3000）
  --responsive        响应式审查：桌面/平板/手机三视口一次对比（LLM 生成页面必开）
  --thorough          放大复查：2x2 分块放大 1.6x 扫微观缺陷（叠字/小字/小点击目标）
  --wait <ms>         截图前等待毫秒数（默认 1200）
  --focus <提示>      额外审查关注点
  --lang <zh|en>      报告语言，默认 zh
  --quiet             不打印终端报告，仅写文件
  --timeout <sec>     API 超时秒数，默认 180
  --max-tokens <n>    单次识图输出上限，默认 5000（复杂页面/图表 scan 枚举长时调大，如 12000）

LLM 生成页面推荐组合:
  fe-review <URL> --responsive --thorough --json report.json --out report.md

示例:
  fe-review http://localhost:3790/mypage/ --responsive --json /tmp/r.json --out /tmp/r.md
  fe-review ./screenshot.png --focus "检查表单区域"`);
  process.exit(0);
}

const target = argv[0];
const OUT_MD = argOf('--out', null);
const OUT_JSON = argOf('--json', null);
const VIEWPORT = argOf('--viewport', '1440x900');
const EXTRA_HEIGHT = argOf('--height', null);
const WAIT_MS = parseInt(argOf('--wait', '1200'), 10);
const FOCUS = argOf('--focus', null);
const LANG = argOf('--lang', 'zh');
const QUIET = hasFlag('--quiet');
const THOROUGH = hasFlag('--thorough');
const RESPONSIVE = hasFlag('--responsive');
const TIMEOUT_SEC = parseInt(argOf('--timeout', '180'), 10);
const MAX_TOKENS = parseInt(argOf('--max-tokens', '5000'), 10);

// ---------- 凭据 ----------
function loadCreds() {
  const envFile = path.join(os.homedir(), '.secrets', 'credentials.env');
  if (fs.existsSync(envFile)) {
    const src = fs.readFileSync(envFile, 'utf8');
    for (const m of src.matchAll(/^export\s+(AGNES_[A-Z_]+)=(.*)$/gm)) {
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  }
  if (!process.env.AGNES_API_KEY || !process.env.AGNES_BASE_URL || !process.env.AGNES_MODEL) {
    console.error('错误：缺少 AGNES_API_KEY / AGNES_BASE_URL / AGNES_MODEL（应在 ~/.secrets/credentials.env 配置）');
    process.exit(1);
  }
}
loadCreds();

// ---------- 截图 ----------
function findChromeShell() {
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base)) {
      if (!d.startsWith('chromium')) continue;
      for (const sub of ['chrome-headless-shell-linux64', 'chrome-linux']) {
        const p = path.join(base, d, sub, 'chrome-headless-shell');
        if (fs.existsSync(p)) return p;
        const p2 = path.join(base, d, sub, 'chrome');
        if (fs.existsSync(p2)) return p2;
      }
    }
  }
  return null;
}

function isUrl(s) { return /^https?:\/\//i.test(s) || /^file:\/\//i.test(s); }

function shoot(url, outPng, w, h) {
  const bin = findChromeShell();
  if (!bin) { console.error('错误：未找到 chrome-headless-shell（~/.cache/ms-playwright）'); process.exit(1); }
  const args = [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--screenshot=${outPng}`, `--window-size=${w},${h}`,
    '--virtual-time-budget=' + Math.max(WAIT_MS, 500),
    url
  ];
  const r = spawnSync(bin, args, { timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0 || !fs.existsSync(outPng) || fs.statSync(outPng).size < 1000) {
    console.error('错误：截图失败 ' + w + 'x' + h + (r.stderr ? '\n' + r.stderr.toString().slice(0, 400) : ''));
    process.exit(1);
  }
}

// ---------- 识图 ----------
function loadSharp() {
  try { return require('sharp'); } catch (e) {}
  try { return require('/usr/local/lib/node_modules/sharp'); } catch (e) {}
  return null;
}

const LLM_PATTERNS = `overlap_layers 定位重叠（absolute/负margin/固定宽高致文字压文字、浮层压内容）
text_truncate 文字截断（nowrap撑破、省略号吃掉关键信息、单词溢出容器）
flex_collapse 布局塌陷（flex/grid子项挤压变形、卡片高度参差、列宽失衡、内容溢出容器）
contrast_low 对比度不足（浅灰字白底、按钮文字与底色对比<4.5:1）
spacing_chaos 间距失衡（贴边、魔法数字间距忽大忽小、行距过密、留白一侧失衡）
style_inconsistency 风格不一致（同页按钮多种圆角/阴影/主色、图标风格混杂）
color_chaos 配色混乱（随机取色、主色不统一、刺眼高饱和撞色、背景与内容冲突）
hierarchy_lost 字号层级混乱（标题与正文接近、同级元素字号不一、全靠加粗区分）
img_distort 图片变形（拉伸、压扁、裁切不当、模糊放大）
zindex_conflict 层叠异常（弹层/下拉被裁剪遮挡、悬浮元素盖住可读内容）
placeholder_left 占位残留（lorem ipsum、TODO、示例数据、测试文字忘删）
form_ux 表单可用性（label缺失或错位、输入框过小、placeholder当label、必填无标识）
small_target 点击目标过小（可点区域<40x24px）
scrollbar_abnormal 滚动异常（横向滚动条、双重滚动条、内容区锁死）
empty_state 空状态缺失（数据区/列表区大片空白无提示）
alignment 对齐混乱（基线不齐、混用居中与左对齐、栅格不齐）`;

function buildSystemPrompt(viewports) {
  const zh = LANG !== 'en';
  const multi = viewports && viewports.length > 1;
  const vpNote = multi
    ? `\n【本次输入为 ${viewports.length} 张截图，依次对应视口：${viewports.join('、')}】逐张审查并对比，重点找响应式问题：某视口下才出现的溢出/塌陷/挤压/换行异常，必须在 issue.viewport 标注对应视口；多视口共有的填 all。`
    : '';
  const vpField = multi
    ? '"viewport": "出问题的视口（如 390x844）或 all"'
    : `"viewport": "${viewports ? viewports[0] : VIEWPORT}"`;
  return zh ? `你是资深前端 UI/QA 视觉审查专家，特别擅长审查 **LLM/AI Agent 生成的网页**——这类页面高频出现"代码能跑但视觉失控"的缺陷。你的任务：审查网页截图，找出所有可见缺陷并输出给一个"看不到图的 AI 编码 Agent"去修复。Agent 完全依赖你的文字来定位和修改代码。

【定位三要素】每个问题的 location 必须同时给出：
1. 页面区域（如：顶部导航栏、英雄区左侧、页脚第二列）
2. 元素类型（如：按钮、标题、输入框、卡片、图标、链接）
3. 元素上可见的原文文字（原样引用，Agent 用它做 grep/文本匹配定位代码）

【第一步 scan（必做）】先自上而下把图上可见的区域和元素枚举出来：区域名、区域内元素（类型+可见原文）。若页面元素超过 15 个，按区域分组、每区域只列最重要的至多 6 个代表元素（保留原文要点），无需全部穷举。看似正常的区域也要覆盖到。按钮要特别检查内部文字是否叠影/重影/两层文字错位。

【第二步对照 LLM 生成页面高频缺陷模式库逐项排查】（命中即在 issue.llm_pattern 填模式名，一般问题填 null）：
${LLM_PATTERNS}

【第三步评分】四个维度各打 0-10 分（10 最好）：beauty 美观（配色/层次/留白整体观感）、structure 结构（布局骨架、信息分组、视觉动线）、usability 可用性（可读性、可点击性、表单体验）、consistency 一致性（风格/间距/色彩的系统程度）。

【第四步改进建议 suggestions】3-6 条按优先级排序。不只挑毛病：包括"能明显变好看"的美化建议（统一阴影规格、建立间距节奏、主色延伸运用等）。每条必须具体到可执行。

【严重度】critical=功能不可用或无法阅读；major=明显影响使用观感；minor=可感知但不碍事；cosmetic=细节打磨项。

【置信度】必须诚实：图上确凿=high；合理推断=medium；看不清/猜测=low（low 也要列出，note 里说明）。

【修复建议 fix】必须可执行：how 一句话改什么；css_hint 给具体 CSS 属性与建议值。

【禁止】不得虚构图上不存在的元素；不得把合理设计风格当缺陷；不得输出 JSON 以外的解释文字。
${vpNote}
只输出一个 JSON 对象（不要 markdown 代码块包裹），结构：
{
  "scan": [{ "region": "区域名", "elements": ["元素类型+可见原文", "..."] }],
  "verdict": "pass|warn|fail",
  "summary": "一句话总体评价",
  "scores": { "beauty": 0, "structure": 0, "usability": 0, "consistency": 0 },
  "issues": [{
    "id": "ISS-01",
    "severity": "critical|major|minor|cosmetic",
    "category": "overlap|overflow|alignment|contrast|spacing|readability|interaction|layout_structure|visual_consistency|responsive|content",
    "llm_pattern": "模式名或 null",
    "viewport": ${vpField},
    "title": "问题短标题",
    "location": { "region": "页面区域", "element": "元素类型", "text": "可见原文", "hint": "位置补充" },
    "evidence": "你在图上看到的具体证据",
    "impact": "对用户的影响",
    "fix": { "how": "修改动作", "css_hint": "CSS/代码建议" },
    "confidence": "high|medium|low",
    "note": "置信度低时说明原因"
  }],
  "checks": [{ "dimension": "overlap", "result": "pass|warn|fail", "note": "简述" }],
  "suggestions": [{ "priority": "high|medium|low", "area": "美观|结构|交互|内容", "suggestion": "建议", "how": "具体做法" }],
  "positive": ["做得好的点（最多3条）"]
}` : `You are a senior frontend UI/QA visual review expert specialized in LLM-generated pages. Review the screenshot(s)${multi ? ' (viewports: ' + viewports.join(', ') + ')' : ''} and output the same JSON schema (scan/verdict/summary/scores/issues with llm_pattern/checks/suggestions/positive) in English. Locate every issue by region + element type + exact visible text. Be honest with confidence levels; never invent elements.`;
}

function buildDetailPrompt() {
  return `你是前端 UI 微观缺陷检测专家。这是一张网页截图的**局部放大图**，你的唯一任务是找这个局部里的微小视觉缺陷，宏观问题（布局失衡、配色等）不用管。重点逐项排查：

1. 叠字/重影：按钮、标签内同一文字出现两层且错位几个像素（高频缺陷，仔细看每个按钮和带文字的控件内部）
2. 文字截断：省略号截断、文字贴容器边缘被裁、单词溢出
3. 过小文字：任何估计小于 11px 的文字（label、脚注、链接）
4. 点击目标过小：链接/按钮/图标的可点击区域明显小于约 40x24px（逐个可点击元素估算）
5. 细微错位：label 与输入框、图标与文字、行内元素基线 1-4px 级错位
6. 边框/阴影异常：边框缺失一侧、阴影方向不一致、圆角不一致

【禁止】报告你确定看到的；每条 evidence 必须描述图上确切位置与形态；不确定的用 confidence:low。宁缺毋滥。

只输出 JSON（不要 markdown 包裹）：
{ "region_issues": [{ "severity": "critical|major|minor|cosmetic", "category": "overlap|overflow|alignment|contrast|spacing|readability|interaction", "title": "短标题", "location": { "region": "此局部图中的位置", "element": "元素类型", "text": "可见原文" }, "evidence": "具体证据", "impact": "影响", "fix": { "how": "修改动作", "css_hint": "CSS建议" }, "confidence": "high|medium|low" }] }
无问题则 region_issues 为空数组。`;
}

function reviewImagesWithPrompt(pngPaths, systemPrompt, userText, maxTokens = 3000) {
  const content = [
    { type: 'text', text: userText },
    ...pngPaths.map((p) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${fs.readFileSync(p).toString('base64')}` } }))
  ];
  const body = {
    model: process.env.AGNES_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content }
    ],
    temperature: 0.1,
    max_tokens: maxTokens
  };
  const tmp = path.join(os.tmpdir(), `fe-review-body-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(body));
  const r = spawnSync('curl', [
    '-sS', '--max-time', String(TIMEOUT_SEC),
    `${process.env.AGNES_BASE_URL}/chat/completions`,
    '-H', `Authorization: Bearer ${process.env.AGNES_API_KEY}`,
    '-H', 'Content-Type: application/json',
    '-d', `@${tmp}`
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  fs.unlinkSync(tmp);
  if (r.status !== 0 || !r.stdout) { console.error('错误：API 调用失败: ' + (r.stderr || r.status)); process.exit(1); }
  let resp;
  try { resp = JSON.parse(r.stdout); } catch (e) { console.error('错误：API 返回非 JSON: ' + r.stdout.slice(0, 300)); process.exit(1); }
  if (resp.error) { console.error('错误：API 报错: ' + JSON.stringify(resp.error).slice(0, 300)); process.exit(1); }
  const answer = resp.choices?.[0]?.message?.content || '';
  try {
    return { report: extractJson(answer), usage: resp.usage };
  } catch (e) {
    console.error('错误：模型输出无法解析为 JSON。原始输出前 500 字：\n' + answer.slice(0, 500));
    process.exit(1);
  }
}

function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

// ---------- 报告渲染 ----------
const SEV_ORDER = { critical: 0, major: 1, minor: 2, cosmetic: 3 };
function renderMd(rep, meta) {
  const L = [];
  L.push(`# 前端界面视觉审查报告`);
  L.push('');
  L.push(`- 审查对象：${meta.target}`);
  L.push(`- 截图：${meta.shots.join('、')}（${meta.viewports.join(' / ')}）`);
  L.push(`- 引擎：${meta.model} · ${new Date().toLocaleString('zh-CN')}`);
  L.push('');
  const vText = rep.verdict === 'fail' ? '未通过' : rep.verdict === 'warn' ? '有条件通过' : '通过';
  L.push(`## 结论：${vText}`);
  L.push('');
  L.push(rep.summary || '');
  L.push('');
  if (rep.scores) {
    L.push(`## 四维评分`);
    L.push('');
    L.push(`| 美观 | 结构 | 可用性 | 一致性 |`);
    L.push(`|------|------|--------|--------|`);
    L.push(`| ${rep.scores.beauty ?? '-'} | ${rep.scores.structure ?? '-'} | ${rep.scores.usability ?? '-'} | ${rep.scores.consistency ?? '-'} |`);
    L.push('');
  }
  const issues = (rep.issues || []).slice().sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  if (issues.length === 0) {
    L.push('未发现界面缺陷。');
  } else {
    L.push(`## 问题清单（${issues.length} 项，按严重度排序）`);
    L.push('');
    for (const it of issues) {
      const loc = it.location || {};
      const locStr = [loc.region, loc.element, loc.text ? `“${loc.text}”` : '', loc.hint].filter(Boolean).join(' · ');
      L.push(`### ${it.id} [${it.severity}] ${it.title || ''}`);
      L.push(`- 位置：${locStr}`);
      if (it.viewport) L.push(`- 视口：${it.viewport}`);
      if (it.llm_pattern && it.llm_pattern !== 'null') L.push(`- 模式：\`${it.llm_pattern}\``);
      L.push(`- 证据：${it.evidence || ''}`);
      L.push(`- 影响：${it.impact || ''}`);
      L.push(`- 修复：${it.fix?.how || ''}`);
      if (it.fix?.css_hint) L.push(`- CSS 提示：\`${it.fix.css_hint}\``);
      L.push(`- 置信度：${it.confidence || 'medium'}${it.note ? `（${it.note}）` : ''}`);
      if (it.source) L.push(`- 来源：${it.source}`);
      L.push('');
    }
  }
  if (Array.isArray(rep.checks) && rep.checks.length) {
    L.push(`## 审查清单`);
    L.push('');
    L.push('| 维度 | 结果 | 说明 |');
    L.push('|------|------|------|');
    for (const c of rep.checks) L.push(`| ${c.dimension} | ${c.result} | ${c.note || ''} |`);
    L.push('');
  }
  if (Array.isArray(rep.suggestions) && rep.suggestions.length) {
    const pri = { high: 0, medium: 1, low: 2 };
    L.push(`## 改进建议（按优先级）`);
    L.push('');
    for (const s of rep.suggestions.slice().sort((a, b) => (pri[a.priority] ?? 9) - (pri[b.priority] ?? 9))) {
      L.push(`- **[${s.priority}] ${s.area || ''}**：${s.suggestion}${s.how ? ` → ${s.how}` : ''}`);
    }
    L.push('');
  }
  if (Array.isArray(rep.positive) && rep.positive.length) {
    L.push(`## 做得好的`);
    for (const p of rep.positive) L.push(`- ${p}`);
    L.push('');
  }
  return L.join('\n');
}

// ---------- 主流程 ----------
(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-review-'));
  const totalUsage = { tokens: 0 };

  let shotPaths = [];
  let viewports = [];

  if (isUrl(target)) {
    const [w0] = VIEWPORT.split('x').map(Number);
    const h0 = EXTRA_HEIGHT ? parseInt(EXTRA_HEIGHT, 10) : parseInt(VIEWPORT.split('x')[1], 10);
    if (RESPONSIVE) {
      // 三视口：桌面/平板/手机，各一张，送一次多图审查
      const sizes = [[1440, 900], [768, 1024], [390, 844]];
      for (const [w, h] of sizes) {
        const p = path.join(tmpDir, `shot-${w}x${h}.png`);
        console.error(`截图 ${w}x${h} ...`);
        shoot(target, p, w, h);
        shotPaths.push(p);
        viewports.push(`${w}x${h}`);
      }
    } else {
      const p = path.join(tmpDir, 'shot.png');
      if (!QUIET) console.error(`截图 ${target}（${w0}x${h0}）...`);
      shoot(target, p, w0, h0);
      shotPaths = [p];
      viewports = [`${w0}x${h0}`];
    }
  } else {
    if (!fs.existsSync(target)) { console.error('错误：图片不存在: ' + target); process.exit(1); }
    shotPaths = [target];
    viewports = [VIEWPORT];
  }

  if (!QUIET) console.error(`识图审查中（${process.env.AGNES_MODEL}）...`);
  const t0 = Date.now();
  const userText = `审查${shotPaths.length > 1 ? '这 ' + shotPaths.length + ' 张' : '这张'}网页截图。${FOCUS ? `特别关注：${FOCUS}。` : ''}按系统指令输出 JSON。`;
  const { report, usage } = reviewImagesWithPrompt(shotPaths, buildSystemPrompt(viewports), userText, MAX_TOKENS);
  totalUsage.tokens += usage?.total_tokens || 0;

  // --thorough：对第一张（桌面视口）做 2x2 分块放大 1.6x 复查微观缺陷
  if (THOROUGH) {
    const sharp = loadSharp();
    if (!sharp) {
      console.error('警告：未找到 sharp，跳过放大复查（npm i -g sharp 后可用）');
    } else {
      console.error('放大复查中（2x2 分块，微观缺陷专扫）...');
      const base = shotPaths[0];
      const img = sharp(base);
      const m = await img.metadata();
      const overlap = Math.round(Math.min(m.width, m.height) * 0.10);
      const cw = Math.ceil(m.width / 2), ch = Math.ceil(m.height / 2);
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          const left = Math.max(0, c * cw - (c > 0 ? overlap : 0));
          const top = Math.max(0, r * ch - (r > 0 ? overlap : 0));
          const j = { left, top, width: Math.min(m.width - left, cw + overlap), height: Math.min(m.height - top, ch + overlap), name: `R${r + 1}C${c + 1}` };
          const part = `${base}.${j.name}.png`;
          await img.clone().extract({ left: j.left, top: j.top, width: j.width, height: j.height })
            .resize(Math.round(j.width * 1.6)).png().toFile(part);
          process.stderr.write(`  复查 ${j.name}（x:${j.left}-${j.left + j.width}, y:${j.top}-${j.top + j.height}）...\n`);
          const { report: d, usage: u } = reviewImagesWithPrompt([part], buildDetailPrompt(),
            `这是整页截图的${j.name}局部放大图。按系统指令输出 JSON。`);
          totalUsage.tokens += u?.total_tokens || 0;
          for (const it of (d.region_issues || [])) {
            it.id = `DET-${String((report.issues || []).length + 1).padStart(2, '0')}`;
            it.source = `局部放大 ${j.name}`;
            it.severity = it.severity === 'critical' ? 'major' : it.severity; // 微观发现不夸大为 critical
            (report.issues = report.issues || []).push(it);
          }
        }
      }
    }
  }

  // 汇总 verdict：出现 critical 即 fail
  const hasCritical = (report.issues || []).some((i) => i.severity === 'critical');
  if (report.verdict !== 'fail' && hasCritical) report.verdict = 'fail';

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const meta = { target, shots: shotPaths, viewports, model: process.env.AGNES_MODEL };
  const md = renderMd(report, meta);
  if (OUT_MD) fs.writeFileSync(OUT_MD, md);
  if (OUT_JSON) {
    fs.writeFileSync(OUT_JSON, JSON.stringify({
      meta: { ...meta, reviewedAt: new Date().toISOString(), totalTokens: totalUsage.tokens || null },
      report
    }, null, 2));
  }
  if (!QUIET) {
    console.log(md);
    console.error(`\n[完成 ${secs}s，tokens: ${totalUsage.tokens}]`);
  } else {
    console.log(`已写入: ${[OUT_MD, OUT_JSON].filter(Boolean).join(', ')}`);
  }
})().catch((e) => { console.error('错误: ' + e.message); process.exit(1); });
