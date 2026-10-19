#!/usr/bin/env node
// cadcraft-bridge.mjs — CADCraft 精确绘图后端桥（零依赖，Node ≥ 16）
// 子命令：doctor | run | query | verify | convert | info
// 退出码：0 成功；1 命令/断言失败；2 环境缺失
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RELEASE_URL = "https://github.com/storytold/cadcraft/releases/latest";
const CHUNK = 80;
const ERR_RE = /(Point or option keyword required|Unknown command|Invalid|invalid param|error:|Error:|failed to|Expected)/;

function die(code, msg) { console.error(msg); process.exit(code); }
function out(obj) { console.log(JSON.stringify(obj)); }

function resolveCli() {
  const env = process.env.CADCRAFT_CLI;
  if (env && fs.existsSync(env)) return env;
  const cands = [
    "cadcraft-cli", "cadcraft-cli.exe",
    path.join(os.homedir(), ".local/bin/cadcraft-cli"),
    "/usr/local/bin/cadcraft-cli",
    path.join(os.homedir(), "bin/cadcraft-cli"),
  ];
  const home = os.homedir();
  if (process.env.CADCRAFT_SCAN !== "0") {
    for (const d of ["/opt", "/tmp/opencode", home]) {
      try {
        for (const e of fs.readdirSync(d)) {
          if (/^cadcraft-[\d.]+/.test(e)) {
            cands.push(path.join(d, e, "bin/cadcraft-cli"));
            cands.push(path.join(d, e, "bin/cadcraft-cli.exe"));
          }
        }
      } catch {}
    }
  }
  for (const c of cands) {
    const hasSlash = c.includes(path.sep);
    if (hasSlash ? fs.existsSync(c) : true) {
      const r = spawnSync(c, ["--version"], { timeout: 15000, encoding: "utf8" });
      if (r.status === 0 && /cadcraft-cli/i.test(r.stdout + r.stderr)) return c;
    }
  }
  return null;
}

