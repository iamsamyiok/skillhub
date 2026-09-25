function createAsset(params) {
  const THREE_ = THREE;
  const L = params.length;
  const W = params.width;
  const hue = params.cushion_hue ?? 0.07;
  const tint = params.frame_tint || 0;
  const group = new THREE_.Group();

  const frame = new THREE_.MeshLambertMaterial({
    color: new THREE_.Color().setHSL(0.09, 0.05, 0.35 + tint)
  });
  const cushion = new THREE_.MeshLambertMaterial({
    color: new THREE_.Color().setHSL(hue, 0.5, 0.55)
  });

  // four short legs
  const lx = L / 2 - 0.08, lz = W / 2 - 0.06;
  for (const sx of [-lx, lx]) {
    for (const sz of [-lz, lz]) {
      const leg = new THREE_.Mesh(new THREE_.BoxGeometry(0.05, 0.22, 0.05), frame);
      leg.position.set(sx, 0.11, sz);
      group.add(leg);
    }
  }

  // flat seat deck
  const seat = new THREE_.Mesh(new THREE_.BoxGeometry(L * 0.62, 0.05, W), cushion);
  seat.position.set(L * 0.16, 0.25, 0);
  group.add(seat);

  // reclined backrest, hinged at the rear end of the deck, rising toward -x
  const ang = 0.62;
  const dirX = -Math.cos(ang), dirY = Math.sin(ang);
  const backLen = L * 0.5;
  const pivotX = -L * 0.15, pivotY = 0.25;
  const back = new THREE_.Mesh(new THREE_.BoxGeometry(backLen, 0.05, W), cushion);
  back.position.set(pivotX + dirX * backLen / 2, pivotY + dirY * backLen / 2, 0);
  back.rotation.z = ang;
  group.add(back);

  // small head cushion near the top of the backrest
  const pillow = new THREE_.Mesh(new THREE_.BoxGeometry(0.18, 0.06, W * 0.8), cushion);
  pillow.position.set(pivotX + dirX * (backLen - 0.12), pivotY + dirY * (backLen - 0.12), 0);
  pillow.rotation.z = ang;
  group.add(pillow);

  // origin normalization: keep bbox base at y=0, centre xz at origin
  const box = new THREE_.Box3().setFromObject(group);
  const c = box.getCenter(new THREE_.Vector3());
  for (const ch of group.children) {
    ch.position.x -= c.x;
    ch.position.z -= c.z;
  }
  const lift = box.min.y;
  for (const ch of group.children) ch.position.y -= lift;

  return group;
}
