#!/usr/bin/env node
// solidcraft-bridge.mjs — SolidCraft 3D 实体建模后端桥（零依赖，Node ≥ 16）
// 子命令：doctor | run | eval | verify | snapshot | commands
// 退出码：0 成功；1 命令/断言失败；2 环境缺失
// 单位：毫米；坐标系 Z 向上；run 失败即整脚本中止（引擎按脚本原子执行，无半成品状态）
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RELEASE_URL = "https://github.com/tangency-labs/solidcraft/releases/latest";
const SAVE_EXT = { step: "step", stl: "stl", obj: "obj", "3mf": "3mf", iges: "igs", igs: "igs" };

function die(code, msg) { console.error(msg); process.exit(code); }
function out(obj) { console.log(JSON.stringify(obj)); }

function resolveCli() {
  const env = process.env.SOLIDCRAFT_CLI;
  if (env && fs.existsSync(env)) return env;
  const cands = [
    "solidcraft-cli", "solidcraft-cli.exe",
    path.join(os.homedir(), ".local/bin/solidcraft-cli"),
    "/usr/local/bin/solidcraft-cli",
    path.join(os.homedir(), "bin/solidcraft-cli"),
  ];
  const home = os.homedir();
  if (process.env.SOLIDCRAFT_SCAN !== "0") {
    for (const d of ["/opt", "/tmp/opencode", home]) {
      try {
        for (const e of fs.readdirSync(d)) {
          if (/^solidcraft-[\d.]+/.test(e)) {
            cands.push(path.join(d, e, "bin/solidcraft-cli"));
            cands.push(path.join(d, e, "bin/solidcraft-cli.exe"));
          }
        }
      } catch {}
    }
  }
  for (const c of cands) {
    const hasSlash = c.includes(path.sep);
    if (hasSlash ? fs.existsSync(c) : true) {
      const r = spawnSync(c, ["--version"], { timeout: 15000, encoding: "utf8" });
      if (r.status === 0 && /solidcraft-cli/i.test(r.stdout + r.stderr)) return c;
    }
  }
  return null;
}

function requireCli() {
  const cli = resolveCli();
  if (!cli) die(2, `ERR 未找到 solidcraft-cli。安装: ${RELEASE_URL}（Linux tar.gz 解压即用），然后 export SOLIDCRAFT_CLI=<路径>/bin/solidcraft-cli 或加入 PATH`);
  return cli;
}