function sh(cli, args, timeoutMs = 180000) {
  const r = spawnSync(cli, args, { timeout: timeoutMs, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) die(2, `ERR 无法执行 ${cli}: ${r.message}`);
  return { stdout: r.stdout || "", stderr: r.stderr || "", status: r.status };
}

function jsonLines(text) {
  return text.split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(x => x && typeof x === "object");
}

// ---------- handle 占位替换 ----------
// "HANDLE"    = 最近一次收集到的 handle
// "HANDLE[n]" = 第 n 个收集到的 handle（1 起）
function rawSub(raw, handles) {
  return raw.replace(/"HANDLE(\[(\d+)\])?"/g, (m, _g1, n) => {
    const h = n ? handles[+n - 1] : handles[handles.length - 1];
    if (!h) throw new Error(`handle 占位 ${m} 无法解析（已收集 ${handles.length} 个）`);
    return JSON.stringify(h);
  });
}

function collectHandles(obj, handles) {
  if (!obj) return;
  if (typeof obj.handle === "string") handles.push(obj.handle);
  if (Array.isArray(obj.handles)) for (const h of obj.handles) if (typeof h === "string") handles.push(h);
}

// 失败回滚：把最近一次成功 part 提升为 <name>.checkpoint.dxf，清理其余中间 part
function rollbackCheckpoint(outDir, name, seq) {
  let last = null;
  for (let i = seq - 1; i >= 1; i--) {
    const p = path.join(outDir, `.${name}.p${i}.dxf`);
    if (fs.existsSync(p)) { last = p; break; }
  }
  if (!last) return null;
  const cp = path.join(outDir, `${name}.checkpoint.dxf`);
  fs.copyFileSync(last, cp);
  for (let i = 1; i < seq; i++) fs.rmSync(path.join(outDir, `.${name}.p${i}.dxf`), { force: true });
  return cp;
}

// ---------- 子命令 ----------
function cmdDoctor() {
  const cli = resolveCli();
  if (!cli) {
    out({ found: false, hint: `安装 CADCraft: ${RELEASE_URL}（Linux tar.gz 解压即用），然后 export CADCRAFT_CLI=<路径>/cadcraft-cli 或加入 PATH` });
    process.exit(2);
  }
  const v = sh(cli, ["--version"], 20000).stdout.trim();
  let smoke = { ok: false, detail: "skipped" };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-smoke-"));
  const f = path.join(tmp, "s.dxf");
  const r = sh(cli, ["run", "--cmd", 'circle {"center":[0,0],"radius":1}', "--save", f], 60000);
  if (r.status === 0 && fs.existsSync(f)) smoke = { ok: true, detail: "circle→dxf 冒烟通过" };
  else smoke = { ok: false, detail: (r.stderr || r.stdout).slice(-200) };
  out({ found: true, path: cli, version: v, smoke });
}

function cmdRun(jobPath, flags) {
  const cli = requireCli();
  const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
  const commands = job.commands || [];
  if (!commands.length) die(1, "ERR job.commands 为空");
  const outDir = job.out || ".";
  fs.mkdirSync(outDir, { recursive: true });
  const name = job.name || "cc-drawing";
  const handles = [];
  const acks = [];
  let seq = 0;
  let curDxf = null; // 当前会话累积态
  let gIdx = 0;      // 全局命令序号（1 起，用于失败定位）

  // 执行一批命令（无占位符），落盘 part 文件，收集 handle
  // 失败时：自动二分探针定位首条失败命令（SolidCraft failed.index 语义），保留最近成功态为 checkpoint
  const flush = (batch) => {
    if (!batch.length) return;
    const from = gIdx + 1;
    const args = ["run"];
    if (curDxf) args.push(curDxf);
    batch.forEach(c => args.push("--cmd", `${c.cmd || c.id} ${JSON.stringify(c.params ?? {})}`));
    seq += 1;
    curDxf = path.join(outDir, `.${name}.p${seq}.dxf`);
    args.push("--save", curDxf);
    const r = sh(cli, args);
    gIdx += batch.length;
    if (ERR_RE.test(r.stdout) || ERR_RE.test(r.stderr) || r.status !== 0) {
      const bad = (r.stdout + r.stderr).split(/\r?\n/).filter(l => ERR_RE.test(l)).slice(-3).join(" | ");
      // 二分探针：从批前状态 base 重放子区间，找首条失败命令
      const base = seq > 1 ? path.join(outDir, `.${name}.p${seq - 1}.dxf`) : null;
      let lo = 0, hi = batch.length; // [lo, hi) 已知失败
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const pa = ["run"];
        if (base) pa.push(base);
        for (let k = lo; k < mid; k++) pa.push("--cmd", `${batch[k].cmd || batch[k].id} ${JSON.stringify(batch[k].params ?? {})}`);
        pa.push("--save", path.join(outDir, `.${name}.probe.dxf`));
        const pr = sh(cli, pa);
        const ok = pr.status === 0 && !ERR_RE.test(pr.stdout) && !ERR_RE.test(pr.stderr);
        fs.rmSync(path.join(outDir, `.${name}.probe.dxf`), { force: true });
        if (ok) lo = mid; else hi = mid;
      }
      const fc = batch[lo];
      const cp = rollbackCheckpoint(outDir, name, seq);
      die(1, `ERR 命令 #${from + lo} (${fc.cmd || fc.id}) 失败: ${bad || `exit ${r.status}`}${cp ? `\n最近成功态已保留: ${cp}（回滚点=失败前状态）` : ""}`);
    }
    jsonLines(r.stdout).forEach(o => { acks.push(o); collectHandles(o, handles); });
  };

  let batch = [];
  for (const c of commands) {
    const raw = JSON.stringify(c.params ?? {});
    if (/HANDLE(\[\d+\])?/.test(raw)) {
      flush(batch); batch = [];
      const resolved = JSON.parse(rawSub(raw, handles));
      seq += 1; gIdx += 1;
      const nextDxf = path.join(outDir, `.${name}.p${seq}.dxf`);
      const prevDxf = seq > 1 ? path.join(outDir, `.${name}.p${seq - 1}.dxf`) : null;
      const a2 = ["run"]; if (prevDxf) a2.push(prevDxf);
      a2.push("--cmd", `${c.cmd || c.id} ${JSON.stringify(resolved)}`, "--save", nextDxf);
      const r = sh(cli, a2);
      if (ERR_RE.test(r.stdout) || ERR_RE.test(r.stderr) || r.status !== 0) {
        const bad = (r.stdout + r.stderr).split(/\r?\n/).filter(l => ERR_RE.test(l)).slice(-3).join(" | ");
        const cp = rollbackCheckpoint(outDir, name, seq);
        die(1, `ERR 命令 #${gIdx} (${c.cmd || c.id}) 失败: ${bad || `exit ${r.status}`}${cp ? `\n最近成功态已保留: ${cp}` : ""}`);
      }
      jsonLines(r.stdout).forEach(o => { acks.push(o); collectHandles(o, handles); });
      curDxf = nextDxf;
    } else {
      batch.push(c);
    }
  }
  flush(batch);

  if (!curDxf) die(1, "ERR 无输出");
  const finalDxf = path.join(outDir, `${name}.dxf`);
  fs.renameSync(curDxf, finalDxf);
  // 清理中间 part 文件
  for (let i = 1; i < seq; i++) fs.rmSync(path.join(outDir, `.${name}.p${i}.dxf`), { force: true });

  const files = { dxf: finalDxf };
  if (job.export?.png) files.png = doConvert(cli, finalDxf, path.join(outDir, `${name}.png`), job.window);
  if (job.export?.svg) files.svg = doConvert(cli, finalDxf, path.join(outDir, `${name}.svg`), job.window);
  const sizes = {}; for (const k of Object.keys(files)) sizes[k] = fs.statSync(files[k]).size;
  out({ ok: true, name, files, sizes, handles, ...(flags.quiet ? { acks_omitted: acks.length } : { acks }) });
}

