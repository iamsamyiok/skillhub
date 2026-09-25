function createAsset(params) {
  const THREE_ = THREE;

  // All geometry points are authored for wheel_radius = 0.34 and scaled by k.
  const k = params.wheel_radius / 0.34;
  const R = params.wheel_radius;

  const frameMat = new THREE_.MeshLambertMaterial({
    color: new THREE_.Color().setHSL(params.frame_hue, 0.78, params.frame_light)
  });
  const darkMat = new THREE_.MeshLambertMaterial({ color: 0x23262b });
  const tireMat = new THREE_.MeshLambertMaterial({ color: 0x1a1c20 });
  const metalMat = new THREE_.MeshLambertMaterial({ color: 0xb9bfc7 });
  const seatMat = new THREE_.MeshLambertMaterial({ color: 0x2e3138 });

  const group = new THREE_.Group();
  const V = (x, y, z) => new THREE_.Vector3(x * k, y * k, z * k);

  // straight tube between two points
  function tube(p1, p2, r, mat) {
    const dir = new THREE_.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const m = new THREE_.Mesh(new THREE_.CylinderGeometry(r * k, r * k, len, 7), mat);
    m.position.copy(p1).add(p2).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE_.Vector3(0, 1, 0), dir.normalize());
    group.add(m);
    return m;
  }

  // frame reference points (xz symmetric about the frame plane)
  const rearHub = V(-0.52, 0.34, 0);
  const frontHub = V(0.52, 0.34, 0);
  const bb = V(0.0, 0.28, 0);          // bottom bracket
  const seatCluster = V(-0.24, 0.92, 0);
  const headBottom = V(0.44, 0.80, 0);
  const headTop = V(0.40, 1.00, 0);
  const stemTop = V(0.36, 1.10, 0);

  // main triangle
  tube(bb, headBottom, 0.028, frameMat);        // down tube
  tube(bb, seatCluster, 0.026, frameMat);       // seat tube
  tube(seatCluster, headTop, 0.024, frameMat);  // top tube
  tube(headTop, headBottom, 0.030, frameMat);   // head tube
  // rear triangle
  tube(seatCluster, rearHub, 0.016, frameMat);  // seat stay
  tube(bb, rearHub, 0.016, frameMat);           // chain stay
  // fork + stem
  tube(headBottom, frontHub, 0.015, metalMat);  // fork
  tube(headTop, stemTop, 0.020, metalMat);      // stem

  // wheels: torus lies in XY plane, axis = Z (bike side view)
  function wheel(center) {
    const tire = new THREE_.Mesh(new THREE_.TorusGeometry(R, 0.034, 8, 26), tireMat);
    tire.position.copy(center);
    group.add(tire);
    const hub = new THREE_.Mesh(new THREE_.CylinderGeometry(0.03 * k, 0.03 * k, 0.09 * k, 8), metalMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.copy(center);
    group.add(hub);
    for (let i = 0; i < 8; i++) {
      const spoke = new THREE_.Mesh(new THREE_.CylinderGeometry(0.005 * k, 0.005 * k, R * 1.86, 4), metalMat);
      spoke.rotation.z = (i / 8) * Math.PI * 2;
      spoke.position.copy(center);
      group.add(spoke);
    }
  }
  wheel(rearHub);
  wheel(frontHub);

  // seat post + saddle
  tube(seatCluster, V(-0.26, 0.99, 0), 0.016, metalMat);
  const saddle = new THREE_.Mesh(new THREE_.BoxGeometry(0.26 * k, 0.045 * k, 0.13 * k), seatMat);
  saddle.position.set(-0.30 * k, 1.02 * k, 0);
  saddle.rotation.z = -0.06;
  group.add(saddle);

  // handlebar
  const barY = 1.10 * k;
  const bar = new THREE_.Mesh(new THREE_.CylinderGeometry(0.017 * k, 0.017 * k, 0.44 * k, 8), metalMat);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0.36 * k, barY, 0);
  group.add(bar);
  for (const zc of [-0.21, 0.21]) {
    const grip = new THREE_.Mesh(new THREE_.CylinderGeometry(0.026 * k, 0.026 * k, 0.11 * k, 8), seatMat);
    grip.rotation.x = Math.PI / 2;
    grip.position.set(0.36 * k, barY, zc * k);
    group.add(grip);
  }

  // crankset: axle, two arms, pedals, chainring
  const axle = new THREE_.Mesh(new THREE_.CylinderGeometry(0.018 * k, 0.018 * k, 0.22 * k, 8), darkMat);
  axle.rotation.x = Math.PI / 2;
  axle.position.copy(bb);
  group.add(axle);
  const ring = new THREE_.Mesh(new THREE_.CylinderGeometry(0.10 * k, 0.10 * k, 0.014 * k, 16), darkMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(bb.x, bb.y, bb.z + 0.055 * k);
  group.add(ring);
  const cog = new THREE_.Mesh(new THREE_.CylinderGeometry(0.045 * k, 0.045 * k, 0.012 * k, 10), darkMat);
  cog.rotation.x = Math.PI / 2;
  cog.position.set(rearHub.x, rearHub.y, rearHub.z + 0.05 * k);
  group.add(cog);
  for (const side of [-1, 1]) {
    const arm = new THREE_.Mesh(new THREE_.BoxGeometry(0.17 * k, 0.03 * k, 0.025 * k), darkMat);
    arm.position.set(bb.x + 0.06 * k * side, bb.y - 0.05 * k * side, bb.z + side * 0.11 * k);
    group.add(arm);
    const pedal = new THREE_.Mesh(new THREE_.BoxGeometry(0.06 * k, 0.018 * k, 0.10 * k), seatMat);
    pedal.position.set(bb.x + 0.145 * k * side, bb.y - 0.10 * k * side, bb.z + side * 0.13 * k);
    group.add(pedal);
  }

  // chain outline: thin box loop between ring and cog (visual hint)
  const chainLen = Math.abs(ring.position.x - cog.position.x);
  const chainC = new THREE_.Mesh(
    new THREE_.BoxGeometry(chainLen, 0.012 * k, 0.008 * k),
    darkMat
  );
  chainC.position.set((ring.position.x + cog.position.x) / 2, bb.y + 0.06 * k, bb.z + 0.055 * k);
  group.add(chainC);
  const chainB = chainC.clone();
  chainB.position.y = bb.y - 0.075 * k;
  group.add(chainB);

  // kickstand
  tube(V(0.1, 0.32, 0.1), V(0.16, 0.02, 0.22), 0.009, darkMat);

  // origin normalization: recentre children so bbox centre xz sits at (0,0)
  const box = new THREE_.Box3().setFromObject(group);
  const c = box.getCenter(new THREE_.Vector3());
  for (const ch of group.children) {
    ch.position.x -= c.x;
    ch.position.z -= c.z;
  }

  return group;
}
