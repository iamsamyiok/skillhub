#!/usr/bin/env node
// run-corpus.mjs — 图纸/零件语料库回归运行器（零依赖，Node ≥ 16）
// 语料 = test/corpus/<name>.job.json + <name>.expected.json
// expected 格式:
//   {"bridge":"cadcraft",  "checks":{"expect":{counts}, "geometry":{...}}}
//   {"bridge":"solidcraft","checks":{"volume":V,"tol":1e-3,"faces":N,"edges":N,"vertices":N,"bodies":N}}
// 用法: node scripts/run-corpus.mjs [name...]   （不选则全量）
// 退出码: 0 全过/全跳过；1 有失败；2 语料缺失
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusDir = path.join(here, "..", "test", "corpus");

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024, ...opts });
}
function jout(r) {
  const i = (r.stdout || "").indexOf("{");
  if (i < 0) return null;
  try { return JSON.parse(r.stdout.slice(i)); } catch { return null; }
}

const selected = process.argv.slice(2);
const entries = fs.readdirSync(corpusDir).filter(f => f.endsWith(".expected.json"))
  .map(f => f.replace(/\.expected\.json$/, ""))
  .filter(n => !selected.length || selected.includes(n))
  .sort();
if (!entries.length) { console.error("ERR 语料库为空或未匹配: " + corpusDir); process.exit(2); }

const results = [];
for (const name of entries) {
  const jobPath = path.join(corpusDir, `${name}.job.json`);
  const expPath = path.join(corpusDir, `${name}.expected.json`);
  if (!fs.existsSync(jobPath)) { results.push({ name, status: "FAIL", detail: "缺 .job.json" }); continue; }
  const expected = JSON.parse(fs.readFileSync(expPath, "utf8"));
  const bridge = path.join(here, `${expected.bridge}-bridge.mjs`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `corpus-${name}-`));
  try {
    const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
    job.out = tmp;
    const tmpJob = path.join(tmp, "job.json");
    fs.writeFileSync(tmpJob, JSON.stringify(job));

    const run = sh("node", [bridge, "run", tmpJob, "--quiet"]);
    if (run.status === 2) { results.push({ name, status: "SKIP", detail: `${expected.bridge} 二进制缺失` }); continue; }
    if (run.status !== 0) { results.push({ name, status: "FAIL", stage: "run", detail: (run.stderr || "").split("\n")[0].slice(0, 160) }); continue; }

    const c = expected.checks || {};
    let verify;
    if (expected.bridge === "cadcraft") {
      const args = [bridge, "verify", path.join(tmp, `${job.name || name}.dxf`)];
      if (c.expect) args.push("--expect", JSON.stringify(c.expect));
      if (c.geometry) args.push("--geometry", JSON.stringify(c.geometry));
      verify = sh("node", args);
    } else {
      const args = [bridge, "verify", path.join(tmp, `${job.name || name}.result.json`)];
      if (c.volume !== undefined) args.push("--volume", String(c.volume));
      if (c.tol !== undefined) args.push("--tol", String(c.tol));
      for (const k of ["faces", "edges", "vertices", "bodies"]) if (c[k] !== undefined) args.push(`--${k}`, String(c[k]));
      verify = sh("node", args);
    }
    if (verify.status === 0) results.push({ name, status: "PASS", detail: expected.oracle || "" });
    else results.push({ name, status: "FAIL", stage: "verify", detail: firstFail(jout(verify)) || (verify.stderr || "").slice(0, 160) });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function firstFail(v) {
  if (!v) return null;
  const bad = Object.entries(v.checks || v.geometry || {}).filter(([, x]) => x && x.pass === false);
  if (bad.length) return bad.map(([k, x]) => `${k}:${JSON.stringify(x)}`).join(" ").slice(0, 200);
  if (v.missing && Object.keys(v.missing).length) return `missing:${JSON.stringify(v.missing)}`;
  if (v.extra && Object.keys(v.extra).length) return `extra:${JSON.stringify(v.extra)}`;
  return null;
}

let failed = 0, skipped = 0;
for (const r of results) {
  const tag = r.status === "PASS" ? "PASS" : r.status;
  console.log(`${tag}  ${r.name}${r.detail ? "  | " + r.detail : ""}${r.stage ? "  [" + r.stage + "]" : ""}`);
  if (r.status === "FAIL") failed++;
  if (r.status === "SKIP") skipped++;
}
console.log(failed ? `CORPUS_FAIL (${failed} failed, ${results.length - failed - skipped} passed, ${skipped} skipped)` : `CORPUS_PASS (${results.length - skipped} passed, ${skipped} skipped)`);
process.exit(failed ? 1 : 0);
