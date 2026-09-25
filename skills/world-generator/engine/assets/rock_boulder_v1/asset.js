function createAsset(params) {
  const THREE_ = THREE;
  const r = params.radius;
  const irr = params.irregularity;

  let seed = (params._seed || 1) >>> 0;
  function rnd() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const geom = new THREE_.IcosahedronGeometry(r, 1);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 - irr + rnd() * irr * 2;
    pos.setXYZ(i, x * k, y * k * params.squash, z * k);
  }
  geom.computeVertexNormals();

  const box = new THREE_.Box3().setFromBufferAttribute(pos);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  geom.translate(-cx, -box.min.y, -cz);

  const g = 0.42 + (params.tint || 0);
  const mesh = new THREE_.Mesh(
    geom,
    new THREE_.MeshLambertMaterial({ color: new THREE_.Color(g, g * 1.02, g * 0.96), flatShading: true })
  );
  return mesh;
}
