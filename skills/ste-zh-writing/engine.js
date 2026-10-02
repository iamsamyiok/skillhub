// STE-ZH 风格引擎：ASD-STE100 原则的中文落地检查器
// 纯逻辑、无依赖；浏览器与 Node 通用
(function (global) {
  'use strict';

  // ---------- 语料与配置 ----------

  const SLANG = ['搞定', '搞一下', '弄一下', '弄好', '捣鼓', '鼓捣', '凑合', '将就着', '马虎', '随便弄', '立马', '给力', '干货', '踩坑', '翻车', '小伙伴', '老铁', '点赞', '涨知识', '秒杀', '拉黑', '奇葩', '坑爹', '打酱油', '大伙', '咱们'];
  const OLD_STYLE = ['切记', '切忌', '切勿', '谨防', '务须', '倘若', '曰'];
  const DOUBLE_NEG = ['不无', '并非不', '不是不', '未尝不', '莫不', '没有不'];
  const DOUBLE_NEG_SOFT = ['不能不', '不得不'];
  const VAGUE = ['一堆', '少许', '适量', '若干', '大概', '左右', '或多或少'];
  const VERB_START = ['检查', '确认', '测量', '记录', '安装', '拆卸', '拆除', '拆除', '拆下', '装回', '合上', '吊出', '吊装', '搬运', '挂牌', '上锁', '验电', '固定', '连接', '断开', '打开', '关闭', '启动', '停止', '清洁', '清洗', '清理', '冲洗', '吹扫', '试压', '更换', '加注', '排放', '排空', '按压', '拉出', '推入', '旋转', '转动', '拧紧', '松开', '设置', '调节', '调整', '校准', '校验', '比对', '登记', '填写', '涂', '涂抹', '润滑', '密封', '测试', '试验', '标记', '标识', '插入', '拔出', '充气', '放气', '供电', '断电', '开机', '关机', '查看', '核对', '对比', '保留', '保存', '清点', '收集', '移除', '放置', '使用', '佩戴', '准备', '预热', '加热', '冷却', '支撑', '顶起', '锁紧', '解锁', '啮合', '脱开', '接通', '切断', '施加', '释放', '接地', '隔离', '复位', '复查', '抽查', '封堵', '疏通'];
  const CONDITION_START = ['若', '如果', '假如', '当', '如', '一旦', '在'];
  const ACRONYM_WHITELIST = ['IT', 'PC', 'USB', 'LED', 'LCD', 'CPU', 'GPU', 'RAM', 'ROM', 'ISO', 'API', 'URL', 'PDF', 'ID', 'WARNING', 'CAUTION', 'NOTE', 'STE'];

  const UNIT_GROUPS = [
    { dim: '扭矩', forms: ['N·m', 'Nm', '牛·米', '牛米'] },
    { dim: '质量', forms: ['kg', '千克', '公斤'] },
    { dim: '长度-毫米', forms: ['mm', '毫米'] },
    { dim: '长度-厘米', forms: ['cm', '厘米', '公分'] },
    { dim: '长度-米', forms: ['m', '米', '公尺'] },
    { dim: '压力', forms: ['MPa', '兆帕'] }
  ];
  const UNIT_NONSTD = { '公分': '厘米', '公尺': '米', '牛米': 'N·m' };

  const SYNONYM_GROUPS = [
    ['阀门', '阀件'],
    ['螺栓', '螺丝', '螺钉'],
    ['电缆', '线缆'],
    ['按钮', '按键'],
    ['指示灯', '信号灯'],
    ['外壳', '壳体'],
    ['传感器', '感应器'],
    ['显示屏', '屏幕']
  ];

  const SENT_MAX_DESC = 50;   // 描述句字数上限
  const SENT_MAX_STEP = 40;   // 程序句字数上限
  const COMMA_RUN = 5;        // 逗号数达到即视为流水句
  const DE_CHAIN = 3;         // "的"链上限
  const NOUN_RUN = 14;        // 无停顿汉字串长度阈值
  // 虚词表：名词堆叠检测时，含这些字的片段视为有语法停顿
  const FUNC_CHARS = new Set('的了着在和与或及对将把由为被从向按以于地得就也都还又再更很太不没未别是若果话且并后前先才只');

  // 找无虚词的汉字长串（真正的名词堆叠）
  function findNounRuns(text) {
    const out = [];
    const reCjk = /[\u4e00-\u9fa5]+/g;
    let m;
    while ((m = reCjk.exec(text)) !== null) {
      const run = m[0], base = m.index;
      let subStart = 0;
      for (let i = 0; i <= run.length; i++) {
        if (i === run.length || FUNC_CHARS.has(run[i])) {
          if (i - subStart >= NOUN_RUN)
            out.push({ text: run.slice(subStart, i), index: base + subStart });
          subStart = i + 1;
        }
      }
    }
    return out;
  }

  // ---------- 工具 ----------

  function isCJK(ch) {
    const c = ch.codePointAt(0);
    return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf);
  }
  function contentLen(s) {
    let n = 0;
    for (const ch of s) if (isCJK(ch) || /[A-Za-z0-9]/.test(ch)) n++;
    return n;
  }

  // 分句：按 。！？；与换行切分，保留位置
  function splitSentences(text) {
    const out = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if ('。！？；\n'.includes(ch)) {
        if (i > start) out.push({ s: text.slice(start, i), start, end: i });
        start = i + 1;
      }
    }
    if (start < text.length) out.push({ s: text.slice(start), start, end: text.length });
    return out.filter(x => x.s.trim().length > 0);
  }

  // 步骤行判定：行首为数字编号
  function stepLines(text) {
    const set = [];
    text.split('\n').forEach(line => {
      const m = line.match(/^\s*(\d{1,3})[\.、\)]\s*/);
      if (m) {
        const base = text.indexOf(line);
        set.push({ num: +m[1], start: base + m[0].length, end: base + line.length });
      }
    });
    return set;
  }
  function inStep(pos, steps) {
    return steps.some(st => pos >= st.start && pos < st.end);
  }

  function normAcronym(word) {
    // 拉丁字母缩略语（全大写、可含数字）
    return /^[A-Z]{2,8}[0-9]*$/.test(word);
  }

  // ---------- 规则表 ----------

  const RULES = [
    { id: 'L01', cat: '句子', name: '句长超限', sev: '建议' },
    { id: 'L02', cat: '句子', name: '流水句', sev: '提示' },
    { id: 'L03', cat: '语态', name: '被动句式', sev: '建议' },
    { id: 'L04', cat: '动词', name: '冗余名词化', sev: '错误' },
    { id: 'L05', cat: '语态', name: '步骤未动词开头', sev: '建议' },
    { id: 'L06', cat: '名词', name: '"的"链过长', sev: '建议' },
    { id: 'L07', cat: '名词', name: '名词堆叠', sev: '提示' },
    { id: 'L08', cat: '词汇', name: '口语/网络用语', sev: '错误' },
    { id: 'L09', cat: '词汇', name: '旧式/文言词', sev: '建议' },
    { id: 'L10', cat: '词汇', name: '双重否定', sev: '错误' },
    { id: 'L11', cat: '标点', name: '分号连句', sev: '提示' },
    { id: 'L12', cat: '术语', name: '缩略语未定义', sev: '提示' },
    { id: 'L13', cat: '安全', name: '警示格式', sev: '建议' },
    { id: 'L14', cat: '术语', name: '单位不统一/非标准', sev: '建议' },
    { id: 'L15', cat: '术语', name: '同义术语混用', sev: '建议' },
    { id: 'L16', cat: '句子', name: '模糊量词', sev: '提示' },
    { id: 'L17', cat: '标点', name: '括号内容过长', sev: '提示' }
  ];
  const RULE_MAP = {};
  RULES.forEach(r => RULE_MAP[r.id] = r);

  // ---------- 主检查 ----------

  function analyze(text) {
    const V = [];
    const push = (id, start, end, matched, fix, detail) => {
      const r = RULE_MAP[id];
      V.push({ id, name: r.name, cat: r.cat, sev: r.sev, start, end, matched, fix, detail: detail || '' });
    };

    const sents = splitSentences(text);
    const steps = stepLines(text);

    // L01 句长 / L02 流水句 / L06 的链
    sents.forEach(({ s, start }) => {
      const len = contentLen(s);
      const limit = inStep(start, steps) ? SENT_MAX_STEP : SENT_MAX_DESC;
      if (len > limit)
        push('L01', start, start + s.length, s.trim().slice(0, 30) + '…',
          `本句 ${len} 字，超过 ${limit} 字上限。拆成多句，一句一事。`);
      const commas = (s.match(/[,，、]/g) || []).length;
      if (commas >= COMMA_RUN)
        push('L02', start, start + s.length, s.trim().slice(0, 30) + '…',
          `本句含 ${commas} 个逗号，是典型流水句。在语义换挡处改用句号断句。`);
      const deCount = (s.match(/的/g) || []).length;
      if (deCount >= DE_CHAIN)
        push('L06', start, start + s.length, s.trim().slice(0, 30) + '…',
          `本句出现 ${deCount} 个"的"。"的"链超过 2 层时，把长定语拆成短句或列表。`);
    });

    // L07 名词堆叠：不含虚词的无停顿汉字长串
    findNounRuns(text).forEach(r =>
      push('L07', r.index, r.index + r.text.length, r.text.slice(0, 20) + (r.text.length > 20 ? '…' : ''),
        '疑似名词堆叠。连续 14 字以上无虚词停顿，多半是部件名层层叠加。用"的"或介词拆分，或收入术语表统一命名。'));

    // L03 被动句式
    let m;
    const rePassive = /((?:由|为)[\u4e00-\u9fa5]{1,24}?(?:完成|实施|执行|进行|检查|操作|确认|负责)|[\u4e00-\u9fa5]{1,10}被[\u4e00-\u9fa5]{1,10}?(?:完成|实施|执行|关闭|打开|拆卸|安装|确认|检查))/g;
    while ((m = rePassive.exec(text)) !== null) {
      push('L03', m.index, m.index + m[0].length, m[0],
        '改写为主动句：把施动者放主语、动词开头。如"由维修人员对管路实施检查"改为"维修人员检查管路"。');
    }
    const reWeiSuo = /为[\u4e00-\u9fa5]{1,8}所[\u4e00-\u9fa5]{1,6}/g;
    while ((m = reWeiSuo.exec(text)) !== null)
      push('L03', m.index, m.index + m[0].length, m[0], '"为……所……"是文言被动式，改为主动陈述。');

    // L04 冗余名词化
    const reNom1 = /(对|将|把)([^，。；！？、]{1,15}?)(进行|实施)([^，。；！？]{0,12})?/g;
    while ((m = reNom1.exec(text)) !== null) {
      push('L04', m.index, m.index + m[0].length, m[0],
        `直接用动词："${m[0]}"改为"动词 + 宾语"，如"对阀门进行关闭操作"改为"关闭阀门"。`);
    }
    const reNom2 = /(予以|加以)[\u4e00-\u9fa5]{1,8}/g;
    while ((m = reNom2.exec(text)) !== null)
      push('L04', m.index, m.index + m[0].length, m[0], '"予以/加以 + 动词"是公文冗余，直接写动词：予以确认 -> 确认。');
    const reNom3 = /做出([^，。；！？]{1,8}?)(决定|总结|分析|改进|调整|优化|说明)/g;
    while ((m = reNom3.exec(text)) !== null)
      push('L04', m.index, m.index + m[0].length, m[0], `"做出 + 名词"改用动词直说："做出${m[2]}"改为"${m[2]}"，并删掉多余的介词结构。`);

    // L05 步骤未动词开头 / 请字开头
    steps.forEach(st => {
      const seg = text.slice(st.start, st.end);
      const head = seg.trim().slice(0, 4);
      if (/^请/.test(head)) {
        push('L05', st.start, st.start + Math.min(seg.length, 12), head + '…',
          '技术步骤不用敬语，删掉"请"，直接以动词开头。');
        return;
      }
      const startsVerb = VERB_START.some(v => head.startsWith(v));
      const startsCond = CONDITION_START.some(c => head.startsWith(c));
      if (!startsVerb && !startsCond)
        push('L05', st.start, st.start + Math.min(seg.length, 12), head + '…',
          `步骤建议以动作动词开头（如：检查、断开、拧紧），或以"若/当"开头的条件句。当前开头："${head}"。`);
    });

    // L08 口语网络语 / L09 旧式词 / L10 双重否定 / L16 模糊量词
    SLANG.forEach(w => {
      let i = -1;
      while ((i = text.indexOf(w, i + 1)) !== -1)
        push('L08', i, i + w.length, w, `"${w}"是口语/网络用语，换用规范表达。`);
    });
    OLD_STYLE.forEach(w => {
      let i = -1;
      while ((i = text.indexOf(w, i + 1)) !== -1)
        push('L09', i, i + w.length, w, `"${w}"是旧式/文言措辞，统一用"不要/严禁/防止"。`);
    });
    DOUBLE_NEG.forEach(w => {
      let i = -1;
      while ((i = text.indexOf(w, i + 1)) !== -1)
        push('L10', i, i + w.length, w, `双重否定（${w}）改为直接肯定或直接否定。`);
    });
    DOUBLE_NEG_SOFT.forEach(w => {
      let i = -1;
      while ((i = text.indexOf(w, i + 1)) !== -1)
        push('L10', i, i + w.length, w, `"${w}"可用时尽量改为肯定式（"必须检查"而非"不得不检查"）。`);
    });
    VAGUE.forEach(w => {
      let i = -1;
      while ((i = text.indexOf(w, i + 1)) !== -1)
        push('L16', i, i + w.length, w, `技术程序中"${w}"不够精确，改为具体数量或范围。`);
    });

    // L11 分号连句
    let si = -1;
    while ((si = text.indexOf('；', si + 1)) !== -1) {
      const before = text.slice(Math.max(0, si - 10), si);
      const after = text.slice(si + 1, si + 11);
      if (/[\u4e00-\u9fa5]/.test(before) && /[\u4e00-\u9fa5]/.test(after))
        push('L11', Math.max(0, si - 10), si + 11, before + '；' + after,
          '分号两侧都是完整表述时，改成两句。分号不用于连接独立句。');
    }

    // L12 缩略语首现未定义
    const acrSeen = {};
    const reAcr = /[A-Z]{2,8}[0-9]*/g;
    while ((m = reAcr.exec(text)) !== null) {
      const w = m[0];
      if (ACRONYM_WHITELIST.includes(w)) continue;
      if (acrSeen[w]) continue;
      // 定义形式：（XXX） / (XXX) / 简称XXX
      const defined = new RegExp('（[^）]*' + w + '[^）]*）|\\([^)]*' + w + '[^)]*\\)|简称' + w).test(text);
      acrSeen[w] = true;
      if (!defined)
        push('L12', m.index, m.index + w.length, w,
          `缩略语"${w}"首次出现应给出全称，格式：中文全称（${w}）。`);
    }

    // L13 警示格式
    const reXiaoxin = /^[ \t]*(小心|当心|注意安全)[，,]?[\u4e00-\u9fa5]{0,12}/gm;
    while ((m = reXiaoxin.exec(text)) !== null)
      push('L13', m.index, m.index + m[0].length, m[0].trim(),
        '使用三级信号词并写明后果：警告（人身伤害）/注意（设备损伤）/说明（补充信息）。如"警告：触碰排气管可致烫伤。"');
    const hasZhSignal = /(警告|注意|说明)/.test(text);
    const hasEnSignal = /\b(WARNING|CAUTION|NOTE)\b/.test(text);
    if (hasZhSignal && hasEnSignal)
      push('L13', 0, 0, '全文', '中英文信号词混用（警告/WARNING）。全文统一使用中文信号词：警告、注意、说明。', 'consistency');
    const reSignalFmt = /^[ \t]*(警告|注意|说明)(?!：|:|\s*$)/gm;
    while ((m = reSignalFmt.exec(text)) !== null)
      push('L13', m.index, m.index + m[0].length, m[0].trim(),
        '信号词后加冒号并独立成行：如"警告："另起一行接正文。');

    // L14 单位
    for (const k in UNIT_NONSTD) {
      let i = -1;
      while ((i = text.indexOf(k, i + 1)) !== -1)
        push('L14', i, i + k.length, k, `非标准单位"${k}"，改为"${UNIT_NONSTD[k]}"。`);
    }
    // 单位符号匹配：拉丁字母单位要求前后都不是字母/数字（避免 N·m 里的 m 误报）
    function unitPos(text, form) {
      if (/^[A-Za-z]/.test(form)) {
        const re = new RegExp('(^|[^A-Za-z0-9·.])(' + form.replace(/[·.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![A-Za-z0-9])');
        const mm = text.match(re);
        return mm ? text.indexOf(mm[2], mm.index + mm[1].length) : -1;
      }
      return text.indexOf(form);
    }
    UNIT_GROUPS.forEach(g => {
      const found = g.forms.filter(f => unitPos(text, f) !== -1);
      if (found.length >= 2) {
        const p = unitPos(text, found[0]);
        push('L14', p, p + found[0].length,
          found.join(' / '), `${g.dim}单位出现多种写法：${found.join('、')}。全文统一为一种（推荐 ${g.forms[0]}）。`, 'consistency');
      }
    });

    // L15 同义术语混用
    SYNONYM_GROUPS.forEach(g => {
      const found = g.filter(w => text.includes(w));
      if (found.length >= 2) {
        const i = text.indexOf(found[1]);
        push('L15', i, i + found[1].length, found.join(' / '),
          `${found.map(w => '"' + w + '"').join('与')}指同类对象但用词不一。选定一个写法全文统一（技术文档中一词一物）。`, 'consistency');
      }
    });

    // L17 括号过长
    const reParen = /（[^）]{20,}）/g;
    while ((m = reParen.exec(text)) !== null)
      push('L17', m.index, m.index + m[0].length, m[0].slice(0, 16) + '…',
        '括号只放缩略语展开、等价术语或单位换算。过长的补充说明移出括号，另起一句。');

    // ---------- 评分 ----------
    const weight = { '错误': 3, '建议': 1.5, '提示': 0.5 };
    const chars = contentLen(text) || 1;
    let penalty = 0;
    V.forEach(v => penalty += weight[v.sev]);
    penalty = penalty * 500 / chars;               // 每千字（500字）归一
    const score = Math.max(0, Math.round(100 - penalty));
    const grade = score >= 90 ? '优秀' : score >= 75 ? '良好' : score >= 60 ? '及格' : '需修改';

    V.sort((a, b) => a.start - b.start || a.end - b.end);
    return {
      score, grade,
      stats: { chars, sentences: sents.length, steps: steps.length, issues: V.length },
      violations: V
    };
  }

  const API = { analyze, RULES, SENT_MAX_DESC, SENT_MAX_STEP };
  global.SteZh = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
