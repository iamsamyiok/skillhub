#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""SkillManager — 技能管理器(标准Skill执行引擎)
无侵入:只读写各技能 SKILL.md 内的托管数据块(HTML注释)与全局索引MD,不改任何Agent逻辑
存储:全部为 MD 文件(全局索引 ~/.skillmanager/index.md),无外部服务

子命令:
  refresh                     扫描技能目录→更新全局索引 + 高频问题更新建议
  suggest --task "任务描述"    手动触发技能组合建议(采纳才挂回调)
  run <技能名> -- <命令...>    临时回调包装器:计时/状态/报错 写入单技能MD+全局索引
  archive <技能名> <on|off>    设置归档标记(仅建议列表隐藏,不影响Agent调用)
  stats [技能名]               查看统计
  dashboard                    生成静态HTML仪表盘(排序/筛选,数据全来自MD)

skillhub 集成(v1.1, 配合"skillhub优先"工作流):
  hub-search <关键词>           搜索 skillhub 上的技能(名称+描述)
  hub-install <名称> [--force]  从 skillhub 安装技能到 ~/.agents/skills/(带来源标记)
  hub-outdated                  检查 hub 安装的技能是否有更新(按 blob sha 比对)
  hub-publish <名称> [--dry-run] 发布本地技能到 skillhub
