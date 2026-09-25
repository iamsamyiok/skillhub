import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

const paramProp = {
  type: ['number', 'object', 'string', 'boolean'],
  additionalProperties: true
};

export const scenePlanSchema = {
  type: 'object',
  required: ['scene_meta', 'zones'],
  properties: {
    scene_meta: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        seed: { type: 'number' },
        global_safety_distance: { type: 'number', minimum: 0 },
        elevation: {
          type: 'object',
          properties: {
            type: { enum: ['flat', 'slope', 'noise'] },
            height: { type: 'number' },
            base: { type: 'number' },
            direction_deg: { type: 'number' },
            rise_per_m: { type: 'number' },
            amplitude: { type: 'number' },
            frequency: { type: 'number' },
            octaves: { type: 'integer', minimum: 1, maximum: 6 },
            seed: { type: 'number' }
          }
        },
        camera: { type: 'object' },
        world_bounds_hint: {
          type: 'object',
          properties: { width: { type: 'number' }, depth: { type: 'number' } }
        }
      }
    },
    zones: {
      type: 'array', minItems: 1,
      items: {
        type: 'object',
        required: ['zone_id', 'boundary'],
        properties: {
          zone_id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]*$' },
          anchor: {
            type: 'object',
            required: ['instance_id'],
            properties: { instance_id: { type: 'string' } }
          },
          boundary: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { enum: ['rect', 'circle', 'polygon'] },
              center: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              width: { type: 'number' }, depth: { type: 'number' },
              radius: { type: 'number' }, segments: { type: 'integer' },
              points: { type: 'array', minItems: 3, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } }
            }
          },
          elevation: { type: 'object' },
          terrain: { type: 'boolean' },
          color: { type: 'string' },
          constraints: { type: 'array', items: { type: 'string' } },
          allow_asset_types: { type: 'array', items: { type: 'string' } },
          deny_asset_types: { type: 'array', items: { type: 'string' } },
          placements: {
            type: 'array',
            items: {
              type: 'object',
              required: ['asset_id'],
              properties: {
                asset_id: { type: 'string' },
                count: { type: 'integer', minimum: 0 },
                params: { type: 'object', additionalProperties: paramProp },
                constraints: {
                  type: 'array',
                  items: {
                    anyOf: [
                      { type: 'string', enum: ['inside_zone', 'no_placement', 'no_overlap', 'align_to_surface', 'keep_inside_bounds'] },
                      {
                        type: 'object', minProperties: 1, maxProperties: 1,
                        properties: {
                          min_distance_to_asset_type: { type: 'array', minItems: 2, maxItems: 2 },
                          max_elevation_diff: { type: 'array', minItems: 1, maxItems: 1 }
                        }
                      }
                    ]
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

export const assetDefinitionSchema = {
  type: 'object',
  required: ['asset_id', 'category', 'params_schema', 'asset_module'],
  properties: {
    asset_id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
    name: { type: 'string' },
    category: { type: 'string' },
    version: { type: 'integer' },
    origin: { enum: ['base_center'] },
    orientation: { enum: ['random', 'fixed'] },
    asset_module: { type: 'string' },
    footprint: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { enum: ['circle', 'box'] },
        radius: { type: 'number' }, radius_param: { type: 'string' },
        half_width: { type: 'number' }, hw_param: { type: 'string' },
        half_depth: { type: 'number' }, hd_param: { type: 'string' }
      }
    },
    max_triangles: { type: 'integer', minimum: 1 },
    height: {
      type: 'object',
      properties: {
        param: { type: 'string' },
        factor: { type: 'number' },
        offset: { type: 'number' }
      }
    },
    params_schema: {
      type: 'object',
      required: ['type', 'properties'],
      properties: {
        type: { enum: ['object'] },
        required: { type: 'array', items: { type: 'string' } },
        properties: {
          type: 'object', additionalProperties: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              min: { type: 'number' }, max: { type: 'number' },
              default: {}, values: { type: 'array' },
              description: { type: 'string' }
            }
          }
        }
      }
    }
  }
};

export const instanceListSchema = {
  type: 'object',
  required: ['scene', 'instances'],
  properties: {
    scene: { type: 'string' },
    instances: {
      type: 'array',
      items: {
        type: 'object',
        required: ['instance_id', 'asset_id', 'zone_id', 'params'],
        properties: {
          instance_id: { type: 'string' },
          asset_id: { type: 'string' },
          zone_id: { type: 'string' },
          params: { type: 'object' },
          constraints: { type: 'array' }
        }
      }
    }
  }
};

const compiled = new Map();
function getValidator(name, schema) {
  if (!compiled.has(name)) compiled.set(name, ajv.compile(schema));
  return compiled.get(name);
}

export const patchFileSchema = {
  type: 'object',
  required: ['patches'],
  properties: {
    description: { type: 'string' },
    time_of_day: { type: 'number', minimum: 0, maximum: 24 },
    patches: {
      type: 'array', minItems: 1,
      items: {
        type: 'object',
        required: ['op', 'instance_id'],
        properties: {
          op: { enum: ['move', 'reparam', 'remove', 'add'] },
          instance_id: { type: 'string', description: 'for op=add this is the new id' },
          offset: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          params: { type: 'object' },
          asset_id: { type: 'string' },
          zone_id: { type: 'string' },
          constraints: { type: 'array' }
        }
      }
    }
  }
};

export function validateDocument(kind, schemaName, schema, doc) {
  const v = getValidator(schemaName, schema);
  const ok = v(doc);
  return {
    kind,
    ok,
    errors: ok ? [] : v.errors.map(e => `${e.instancePath || '(root)'} ${e.message}`)
  };
}
