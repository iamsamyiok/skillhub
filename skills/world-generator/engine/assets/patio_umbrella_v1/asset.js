function createAsset(params) {
  const THREE_ = THREE;
  const r = params.canopy_radius;
  const h = params.pole_height;
  const group = new THREE_.Group();

  const base = new THREE_.Mesh(
    new THREE_.CylinderGeometry(0.22, 0.28, 0.12, 10),
    new THREE_.MeshLambertMaterial({ color: 0x7d8288 })
  );
  base.position.y = 0.06;
  group.add(base);

  const pole = new THREE_.Mesh(
    new THREE_.CylinderGeometry(0.04, 0.05, h, 8),
    new THREE_.MeshLambertMaterial({ color: 0xb8bdc4 })
  );
  pole.position.y = h / 2 + 0.1;
  group.add(pole);

  const canopy = new THREE_.Mesh(
    new THREE_.ConeGeometry(r, r * 0.42, 12),
    new THREE_.MeshLambertMaterial({ color: new THREE_.Color().setHSL(params.canopy_hue, 0.62, 0.55), side: THREE_.DoubleSide })
  );
  canopy.position.y = h + 0.08 + r * 0.1;
  group.add(canopy);

  const finial = new THREE_.Mesh(
    new THREE_.SphereGeometry(0.05, 6, 5),
    new THREE_.MeshLambertMaterial({ color: 0x7d8288 })
  );
  finial.position.y = h + 0.18 + r * 0.42;
  group.add(finial);

  return group;
}