function sh(cli, args, timeoutMs = 240000) {
  const r = spawnSync(cli, args, { timeout: timeoutMs, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) die(2, `ERR 无法执行 ${cli}: ${r.message}`);
  return { stdout: r.stdout || "", stderr: r.stderr || "", status: r.status };
}

// run/eval 的 stdout 是一个完整 JSON 对象（可能带前缀行）；从首个 { 起解析
function parseResult(stdout) {
  const i = stdout.indexOf("{");
  if (i < 0) return null;
  try { return JSON.parse(stdout.slice(i)); } catch { return null; }
}

function measureOf(result) {
  if (!result) return null;
  const t = result.total || result.measure?.total;
  if (!t) return null;
  return {
    volume_mm3: t.volume_mm3, area_mm2: t.area_mm2, mass_g: t.mass_g,
    faces: t.faces, edges: t.edges, vertices: t.vertices,
    bodies: (result.bodies || []).length || t.bodies || undefined,
  };
}

// ---------- doctor ----------
function cmdDoctor() {
  const cli = resolveCli();
  if (!cli) {
    out({ found: false, hint: `安装 SolidCraft: ${RELEASE_URL} 下载 solidcraft-<ver>-linux-x86_64.tar.gz（Windows 用 MSI），解压后 export SOLIDCRAFT_CLI=<目录>/bin/solidcraft-cli` });
    process.exit(2);
  }
  const version = sh(cli, ["--version"], 20000).stdout.trim();
  // 冒烟：40x30x20 长方体 → 体积必须等于 24000（解析式）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-smoke-"));
  const script = path.join(tmp, "box.json");
  fs.writeFileSync(script, JSON.stringify({ commands: [
    { command: "sketch.create", params: { plane: "XY" } },
    { command: "sketch.rectangle.two_point", params: { p0: [0, 0], p1: [40, 30] } },
    { command: "solid.extrude", params: { distance: 20 } },
  ] }));
  const r = sh(cli, ["run", script], 120000);
  const m = measureOf(parseResult(r.stdout));
  const smoke = m && Math.abs(m.volume_mm3 - 24000) < 0.5
    ? { ok: true, detail: "box 40x30x20 → volume 24000 冒烟通过" }
    : { ok: false, detail: (r.stderr || r.stdout).slice(-200) };
  out({ found: true, path: cli, version, smoke });
}

// ---------- run ----------
// job.json: { name, commands: [{command, params}], out?, save?: {step?,stl?,obj?,"3mf"?,igs?,design?}, export?: {png?}, view?, width?, height? }
// 导出走 file.export（step/stl/obj/3mf/igs，按扩展名）；save.design 落 .solidcraft 设计容器（可重开编辑时间线）
// run 总是导一个 .step 主交付物（save.step:false 可关）
function cmdRun(jobPath, flags) {
  const cli = requireCli();
  const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
  const commands = job.commands || [];
  if (!commands.length) die(1, "ERR job.commands 为空");
  const outDir = job.out || ".";
  fs.mkdirSync(outDir, { recursive: true });
  const name = job.name || "sc-part";

  const files = {};
  const scriptCmds = commands.slice();
  const save = job.save || {};
  if (save.step !== false) save.step = true;
  for (const [k, ext] of Object.entries(SAVE_EXT)) {
    if (save[k]) {
      const f = path.join(outDir, `${name}.${ext}`);
      scriptCmds.push({ command: "file.export", params: { path: f } });
      files[k] = f;
    }
  }
  if (save.design) {
    const f = path.join(outDir, `${name}.solidcraft`);
    scriptCmds.push({ command: "file.save_as", params: { path: f } });
    files.design = f;
  }
  const script = path.join(outDir, `.${name}.script.json`);
  fs.writeFileSync(script, JSON.stringify({ commands: scriptCmds }));

  const r = sh(cli, ["run", script]);
  fs.rmSync(script, { force: true });
  if (r.status !== 0) {
    const errLine = (r.stderr || r.stdout).split(/\r?\n/).filter(Boolean).slice(-4).join(" | ");
    die(1, `ERR solidcraft run 失败（脚本原子中止，无半成品）: ${errLine}`);
  }
  const result = parseResult(r.stdout);
  if (!result) die(1, `ERR run 输出无法解析为 JSON: ${r.stdout.slice(0, 200)}`);
  const measure = measureOf(result) || {};
  for (const k of Object.keys(files)) {
    if (!fs.existsSync(files[k])) die(1, `ERR 期望产物未生成: ${files[k]}`);
  }
  const sizes = {}; for (const k of Object.keys(files)) sizes[k] = fs.statSync(files[k]).size;

  if (job.export?.png) {
    const png = path.join(outDir, `${name}.png`);
    const args = ["snapshot", script2file(job, commands), "--out", png];
    if (job.view) args.push("--view", job.view);
    if (job.width) args.push("--width", String(job.width));
    const rs = sh(cli, args, 180000);
    if (rs.status === 0 && fs.existsSync(png)) { files.png = png; sizes.png = fs.statSync(png).size; }
    else console.error(`WARN snapshot 失败（不影响实体产物）: ${(rs.stderr || rs.stdout).slice(-160)}`);
  }

  // 结果 JSON 落盘供 verify 复用（避免二次 eval）
  const resultPath = path.join(outDir, `${name}.result.json`);
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  const rep = { ok: true, name, files, sizes, measure, result_file: resultPath };
  if (flags.verbose) rep.full = result;
  else rep.bodies = (result.bodies || []).map(b => ({ name: b.name, volume_mm3: b.volume_mm3 }));
  out(rep);
}

// snapshot 需要不含 file.save 的原脚本（save 落盘后仍可，但保持干净）
function script2file(job, commands) {
  const p = path.join(job.out || ".", `.${job.name || "sc-part"}.snap.json`);
  fs.writeFileSync(p, JSON.stringify({ commands }));
  return p;
}

// ---------- eval ----------
function cmdEval(file) {
  const cli = requireCli();
  if (!fs.existsSync(file)) die(1, `ERR 文件不存在: ${file}`);
  const r = sh(cli, ["eval", file]);
  if (r.status !== 0) die(1, `ERR eval 失败: ${(r.stderr || r.stdout).slice(-200)}`);
  const result = parseResult(r.stdout);
  const m = measureOf(result);
  if (!m) die(1, `ERR eval 输出无法解析: ${r.stdout.slice(0, 200)}`);
  out({ ok: true, file, measure: m });
}

// ---------- verify ----------
// 用法: verify <result.json|part.step> [--volume V] [--area V] [--tol 1e-3] [--faces N] [--edges N] [--vertices N] [--bodies N]
// volume/area 用相对容差（SolidCraft 由显示网格测量，典型偏差 1e-6~1e-5）；faces/edges/vertices/bodies 精确断言
function cmdVerify(file, opts) {
  let measure;
  if (file.endsWith(".json")) {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    measure = measureOf(j) || j.measure;
    if (!measure) die(1, "ERR result.json 中无测量字段");
  } else {
    const cli = requireCli();
    const r = sh(cli, ["eval", file]);
    if (r.status !== 0) die(1, `ERR eval 失败: ${(r.stderr || r.stdout).slice(-200)}`);
    measure = measureOf(parseResult(r.stdout));
    if (!measure) die(1, "ERR eval 输出无法解析");
  }
  const tol = opts.tol ? Number(opts.tol) : 1e-3;
  const checks = {};
  let pass = true;
  const near = (name, actual, expect) => {
    if (expect === undefined || actual === undefined) return;
    const rel = Math.abs(actual - expect) / Math.abs(expect);
    checks[name] = { expect, actual, rel_err: rel, pass: rel <= tol };
    if (rel > tol) pass = false;
  };
  const exact = (name, actual, expect) => {
    if (expect === undefined || actual === undefined) return;
    const ok = actual === expect;
    checks[name] = { expect, actual, pass: ok };
    if (!ok) pass = false;
  };
  near("volume_mm3", measure.volume_mm3, opts.volume !== undefined ? Number(opts.volume) : undefined);
  near("area_mm2", measure.area_mm2, opts.area !== undefined ? Number(opts.area) : undefined);
  exact("faces", measure.faces, opts.faces !== undefined ? Number(opts.faces) : undefined);
  exact("edges", measure.edges, opts.edges !== undefined ? Number(opts.edges) : undefined);
  exact("vertices", measure.vertices, opts.vertices !== undefined ? Number(opts.vertices) : undefined);
  exact("bodies", measure.bodies, opts.bodies !== undefined ? Number(opts.bodies) : undefined);
  if (!Object.keys(checks).length) die(1, "ERR verify 需要至少一个断言: --volume/--area/--faces/--edges/--vertices/--bodies");
  out({ pass, checks, measure: { volume_mm3: measure.volume_mm3, area_mm2: measure.area_mm2, faces: measure.faces, edges: measure.edges, vertices: measure.vertices, bodies: measure.bodies } });
  if (!pass) process.exit(1);
}

// ---------- snapshot ----------
function cmdSnapshot(scriptOrStep, opts) {
  const cli = requireCli();
  const png = opts.out || "snapshot.png";
  const args = ["snapshot", scriptOrStep, "--out", png];
  if (opts.view) args.push("--view", opts.view);
  if (opts.width) args.push("--width", String(opts.width));
  if (opts.height) args.push("--height", String(opts.height));
  const r = sh(cli, args, 180000);
  if (r.status !== 0 || !fs.existsSync(png)) die(1, `ERR snapshot 失败: ${(r.stderr || r.stdout).slice(-200)}`);
  out({ ok: true, png, size: fs.statSync(png).size });
}

// ---------- commands ----------
function cmdCommands(filter) {
  const cli = requireCli();
  const r = sh(cli, ["commands"], 60000);
  if (r.status !== 0) die(1, `ERR commands 失败: ${(r.stderr || r.stdout).slice(-200)}`);
  let list;
  try { list = JSON.parse(r.stdout); } catch { die(1, "ERR commands 输出无法解析"); }
  const items = filter
    ? list.filter(c => (c.id + " " + (c.label || "")).toLowerCase().includes(filter.toLowerCase()))
    : list;
  out({ total: items.length, commands: items.map(c => ({ id: c.id, tab: c.tab, params: c.params })) });
}

// ---------- 入口 ----------
const [sub, ...rest] = process.argv.slice(2);
const usage = `用法:
  solidcraft-bridge.mjs doctor
  solidcraft-bridge.mjs run <job.json> [--verbose]
  solidcraft-bridge.mjs eval <part.step|part.stl>
  solidcraft-bridge.mjs verify <result.json|part.step> --volume 620401.7 --tol 1e-3 --faces 12 --edges 20 --vertices 20 --bodies 1
  solidcraft-bridge.mjs snapshot <job.json> --out x.png [--view iso|top|front] [--width 1280]
  solidcraft-bridge.mjs commands [filter]`;

try {
  if (sub === "doctor") cmdDoctor();
  else if (sub === "run") {
    if (!rest[0]) die(1, usage);
    cmdRun(rest[0], { verbose: rest.includes("--verbose") });
  }
  else if (sub === "eval") { if (!rest[0]) die(1, usage); cmdEval(rest[0]); }
  else if (sub === "verify") {
    const file = rest[0]; if (!file) die(1, usage);
    const opts = {};
    for (let i = 1; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
    cmdVerify(file, opts);
  }
  else if (sub === "snapshot") {
    const file = rest[0]; if (!file) die(1, usage);
    const opts = {};
    for (let i = 1; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
    cmdSnapshot(file, opts);
  }
  else if (sub === "commands") cmdCommands(rest[0]);
  else die(1, usage);
} catch (e) {
  die(1, `ERR ${e.message}`);
}