"""
import sys, os, re, json, time, argparse, subprocess
from pathlib import Path
from collections import Counter
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HOME = Path.home()
SM_DIR = HOME / ".skillmanager"
INDEX_MD = SM_DIR / "index.md"
MANAGED_BEGIN = "<!-- skillmanager:v1"
MANAGED_END = "skillmanager:v1 -->"
NL = chr(10)
DEFAULT_ROOTS = [HOME / ".agents" / "skills", HOME / ".zcode" / "skills", HOME / ".claude" / "skills"]
ERROR_PAT_KEEP = 3
RECENT_KEEP = 60

def now_str():
    return datetime.now().strftime("%Y-%m-%dT%H:%M")

# ---------------- SKILL.md 托管块读写 ----------------

def read_managed(skill_md_path):
    default = {"schema": "v1", "archived": False, "tags": [], "runs": 0, "ok": 0, "fail": 0,
               "total_sec": 0.0, "avg_sec": 0.0, "last_sec": 0.0, "last": "", "last_status": "",
               "top_errors": [], "first": "", "updated": ""}
    try:
        text = Path(skill_md_path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return dict(default)
    m = re.search(re.escape(MANAGED_BEGIN) + r"\s*(\{.*?\})\s*" + re.escape(MANAGED_END), text, re.S)
    if not m:
        return dict(default)
    try:
        d = json.loads(m.group(1))
        base = dict(default); base.update(d)
        return base
    except Exception:
        return dict(default)

def write_managed(skill_md_path, data):
    p = Path(skill_md_path)
    text = p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""
    block = MANAGED_BEGIN + NL + json.dumps(data, ensure_ascii=False, indent=1) + NL + MANAGED_END
    pat = re.compile(re.escape(MANAGED_BEGIN) + r"\s*\{.*?\}\s*" + re.escape(MANAGED_END), re.S)
    if pat.search(text):
        text = pat.sub(lambda _: block, text, count=1)
    else:
        text = (text.rstrip() + NL + NL + block + NL) if text.strip() else block + NL
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")

# ---------------- 技能目录扫描 ----------------

def scan_roots(extra=None):
    roots = [HOME / ".agents" / "skills", HOME / ".zcode" / "skills", HOME / ".claude" / "skills",
             Path.cwd() / ".agents" / "skills", Path.cwd() / ".zcode" / "skills", Path.cwd() / "skills"]
    if extra: roots.append(Path(extra))
    return [r for r in roots if r.is_dir()]

def find_all_skills(extra_root=None):
    out, seen = [], set()
    for root in scan_roots(extra_root):
        try:
            for d in sorted(root.iterdir()):
                if not d.is_dir(): continue
                sm = d / "SKILL.md"
                if sm.exists() and d.name not in seen:
                    seen.add(d.name)
                    out.append((d.name, sm, root))
        except OSError:
            continue
    return out

def find_skill_md(name):
    for n, sm, root in find_all_skills():
        if n == name: return sm
    return None

def parse_frontmatter(p):
    try:
        text = Path(p).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}
    m = re.match(r"^---\s*" + NL + r"([\s\S]*?)\n---", text)
    if not m: return {}
    fm = {}
    for line in m.group(1).split(NL):
        mm = re.match(r"^(\w[\w-]*):\s*(.*)$", line)
        if mm:
            k, v = mm.group(1), mm.group(2).strip()
            if v.startswith("[") and v.endswith("]"):
                v = [x.strip(" '\"") for x in v[1:-1].split(",") if x.strip()]
            fm[k] = v
    return fm

def load_all_stats():
    out = []
    for name, sm, root in find_all_skills():
        fm = parse_frontmatter(sm) or {}
        d = read_managed(sm) or {}
        tags = fm.get("tags") or d.get("tags") or []
        if isinstance(tags, str): tags = [tags]
        out.append({"name": str(name), "path": str(sm), "root": str(root),
                    "desc": str(fm.get("description", "")),
                    "tags": tags, "managed": d})
    return out

def norm_error(line):
    s = re.sub(r"\d+", "N", line)
    s = re.sub(r"[A-Za-z]:[\\\\/][^\s,;]*", "<path>", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:80]

# ---------------- 全局索引MD ----------------

def append_global_log(name, sec, ok, error_line):
    SM_DIR.mkdir(parents=True, exist_ok=True)
    line = "| " + now_str() + " | " + name + " | {:.1f} | {} | {} |".format(
        sec, "成功" if ok else "失败", (error_line or "-")[:60])
    text = INDEX_MD.read_text(encoding="utf-8", errors="replace") if INDEX_MD.exists() else ""
    marker = "## 运行日志"
    if marker in text:
        lines = text.split(NL)
        idx = next(i for i, l in enumerate(lines) if l.startswith(marker))
        lines.insert(idx + 2, line)
        text = NL.join(lines)
    else:
        text = (text.rstrip() + NL + NL + marker + NL + "| 时间 | 技能 | 耗时s | 状态 | 报错 |"
                + NL + "|---|---|---|---|---|" + NL + line + NL)
    INDEX_MD.write_text(text, encoding="utf-8")

def record_run(name, skill_md, sec, ok, error_line):
    d = read_managed(skill_md)
    if not d.get("first"): d["first"] = now_str()
    d["runs"] = d.get("runs", 0) + 1
    d["ok" if ok else "fail"] = d.get("ok" if ok else "fail", 0) + 1
    d["total_sec"] = round(d.get("total_sec", 0.0) + sec, 2)
    d["avg_sec"] = round(d["total_sec"] / d["runs"], 2)
    d["last_sec"] = round(sec, 2)
    d["last"] = now_str()
    d["last_status"] = "成功" if ok else "失败"
    d["updated"] = d["last"]
    if not ok and error_line:
        pat = re.sub(r"\d+", "N", error_line)[:80]
        tops = {e["pat"]: e["n"] for e in d.get("top_errors", [])}
        tops[pat] = tops.get(pat, 0) + 1
        d["top_errors"] = [{"pat": k, "n": v} for k, v in sorted(tops.items(), key=lambda kv: -kv[1])[:ERROR_PAT_KEEP]]
    write_managed(skill_md, d)
    append_global_log(name, sec, ok, error_line)

# ---------------- refresh ----------------

def cmd_refresh(args):
    skills = load_all_stats()
    if not skills:
        print("未扫描到技能。检查目录: " + ", ".join(str(r) for r in scan_roots()))
        return
    rows = ["| 技能 | 标签 | 归档 | 总次数 | 成功率 | 平均耗时 | 最近调用 |",
            "|---|---|---|---|---|---|---|"]
    suggestions = []
    for s in sorted(skills, key=lambda x: x["name"]):
        d = s["managed"]
        rate = ("{:.0f}%".format(d["ok"] * 100 / d["runs"]) if d.get("runs") else "-")
        tags = ",".join(s["tags"]) if s["tags"] else "-"
        cells = [str(s["name"]), str(tags), str(d.get("archived", False)),
                 str(d.get("runs", 0) or 0), str(rate), str(d.get("avg_sec", 0) or 0) + "s",
                 str(d.get("last", "-") or "-")]
        rows.append("| " + " | ".join(cells) + " |")
        if d.get("runs", 0) >= 3:
            fr = d.get("fail", 0) * 100 // d["runs"]
            if fr >= 30:
                top = "、".join(e["pat"] + "x" + str(e["n"]) for e in d.get("top_errors", [])[:2]) or "无报错详情"
                suggestions.append("更新建议: " + s["name"] + " — 失败率" + str(fr) + "% (高频: " + top + ") — 建议排查依赖或更新文档")
        if d.get("runs", 0) >= 5 and d.get("avg_sec", 0) > 120:
            suggestions.append("性能建议: " + s["name"] + " — 平均耗时" + str(d["avg_sec"]) + "s,建议拆分步骤或加缓存")
    text = ("# SkillManager 全局技能索引" + NL + NL
            + "> 生成于 " + now_str() + " · 技能 " + str(len(skills)) + " 个 · 数据来源: 各技能 SKILL.md 托管块(仅MD存储)" + NL + NL
            + "## 技能清单" + NL + NL + NL.join(rows) + NL)
    if suggestions:
        text += NL + "## 高频问题更新建议" + NL + NL + NL.join("- " + s for s in suggestions) + NL
    INDEX_MD.parent.mkdir(parents=True, exist_ok=True)
    INDEX_MD.write_text(text, encoding="utf-8")
    print("全局索引已更新: " + str(INDEX_MD) + " (" + str(len(skills)) + " 个技能, " + str(len(suggestions)) + " 条建议)")

# ---------------- suggest / adopt ----------------

def tokens(task):
    out = []
    for run in re.findall(r"[A-Za-z0-9]+|[\u4e00-\u9fff]+", task):
        if re.match(r"[\u4e00-\u9fff]", run[0]):
            for i in range(len(run) - 1):
                out.append(run[i:i + 2])
            out.append(run)
        else:
            out.append(run.lower())
    return [t for t in out if len(t) >= 2]

def cmd_suggest(args):
    skills = load_all_stats()
    tk = tokens(args.task)
    scored = []
    for s in skills:
        if s["managed"].get("archived"): continue
        text = (s["name"] + " " + s["desc"] + " " + " ".join(s["tags"])).lower()
        score = sum(len(t) for t in tk if t in text)
        if score: scored.append((score, s))
    scored.sort(key=lambda x: -x[0])
    if not scored:
        print("没有匹配的技能(任务: " + args.task + ")"); return
    print("=== 技能组合建议(按匹配度排序) ===")
    chain = []
    for score, s in scored[:min(5, len(scored))]:
        print("[" + str(score) + "] " + s["name"])
        chain.append(s["name"])
    print(NL + "建议执行链: " + " → ".join(chain))
    print(NL + "确认采纳后,为执行链挂临时回调的命令(每次运行自动记录 耗时/状态/报错 到单技能MD+全局索引):")
    for name in chain:
        print('  python "' + str(Path(__file__).resolve()) + '" run "' + name + '" -- <该技能的实际执行命令>')
    print("临时回调仅在本次执行链生效;记录永久保留在MD文件中。")

def cmd_adopt(args):
    chain = [x.strip() for x in args.chain.replace("→", ",").replace("->", ",").split(",") if x.strip()]
    print("=== 执行链(挂临时回调后的版本) ===")
    for name in chain:
        print('python "' + str(Path(__file__).resolve()) + '" run "' + name + '" -- <该技能的实际执行命令>')
    print(NL + "逐条执行即可;每次运行自动记录 耗时/状态/报错 到对应单技能MD与全局索引。")

# ---------------- run / archive / dashboard / stats ----------------

def cmd_run(args):
    name = args.skill
    sm = find_skill_md(name)
    if not sm:
        print("未找到技能: " + name + " (先 refresh 扫描)"); return 2
    cmd = args.cmd
    if not cmd:
        print("缺少要执行的命令"); return 2
    t0 = time.time()
    try:
        rc = subprocess.call(cmd)
        ok = rc == 0
        err = "" if ok else "退出码 " + str(rc)
    except OSError as e:
        ok = False; err = str(e)[:80]; rc = 127
    sec = time.time() - t0
    record_run(name, sm, sec, ok, err)
    print("[SkillManager] " + name + " | " + ("成功" if ok else "失败") + " | {:.1f}s | {}".format(sec, err[:60] if err else "-"))
    return 0 if ok else 1

def cmd_archive(args):
    name, onoff = args.skill, args.state
    sm = find_skill_md(name)
    if not sm:
        print("未找到技能: " + name); return 2
    d = read_managed(sm)
    d["archived"] = (onoff == "on")
    d["updated"] = now_str()
    write_managed(sm, d)
    print(name + ": 归档=" + str(d["archived"]) + " (仅影响建议列表,不影响Agent调用)")

def parse_global_log():
    if not INDEX_MD.exists(): return []
    rows = []
    for line in INDEX_MD.read_text(encoding="utf-8", errors="replace").split(NL):
        if line.startswith("| 2"):
            cells = [x.strip() for x in line.strip("|").split("|")]
            if len(cells) >= 5:
                rows.append({"time": cells[0], "skill": cells[1], "sec": cells[2],
                             "status": cells[3], "error": cells[4]})
    return rows

DASH_TEMPLATE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>SkillManager 仪表盘</title>
<style>
body{background:#0b0e17;color:#e6edf3;font-family:"Microsoft YaHei",sans-serif;margin:0;padding:24px}
h1{font-size:22px}.cards{display:flex;gap:14px;flex-wrap:wrap;margin:16px 0}
.card{background:#131824;border:1px solid #263042;border-radius:12px;padding:14px 20px;min-width:130px}
.card .v{font-size:26px;font-weight:800;color:#3fb950}.card .k{color:#8b93a3;font-size:12px;margin-top:4px}
table{border-collapse:collapse;width:100%;margin-top:12px;font-size:14px}
th,td{border:1px solid #263042;padding:8px 10px;text-align:left}
th{background:#131824;color:#58a6ff;cursor:pointer;user-select:none}
input,select{background:#0b0e17;color:#e6edf3;border:1px solid #263042;border-radius:8px;padding:8px 12px;font-size:14px;margin:8px 8px 8px 0}
h2{font-size:16px;color:#58a6ff;margin:28px 0 8px}
</style></head><body>
<h1>SkillManager 技能仪表盘</h1>
<div>数据来源: 各技能 SKILL.md 托管块 + 全局索引MD · 生成于 __GENERATED__</div>
<div class="cards">
<div class="card"><div class="v">__N_SKILLS__</div><div class="k">技能总数</div></div>
<div class="card"><div class="v">__N_RUNS__</div><div class="k">总调用次数</div></div>
<div class="card"><div class="v">__N_OK__</div><div class="k">成功</div></div>
<div class="card"><div class="v">__RATE__</div><div class="k">成功率</div></div>
<div class="card"><div class="v">__N_ARCH__</div><div class="k">已归档</div></div>
</div>
<h2>技能统计</h2>
<div>
归档: <select id="fArch"><option value="">全部</option><option value="0">活跃</option><option value="1">已归档</option></select>
标签: <input id="fTag" placeholder="输入标签筛选" size="12">
搜索: <input id="fText" placeholder="名称/描述" size="16">
</div>
<table id="tbl"><thead><tr>
<th data-k="name">技能</th><th data-k="tags_s">标签</th><th data-k="runs">调用</th>
<th data-k="ok">成功</th><th data-k="fail">失败</th><th data-k="rate_s">成功率</th>
<th data-k="avg_sec">平均耗时s</th><th data-k="last">最近调用</th><th data-k="top_s">高频报错</th>
</tr></thead><tbody id="tbody"></tbody></table>
<h2>运行日志(最近 __LOGN__ 条)</h2>
<table id="logtbl" border="1" style="border-collapse:collapse;font-size:13px"><thead><tr>
<th>时间</th><th>技能</th><th>耗时s</th><th>状态</th><th>报错</th></tr></thead><tbody id="logbody"></tbody></table>
<script>
const DATA = __DATA_JSON__;
const $=id=>document.getElementById(id);
function renderSkills(){
  const arch=$('fArch').value, tag=$('fTag').value.trim().toLowerCase(), txt=$('fText').value.trim().toLowerCase();
  const tb=$('tbody'); tb.innerHTML='';
  DATA.skills.filter(s=>{
    if(arch==='1'&&!s.archived)return false;
    if(arch==='0'&&s.archived)return false;
    if(tag&&!(s.tags_s||'').toLowerCase().includes(tag))return false;
    if(txt&&!(s.name+' '+(s.desc||'')).toLowerCase().includes(txt))return false;
    return true;
  }).forEach(s=>{
    const tr=document.createElement('tr');
    if(s.archived)tr.className='archived';
    tr.innerHTML='<td>'+s.name+'</td><td>'+(s.tags_s||'-')+'</td><td>'+s.runs+'</td><td>'+s.ok+
      '</td><td>'+s.fail+'</td><td>'+(s.rate_s||'-')+'</td><td>'+(s.avg_sec??'-')+'</td><td>'+(s.last||'-')+
      '</td><td>'+(s.top_s||'-')+'</td>';
    tb.appendChild(tr);
  });
}
$('fArch').onchange=renderSkills;$('fTag').oninput=renderSkills;$('fText').oninput=renderSkills;
document.querySelectorAll('#tbl th').forEach(th=>th.onclick=()=>{
  const k=th.dataset.k, tb=$('tbody');
  const rows=[...tb.rows].sort((a,b)=>{
    const x=a.children[th.cellIndex].textContent, y=b.children[th.cellIndex].textContent;
    const nx=parseFloat(x.replace(/[^\\d.]/g,'')), ny=parseFloat(y.replace(/[^\\d.]/g,''));
    const cmp=(!isNaN(nx)&&!isNaN(ny))?nx-ny:x.localeCompare(y);
    return th.asc?cmp:-cmp;
  });
  th.asc=!th.asc; rows.forEach(r=>tb.appendChild(r));
});
(function(){
  const tb=$('logbody');
  (DATA.log||[]).forEach(r=>{
    const tr=document.createElement('tr');
    [r.time,r.skill,r.sec,r.status,r.error].forEach(v=>{
      const td=document.createElement('td');td.textContent=v??'';tr.appendChild(td);});
    tb.appendChild(tr);
  });
})();
renderSkills();
</script></body></html>
"""

