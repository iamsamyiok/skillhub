import { resolveBoundary, pointInPolygon, distToPolygonEdge, polygonAABB } from './geom.mjs';
import { makeElevationField } from './elevation.mjs';
import { Rng } from './rng.mjs';

// Resolve a footprint dimension: fixed number, or param reference with
// optional factor/offset (half_width = width * factor + offset).
function pickDim(spec, params, fallback, factor, offset) {
  if (typeof spec === 'number') return spec;
  if (typeof spec === 'string') {
    const v = params[spec];
    if (typeof v !== 'number') return fallback;
    return v * (factor ?? 1) + (offset ?? 0);
  }
  return fallback;
}

// Exact corner check for fixed-yaw box footprints; conservative circle for
// random-yaw boxes. Returns { corners: [[x,z]x4] } or { radius }.
function footprintShape(def, params, yaw) {
  const fp = def.footprint || { type: 'circle', radius: 0.5 };
  if (fp.type === 'circle') {
    return { radius: pickDim(fp.radius ?? fp.radius_param, params, 0.5, fp.factor, fp.offset) };
  }
  const hw = pickDim(fp.half_width ?? fp.hw_param, params, 0.5,
    fp.hw_factor ?? fp.factor, fp.hw_offset ?? fp.offset);
  const hd = pickDim(fp.half_depth ?? fp.hd_param, params, 0.5,
    fp.hd_factor ?? fp.factor, fp.hd_offset ?? fp.offset);
  if (yaw !== null) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const rot = (x, z) => [x * c + z * s, -x * s + z * c];
    return { corners: [
      rot(-hw, -hd), rot(hw, -hd), rot(hw, hd), rot(-hw, hd)
    ] };
  }
  return { radius: Math.hypot(hw, hd) };
}

// Collision shape for a placed instance: axis-aligned box (fixed yaw of
// multiples of 90 deg) or conservative circle (any other yaw).
function collisionShape(def, params, yaw) {
  const fp = def?.footprint;
  if (!fp || fp.type === 'circle') {
    return { kind: 'circle', r: pickDim(fp?.radius ?? fp?.radius_param, params, 0.5, fp?.factor, fp?.offset) };
  }
  const hw = pickDim(fp.half_width ?? fp.hw_param, params, 0.5,
    fp.hw_factor ?? fp.factor, fp.hw_offset ?? fp.offset);
  const hd = pickDim(fp.half_depth ?? fp.hd_param, params, 0.5,
    fp.hd_factor ?? fp.factor, fp.hd_offset ?? fp.offset);
  if (yaw !== null) {
    const q = Math.round(yaw / (Math.PI / 2));
    if (Math.abs(yaw - q * Math.PI / 2) < 1e-3) {
      const swap = Math.abs(q) % 2 === 1;
      return { kind: 'box', hw: swap ? hd : hw, hd: swap ? hw : hd };
    }
  }
  return { kind: 'circle', r: Math.hypot(hw, hd) };
}

// Exact overlap test between two collision shapes padded by safety.
function shapesOverlap(a, ax, az, b, bx, bz, safety) {
  const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
  if (a.kind === 'box' && b.kind === 'box') {
    return dx < a.hw + b.hw + safety && dz < a.hd + b.hd + safety;
  }
  if (a.kind === 'box') {
    // circle b vs box a
    const cx = Math.max(dx - a.hw, 0), cz = Math.max(dz - a.hd, 0);
    return Math.hypot(cx, cz) < b.r + safety;
  }
  if (b.kind === 'box') {
    const cx = Math.max(dx - b.hw, 0), cz = Math.max(dz - b.hd, 0);
    return Math.hypot(cx, cz) < a.r + safety;
  }
  return Math.hypot(dx, dz) < a.r + b.r + safety;
}

// Vertical extent of an instance: definition height expression, else a
// conservative multiple of the collision radius.
export function instanceHeight(def, params, fallback) {
  const h = def?.height;
  if (!h) return fallback;
  if (typeof h === 'number') return h;
  const v = params[h.param];
  if (typeof v !== 'number') return fallback;
  return v * (h.factor ?? 1) + (h.offset ?? 0);
}

