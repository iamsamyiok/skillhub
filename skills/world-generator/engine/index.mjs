#!/usr/bin/env node
// Universal World Generator - assembler & validator pipeline.
//
//   node engine/index.mjs --scene scenes/demo
//   node engine/index.mjs --scene scenes/campus --refine refine-1.json
//   node engine/index.mjs --scene scenes/campus --patch patch-1.json
//
// Modes:
//   base   full pipeline from scene-plan.json (level 0)
//   refine progressive detail: zones may anchor to solved instances,
//          boundary/elevation are authored in the anchor's local frame,
//          the program transforms them to world space and solves
//          incrementally against the existing world
//   patch  local modification of solved instances:
//          move / reparam / remove / add (single-instance incremental solve)
//
// AI never computes world coordinates in any mode.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from './lib/registry.mjs';
import { validateDocument, scenePlanSchema, assetDefinitionSchema, instanceListSchema, patchFileSchema } from './lib/schema-rules.mjs';
import { expandPlan, validateConstraintVocabulary, normalizeConstraint, defaultParams } from './lib/expand.mjs';
import { solveInstances, buildZoneContexts, rebuildPlaced } from './lib/solve.mjs';
import { lintPlan } from './lib/plan-lint.mjs';
import { validateAllAssets, loadAssetFactory } from './lib/validate-assets.mjs';
import { packWorld } from './packer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const sceneDir = arg('--scene', 'scenes/demo');
const refineFile = arg('--refine', null);
const patchFile = arg('--patch', null);
const editSave = process.argv.includes('--edit-save');
const newSession = process.argv.includes('--new-session');
if (!fs.existsSync(sceneDir)) {
  console.error(`Scene directory not found: ${sceneDir}`);
  process.exit(2);
}

const report = {
  scene: sceneDir,
  mode: patchFile ? 'patch' : (refineFile ? 'refine' : 'base'),
  timestamp: new Date().toISOString(),
  stages: {},
  errors: [],
  warnings: [],
  routing: null
};

function stage(name, fn) {
  console.log(`\n=== ${name} ===`);
  try {
    return fn();
  } catch (err) {
    report.errors.push(`[${name}] ${err.message}`);
    console.error(`FAILED: ${err.message}`);
    return null;
  }
}

const solvedFile = path.join(sceneDir, 'solved-instances.json');

function loadSolved() {
  if (!fs.existsSync(solvedFile)) {
    throw new Error('solved-instances.json not found - run the base scene first');
  }
  return JSON.parse(fs.readFileSync(solvedFile, 'utf8'));
}

function writeSolved(list) {
  fs.writeFileSync(solvedFile, JSON.stringify(list, null, 2));
}

function writeInstanceList(planName, solved) {
  const out = {
    scene: planName,
    generated_at: report.timestamp,
    instances: solved.map(({ instance_id, asset_id, zone_id, params, rotation_y, patched }) => {
      const o = { instance_id, asset_id, zone_id, params };
      if (rotation_y !== undefined) o.rotation_y = rotation_y;
      if (patched) o.patched = true;
      return o;
    })
  };
  fs.writeFileSync(path.join(sceneDir, 'instance-list.json'), JSON.stringify(out, null, 2));
}

// ---- shared: registry + asset validation ----
const registry = stage('LOAD ASSET REGISTRY', () => {
  const reg = loadRegistry([
    path.join(__dirname, 'assets'),
    path.join(sceneDir, 'new-assets')
  ]);
  report.warnings.push(...reg.loadErrors.map(e => `[REGISTRY] ${e}`));
  const schemaFail = [];
  for (const def of reg.defs.values()) {
    const res = validateDocument('asset-definition:' + def.asset_id, 'asset-definition', assetDefinitionSchema, def);
    if (!res.ok) {
      res.errors.forEach(e => schemaFail.push(`asset '${def.asset_id}': ${e}`));
      reg.factories.delete(def.asset_id);
    } else if (reg.sources.has(def.asset_id)) {
      try {
        reg.factories.set(def.asset_id, loadAssetFactory(reg.sources.get(def.asset_id)));
      } catch (err) {
        schemaFail.push(`asset '${def.asset_id}': module load failed: ${err.message}`);
      }
    }
  }
  if (schemaFail.length) {
    schemaFail.forEach(e => report.errors.push(`[SCHEMA asset-definition] ${e}`));
    console.error(schemaFail.join('\n'));
  }
  console.log(`assets loaded: ${[...reg.defs.keys()].length}`);
  return reg;
});
if (!registry) { writeReport(); process.exit(1); }