def cmd_dashboard(args):
    skills = load_all_stats()
    log_rows = parse_global_log()
    n_runs = sum(s["managed"].get("runs", 0) for s in skills)
    n_ok = sum(s["managed"].get("ok", 0) for s in skills)
    n_arch = sum(1 for s in skills if s["managed"].get("archived"))
    data = {"skills": [], "log": log_rows[:100]}
    for s in skills:
        d = s["managed"]
        data["skills"].append({
            "name": s["name"], "desc": s["desc"][:50],
            "tags_s": ",".join(s["tags"]) if s["tags"] else "-", "tags": s["tags"],
            "archived": bool(d.get("archived")),
            "runs": d.get("runs", 0), "ok": d.get("ok", 0), "fail": d.get("fail", 0),
            "avg_sec": d.get("avg_sec", 0),
            "rate_s": ("{:.0f}%".format(d["ok"] * 100 / d["runs"]) if d.get("runs") else "-"),
            "last": d.get("last", "-"),
            "top_s": "、".join(e["pat"] + "×" + str(e["n"]) for e in d.get("top_errors", [])[:2]) or "-",
        })
    html = (DASH_TEMPLATE
            .replace("__DATA_JSON__", json.dumps(data, ensure_ascii=False))
            .replace("__GENERATED__", now_str())
            .replace("__N_SKILLS__", str(len(skills)))
            .replace("__N_RUNS__", str(n_runs))
            .replace("__N_OK__", str(n_ok))
            .replace("__RATE__", ("{:.0f}%".format(n_ok * 100 / n_runs) if n_runs else "-"))
            .replace("__N_ARCH__", str(n_arch))
            .replace("__LOGN__", str(min(100, len(log_rows)))))
    out = SM_DIR / "dashboard.html"
    SM_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print("仪表盘已生成: {} ({} 技能, {} 条日志)".format(out, len(skills), len(log_rows)))
    print("用浏览器打开即可查看(支持按指标排序、按归档/标签筛选)")

