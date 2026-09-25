export function polygonAABB(points) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

export function pointInPolygon(x, z, points) {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi] = points[i];
    const [xj, zj] = points[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointToSegmentDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

export function distToPolygonEdge(x, z, points) {
  let min = Infinity;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = pointToSegmentDist(x, z, points[j][0], points[j][1], points[i][0], points[i][1]);
    if (d < min) min = d;
  }
  return min;
}

export function polygonArea(points) {
  let a = 0;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return Math.abs(a / 2);
}

export function resolveBoundary(boundary) {
  if (boundary.type === 'rect') {
    const { center = [0, 0], width, depth } = boundary;
    const hx = width / 2, hz = depth / 2;
    const [cx, cz] = center;
    return [
      [cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]
    ];
  }
  if (boundary.type === 'circle') {
    const { center = [0, 0], radius, segments = 48 } = boundary;
    const [cx, cz] = center;
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * radius, cz + Math.sin(a) * radius]);
    }
    return pts;
  }
  if (boundary.type === 'polygon') {
    return boundary.points.map(p => [p[0], p[1]]);
  }
  throw new Error(`Unknown boundary type: ${boundary.type}`);
}
