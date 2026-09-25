function createAsset(params) {
  const THREE_ = THREE;
  const group = new THREE_.Group();

  const L = 4.3, W = 1.85;
  const bodyMat = new THREE_.MeshLambertMaterial({
    color: new THREE_.Color().setHSL(params.body_hue, 0.55, params.body_light)
  });

  // chassis + hood/trunk level
  const body = new THREE_.Mesh(new THREE_.BoxGeometry(L, 0.62, W), bodyMat);
  body.position.y = 0.34 + 0.3;
  group.add(body);

  // cabin
  const cabin = new THREE_.Mesh(new THREE_.BoxGeometry(L * 0.5, 0.55, W * 0.88), bodyMat);
  cabin.position.set(-L * 0.06, 0.64 + 0.62 + 0.24, 0);
  group.add(cabin);

  // greenhouse glass
  const glassMat = new THREE_.MeshLambertMaterial({ color: 0x22303d, emissive: new THREE_.Color(0x1a2632), emissiveIntensity: 0.2 });
  const windshield = new THREE_.Mesh(new THREE_.BoxGeometry(0.06, 0.42, W * 0.8), glassMat);
  windshield.position.set(L * 0.19, 0.64 + 0.62 + 0.22, 0);
  windshield.rotation.z = 0.42;
  group.add(windshield);
  const rearGlass = new THREE_.Mesh(new THREE_.BoxGeometry(0.06, 0.4, W * 0.8), glassMat);
  rearGlass.position.set(-L * 0.31, 0.64 + 0.62 + 0.22, 0);
  rearGlass.rotation.z = -0.5;
  group.add(rearGlass);

  // wheels: axle along z
  const wheelMat = new THREE_.MeshLambertMaterial({ color: 0x18191c });
  const rimMat = new THREE_.MeshLambertMaterial({ color: 0x9aa0a8 });
  for (const wx of [L * 0.32, -L * 0.32]) {
    for (const wz of [-W / 2 + 0.08, W / 2 - 0.08]) {
      const wheel = new THREE_.Mesh(new THREE_.CylinderGeometry(0.33, 0.33, 0.24, 12), wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.33, wz);
      group.add(wheel);
      const rim = new THREE_.Mesh(new THREE_.CylinderGeometry(0.15, 0.15, 0.26, 8), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(wx, 0.33, wz);
      group.add(rim);
    }
  }

  // head lights and tail lights
  const headMat = new THREE_.MeshLambertMaterial({ color: 0xfff6d8, emissive: new THREE_.Color(0xffedb0), emissiveIntensity: 0.8 });
  const tailMat = new THREE_.MeshLambertMaterial({ color: 0xff5a4a, emissive: new THREE_.Color(0xd82010), emissiveIntensity: 0.7 });
  for (const wz of [-W / 2 + 0.32, W / 2 - 0.32]) {
    const hl = new THREE_.Mesh(new THREE_.BoxGeometry(0.08, 0.14, 0.3), headMat);
    hl.position.set(L / 2 + 0.02, 0.64 + 0.14, wz);
    group.add(hl);
    const tl = new THREE_.Mesh(new THREE_.BoxGeometry(0.08, 0.12, 0.3), tailMat);
    tl.position.set(-L / 2 - 0.02, 0.64 + 0.16, wz);
    group.add(tl);
  }

  return group;
}