def cmd_stats(args):
    if args.skill:
        for s in load_all_stats():
            if s["name"] == args.skill:
                print(json.dumps(s["managed"], ensure_ascii=False, indent=1))
                return
        print("未找到: " + args.skill)
    else:
        for s in load_all_stats():
            d = s["managed"]
            print("{:<28} 调用{:<4} 成功率{:<6} 平均{}s 归档{}".format(
                s["name"], d.get("runs", 0),
                ("{:.0f}%".format(d["ok"] * 100 / d["runs"]) if d.get("runs") else "-"),
                d.get("avg_sec", "-"), "是" if d.get("archived") else "否"))



# ---------------- skillhub 集成(v1.1) ----------------
HUB_REPO = os.environ.get("SKILLHUB_REPO", "iamsamyiok/skillhub")
_TREE_CACHE = {}

def _gh_json(path):
    r = subprocess.run(["gh", "api", path], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip()[:300] or ("gh api 失败: " + path))
    return json.loads(r.stdout)

def _hub_tree():
    if "t" not in _TREE_CACHE:
        # 网络抖动防护: 本机代理偶发返回 rc=0 但空体的响应,连续3次重试
        for attempt in range(3):
            t = _gh_json("repos/%s/git/trees/main?recursive=1" % HUB_REPO)
            tree = t.get("tree") or []
            if tree:
                _TREE_CACHE["t"] = tree
                break
            time.sleep(2 * (attempt + 1))
        else:
            raise RuntimeError("hub tree 连续3次为空(网络抖动),请稍后重试")
    return _TREE_CACHE["t"]

