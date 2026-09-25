import { Rng } from './rng.mjs';

// Normalize constraint entries from the plan/instance files into objects:
//   "inside_zone"                                  -> { type: 'inside_zone' }
//   { min_distance_to_asset_type: [type, num] }    -> { type: ..., asset_type, value }
export function normalizeConstraint(c) {
  if (typeof c === 'string') return { type: c };
  const keys = Object.keys(c);
  if (keys.length !== 1) throw new Error(`Invalid constraint entry: ${JSON.stringify(c)}`);
  const type = keys[0];
  const [a, b] = c[type];
  if (type === 'min_distance_to_asset_type') return { type, asset_type: a, value: Number(b) };
  if (type === 'max_elevation_diff') return { type, value: Number(a) };
  throw new Error(`Unknown parameterized constraint: ${type}`);
}

const SPATIAL_TYPES = new Set([
  'inside_zone', 'no_overlap', 'keep_inside_bounds',
  'min_distance_to_asset_type', 'max_elevation_diff'
]);
const ZONE_LEVEL_TYPES = new Set(['no_placement']);

export function validateConstraintVocabulary(constraints, zoneConstraints) {
  const errors = [];
  const KNOWN = new Set([
    'inside_zone', 'no_placement', 'no_overlap', 'align_to_surface',
    'min_distance_to_asset_type', 'max_elevation_diff', 'keep_inside_bounds'
  ]);
  for (const c of constraints || []) {
    const n = normalizeConstraint(c);
    if (!KNOWN.has(n.type)) errors.push(`Unknown constraint '${n.type}'`);
    if (!SPATIAL_TYPES.has(n.type) && !ZONE_LEVEL_TYPES.has(n.type)) errors.push(`Constraint '${n.type}' is not valid on instances`);
  }
  for (const c of zoneConstraints || []) {
    if (typeof c !== 'string' || !KNOWN.has(c)) errors.push(`Unknown zone constraint '${JSON.stringify(c)}'`);
  }
  return errors;
}

// Expand scene-plan placements into a flat instance list.
// Params: number -> fixed; {min,max} -> sampled; {values:[..]} -> picked.
// A deterministic per-instance seed is injected as params._seed so asset
// geometry is reproducible both in Node validation and in the browser.
export function expandPlan(plan, assetRegistry) {
  const rng = new Rng(plan.scene_meta.seed ?? 1);
  const instances = [];
  const errors = [];

  for (const zone of plan.zones) {
    const placements = zone.placements || [];
    for (const p of placements) {
      const def = assetRegistry.defs.get(p.asset_id);
      if (!def) {
        errors.push(`[EXPAND] Missing asset definition for '${p.asset_id}' (zone ${zone.zone_id})`);
        continue;
      }
      if (p.asset_id in (zone.deny_asset_types || [])) {
        errors.push(`[EXPAND] Asset '${p.asset_id}' is denied in zone '${zone.zone_id}'`);
      }
      const count = p.count ?? 0;
      for (let i = 0; i < count; i++) {
        const params = {};
        const merged = { ...defaultParams(def), ...(p.params || {}) };
        for (const [k, v] of Object.entries(merged)) {
          if (typeof v === 'number') params[k] = v;
          else if (v && typeof v === 'object') {
            if (Array.isArray(v.values)) params[k] = rng.pick(v.values);
            else if (typeof v.min === 'number' && typeof v.max === 'number') params[k] = rng.range(v.min, v.max);
            else errors.push(`[EXPAND] Bad param spec '${k}' for '${p.asset_id}'`);
          } else {
            params[k] = v;
          }
        }
        const perr = checkParamsAgainstDefinition(params, def);
        if (perr) {
          errors.push(`[EXPAND] ${perr} (asset '${p.asset_id}' in zone '${zone.zone_id}')`);
        }
        params._seed = rng.int(1, 999999);
        instances.push({
          instance_id: `inst_${zone.zone_id}_${p.asset_id}_${String(i + 1).padStart(3, '0')}`,
          asset_id: p.asset_id,
          zone_id: zone.zone_id,
          params,
          constraints: (p.constraints || []).map(normalizeConstraint),
          orientation: def.orientation || 'random',
          rotation_hint: typeof p.rotation_y === 'number' ? p.rotation_y : null,
          solved: null
        });
      }
    }
  }
  return { instances, errors };
}

export function defaultParams(def) {
  const out = {};
  const props = def.params_schema?.properties || {};
  for (const [k, v] of Object.entries(props)) {
    if (v.default !== undefined) out[k] = v.default;
  }
  return out;
}

// Plan-level param ranges must live inside the asset definition's own range.
function checkParamsAgainstDefinition(params, def) {
  const props = def.params_schema?.properties || {};
  for (const [k, v] of Object.entries(params)) {
    if (k === '_seed') continue;
    const prop = props[k];
    if (!prop) return `Param '${k}' is not declared in asset definition`;
    if (typeof v === 'number' && typeof prop.min === 'number' && v < prop.min - 1e-9) {
      return `Param '${k}'=${v} below asset minimum ${prop.min}`;
    }
    if (typeof v === 'number' && typeof prop.max === 'number' && v > prop.max + 1e-9) {
      return `Param '${k}'=${v} above asset maximum ${prop.max}`;
    }
  }
  return null;
}
