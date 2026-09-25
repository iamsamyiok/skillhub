import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';

// Load an asset module source into a createAsset(params) factory.
// Works identically in Node and in the browser (packaged HTML uses the same
// mechanism), so the createAsset signature stays literally as specified.
export function loadAssetFactory(source) {
  const factory = new Function('THREE', `${source}\n;return createAsset;`);
  return factory(THREE);
}

function collectStats(root) {
  let triangles = 0;
  let meshes = 0;
  const problems = [];
  root.updateMatrixWorld(true);
  root.traverse(obj => {
    if (obj.isMesh) {
      meshes++;
      const g = obj.geometry;
      if (!g || !g.isBufferGeometry) { problems.push('non-buffer geometry'); return; }
      if (!g.attributes.position) { problems.push('geometry without position attribute'); return; }
      if (!g.attributes.normal) { problems.push('geometry without normals (call computeVertexNormals)'); }
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
          problems.push('non-finite vertex coordinates'); break;
        }
      }
      const count = g.index ? g.index.count : pos.count;
      triangles += count / 3;
    }
  });
  return { triangles: Math.round(triangles), meshes, problems: [...new Set(problems)] };
}

// Validate one asset against its definition:
//  - constructs at min/default/max param corners
//  - origin contract: bounding box min.y ~= 0 and center xz ~= 0
//  - normals present, finite vertices, triangle budget respected
export function validateAsset(def, factory) {
  const issues = [];
  const props = def.params_schema?.properties || {};
  const defaults = {};
  for (const [k, v] of Object.entries(props)) {
    if (v.default !== undefined) defaults[k] = v.default;
  }
  const minParams = { ...defaults };
  const maxParams = { ...defaults };
  for (const [k, v] of Object.entries(props)) {
    if (v.min !== undefined) minParams[k] = v.min;
    if (v.max !== undefined) maxParams[k] = v.max;
  }

  let maxTriangles = 0;
  for (const [label, params] of [['min', minParams], ['default', defaults], ['max', maxParams]]) {
    let asset;
    try {
      asset = factory({ ...params, _seed: 7 });
    } catch (err) {
      issues.push(`[${label}] createAsset threw: ${err.message}`);
      continue;
    }
    if (!asset) { issues.push(`[${label}] createAsset returned ${asset}`); continue; }
    if (!(asset.isMesh || asset.isGroup)) {
      issues.push(`[${label}] returned object is neither THREE.Mesh nor THREE.Group`);
      continue;
    }
    const box = new THREE.Box3().setFromObject(asset);
    if (!Number.isFinite(box.min.y) || !Number.isFinite(box.max.y)) {
      issues.push(`[${label}] bounding box not finite`); continue;
    }
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    if (Math.abs(box.min.y) > 0.05) issues.push(`[${label}] origin contract violated: bbox.min.y=${box.min.y.toFixed(3)} (must be 0)`);
    if (Math.abs(cx) > 0.05) issues.push(`[${label}] origin contract violated: bbox center x=${cx.toFixed(3)} (must be 0)`);
    if (Math.abs(cz) > 0.05) issues.push(`[${label}] origin contract violated: bbox center z=${cz.toFixed(3)} (must be 0)`);
    if (box.max.y - box.min.y <= 0.001) issues.push(`[${label}] asset has zero height`);

    const stats = collectStats(asset);
    maxTriangles = Math.max(maxTriangles, stats.triangles);
    for (const p of stats.problems) issues.push(`[${label}] ${p}`);
    const budget = def.max_triangles ?? 5000;
    if (stats.triangles > budget) issues.push(`[${label}] triangle budget exceeded: ${stats.triangles} > ${budget}`);
  }

  return { asset_id: def.asset_id, ok: issues.length === 0, issues, max_triangles: maxTriangles };
}

export function validateAllAssets(registry) {
  const results = [];
  for (const def of registry.defs.values()) {
    const factory = registry.factories.get(def.asset_id);
    if (!factory) {
      results.push({ asset_id: def.asset_id, ok: false, issues: ['asset module source missing'], max_triangles: 0 });
      continue;
    }
    results.push(validateAsset(def, factory));
  }
  return results;
}
