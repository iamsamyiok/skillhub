function createAsset(params) {
  const THREE_ = THREE;
  const totalH = params.total_height;
  const r = params.crown_radius;
  const irr = params.irregularity;

  let seed = (params._seed || 1) >>> 0;
  function rnd() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const group = new THREE_.Group();

  const trunkH = totalH * 0.42;
  const trunk = new THREE_.Mesh(
    new THREE_.CylinderGeometry(r * 0.09, r * 0.14, trunkH, 7),
    new THREE_.MeshLambertMaterial({ color: 0x6d4f35 })
  );
  trunk.position.y = trunkH / 2;
  group.add(trunk);

  const hue = 0.28 + (params.hue_shift || 0);
  const crownCenterY = trunkH + r * 0.72;
  const lumps = 3;
  for (let i = 0; i < lumps; i++) {
    const lr = r * (0.62 + rnd() * 0.3);
    const geom = new THREE_.IcosahedronGeometry(lr, 1);
    const pos = geom.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const k = 1 - irr + rnd() * irr * 2;
      pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * k * 0.92, pos.getZ(v) * k);
    }
    geom.computeVertexNormals();
    const ang = (i / lumps) * Math.PI * 2 + rnd();
    const off = r * 0.4;
    const lump = new THREE_.Mesh(
      geom,
      new THREE_.MeshLambertMaterial({ color: new THREE_.Color().setHSL(hue, 0.4, 0.3 + i * 0.03), flatShading: true })
    );
    lump.position.set(Math.cos(ang) * off, crownCenterY + (i - 1) * r * 0.34, Math.sin(ang) * off);
    group.add(lump);
  }

  // origin normalization: recentre children so bbox centre xz sits at (0,0)
  const box = new THREE_.Box3().setFromObject(group);
  const c = box.getCenter(new THREE_.Vector3());
  for (const ch of group.children) {
    ch.position.x -= c.x;
    ch.position.z -= c.z;
  }

  return group;
}
