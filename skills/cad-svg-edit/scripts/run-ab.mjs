#!/usr/bin/env node
// A/B 引擎对比驱动：计时运行 + 校验 + 快照，产出 out/ab-results.json
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// 用法: node scripts/run-ab.mjs [AB_ROOT]   （默认每次新开临时目录；job 固定读 test/ab/）
import os from "node:os";
const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "ab-compare-"));

const JOBS = path.join(here, "..", "test", "ab");
const CC = path.join(here, "cadcraft-bridge.mjs");
const SC = path.join(here, "solidcraft-bridge.mjs");
const env = { ...process.env };

function sh(args) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync("node", args, { cwd: ROOT, env, encoding: "utf8", timeout: 120000 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ok: r.status === 0, ms: Math.round(ms), out: (r.stdout || "") + (r.stderr || "") };
}
// job 注入独立 out 目录后落临时副本（test/ab 的 job 不含 out）
function jobWithOut(id, outDir) {
  const job = JSON.parse(fs.readFileSync(path.join(JOBS, `${id}.job.json`), "utf8"));
  job.out = path.join(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, `.${id}.job.json`);
  fs.writeFileSync(p, JSON.stringify(job));
  return p;
}

const SPECS = [
  { id: "flange", cn: "法兰盘", cc: "flange-cc", sc: "flange-sc",
    ccVerify: ["--expect", '{"Circle":11,"LINE":0}', "--geometry", '{"polar_pattern":[{"type":"Circle","ring_radius":100,"count":8,"step_deg":45}]}'],
    scVerify: ["--volume", "620401.717", "--tol", "1e-3", "--faces", "12", "--bodies", "1"] },
  { id: "bracket", cn: "L 支架", cc: "bracket-cc", sc: "bracket-sc",
    ccVerify: ["--expect", '{"Circle":2}'],
    scVerify: ["--volume", "6395.752", "--tol", "1e-3", "--bodies", "1"] },
  { id: "plate", cn: "安装板", cc: "plate-cc", sc: "plate-sc",
    ccVerify: ["--expect", '{"Circle":4}'],
    scVerify: ["--volume", "55558.141", "--tol", "1e-3", "--bodies", "1"] },
];

const results = [];
for (const s of SPECS) {
  const row = { id: s.id, cn: s.cn, cc: {}, sc: {} };
  // A+ CADCraft 2D（3 轮取中位）
  const ccDir = path.join(ROOT, "out", `${s.id}-cc`);
  const ccRuns = [0,1,2].map(() => sh([CC, "run", jobWithOut(`${s.id}-cc`, ccDir), "--quiet"]));
  const ccSorted = ccRuns.map(r => r.ms).sort((a,b)=>a-b);
  const ccRun = ccRuns[0];
  row.cc.run = { ok: ccRuns.every(r=>r.ok), ms: ccSorted[1], cold: ccSorted[0], samples: ccSorted };
  if (ccRun.ok) {
    const dxf = path.join(ccDir, `${s.cc}.dxf`);
    const v = sh([CC, "verify", dxf, ...s.ccVerify]);
    row.cc.verify = { ok: v.ok, ms: v.ms, detail: v.out.trim().split("\n").slice(-3).join(" | ") };
    const c = sh([CC, "convert", dxf, "--svg", path.join(ccDir, `${s.id}-cc.svg`), "--png", path.join(ccDir, `${s.id}-cc.png`)]);
    row.cc.render = { ok: c.ok, ms: c.ms };
    row.cc.files = fs.readdirSync(ccDir).filter(f => !f.startsWith("."));
  }
  // A++ SolidCraft 3D
  const scDir = path.join(ROOT, "out", `${s.id}-sc`);
  const scRuns = [0,1,2].map(() => sh([SC, "run", jobWithOut(`${s.id}-sc`, scDir)]));
  const scSorted = scRuns.map(r => r.ms).sort((a,b)=>a-b);
  const scRun = scRuns[0];
  row.sc.run = { ok: scRuns.every(r=>r.ok), ms: scSorted[1], cold: scSorted[0], samples: scSorted };
  if (scRun.ok) {
    const step = fs.readdirSync(scDir).map(f => path.join(scDir, f)).find(p => p.endsWith(".step"));
    const v = sh([SC, "verify", step, ...s.scVerify]);
    row.sc.verify = { ok: v.ok, ms: v.ms, detail: v.out.trim().split("\n").slice(-3).join(" | ") };
    const snap = sh([SC, "snapshot", `${JOBS}/${s.sc}.job.json`, "--out", path.join(scDir, `${s.id}-sc.png`), "--view", "iso", "--width", "900"]);
    row.sc.snapshot = { ok: snap.ok, ms: snap.ms };
    row.sc.files = fs.readdirSync(scDir).filter(f => !f.startsWith("."));
  }
  results.push(row);
  console.log(`[${s.id}] cc run=${row.cc.run.ms}ms ok=${row.cc.run.ok} verify=${row.cc.verify?.ok} | sc run=${row.sc.run.ms}ms ok=${row.sc.run.ok} verify=${row.sc.verify?.ok}`);
}
fs.writeFileSync(path.join(ROOT, "out", "ab-results.json"), JSON.stringify(results, null, 1));
console.log(`DONE -> ${path.join(ROOT, "out/ab-results.json")}`);