// Rebuild the placed-environment records from previously solved instances so
// incremental refinements collide-check against the existing world.
export function rebuildPlaced(solvedInstances, registry) {
  return solvedInstances.map(s => {
    const def = registry.defs.get(s.asset_id);
    const yaw = s.rotation_y ?? 0;
    const coll = collisionShape(def, s.params, yaw);
    const r = coll.kind === 'circle' ? coll.r : Math.hypot(coll.hw, coll.hd);
    const y0 = s.position[1];
    return {
      x: s.position[0], z: s.position[2], y: y0,
      y1: y0 + instanceHeight(def, s.params, r * 1.5),
      r, coll,
      asset_id: s.asset_id,
      zone_id: s.zone_id,
      instance_id: s.instance_id
    };
  });
}

export function buildZoneContexts(plan, anchorSolved = null) {
  const sceneElev = makeElevationField(plan.scene_meta.elevation);
  return plan.zones.map(zone => {
    let points = resolveBoundary(zone.boundary);
    let aabb = polygonAABB(points);
    let elev = zone.elevation ? makeElevationField(zone.elevation) : sceneElev;
    let anchor = null;

    // anchored zones live in their anchor instance's local frame; the program
    // transforms boundary and elevation into world space (AI stays local).
    if (zone.anchor && anchorSolved) {
      const a = anchorSolved.get(zone.anchor.instance_id);
      if (!a) throw new Error(`Anchor instance '${zone.anchor.instance_id}' not solved yet`);
      anchor = a;
      const cy = Math.cos(a.rotation_y ?? 0), sy = Math.sin(a.rotation_y ?? 0);
      points = points.map(([x, z]) => [a.position[0] + x * cy + z * sy, a.position[2] - x * sy + z * cy]);
      aabb = polygonAABB(points);
      const localElev = elev;
      const invCy = cy, invSy = -sy;
      elev = (wx, wz) => {
        const dx = wx - a.position[0], dz = wz - a.position[2];
        const lx = dx * invCy + dz * invSy;
        const lz = -dx * invSy + dz * invCy;
        return a.position[1] + localElev(lx, lz);
      };
    }
    return {
      zone,
      points,
      aabb,
      elev,
      anchorId: zone.anchor?.instance_id ?? null,
      placements: zone.placements || []
    };
  });
}