function requireCli() {
  const cli = resolveCli();
  if (!cli) die(2, `ERR 未找到 cadcraft-cli。安装: ${RELEASE_URL}，或 export CADCRAFT_CLI=<路径>。也可用 JS 引擎路径（SKILL.md A 路）。`);
  return cli;
}

function doConvert(cli, input, outputPath, window) {
  const args = ["convert", input, outputPath];
  if (window) args.push("--window", window.join(","));
  const r = sh(cli, args);
  if (r.status !== 0 || !fs.existsSync(outputPath)) die(1, `ERR 导出失败 ${outputPath}: ${(r.stderr || r.stdout).slice(-200)}`);
  return outputPath;
}

function cmdQuery(file, opts) {
  const cli = requireCli();
  const params = {};
  if (opts.type) params.type = opts.type;
  if (opts.layer) params.layer = opts.layer;
  if (opts.window) params.window = opts.window;
  params.limit = opts.limit || 500;
  const r = sh(cli, ["run", file, "--cmd", `entities ${JSON.stringify(params)}`]);
  if (r.status !== 0) die(1, `ERR 查询失败: ${(r.stderr || r.stdout).slice(-200)}`);
  const hits = jsonLines(r.stdout).filter(o => "entities" in o);
  if (!hits.length) die(1, "ERR 查询无 JSON 输出");
  out(hits[hits.length - 1]);
}

function cmdInfo(file) {
  const cli = requireCli();
  const r = sh(cli, ["info", file]);
  if (r.status !== 0) die(1, `ERR info 失败: ${(r.stderr || r.stdout).slice(-200)}`);
  try { out(JSON.parse(r.stdout)); } catch { die(1, `ERR info 输出无法解析: ${r.stdout.slice(0, 200)}`); }
}