def cmd_hub_search(a):
    kw = a.keyword.lower()
    names = sorted({p["path"].split("/")[1] for p in _hub_tree()
                    if "/SKILL.md" in p["path"]})
    hits = [n for n in names if kw in n.lower()]
    if hits:
        for n in hits[:15]:
            print("·", n)
        return
    import time as _t
    hits = []
    for n in names:
        try:
            d = _gh_json("repos/%s/contents/skills/%s/SKILL.md" % (HUB_REPO, n))
            import base64
            raw = d.get("content", "")
            if not raw:
                print("  ? 空响应,跳过", n, flush=True)
            else:
                txt = base64.b64decode(raw).decode("utf-8", "replace").lower()
                if kw in txt:
                    hits.append(n)
                    print("·", n, "(描述命中)", flush=True)
        except Exception:
            _t.sleep(2)                     # 触发限流:退避后重试一次
            try:
                d = _gh_json("repos/%s/contents/skills/%s/SKILL.md" % (HUB_REPO, n))
                import base64
                txt = base64.b64decode(d.get("content", "")).decode("utf-8", "replace").lower()
                if kw in txt:
                    hits.append(n)
                    print("·", n, "(描述命中)", flush=True)
            except Exception:
                print("  ? 跳过", n, flush=True)
        _t.sleep(0.5)                       # 节流:防 GitHub 二级限流(35 连发必触发)
    if not hits:
        print("(名称与描述均无命中)")

