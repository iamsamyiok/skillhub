// Single self-contained function: its source text is injected verbatim into the
// packaged HTML so Node-side solving and browser-side rendering share the exact
// same elevation field. Do not reference any outer-scope symbol from this function.
function makeElevationField(cfg) {
  cfg = cfg || { type: 'flat', height: 0 };
  if (cfg.type === 'flat') {
    const h = cfg.height || 0;
    return function (x, z) { return h; };
  }
  if (cfg.type === 'slope') {
    const dir = ((cfg.direction_deg || 0) * Math.PI) / 180;
    const rise = cfg.rise_per_m || 0;
    const base = cfg.base || 0;
    return function (x, z) {
      return base + (Math.cos(dir) * x + Math.sin(dir) * z) * rise;
    };
  }
  // type === 'noise': deterministic value-noise from sin-hash, octaves sum
  const seed = cfg.seed || 0;
  const amp = cfg.amplitude || 1;
  const freq = cfg.frequency || 0.05;
  const octaves = cfg.octaves || 3;
  const base = cfg.base || 0;
  function hash2(ix, iz) {
    let s = Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function smooth(t) {
    return t * t * (3 - 2 * t);
  }
  function noise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = smooth(x - ix), fz = smooth(z - iz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  return function (x, z) {
    let sum = 0, a = 1, f = freq, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * f, z * f) * a;
      norm += a;
      a *= 0.5;
      f *= 2.07;
    }
    return base + ((sum / norm) * 2 - 1) * amp;
  };
}

export { makeElevationField };