// ---------- verify ----------
// 计数断言: verify <file.dxf> --expect '{"Circle":2,"Line":1}'
// 几何断言: verify <file.dxf> --geometry '<json>'
//   {"circle":    [{"center":[x,y],"radius":R,"tol":0.5}, ...]}        每条必须命中一个同型实体
//   {"polar_pattern": [{"type":"Circle","ring_radius":100,"count":8,"step_deg":45,"tol":0.5}]}
//      环上应有 count 个圆心，按极角排序后相邻角差 ≈ step_deg
//   {"distance":  [{"from":[x1,y1],"to":[x2,y2],"expect":D,"tol":0.5}]} 任意两点距（可用于圆心距）
function queryEntities(cli, file, type) {
  const r = sh(cli, ["run", file, "--cmd", `entities ${JSON.stringify({ type, limit: 2000 })}`]);
  if (r.status !== 0) die(1, `ERR 查询失败(${type}): ${(r.stderr || r.stdout).slice(-200)}`);
  const hits = jsonLines(r.stdout).filter(o => "entities" in o);
  if (!hits.length) die(1, `ERR 查询 ${type} 无 JSON 输出`);
  return hits[hits.length - 1].entities || [];
}

// center 兼容 [x,y] 与 {x,y,z} 两种返回形态
function centerOf(g) {
  if (!g || g.center === undefined) return null;
  if (Array.isArray(g.center)) return [g.center[0], g.center[1]];
  if (typeof g.center === "object") return [g.center.x, g.center.y];
  return null;
}

function checkGeometry(cli, file, specJson) {
  let spec;
  try { spec = JSON.parse(specJson); } catch { die(1, "ERR --geometry 不是合法 JSON"); }
  const checks = {};
  let pass = true;

  for (const c of spec.circle || []) {
    const tol = c.tol ?? 0.5;
    const ents = queryEntities(cli, file, c.type || "Circle");
    const hit = ents.find(e => {
      const g = e.geometry || {};
      const p = centerOf(g);
      if (!p || g.radius === undefined) return false;
      const dc = Math.hypot(p[0] - c.center[0], p[1] - c.center[1]);
      return dc <= tol && Math.abs(g.radius - c.radius) <= tol;
    });
    checks[`circle@(${c.center})r${c.radius}`] = hit
      ? { pass: true, handle: hit.handle }
      : { pass: false, detail: `无 Circle 在 (${c.center}) r=${c.radius}±${tol}` };
    if (!hit) pass = false;
  }

  for (const p of spec.polar_pattern || []) {
    const tol = p.tol ?? 0.5;
    const angles = queryEntities(cli, file, p.type || "Circle")
      .map(e => centerOf(e.geometry)).filter(Boolean)
      .filter(c => Math.abs(Math.hypot(c[0], c[1]) - p.ring_radius) <= tol)
      .map(c => Math.atan2(c[1], c[0]) * 180 / Math.PI)
      .map(a => Math.round(((a + 360) % 360) * 100) / 100)
      .sort((a, b) => a - b);
    let ok = angles.length === p.count;
    const steps = [];
    if (ok) {
      for (let i = 0; i < angles.length; i++) {
        const step = i + 1 < angles.length ? angles[i + 1] - angles[i] : angles[0] + 360 - angles[angles.length - 1];
        steps.push(step);
        if (Math.abs(step - p.step_deg) > (p.step_tol ?? 0.5)) ok = false;
      }
    }
    checks[`polar(r=${p.ring_radius},n=${p.count})`] = { pass: ok, found: angles.length, expect: p.count, steps_deg: steps };
    if (!ok) pass = false;
  }

  for (const d of spec.distance || []) {
    const tol = d.tol ?? 0.5;
    const actual = Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1]);
    const diff = Math.abs(actual - d.expect);
    checks[`dist(${d.from}->${d.to})`] = { pass: diff <= tol, actual: Math.round(actual * 1000) / 1000, expect: d.expect };
    if (diff > tol) pass = false;
  }

  return { pass, checks };
}

