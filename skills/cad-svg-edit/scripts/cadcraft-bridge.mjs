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

function cmdRun(jobPath) {
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

  // 执行一批命令（无占位符），落盘 part 文件，收集 handle
  const flush = (batch) => {
    if (!batch.length) return;
    const args = ["run"];
    if (curDxf) args.push(curDxf);
    batch.forEach(c => args.push("--cmd", `${c.cmd || c.id} ${JSON.stringify(c.params ?? {})}`));
    seq += 1;
    curDxf = path.join(outDir, `.${name}.p${seq}.dxf`);
    args.push("--save", curDxf);
    const r = sh(cli, args);
    if (ERR_RE.test(r.stdout) || ERR_RE.test(r.stderr) || r.status !== 0) {
      const bad = (r.stdout + r.stderr).split(/\r?\n/).filter(l => ERR_RE.test(l)).slice(-3).join(" | ");
      die(1, `ERR 批次(${batch.length} 条)执行失败: ${bad || `exit ${r.status}`}`);
    }
    jsonLines(r.stdout).forEach(o => { acks.push(o); collectHandles(o, handles); });
  };

  let batch = [];
  for (const c of commands) {
    const raw = JSON.stringify(c.params ?? {});
    if (/HANDLE(\[\d+\])?/.test(raw)) {
      flush(batch); batch = [];
      const resolved = JSON.parse(rawSub(raw, handles));
      seq += 1;
      const nextDxf = path.join(outDir, `.${name}.p${seq}.dxf`);
      const prevDxf = seq > 1 ? path.join(outDir, `.${name}.p${seq - 1}.dxf`) : null;
      const a2 = ["run"]; if (prevDxf) a2.push(prevDxf);
      a2.push("--cmd", `${c.cmd || c.id} ${JSON.stringify(resolved)}`, "--save", nextDxf);
      const r = sh(cli, a2);
      if (ERR_RE.test(r.stdout) || ERR_RE.test(r.stderr) || r.status !== 0) {
        const bad = (r.stdout + r.stderr).split(/\r?\n/).filter(l => ERR_RE.test(l)).slice(-3).join(" | ");
        die(1, `ERR 命令 ${c.cmd || c.id} 失败: ${bad || `exit ${r.status}`}`);
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
  out({ ok: true, name, files, sizes, handles, acks });
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

function cmdVerify(file, expectJson) {
  const cli = requireCli();
  const r = sh(cli, ["info", file]);
  if (r.status !== 0) die(1, `ERR info 失败: ${(r.stderr || r.stdout).slice(-200)}`);
  let counts;
  try { counts = JSON.parse(r.stdout).counts || {}; } catch { die(1, "ERR info 输出无法解析"); }
  const expect = expectJson ? JSON.parse(expectJson) : null;
  const rep = { pass: true, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), missing: {}, extra: {}, untracked: {} };
  if (expect) {
    for (const [t, n] of Object.entries(expect)) {
      const act = counts[t] || 0;
      if (act < n) { rep.missing[t] = { expect: n, actual: act }; rep.pass = false; }
      else if (act > n) { rep.extra[t] = { expect: n, actual: act }; rep.pass = false; }
    }
    for (const [t, n] of Object.entries(counts)) if (!(t in expect)) rep.untracked[t] = n;
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
  cadcraft-bridge.mjs run <job.json>
  cadcraft-bridge.mjs query <file.dxf> [--type Circle] [--layer L] [--window x0,y0,x1,y1] [--limit N]
  cadcraft-bridge.mjs info <file.dxf|dwg>
  cadcraft-bridge.mjs verify <file.dxf> --expect '{"Circle":2,"Line":1}'
  cadcraft-bridge.mjs convert <file.dxf> [--svg out.svg] [--png out.png] [--window x0,y0,x1,y1]`;

try {
  if (sub === "doctor") cmdDoctor();
  else if (sub === "run") { if (!rest[0]) die(1, usage); cmdRun(rest[0]); }
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
    const ei = rest.indexOf("--expect");
    cmdVerify(file, ei >= 0 ? rest[ei + 1] : null);
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
