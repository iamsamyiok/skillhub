function createAsset(params) {
  const THREE_ = THREE;
  const height = params.total_height;
  const crownR = params.crown_radius;
  const trunkR = Math.max(0.06, crownR * params.trunk_ratio);
  const tiers = Math.max(2, Math.round(params.tiers));

  const group = new THREE_.Group();

  const trunkH = height * 0.22;
  const trunk = new THREE_.Mesh(
    new THREE_.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 7),
    new THREE_.MeshLambertMaterial({ color: 0x6b4a2f })
  );
  trunk.position.y = trunkH / 2;
  group.add(trunk);

  const baseHue = 0.30 + (params.hue_shift || 0);
  const crownH = height - trunkH;
  const tierH = crownH / tiers;
  for (let i = 0; i < tiers; i++) {
    const t0 = i / tiers;
    const r = crownR * (1 - t0 * 0.62);
    const cone = new THREE_.Mesh(
      new THREE_.ConeGeometry(r, tierH * 1.35, 8),
      new THREE_.MeshLambertMaterial({ color: new THREE_.Color().setHSL(baseHue, 0.42, 0.26 + i * 0.035) })
    );
    cone.position.y = trunkH + tierH * (i + 0.55);
    group.add(cone);
  }
  return group;
}
