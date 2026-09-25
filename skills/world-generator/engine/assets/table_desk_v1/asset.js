function createAsset(params) {
  const THREE_ = THREE;
  const W = params.width;
  const D = params.depth;
  const tint = params.wood_tint || 0;
  const group = new THREE_.Group();

  const wood = new THREE_.MeshLambertMaterial({
    color: new THREE_.Color().setHSL(0.09, 0.35, 0.42 + tint)
  });
  const metal = new THREE_.MeshLambertMaterial({ color: 0x4a5058 });

  const top = new THREE_.Mesh(new THREE_.BoxGeometry(W, 0.05, D), wood);
  top.position.set(0, 0.75, 0);
  group.add(top);

  const lx = W / 2 - 0.09, lz = D / 2 - 0.09;
  for (const sx of [-lx, lx]) {
    for (const sz of [-lz, lz]) {
      const leg = new THREE_.Mesh(new THREE_.BoxGeometry(0.06, 0.73, 0.06), metal);
      leg.position.set(sx, 0.365, sz);
      group.add(leg);
    }
  }

  return group;
}
