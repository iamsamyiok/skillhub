function createAsset(params) {
  const THREE_ = THREE;
  const h = params.pole_height;
  const lr = params.lamp_radius;

  const group = new THREE_.Group();

  const base = new THREE_.Mesh(
    new THREE_.CylinderGeometry(0.16, 0.22, 0.18, 10),
    new THREE_.MeshLambertMaterial({ color: 0x2f3640 })
  );
  base.position.y = 0.09;
  group.add(base);

  const pole = new THREE_.Mesh(
    new THREE_.CylinderGeometry(0.045, 0.07, h, 8),
    new THREE_.MeshLambertMaterial({ color: 0x39414e })
  );
  pole.position.y = h / 2 + 0.1;
  group.add(pole);

  const cap = new THREE_.Mesh(
    new THREE_.ConeGeometry(lr * 1.45, lr * 0.9, 8),
    new THREE_.MeshLambertMaterial({ color: 0x2f3640 })
  );
  cap.position.y = h + lr * 1.55 + 0.1;
  group.add(cap);

  const bulb = new THREE_.Mesh(
    new THREE_.SphereGeometry(lr, 10, 8),
    new THREE_.MeshLambertMaterial({
      color: 0xfff3c4,
      emissive: new THREE_.Color(0xffdf8a),
      emissiveIntensity: params.glow
    })
  );
  bulb.position.y = h + lr * 0.72 + 0.1;
  group.add(bulb);

  return group;
}
