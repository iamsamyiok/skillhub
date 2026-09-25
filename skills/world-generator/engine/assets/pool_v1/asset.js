function createAsset(params) {
  const THREE_ = THREE;
  const w = params.width, d = params.depth;
  const group = new THREE_.Group();

  // stone deck rim
  const deck = new THREE_.Mesh(
    new THREE_.BoxGeometry(w + 1.6, 0.14, d + 1.6),
    new THREE_.MeshLambertMaterial({ color: 0xcfc7b4 })
  );
  deck.position.y = 0.07;
  group.add(deck);

  // pool inner floor (slightly recessed look)
  const basin = new THREE_.Mesh(
    new THREE_.BoxGeometry(w, 0.1, d),
    new THREE_.MeshLambertMaterial({ color: 0x1d6f9e })
  );
  basin.position.y = 0.12;
  group.add(basin);

  // translucent water surface above basin
  const water = new THREE_.Mesh(
    new THREE_.BoxGeometry(w, 0.05, d),
    new THREE_.MeshLambertMaterial({
      color: new THREE_.Color().setHSL(params.water_hue, 0.65, 0.55),
      emissive: new THREE_.Color().setHSL(params.water_hue, 0.8, 0.25),
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.82
    })
  );
  water.position.y = 0.21;
  // viewer upgrades userData.water meshes to an animated water material
  water.userData.water = true;
  group.add(water);

  // ladder hint: two small rails
  const railMat = new THREE_.MeshLambertMaterial({ color: 0xd8dde2 });
  for (const sx of [-0.6, 0.6]) {
    const rail = new THREE_.Mesh(new THREE_.CylinderGeometry(0.035, 0.035, 0.75, 6), railMat);
    rail.position.set(sx, 0.42, d / 2 - 0.35);
    group.add(rail);
  }

  return group;
}
