function createAsset(params) {
  const THREE_ = THREE;
  const w = params.width, d = params.depth, us = params.upper_scale;
  const tint = params.wall_tint || 0;
  const glass = params.glass_glow;

  const group = new THREE_.Group();

  const wallMat = new THREE_.MeshLambertMaterial({ color: new THREE_.Color().setHSL(0.09, 0.18, 0.78 + tint) });
  const lower = new THREE_.Mesh(new THREE_.BoxGeometry(w, 3.1, d), wallMat);
  lower.position.y = 3.1 / 2;
  group.add(lower);

  const upper = new THREE_.Mesh(new THREE_.BoxGeometry(w * us, 2.7, d * us), wallMat);
  upper.position.set(-w * (1 - us) * 0.25, 3.1 + 2.7 / 2, -d * (1 - us) * 0.22);
  group.add(upper);

  // flat roof slabs with overhang
  const slabMat = new THREE_.MeshLambertMaterial({ color: 0xd9d4c8 });
  const slab1 = new THREE_.Mesh(new THREE_.BoxGeometry(w + 0.7, 0.16, d + 0.7), slabMat);
  slab1.position.y = 3.1 + 0.08;
  group.add(slab1);
  const slab2 = new THREE_.Mesh(new THREE_.BoxGeometry(w * us + 0.6, 0.16, d * us + 0.6), slabMat);
  slab2.position.set(upper.position.x, 3.1 + 2.7 + 0.08, upper.position.z);
  group.add(slab2);

  // glass band on lower south face
  const glassMat = new THREE_.MeshLambertMaterial({
    color: 0x9fc8e8,
    emissive: new THREE_.Color(0x5a90c8),
    emissiveIntensity: glass
  });
  const band = new THREE_.Mesh(new THREE_.BoxGeometry(w * 0.72, 1.5, 0.08), glassMat);
  band.position.set(w * 0.08, 1.7, d / 2 + 0.03);
  group.add(band);

  // upper storey ribbon window on south face
  const band2 = new THREE_.Mesh(new THREE_.BoxGeometry(w * us * 0.78, 1.2, 0.08), glassMat);
  band2.position.set(upper.position.x, 3.1 + 1.5, upper.position.z + (d * us) / 2 + 0.03);
  group.add(band2);

  // entrance door
  const door = new THREE_.Mesh(
    new THREE_.BoxGeometry(1.0, 2.1, 0.1),
    new THREE_.MeshLambertMaterial({ color: 0x5a4030 })
  );
  door.position.set(-w * 0.28, 1.05, d / 2 + 0.04);
  group.add(door);

  // side garage wing
  const garage = new THREE_.Mesh(new THREE_.BoxGeometry(3.4, 2.6, d * 0.62), wallMat);
  garage.position.set(w / 2 + 1.5, 1.3, d * 0.16);
  group.add(garage);
  const gSlab = new THREE_.Mesh(new THREE_.BoxGeometry(3.9, 0.14, d * 0.62 + 0.5), slabMat);
  gSlab.position.set(w / 2 + 1.5, 2.67, d * 0.16);
  group.add(gSlab);
  const gDoor = new THREE_.Mesh(
    new THREE_.BoxGeometry(2.6, 1.9, 0.08),
    new THREE_.MeshLambertMaterial({ color: 0xb8bdc4 })
  );
  gDoor.position.set(w / 2 + 1.5, 0.98, d * 0.16 + (d * 0.62) / 2 + 0.03);
  group.add(gDoor);

  // origin normalization: recentre children so bbox centre xz sits at (0,0)
  const box = new THREE_.Box3().setFromObject(group);
  const c = box.getCenter(new THREE_.Vector3());
  for (const ch of group.children) {
    ch.position.x -= c.x;
    ch.position.z -= c.z;
  }

  return group;
}
