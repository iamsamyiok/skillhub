function createAsset(params) {
  const THREE_ = THREE;
  const w = params.width, d = params.depth, h = params.wall_height, o = params.roof_overhang;
  const hx = w / 2, hz = d / 2;
  const tint = params.wood_tint || 0;

  const group = new THREE_.Group();

  const wallMat = new THREE_.MeshLambertMaterial({ color: new THREE_.Color().setHSL(0.07, 0.35, 0.38 + tint) });
  const body = new THREE_.Mesh(new THREE_.BoxGeometry(w, h, d), wallMat);
  body.position.y = h / 2;
  body.userData.surface = 'wood';
  group.add(body);

  const door = new THREE_.Mesh(
    new THREE_.BoxGeometry(w * 0.18, h * 0.62, 0.06),
    new THREE_.MeshLambertMaterial({ color: 0x4a3220 })
  );
  door.position.set(0, h * 0.31, hz + 0.02);
  group.add(door);

  const ridgeH = d * 0.38;
  const A = [-hx - o, 0, -hz - o], B = [hx + o, 0, -hz - o];
  const C = [hx + o, 0, hz + o], D = [-hx - o, 0, hz + o];
  const E = [0, ridgeH, -hz - o * 0.5], F = [0, ridgeH, hz + o * 0.5];
  const verts = [
    ...A, ...B, ...F, ...A, ...F, ...E,
    ...C, ...D, ...E, ...C, ...E, ...F,
    ...D, ...A, ...E,
    ...B, ...C, ...F
  ];
  const roofGeom = new THREE_.BufferGeometry();
  roofGeom.setAttribute('position', new THREE_.Float32BufferAttribute(verts, 3));
  roofGeom.computeVertexNormals();
  const roof = new THREE_.Mesh(
    roofGeom,
    new THREE_.MeshLambertMaterial({ color: new THREE_.Color().setHSL(0.03, 0.45, 0.30 + tint), side: THREE_.DoubleSide })
  );
  roof.position.y = h;
  roof.userData.surface = 'rooftile';
  group.add(roof);

  const chimney = new THREE_.Mesh(
    new THREE_.BoxGeometry(0.32, ridgeH * 1.1, 0.32),
    new THREE_.MeshLambertMaterial({ color: 0x7a7a78 })
  );
  chimney.position.set(hx * 0.45, h + ridgeH * 0.72, 0);
  chimney.userData.surface = 'concrete';
  group.add(chimney);

  return group;
}
