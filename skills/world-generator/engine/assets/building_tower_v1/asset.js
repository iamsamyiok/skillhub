function createAsset(params) {
  const THREE_ = THREE;
  const F = Math.max(2, Math.round(params.floors));
  const W = params.width;
  const D = params.depth;
  const FH = 3.2;    // storey height (world rule for this asset family)
  const ST = 0.25;   // slab thickness
  const glow = params.glass_glow ?? 0.45;
  const tint = params.accent_tint || 0;
  const group = new THREE_.Group();

  const concrete = new THREE_.MeshLambertMaterial({
    color: new THREE_.Color().setHSL(0.09, 0.06, 0.62 + tint)
  });
  const dark = new THREE_.MeshLambertMaterial({
    color: new THREE_.Color().setHSL(0.09, 0.04, 0.32 + tint)
  });
  // translucent curtain wall so refined interiors stay visible
  const glass = new THREE_.MeshPhongMaterial({
    color: new THREE_.Color().setHSL(0.55, 0.5, 0.35 + glow * 0.4),
    transparent: true,
    opacity: 0.18 + glow * 0.12,
    shininess: 80,
    side: THREE_.DoubleSide,
    depthWrite: false
  });

  const topY = F * FH + ST;

  // corner columns, full height
  const cx = W / 2 - 0.35, cz = D / 2 - 0.35;
  for (const sx of [-cx, cx]) {
    for (const sz of [-cz, cz]) {
      const col = new THREE_.Mesh(new THREE_.BoxGeometry(0.55, topY, 0.55), concrete);
      col.position.set(sx, topY / 2, sz);
      col.userData.surface = 'concrete';
      group.add(col);
    }
  }

  // slabs: ground (k=0) + one per floor above (k=1..F)
  for (let k = 0; k <= F; k++) {
    const slab = new THREE_.Mesh(new THREE_.BoxGeometry(W, ST, D), k === F ? dark : concrete);
    slab.position.set(0, k * FH + ST / 2, 0);
    slab.userData.surface = 'concrete';
    group.add(slab);
  }

  // curtain wall per storey: inset panels on all four sides
  const gx = W / 2 - 0.3, gz = D / 2 - 0.3;
  const wallH = FH - ST;
  for (let k = 0; k < F; k++) {
    const y = k * FH + ST + wallH / 2;
    const front = new THREE_.Mesh(new THREE_.PlaneGeometry(W - 1.2, wallH), glass);
    front.position.set(0, y, gz);
    group.add(front);
    const back = front.clone();
    back.position.z = -gz;
    group.add(back);
    const sideL = new THREE_.Mesh(new THREE_.PlaneGeometry(D - 1.2, wallH), glass);
    sideL.position.set(-gx, y, 0);
    sideL.rotation.y = Math.PI / 2;
    group.add(sideL);
    const sideR = sideL.clone();
    sideR.position.x = gx;
    group.add(sideR);
  }

  // roof parapet hint
  const core = new THREE_.Mesh(new THREE_.BoxGeometry(W * 0.35, 1.1, D * 0.35), dark);
  core.position.set(0, topY + 0.55, 0);
  group.add(core);

  // symmetric build: base-centre origin already satisfied
  return group;
}