stage('ASSET GEOMETRY VALIDATION', () => {
  const results = validateAllAssets(registry);
  report.stages.asset_validation = results;
  let bad = 0;
  for (const r of results) {
    if (!r.ok) {
      bad++;
      r.issues.forEach(i => report.errors.push(`[ASSET ${r.asset_id}] ${i}`));
      console.error(`${r.asset_id}: ${r.issues.join(' | ')}`);
    }
  }
  console.log(bad === 0 ? 'all assets OK' : `${bad} assets failed`);
  return bad === 0;
});

// ---- shared: packing (zones always come from the base plan) ----
function packScene(basePlan, solvedInstances, metaExtra = {}) {
  const zonesOut = buildZoneContexts(basePlan).map(zc => ({
    zone_id: zc.zone.zone_id,
    boundary_points: zc.points,
    aabb: zc.aabb,
    elevation: zc.zone.elevation || basePlan.scene_meta.elevation || { type: 'flat', height: 0 },
    terrain: zc.zone.terrain !== false,
    color: zc.zone.color || null
  }));
  const out = packWorld({
    scenePlan: { ...basePlan, scene_meta: { ...basePlan.scene_meta, ...metaExtra } },
    zonesOut,
    instancesOut: solvedInstances,
    registry,
    outDir: sceneDir
  });
  console.log(`packed: ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
  return out;
}

function checkZonePolicy(zones, instances) {
  const zoneById = new Map(zones.map(z => [z.zone_id, z]));
  const errs = [];
  for (const inst of instances) {
    const z = zoneById.get(inst.zone_id);
    const def = registry.defs.get(inst.asset_id);
    if (!z || !def) continue;
    const deny = z.deny_asset_types || [];
    const allow = z.allow_asset_types || ['*'];
    const cat = def.category;
    if (deny.includes(inst.asset_id) || deny.includes(cat) || deny.includes('*')) {
      errs.push(`asset '${inst.asset_id}' (${cat}) denied in zone '${z.zone_id}'`);
    } else if (!allow.includes('*') && !allow.includes(inst.asset_id) && !allow.includes(cat)) {
      errs.push(`asset '${inst.asset_id}' (${cat}) not allowed in zone '${z.zone_id}'`);
    }
  }
  return errs;
}

let worldFile = null;
let solveSummary = { failures: [] };

// ================================================================ BASE
if (report.mode === 'base') {
  const plan = stage('LOAD SCENE PLAN', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(sceneDir, 'scene-plan.json'), 'utf8'));
    const res = validateDocument('scene-plan', 'scene-plan', scenePlanSchema, doc);
    if (!res.ok) {
      res.errors.forEach(e => report.errors.push(`[SCHEMA scene-plan] ${e}`));
      console.error(res.errors.join('\n'));
      return null;
    }
    console.log(`plan OK: ${doc.scene_meta.name}, ${doc.zones.length} zones`);
    return doc;
  });
  if (!plan) { writeReport(); process.exit(1); }

  stage('CONSTRAINT VOCABULARY', () => {
    const errs = [];
    for (const z of plan.zones) {
      errs.push(...validateConstraintVocabulary([], z.constraints || []).map(e => `zone '${z.zone_id}': ${e}`));
      for (const p of z.placements || []) {
        errs.push(...validateConstraintVocabulary(p.constraints, []).map(e => `asset '${p.asset_id}' in zone '${z.zone_id}': ${e}`));
      }
    }
    if (errs.length) {
      errs.forEach(e => report.errors.push(`[VOCAB] ${e}`));
      return null;
    }
    console.log('vocabulary OK');
    return true;
  });

  const expansion = stage('EXPAND PLAN -> INSTANCE LIST', () => {
    const { instances, errors } = expandPlan(plan, registry);
    errors.forEach(e => report.errors.push(e));
    for (const inst of instances) inst._def = registry.defs.get(inst.asset_id);
    console.log(`instances: ${instances.length}`);
    return { instances };
  });
  if (!expansion) { writeReport(); process.exit(1); }

  const lint = stage('LINT MASTERPLAN (seam risks)', () => {
    const warnings = lintPlan(plan);
    report.plan_lint = warnings;
    if (warnings.length) {
      console.log(`plan-lint: ${warnings.length} warning(s)`);
      for (const w of warnings) console.log(`  [${w.rule}] ${Array.isArray(w.zone) ? w.zone.join(' <-> ') : w.zone}: ${w.detail}`);
    } else {
      console.log('plan-lint: clean');
    }
    return warnings;
  });

  solveSummary = stage('SOLVE WORLD COORDINATES', () => {
    const deny = checkZonePolicy(plan.zones, expansion.instances);
    deny.forEach(e => report.errors.push(`[ZONE POLICY] ${e}`));
    if (deny.length) return { failures: [{ reason: 'zone_policy' }], stats: {} };

    const { solved, failures, stats } = solveInstances(expansion.instances, plan);
    report.stages.solve = { ...stats, failures };
    if (failures.length) {
      const byReason = {};
      failures.forEach(f => { byReason[f.reason] = (byReason[f.reason] || 0) + 1; });
      console.warn(`unsolved: ${failures.length}`, byReason);
    }
    console.log(`solved ${stats.solved}/${stats.solved + stats.failed} (${stats.attempts} attempts)`);
    const solvedList = expansion.instances.filter(i => i.solved).map(i => i.solved);
    writeSolved(solvedList);
    writeInstanceList(plan.scene_meta.name, solvedList);
    return { solved: solvedList, failures, stats };
  });

  if (solveSummary && solveSummary.solved) {
    worldFile = stage('PACK WORLD.HTML', () => packScene(plan, solveSummary.solved));
  }
}

// ================================================================ REFINE
if (report.mode === 'refine') {
  const basePlan = JSON.parse(fs.readFileSync(path.join(sceneDir, 'scene-plan.json'), 'utf8'));
  const refinePlan = stage('LOAD REFINE PLAN', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(sceneDir, refineFile), 'utf8'));
    const res = validateDocument('refine-plan', 'scene-plan', scenePlanSchema, doc);
    if (!res.ok) {
      res.errors.forEach(e => report.errors.push(`[SCHEMA refine-plan] ${e}`));
      console.error(res.errors.join('\n'));
      return null;
    }
    for (const z of doc.zones) {
      if (!z.anchor) {
        report.warnings.push(`[REFINE] zone '${z.zone_id}' has no anchor - treated as world-space zone`);
      }
    }
    console.log(`refine plan OK: ${doc.scene_meta.name}, ${doc.zones.length} zones`);
    return doc;
  });
  if (!refinePlan) { writeReport(); process.exit(1); }

  const solvedBefore = stage('LOAD SOLVED WORLD', () => {
    const list = loadSolved();
    console.log(`existing instances: ${list.length}`);
    return list;
  });
  if (!solvedBefore) { writeReport(); process.exit(1); }

  const anchorMap = new Map(solvedBefore.map(s => [s.instance_id, s]));

  const expansion = stage('EXPAND REFINE INSTANCES', () => {
    const { instances, errors } = expandPlan(refinePlan, registry);
    errors.forEach(e => report.errors.push(e));
    for (const inst of instances) inst._def = registry.defs.get(inst.asset_id);
    // anchor existence check
    for (const z of refinePlan.zones) {
      if (z.anchor && !anchorMap.has(z.anchor.instance_id)) {
        report.errors.push(`[REFINE] anchor '${z.anchor.instance_id}' (zone ${z.zone_id}) not found in solved world`);
      }
    }
    console.log(`refine instances: ${instances.length}`);
    return { instances };
  });
  if (!expansion || report.errors.length) { writeReport(); process.exit(1); }

  solveSummary = stage('SOLVE REFINEMENT INCREMENTS', () => {
    const envPlaced = rebuildPlaced(solvedBefore, registry);
    const zoneContexts = buildZoneContexts(refinePlan, anchorMap);
    const deny = checkZonePolicy(refinePlan.zones, expansion.instances);
    deny.forEach(e => report.errors.push(`[ZONE POLICY] ${e}`));
    if (deny.length) return { failures: [{ reason: 'zone_policy' }], stats: {} };

    const { solved, failures, stats } = solveInstances(expansion.instances, refinePlan, { envPlaced, zoneContexts, anchorSolved: anchorMap });
    report.stages.refine_solve = { ...stats, failures };
    if (failures.length) console.warn(`unsolved: ${failures.length}`);
    console.log(`refined ${stats.solved}/${stats.solved + stats.failed} (${stats.attempts} attempts)`);
    const solvedList = [...solvedBefore, ...solved];
    writeSolved(solvedList);
    writeInstanceList(refinePlan.scene_meta.name, solvedList);
    return { solved: solvedList, failures, stats };
  });

  if (solveSummary && solveSummary.solved) {
    worldFile = stage('PACK WORLD.HTML', () =>
      packScene(basePlan, solveSummary.solved, { name: `${basePlan.scene_meta.name} + ${refinePlan.scene_meta.name}` }));
  }
}

// ================================================================ PATCH
if (report.mode === 'patch') {
  const basePlan = JSON.parse(fs.readFileSync(path.join(sceneDir, 'scene-plan.json'), 'utf8'));
  const patchDoc = stage('LOAD PATCH FILE', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(sceneDir, patchFile), 'utf8'));
    const res = validateDocument('patch', 'patch', patchFileSchema, doc);
    if (!res.ok) {
      res.errors.forEach(e => report.errors.push(`[SCHEMA patch] ${e}`));
      console.error(res.errors.join('\n'));
      return null;
    }
    console.log(`patch OK: ${doc.patches.length} ops`);
    return doc;
  });
  if (!patchDoc) { writeReport(); process.exit(1); }

  solveSummary = stage('APPLY PATCHES', () => {
    const solved = loadSolved().map(s => ({ ...s }));
    const byId = new Map(solved.map(s => [s.instance_id, s]));
    const patchIds = [];
    const failures = [];

    for (const p of patchDoc.patches) {
      if (p.op === 'remove') {
        if (byId.delete(p.instance_id)) patchIds.push(p.instance_id);
        else failures.push({ instance_id: p.instance_id, reason: 'patch_remove_unknown' });
        continue;
      }
      if (p.op === 'move') {
        const s = byId.get(p.instance_id);
        if (!s) { failures.push({ instance_id: p.instance_id, reason: 'patch_move_unknown' }); continue; }
        s.position = [
          +(s.position[0] + p.offset[0]).toFixed(3),
          +(s.position[1] + p.offset[1]).toFixed(3),
          +(s.position[2] + p.offset[2]).toFixed(3)
        ];
        s.patched = true;
        patchIds.push(p.instance_id);
        continue;
      }
      if (p.op === 'reparam') {
        const s = byId.get(p.instance_id);
        if (!s) { failures.push({ instance_id: p.instance_id, reason: 'patch_reparam_unknown' }); continue; }
        const def = registry.defs.get(s.asset_id);
        const merged = { ...s.params, ...p.params };
        for (const [k, v] of Object.entries(p.params)) {
          const prop = def?.params_schema?.properties?.[k];
          if (!prop) { report.errors.push(`[PATCH] '${s.instance_id}': param '${k}' unknown for ${s.asset_id}`); continue; }
          if (typeof v === 'number' && typeof prop.min === 'number' && v < prop.min) report.errors.push(`[PATCH] '${s.instance_id}': '${k}'=${v} below min ${prop.min}`);
          if (typeof v === 'number' && typeof prop.max === 'number' && v > prop.max) report.errors.push(`[PATCH] '${s.instance_id}': '${k}'=${v} above max ${prop.max}`);
        }
        s.params = merged;
        s.patched = true;
        patchIds.push(p.instance_id);
        continue;
      }
      if (p.op === 'add') {
        const def = registry.defs.get(p.asset_id);
        if (!def) { report.errors.push(`[PATCH] unknown asset '${p.asset_id}'`); continue; }
        // deterministic seed: FNV-1a of the new instance_id mixed with the scene seed
        let h = 2166136261;
        for (const ch of p.instance_id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
        const params = { ...defaultParams(def), ...(p.params || {}), _seed: (Math.abs(h) ^ (basePlan.scene_meta.seed ?? 1)) % 999999 + 1 };
        const zoneContexts = buildZoneContexts(basePlan);
        const zoneCtx = zoneContexts.find(zc => zc.zone.zone_id === p.zone_id);
        if (!zoneCtx) { report.errors.push(`[PATCH] zone '${p.zone_id}' not in base plan`); continue; }
        const inst = {
          instance_id: p.instance_id,
          asset_id: p.asset_id,
          zone_id: p.zone_id,
          params,
          constraints: (p.constraints || []).map(normalizeConstraint),
          orientation: def.orientation || 'random',
          rotation_hint: typeof p.rotation_y === 'number' ? p.rotation_y : null,
          _def: def
        };
        const others = solved.filter(s => s.instance_id !== p.instance_id);
        const envPlaced = rebuildPlaced(others, registry);
        const { solved: solvedOne, failures: f1 } = solveInstances([inst], basePlan, { envPlaced, zoneContexts });
        if (f1.length) {
          failures.push(...f1);
        } else {
          byId.set(p.instance_id, { ...solvedOne[0], patched: true });
          patchIds.push(p.instance_id);
        }
      }
    }

    // move-collision sanity check (warnings only: user explicitly moved it)
    const finalList = [...byId.values()];
    const placedAll = rebuildPlaced(finalList, registry);
    for (const id of patchIds) {
      const me = placedAll.find(q => q.instance_id === id);
      if (!me || me.coll === undefined) continue;
      for (const other of placedAll) {
        if (other.instance_id === id) continue;
        if (other.y1 <= me.y + 0.05 || me.y1 <= other.y + 0.05) continue;
        const dx = Math.abs(me.x - other.x), dz = Math.abs(me.z - other.z);
        const bothBox = me.coll.kind === 'box' && other.coll.kind === 'box';
        const hit = bothBox
          ? (dx < me.coll.hw + other.coll.hw && dz < me.coll.hd + other.coll.hd)
          : true; // circle cases approximated; only flag definite box-box overlap
        if (hit && bothBox) {
          report.warnings.push(`[PATCH] moved '${id}' now overlaps '${other.instance_id}' (accepted, explicit user move)`);
          break;
        }
      }
    }

    report.stages.patch = { ops: patchDoc.patches.length, applied: patchIds.length, failures };
    console.log(`applied: ${patchIds.length}/${patchDoc.patches.length} ops, failures: ${failures.length}`);
    if (typeof patchDoc.time_of_day === 'number') {
      fs.writeFileSync(path.join(sceneDir, 'world-meta.json'), JSON.stringify({ time_of_day: patchDoc.time_of_day }));
      console.log(`time_of_day set to ${patchDoc.time_of_day}`);
    }
    writeSolved(finalList);
    writeInstanceList(`${basePlan.scene_meta.name} (patched)`, finalList);
    return { solved: finalList, failures, stats: { solved: patchIds.length, failed: failures.length } };
  });

  if (solveSummary && solveSummary.solved) {
    const metaExtra = solveSummary.solved.some(s => s.patched)
      ? { name: `${basePlan.scene_meta.name} + patch` } : {};
    worldFile = stage('PACK WORLD.HTML', () => packScene(basePlan, solveSummary.solved, metaExtra));
  }
}

// ---- routing + report ----
report.routing = routeErrors(report, solveSummary);
writeReport();

function routeErrors(rep, solve) {
  const e = rep.errors;
  const densityFailures = solve && solve.failures && solve.failures.length > 0;
  const schemaErrs = e.filter(x => x.startsWith('[SCHEMA') || x.startsWith('[VOCAB') || x.startsWith('[EXPAND') || x.startsWith('[REFINE]') || x.startsWith('[PATCH]'));
  const assetErrs = e.filter(x => x.startsWith('[ASSET '));
  if (e.length === 0 && !densityFailures) {
    return { type: 'OK', message: 'All stages passed.' };
  }
  if (schemaErrs.length) {
    return { type: 'FIX_PLAN_OR_ASSET_DEFINITION', message: 'JSON/schema errors found. Fix the flagged documents.', details: schemaErrs.slice(0, 20) };
  }
  if (assetErrs.length) {
    return { type: 'FIX_ASSET_CODE', message: 'Asset geometry violations. Repair the flagged asset_id components.', details: assetErrs.slice(0, 20) };
  }
  if (densityFailures) {
    return { type: 'FIX_PLAN_DENSITY', message: 'Some instances could not be placed. Reduce density, relax spacing or parameter ranges.', details: solve.failures.slice(0, 30) };
  }
  return { type: 'REVIEW', message: 'Manual review required.', details: e.slice(0, 20) };
}

function writeReport() {
  report.world_file = worldFile;
  if (!report.routing) report.routing = routeErrors(report, solveSummary);
  const jsonPath = path.join(sceneDir, 'validation-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(sceneDir, 'validation-report.md'), renderMarkdown(report));
  const ok = report.errors.length === 0;
  console.log(`\nreport: ${jsonPath}`);
  console.log(`routing: ${report.routing.type}`);

  // versioned snapshot for edit rounds: world.html -> world_E<session>.<save>.html
  if (editSave && ok && report.routing.type === 'OK' && worldFile) {
    const statePath = path.join(sceneDir, 'edit-state.json');
    let st = { session: 1, saves: 0 };
    try { st = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) { /* fresh */ }
    if (newSession) { st.session += 1; st.saves = 0; }
    st.saves += 1;
    const ver = `E${st.session}.${st.saves}`;
    const snapshot = path.join(sceneDir, `world_${ver}.html`);
    fs.copyFileSync(path.join(sceneDir, 'world.html'), snapshot);
    fs.writeFileSync(statePath, JSON.stringify(st, null, 2));
    console.log(`edit-save: ${snapshot}`);
    report.edit_save = { version: ver, file: `world_${ver}.html` };
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  }

  console.log(ok && report.routing.type === 'OK' ? 'PIPELINE OK' : 'PIPELINE ISSUES (see report)');
  process.exitCode = ok && report.routing.type === 'OK' ? 0 : 1;
}

function renderMarkdown(rep) {
  const L = [];
  L.push(`# Validation Report — ${rep.scene} (${rep.mode})`);
  L.push(`- time: ${rep.timestamp}`);
  L.push(`- world: ${rep.world_file || '(not packed)'}`);
  L.push('');
  L.push('## Errors');
  if (rep.errors.length === 0) L.push('- none');
  else rep.errors.forEach(e => L.push(`- ${e}`));
  L.push('');
  L.push('## Warnings');
  if (rep.warnings.length === 0) L.push('- none');
  else rep.warnings.forEach(w => L.push(`- ${w}`));
  L.push('');
  for (const [k, s] of Object.entries(rep.stages)) {
    if (!s || s.failures === undefined) continue;
    L.push(`## ${k}`);
    L.push(`- solved: ${s.solved ?? '-'}, failed: ${s.failed ?? '-'}, attempts: ${s.attempts ?? '-'}`);
    if (s.failures && s.failures.length) {
      L.push('| instance | reason |');
      L.push('|---|---|');
      s.failures.forEach(f => L.push(`| ${f.instance_id} | ${f.reason} |`));
    }
    L.push('');
  }
  if (rep.stages.asset_validation) {
    L.push('## Asset Validation');
    L.push('| asset | status | max tris | issues |');
    L.push('|---|---|---|---|');
    rep.stages.asset_validation.forEach(a =>
      L.push(`| ${a.asset_id} | ${a.ok ? 'OK' : 'FAIL'} | ${a.max_triangles} | ${a.issues.join('; ') || '-'} |`));
    L.push('');
  }
  L.push('## Next Action (routing)');
  L.push(`- type: **${rep.routing.type}**`);
  L.push(`- message: ${rep.routing.message}`);
  return L.join('\n');
}
