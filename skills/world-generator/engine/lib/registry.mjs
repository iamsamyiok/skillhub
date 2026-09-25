// Asset registry: scans asset library directories for definition.json + asset.js
// pairs. Library order (later wins): engine/assets (built-in) -> <scene>/new-assets
// (per-scene AI-generated). This implements the global asset_id reuse model.
import fs from 'node:fs';
import path from 'node:path';

export function loadRegistry(directories) {
  const defs = new Map();
  const sources = new Map();
  const factories = new Map();
  const loadErrors = [];

  for (const dir of directories) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const adir = path.join(dir, entry.name);
      const defFile = path.join(adir, 'definition.json');
      const srcFile = path.join(adir, 'asset.js');
      if (!fs.existsSync(defFile)) continue;
      let def;
      try {
        def = JSON.parse(fs.readFileSync(defFile, 'utf8'));
      } catch (err) {
        loadErrors.push(`Bad definition.json in ${adir}: ${err.message}`);
        continue;
      }
      if (fs.existsSync(srcFile)) {
        const src = fs.readFileSync(srcFile, 'utf8');
        sources.set(def.asset_id, src);
      } else {
        loadErrors.push(`asset.js missing for '${def.asset_id}' in ${adir}`);
        continue;
      }
      defs.set(def.asset_id, { ...def, _dir: adir });
    }
  }
  return { defs, sources, factories, loadErrors };
}
