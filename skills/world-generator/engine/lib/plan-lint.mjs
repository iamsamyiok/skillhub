// plan-lint: masterplan seam-risk detection (warnings, never blocks the pipeline)
// Rules encoded here mirror SKILL.md "总图与地形拼接规范".
import { pointInPolygon, distToPolygonEdge, polygonAABB, resolveBoundary } from './geom.mjs';

function aabbOverlap(a, b, pad = 0) {
  return a.maxX + pad >= b.minX && b.maxX + pad >= a.minX &&
         a.maxZ + pad >= b.minZ && b.minZ + pad >= a.minZ ? true : false;
}

export function lintPlan(plan) {
  const warnings = [];
  const RAMP = 1.4; // must match viewer terrain RAMP
  const terrain = plan.zones.filter(z => z.terrain !== false);
  for (const z of plan.zones) z.boundary_points = resolveBoundary(z.boundary);
  const aabbs = new Map(terrain.map(z => [z.zone_id, polygonAABB(z.boundary_points)]));

  // sample points along every terrain zone edge (0.5m step)
  function edgeSamples(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 0.5));
      for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    }
    return out;
  }
  const samples = new Map(terrain.map(z => [z.zone_id, edgeSamples(z.boundary_points)]));

  // 1) narrow gap between two terrain zones (0.05–1.0m): lattice ramp cannot fill it,
  //    leaves a sliver of base -> visible seam
  for (let i = 0; i < terrain.length; i++) {
    for (let j = i + 1; j < terrain.length; j++) {
      const A = terrain[i], B = terrain[j];
      if (!aabbOverlap(aabbs.get(A.zone_id), aabbs.get(B.zone_id), 1.2)) continue;
      let gap = Infinity;
      for (const [x, z] of samples.get(A.zone_id)) {
        if (pointInPolygon(x, z, B.boundary_points)) { gap = 0; break; }
        gap = Math.min(gap, distToPolygonEdge(x, z, B.boundary_points));
      }
      if (gap > 0.05 && gap < 1.0) {
        warnings.push({ rule: 'seam_narrow_gap', zone: [A.zone_id, B.zone_id], detail: `gap ~${gap.toFixed(2)}m (keep 0 or >=${RAMP}m)` });
      }
    }
  }

  // 2) flat platform must clear the noise base amplitude nearby, else it reads as a
  //    floating slab / sunken plate against the rolling base
  const noiseZones = terrain.filter(z => (z.elevation || {}).type === 'noise');
  const flats = terrain.filter(z => (z.elevation || {}).type === 'flat');
  for (const F of flats) {
    const fh = F.elevation.height || 0;
    for (const N of noiseZones) {
      if (F.zone_id === N.zone_id) continue;
      if (!aabbOverlap(aabbs.get(F.zone_id), aabbs.get(N.zone_id), 2.5)) continue;
      const nMax = (N.elevation.base || 0) + (N.elevation.amplitude || 0);
      if (fh < nMax + 0.02) {
        warnings.push({ rule: 'platform_below_base', zone: F.zone_id, detail: `flat ${fh.toFixed(2)} < noise max ${nMax.toFixed(2)} of ${N.zone_id}` });
      }
    }
  }

  // 3) big height step where two flats overlap heavily (stacked platforms)
  for (let i = 0; i < flats.length; i++) {
    for (let j = i + 1; j < flats.length; j++) {
      const A = flats[i], B = flats[j];
      if (!aabbOverlap(aabbs.get(A.zone_id), aabbs.get(B.zone_id), 0)) continue;
      const step = Math.abs((A.elevation.height || 0) - (B.elevation.height || 0));
      if (step > 0.15) {
        warnings.push({ rule: 'platform_step', zone: [A.zone_id, B.zone_id], detail: `height step ${step.toFixed(2)}m > 0.15` });
      }
    }
  }

  // 4) paved/placement zones should be protected by a no_placement cover with
  //    except_zones naming them (keeps trees/rocks off pavement and out of ramps)
  const npZones = plan.zones.filter(z => (z.constraints || []).includes('no_placement'));
  for (const F of flats) {
    if (!(F.placements || []).length) continue;
    const za = aabbs.get(F.zone_id);
    const covered = npZones.some(np => {
      if (!(np.except_zones || []).includes(F.zone_id)) return false;
      const na = polygonAABB(np.boundary_points);
      return na.minX <= za.minX + 0.5 && na.maxX >= za.maxX - 0.5 &&
             na.minZ <= za.minZ + 0.5 && na.maxZ >= za.maxZ - 0.5;
    });
    if (!covered) {
      warnings.push({ rule: 'missing_np_cover', zone: F.zone_id, detail: 'no no_placement cover (with except_zones incl. this zone) found' });
    }
  }

  return warnings;
}
