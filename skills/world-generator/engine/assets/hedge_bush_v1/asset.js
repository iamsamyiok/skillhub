function createAsset(params) {
  const THREE_ = THREE;
  const r = params.radius;

  let seed = (params._seed || 1) >>> 0;
  function rnd() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const group = new THREE_.Group();

  const hue = 0.3 + (params.hue_shift || 0);
  const mounds = 2;
  for (let i = 0; i < mounds; i++) {
    const mr = r * (0.78 + rnd() * 0.3);
    const geom = new THREE_.IcosahedronGeometry(mr, 1);
    const pos = geom.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const k = 1 - 0.1 + rnd() * 0.2;
      pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * k * 0.78, pos.getZ(v) * k);
    }
    geom.computeVertexNormals();
    const box = new THREE_.Box3().setFromBufferAttribute(pos);
    geom.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const mound = new THREE_.Mesh(
      geom,
      new THREE_.MeshLambertMaterial({ color: new THREE_.Color().setHSL(hue, 0.42, 0.24 + i * 0.04), flatShading: true })
    );
    mound.position.set((rnd() - 0.5) * r * 0.7, 0, (rnd() - 0.5) * r * 0.7);
    group.add(mound);
  }

  const nFlowers = Math.round(params.flower * 7);
  for (let i = 0; i < nFlowers; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = r * (0.55 + rnd() * 0.35);
    const fh = r * 0.55 + rnd() * r * 0.5;
    const flower = new THREE_.Mesh(
      new THREE_.SphereGeometry(r * 0.13, 5, 4),
      new THREE_.MeshLambertMaterial({
        color: new THREE_.Color().setHSL(0.92 + rnd() * 0.06, 0.7, 0.72),
        emissive: new THREE_.Color(0xd06fa8),
        emissiveIntensity: 0.25
      })
    );
    flower.position.set(Math.cos(ang) * dist, fh, Math.sin(ang) * dist);
    group.add(flower);
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
