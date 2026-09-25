function createAsset(params) {
  const THREE_ = THREE;
  const L = params.length;
  const tint = params.wood_tint || 0;
  const group = new THREE_.Group();

  const woodMat = new THREE_.MeshLambertMaterial({ color: new THREE_.Color().setHSL(0.08, 0.4, 0.36 + tint) });
  const frameMat = new THREE_.MeshLambertMaterial({ color: 0x3a4048 });

  // seat slats
  for (let i = 0; i < 3; i++) {
    const slat = new THREE_.Mesh(new THREE_.BoxGeometry(L, 0.045, 0.11), woodMat);
    slat.position.set(0, 0.45, -0.16 + i * 0.16);
    group.add(slat);
  }

  // backrest slats
  for (let i = 0; i < 2; i++) {
    const slat = new THREE_.Mesh(new THREE_.BoxGeometry(L, 0.1, 0.04), woodMat);
    slat.position.set(0, 0.62 + i * 0.22, -0.3 - i * 0.015);
    slat.rotation.x = -0.15;
    group.add(slat);
  }

  // side frames
  for (const fx of [-L / 2 + 0.12, L / 2 - 0.12]) {
    const leg1 = new THREE_.Mesh(new THREE_.BoxGeometry(0.06, 0.45, 0.06), frameMat);
    leg1.position.set(fx, 0.225, 0.18);
    group.add(leg1);
    const leg2 = new THREE_.Mesh(new THREE_.BoxGeometry(0.06, 0.45, 0.06), frameMat);
    leg2.position.set(fx, 0.225, -0.2);
    group.add(leg2);
    const backPost = new THREE_.Mesh(new THREE_.BoxGeometry(0.06, 0.55, 0.06), frameMat);
    backPost.position.set(fx, 0.45 + 0.26, -0.28);
    backPost.rotation.x = -0.15;
    group.add(backPost);
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
