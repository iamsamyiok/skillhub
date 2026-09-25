function createAsset(params) {
  const THREE_ = THREE;
  const hue = params.seat_hue ?? 0.58;
  const tint = params.wood_tint || 0;
  const group = new THREE_.Group();

  const seatMat = new THREE_.MeshLambertMaterial({
    color: new THREE_.Color().setHSL(hue, 0.45, 0.4)
  });
  const frame = new THREE_.MeshLambertMaterial({
    color: new THREE_.Color().setHSL(0.09, 0.3, 0.38 + tint)
  });

  const seat = new THREE_.Mesh(new THREE_.BoxGeometry(0.45, 0.05, 0.45), seatMat);
  seat.position.set(0, 0.46, 0);
  group.add(seat);

  for (const sx of [-0.19, 0.19]) {
    for (const sz of [-0.19, 0.19]) {
      const leg = new THREE_.Mesh(new THREE_.BoxGeometry(0.05, 0.44, 0.05), frame);
      leg.position.set(sx, 0.22, sz);
      group.add(leg);
    }
  }

  const back = new THREE_.Mesh(new THREE_.BoxGeometry(0.45, 0.42, 0.05), seatMat);
  back.position.set(0, 0.7, -0.2);
  group.add(back);

  for (const sx of [-0.19, 0.19]) {
    const post = new THREE_.Mesh(new THREE_.BoxGeometry(0.05, 0.44, 0.05), frame);
    post.position.set(sx, 0.68, -0.2);
    group.add(post);
  }

  return group;
}