// Solve world positions for all instances. Pure program responsibility:
// AI never computes coordinates. Deterministic given the same seed + inputs.
// opts.envPlaced: existing world to collide against (incremental refinement).
// opts.zoneContexts: prebuilt contexts (used when plan carries anchor zones).
export function solveInstances(instances, plan, opts = {}) {
  const safety = plan.scene_meta.global_safety_distance ?? 0.3;
  const rng = new Rng((plan.scene_meta.seed ?? 1) ^ 0x9E3779B9);
  const contexts = opts.zoneContexts ?? buildZoneContexts(plan, opts.anchorSolved ?? null);
  const zoneById = new Map(contexts.map(zc => [zc.zone.zone_id, zc]));
  const placed = opts.envPlaced ? opts.envPlaced.map(p => ({ ...p })) : [];
  const failures = [];
  const stats = { solved: 0, failed: 0, attempts: 0 };
  const MAX_ATTEMPTS = 600;

  // no_placement zones are hard-excluded territories; zones listed in
  // except_zones keep their own placement rights over that territory.
  const noPlacementZones = plan.zones
    .filter(z => (z.constraints || []).includes('no_placement'))
    .map(z => {
      const poly = zoneById.get(z.zone_id);
      return { zone_id: z.zone_id, points: poly.points, except: new Set(z.except_zones || []) };
    });

  for (const inst of instances) {
    const zc = zoneById.get(inst.zone_id);
    if (!zc) {
      failures.push({ instance_id: inst.instance_id, reason: 'unknown_zone', zone_id: inst.zone_id });
      stats.failed++;
      continue;
    }
    if ((zc.zone.constraints || []).includes('no_placement')) {
      failures.push({ instance_id: inst.instance_id, reason: 'zone_no_placement', zone_id: inst.zone_id });
      stats.failed++;
      continue;
    }

    const def = inst._def;
    const yaw = inst.orientation === 'fixed' ? (inst.rotation_hint ?? 0) : null;
    const fpShape = footprintShape(def, inst.params, yaw);
    const collShape = collisionShape(def, inst.params, yaw);
    const collRadius = collShape.kind === 'circle'
      ? collShape.r
      : Math.hypot(collShape.hw, collShape.hd);
    const thisColl = { kind: collShape.kind, r: collShape.r, hw: collShape.hw, hd: collShape.hd };
    const instHeight = instanceHeight(def, inst.params, collRadius * 1.5);
    let solved = null;
    let lastReason = 'max_attempts';

    for (let a = 0; a < MAX_ATTEMPTS; a++) {
      stats.attempts++;
      const x = rng.range(zc.aabb.minX, zc.aabb.maxX);
      const z = rng.range(zc.aabb.minZ, zc.aabb.maxZ);

      if (!pointInPolygon(x, z, zc.points)) { lastReason = 'outside_zone'; continue; }

      if (hasConstraint(inst, 'keep_inside_bounds')) {
        if (fpShape.corners) {
          let inside = true;
          for (const [cx, cz] of fpShape.corners) {
            if (!pointInPolygon(x + cx, z + cz, zc.points) ||
                distToPolygonEdge(x + cx, z + cz, zc.points) < safety) { inside = false; break; }
          }
          if (!inside) { lastReason = 'keep_inside_bounds'; continue; }
        } else if (distToPolygonEdge(x, z, zc.points) < fpShape.radius + safety) {
          lastReason = 'keep_inside_bounds'; continue;
        }
      }
      let overlap = false;
      for (const p of placed) {
        // anchor parent is exempt: children are part of their anchor instance
        if (zc.anchorId && p.instance_id === zc.anchorId) continue;
        // vertical separation exempts 2D collision (different storeys)
        if (p.y !== undefined && p.y1 !== undefined) {
          const instY0 = zc.elev(x, z);
          const instY1 = instY0 + instHeight;
          if (p.y1 <= instY0 + 0.05 || instY1 <= p.y + 0.05) continue;
        }
        if (hasConstraint(inst, 'no_overlap')) {
          if (shapesOverlap(thisColl, x, z, p.coll, p.x, p.z, safety)) {
            overlap = true; lastReason = 'no_overlap'; break;
          }
        }
        for (const c of inst.constraints) {
          if (c.type === 'min_distance_to_asset_type' && p.asset_id === c.asset_type) {
            const dx = p.x - x, dz = p.z - z;
            if (dx * dx + dz * dz < c.value * c.value) { overlap = true; lastReason = `min_distance_to_asset_type:${c.asset_type}`; break; }
          }
        }
        if (overlap) break;
      }
      if (overlap) continue;

      let elevOk = true;
      for (const c of inst.constraints) {
        if (c.type === 'max_elevation_diff') {
          const probeR = fpShape.radius ?? 0.5;
          const ys = [zc.elev(x, z)];
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2;
            ys.push(zc.elev(x + Math.cos(ang) * probeR, z + Math.sin(ang) * probeR));
          }
          const diff = Math.max(...ys) - Math.min(...ys);
          if (diff > c.value) { elevOk = false; lastReason = 'max_elevation_diff'; break; }
        }
      }
      if (!elevOk) continue;

      let inNoPlacement = false;
      for (const npz of noPlacementZones) {
        if (npz.except.has(zc.zone.zone_id)) continue;
        if (pointInPolygon(x, z, npz.points) || distToPolygonEdge(x, z, npz.points) < collRadius + safety) {
          inNoPlacement = true; lastReason = 'no_placement_zone'; break;
        }
      }
      if (inNoPlacement) continue;

      solved = { x, z };
      break;
    }

    if (!solved) {
      failures.push({ instance_id: inst.instance_id, reason: lastReason, attempts: MAX_ATTEMPTS });
      stats.failed++;
      continue;
    }

    const finalYaw = yaw ?? rng.angle();
    const y = zc.elev(solved.x, solved.z);
    const rec = {
      instance_id: inst.instance_id,
      asset_id: inst.asset_id,
      zone_id: inst.zone_id,
      position: [round3(solved.x), round3(y), round3(solved.z)],
      rotation_y: round4(finalYaw),
      params: inst.params
    };
    placed.push({
      x: solved.x, z: solved.z, y, y1: y + instHeight,
      r: collRadius, coll: thisColl,
      asset_id: inst.asset_id, zone_id: inst.zone_id,
      instance_id: inst.instance_id
    });
    inst.solved = rec;
    stats.solved++;
  }

  return { solved: instances.filter(i => i.solved).map(i => i.solved), failures, stats };
}

function hasConstraint(inst, type) {
  return inst.constraints.some(c => c.type === type);
}

function round3(v) { return Math.round(v * 1000) / 1000; }
function round4(v) { return Math.round(v * 10000) / 10000; }