def cmd_hub_install(a):
    name = a.name
    dest = HOME / ".agents" / "skills" / name
    if dest.exists() and not a.force:
        print("本地已存在 %s(--force 可覆盖)" % dest); return
    prefix = "skills/" + name + "/"
    files = [(x["path"], x.get("sha")) for x in _hub_tree()
             if x["path"].startswith(prefix) and x.get("type") == "blob"]
    if not files:
        print("skillhub 上没有 %s" % prefix); return
    import base64
    dest.mkdir(parents=True, exist_ok=True)
    files_map = {}
    for p, sha in files:
        rel = p[len(prefix):]
        info = _gh_json("repos/%s/contents/%s" % (HUB_REPO, p))
        outp = dest / rel
        outp.parent.mkdir(parents=True, exist_ok=True)
        outp.write_bytes(base64.b64decode(info.get("content", "")))
        files_map[rel] = sha
        print("↓", rel)
    (dest / ".skillhub.json").write_text(json.dumps(
        {"name": name, "commit": _gh_json("repos/%s/commits/main" % HUB_REPO)["sha"],
         "installed": now_str(), "files": files_map}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("安装完成 →", dest)

def cmd_hub_outdated(a):
    rows = []
    for root in DEFAULT_ROOTS:
        for marker in sorted(root.glob("*/.skillhub.json")):
            try:
                m = json.loads(marker.read_text(encoding="utf-8"))
            except Exception:
                continue
            name = m.get("name")
            if not name:
                continue                                   # 非本工具安装的标记,跳过
            files = m.get("files") or {}
            shas = {x["path"]: x.get("sha") for x in _hub_tree()
                    if x["path"].startswith("skills/%s/" % name)}
            changed = [rel for rel, sha in files.items()
                       if shas.get("skills/%s/%s" % (name, rel)) != sha]
            rows.append((name, changed))
    if not rows:
        print("(本机没有 hub 安装的技能——先 hub-install)"); return
    for name, changed in rows:
        if changed:
            print("· %s → 可更新(%d 个文件变动)" % (name, len(changed)))
            for c in changed[:6]: print("    ~", c)
        else:
            print("· %s → 最新" % name)

def cmd_hub_publish(a):
    src = None
    for root in DEFAULT_ROOTS:
        cand = root / a.name
        if (cand / "SKILL.md").exists():
            src = cand; break
    if src is None:
        print("本地找不到技能: %s" % a.name); return
    name = a.name
    files = []
    for f in sorted(src.rglob("*")):
        if f.is_file():
            rel = f.relative_to(src).as_posix()
            if rel.startswith(".skillhub") or "__pycache__" in rel or rel.endswith(".pyc"):
                continue
            files.append((rel, f))
    print("[hub-publish] 来源 %s, %d 个文件" % (src, len(files)))
    if a.dry_run:
        for rel, _ in files: print("   ", rel)
        print("(dry-run 结束,去掉 --dry-run 实际发布)"); return
    import base64
    tmp = SM_DIR / "payload.json"
    ok = 0
    for rel, f in files:
        payload = {"message": "skill: publish %s (%s)" % (name, rel),
                   "content": base64.b64encode(f.read_bytes()).decode()}
        path = "skills/%s/%s" % (name, rel)
        r = subprocess.run(["gh", "api", "repos/%s/contents/%s" % (HUB_REPO, path)],
                           capture_output=True, text=True)
        if r.returncode == 0:
            try: payload["sha"] = json.loads(r.stdout)["sha"]
            except Exception: pass
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        rr = subprocess.run(["gh", "api", "-X", "PUT", "repos/%s/contents/%s" % (HUB_REPO, path),
                             "--input", str(tmp)], capture_output=True, text=True)
        if rr.returncode == 0:
            ok += 1; print("↑", rel)
        else:
            print("✗", rel, (rr.stderr or "")[:150])
    print("发布完成 %d/%d → github.com/%s/tree/main/skills/%s" % (ok, len(files), HUB_REPO, name))


def main():
    ap = argparse.ArgumentParser(prog="skillmanager", description="SkillManager — 技能管理器(MD存储,无侵入)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("refresh", help="扫描技能目录→更新全局索引+高频问题更新建议")
    s = sub.add_parser("suggest", help="技能组合建议(手动触发,采纳才挂回调)")
    s.add_argument("--task", required=True, help="任务描述")
    s = sub.add_parser("run", help="临时回调包装器: run <技能名> -- <命令...>")
    s.add_argument("skill"); s.add_argument("cmd", nargs="+")
    s = sub.add_parser("archive", help="归档标记: archive <技能名> <on|off>")
    s.add_argument("skill"); s.add_argument("state", choices=["on", "off"])
    sub.add_parser("dashboard", help="生成静态HTML仪表盘")
    s = sub.add_parser("stats", help="查看单技能统计")
    s.add_argument("skill", nargs="?", default=None)
    s = sub.add_parser("hub-search", help="搜索 skillhub 上的技能")
    s.add_argument("keyword")
    s = sub.add_parser("hub-install", help="从 skillhub 安装技能")
    s.add_argument("name")
    s.add_argument("--force", action="store_true")
    sub.add_parser("hub-outdated", help="检查 hub 安装的技能是否有更新")
    s = sub.add_parser("hub-publish", help="发布本地技能到 skillhub")
    s.add_argument("name")
    s.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if a.cmd == "refresh": cmd_refresh(a)
    elif a.cmd == "suggest": cmd_suggest(a)
    elif a.cmd == "run":
        sys.exit(cmd_run(a))
    elif a.cmd == "archive": cmd_archive(a)
    elif a.cmd == "dashboard": cmd_dashboard(a)
    elif a.cmd == "stats": cmd_stats(a)
    elif a.cmd == "hub-search": cmd_hub_search(a)
    elif a.cmd == "hub-install": cmd_hub_install(a)
    elif a.cmd == "hub-outdated": cmd_hub_outdated(a)
    elif a.cmd == "hub-publish": cmd_hub_publish(a)

if __name__ == "__main__":
    main()