function cmdVerify(file, opts) {
  const cli = requireCli();
  const r = sh(cli, ["info", file]);
  if (r.status !== 0) die(1, `ERR info 失败: ${(r.stderr || r.stdout).slice(-200)}`);
  let counts;
  try { counts = JSON.parse(r.stdout).counts || {}; } catch { die(1, "ERR info 输出无法解析"); }
  const expect = opts.expect ? JSON.parse(opts.expect) : null;
  const rep = { pass: true, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), missing: {}, extra: {}, untracked: {} };
  if (expect) {
    for (const [t, n] of Object.entries(expect)) {
      const act = counts[t] || 0;
      if (act < n) { rep.missing[t] = { expect: n, actual: act }; rep.pass = false; }
      else if (act > n) { rep.extra[t] = { expect: n, actual: act }; rep.pass = false; }
    }
    for (const [t, n] of Object.entries(counts)) if (!(t in expect)) rep.untracked[t] = n;
  }
  if (opts.geometry) {
    const g = checkGeometry(cli, file, opts.geometry);
    rep.geometry = g.checks;
    if (!g.pass) rep.pass = false;
  }
  out(rep);
  if (!rep.pass) process.exit(1);
}

function cmdConvert(file, opts) {
  const cli = requireCli();
  const made = [];
  if (opts.svg) made.push(doConvert(cli, file, opts.svg, opts.window?.split(",").map(Number)));
  if (opts.png) made.push(doConvert(cli, file, opts.png, opts.window?.split(",").map(Number)));
  out({ ok: true, files: made });
}

// ---------- 入口 ----------
const [sub, ...rest] = process.argv.slice(2);
const usage = `用法:
  cadcraft-bridge.mjs doctor
  cadcraft-bridge.mjs run <job.json> [--quiet]（--quiet 省略逐命令 acks）
  cadcraft-bridge.mjs query <file.dxf> [--type Circle] [--layer L] [--window x0,y0,x1,y1] [--limit N]
  cadcraft-bridge.mjs info <file.dxf|dwg>
  cadcraft-bridge.mjs verify <file.dxf> --expect '{"Circle":2,"Line":1}' [--geometry '{"circle":[{"center":[0,0],"radius":40,"tol":0.5}],"polar_pattern":[{"type":"Circle","ring_radius":100,"count":8,"step_deg":45}]}']
  cadcraft-bridge.mjs convert <file.dxf> [--svg out.svg] [--png out.png] [--window x0,y0,x1,y1]`;

try {
  if (sub === "doctor") cmdDoctor();
  else if (sub === "run") { if (!rest[0]) die(1, usage); cmdRun(rest[0], { quiet: rest.includes("--quiet") }); }
  else if (sub === "query") {
    const file = rest[0]; if (!file) die(1, usage);
    const opts = {};
    for (let i = 1; i < rest.length; i += 2) {
      const k = rest[i].replace(/^--/, ""); const v = rest[i + 1];
      if (k === "window") opts.window = v.split(",").map(Number).length === 4
        ? [[+v.split(",")[0], +v.split(",")[1]], [+v.split(",")[2], +v.split(",")[3]]] : v;
      else opts[k] = v;
    }
    cmdQuery(file, opts);
  }
  else if (sub === "info") { if (!rest[0]) die(1, usage); cmdInfo(rest[0]); }
  else if (sub === "verify") {
    const file = rest[0]; if (!file) die(1, usage);
    const opts = {};
    for (let i = 1; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
    cmdVerify(file, opts);
  }
  else if (sub === "convert") {
    const file = rest[0]; if (!file) die(1, usage);
    const opts = {};
    for (let i = 1; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
    cmdConvert(file, opts);
  }
  else die(1, usage);
} catch (e) {
  die(1, `ERR ${e.message}`);
}
