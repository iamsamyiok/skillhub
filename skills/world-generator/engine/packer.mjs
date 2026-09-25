// Packager: bundles everything into a single interactive world.html.
// - three.module.js embedded as <script type="module"> with a window.THREE shim
//   generated from its export block (no CDN dependency, works offline)
// - selected examples/jsm addons (postprocessing chain + GLTFExporter)
//   embedded the same way: 'three' imports become window.THREE destructures,
//   relative imports are stripped via dependency-order concatenation
// - elevation field function source injected verbatim (Node/browser parity)
// - asset sources injected as strings, evaluated with the same loadAssetFactory
//   mechanism used in Node validation
// - solved instance data + zone geometry data embedded as JSON
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeElevationField } from './lib/elevation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildThreeShim(threeSource) {
  const m = threeSource.match(/export\s*\{([\s\S]*?)\};?\s*$/);
  if (!m) throw new Error('Cannot locate export block in three.module.js');
  const names = m[1].split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const asMatch = entry.match(/^(\S+)\s+as\s+(\S+)$/);
    return asMatch ? { from: asMatch[1], to: asMatch[2] } : { from: entry, to: entry };
  });
  const entries = names.map(n =>
    n.from === n.to ? n.to : `${JSON.stringify(n.to)}: ${n.from}`
  ).join(',\n');
  return `const __threeShim = {\n${entries}\n};\nwindow.THREE = __threeShim;\nwindow.THREE_IS_READY = true;`;
}

// Dependency order matters: relative imports are stripped and symbols resolve
// through concatenation scope.
const ADDON_FILES = [
  'postprocessing/Pass.js',
  'shaders/CopyShader.js',
  'shaders/LuminosityHighPassShader.js',
  'shaders/OutputShader.js',
  'postprocessing/MaskPass.js',
  'postprocessing/ShaderPass.js',
  'postprocessing/RenderPass.js',
  'postprocessing/EffectComposer.js',
  'postprocessing/UnrealBloomPass.js',
  'postprocessing/OutputPass.js',
  'exporters/GLTFExporter.js'
];
const ADDON_EXPORTS = ['EffectComposer', 'RenderPass', 'ShaderPass', 'UnrealBloomPass', 'OutputPass', 'GLTFExporter'];

// resolve a file inside the installed three package, walking up from the
// engine dir so the skill works from a bare repo (npm install at any level)
function threePath(rel) {
  const candidates = [];
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    candidates.push(path.join(dir, 'node_modules', 'three', rel));
    dir = path.dirname(dir);
  }
  candidates.push(path.join(process.cwd(), 'node_modules', 'three', rel));
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(`three not found (looked for ${rel}; run npm install)`);
}

function bundleAddons() {
  const threeNames = new Set();
  const parts = [];
  for (const rel of ADDON_FILES) {
    let src = fs.readFileSync(threePath(path.join('examples', 'jsm', rel)), 'utf8');
    // match import statements (multiline) from 'three' or relative specifiers
    const importRe = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g;
    src = src.replace(importRe, (_, namesRaw, spec) => {
      if (spec === 'three') {
        namesRaw.split(',').map(s => s.trim()).filter(Boolean).forEach(n => {
          const asMatch = n.match(/^(\S+)\s+as\s+(\S+)$/);
          threeNames.add(asMatch ? asMatch[2] : n);
        });
        return ''; // covered by the shared destructure
      }
      return `/* stripped relative import: ${spec} */`; // symbol from concat scope
    });
    const leftovers = src.match(/^\s*import[\s\S]*?;/m);
    if (leftovers) throw new Error(`Unresolved import form in ${rel}: ${leftovers[0].slice(0, 120)}`);
    parts.push(`// ---- addon: ${rel} ----\n${src}`);
  }
  const destructure = `const { ${[...threeNames].sort().join(', ')} } = window.THREE;`;
  const shim = `window.THREE_ADDONS = { ${ADDON_EXPORTS.join(', ')} };`;
  const code = destructure + '\n\n' + parts.join('\n\n') + '\n\n' + shim;
  return code.replace(/<\/script/gi, '<\\/script');
}

export function packWorld({ scenePlan, zonesOut, instancesOut, registry, outDir }) {
  const template = fs.readFileSync(path.join(__dirname, 'viewer-template.html'), 'utf8');
  const threeSource = fs.readFileSync(threePath('build/three.module.js'), 'utf8');
  const shim = buildThreeShim(threeSource);
  const elevSource = makeElevationField.toString();

  const assetSources = {};
  for (const [id, src] of registry.sources.entries()) assetSources[id] = src;

  // scene-level runtime meta overlay (e.g. time_of_day patched after solve)
  let runtimeMeta = {};
  const metaOverlay = path.join(outDir, 'world-meta.json');
  if (fs.existsSync(metaOverlay)) {
    try { runtimeMeta = JSON.parse(fs.readFileSync(metaOverlay, 'utf8')); } catch { /* ignore bad overlay */ }
  }

  const payload = {
    meta: {
      name: scenePlan.scene_meta.name,
      seed: scenePlan.scene_meta.seed ?? 1,
      safety: scenePlan.scene_meta.global_safety_distance ?? 0.3,
      time_of_day: runtimeMeta.time_of_day ?? scenePlan.scene_meta.time_of_day ?? 14,
      elevation: scenePlan.scene_meta.elevation || null
    },
    zones: zonesOut,
    instances: instancesOut
  };

  // three.module.js runs inside a module script so its top-level symbols are
  // visible to the shim; the shim then exposes them as window.THREE.
  const safeThree = threeSource.replace(/<\/script/gi, '<\\/script');
  const moduleCode = safeThree + '\n' + shim;

  // Standard JSON-in-HTML safety: escape '<' so no embedded payload can
  // terminate the script block early.
  const jsonForHtml = v => JSON.stringify(v).replace(/</g, '\\u003c');

  const html = template
    .replace('/*__THREE_MODULE__*/', () => moduleCode)
    .replace('/*__ADDONS_MODULE__*/', () => bundleAddons())
    .replace('"__ELEV_FN__"', () => jsonForHtml(elevSource))
    .replace('"__ASSET_SOURCES__"', () => jsonForHtml(assetSources))
    .replace('"__WORLD_DATA__"', () => jsonForHtml(payload));

  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'world.html');
  fs.writeFileSync(out, html);
  return out;
}
