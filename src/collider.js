// Collision against the real map geometry: every triangle of the solid scenery that is drawn on screen.
// There are no invisible corridor walls; the runner only crashes where there is an actual object.
import * as THREE from 'three';

const CELL = 16;
// Triangles this large are ground slabs, water or distant desert planes. Floor contact is handled as a fall
// (physics.js), and indexing kilometre-wide triangles would bloat the grid for no benefit.
const MAX_TRIANGLE_SPAN = 320;

export function createCollider(meshes) {
  const tris = [], cells = new Map(), v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const key = (i, j, k) => `${i},${j},${k}`;
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.attributes.position, index = mesh.geometry.index;
    const count = index ? index.count : pos.count;
    for (let t = 0; t < count; t += 3) {
      for (let c = 0; c < 3; c++) v[c].fromBufferAttribute(pos, index ? index.getX(t + c) : t + c).applyMatrix4(mesh.matrixWorld);
      const minX = Math.min(v[0].x, v[1].x, v[2].x), maxX = Math.max(v[0].x, v[1].x, v[2].x);
      const minY = Math.min(v[0].y, v[1].y, v[2].y), maxY = Math.max(v[0].y, v[1].y, v[2].y);
      const minZ = Math.min(v[0].z, v[1].z, v[2].z), maxZ = Math.max(v[0].z, v[1].z, v[2].z);
      if (maxX - minX > MAX_TRIANGLE_SPAN || maxZ - minZ > MAX_TRIANGLE_SPAN) continue;
      const id = tris.length / 9;
      tris.push(v[0].x, v[0].y, v[0].z, v[1].x, v[1].y, v[1].z, v[2].x, v[2].y, v[2].z);
      for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++)
        for (let j = Math.floor(minY / CELL); j <= Math.floor(maxY / CELL); j++)
          for (let k = Math.floor(minZ / CELL); k <= Math.floor(maxZ / CELL); k++) {
            const cell = key(i, j, k); let list = cells.get(cell);
            if (!list) cells.set(cell, list = []); list.push(id);
          }
    }
  }
  const data = Float32Array.from(tris);
  const out = { x: 0, y: 0, z: 0 };

  // Closest point on triangle to p (Ericson, Real-Time Collision Detection 5.1.5).
  function closest(id, px, py, pz) {
    const o = id * 9, ax = data[o], ay = data[o + 1], az = data[o + 2], bx = data[o + 3], by = data[o + 4], bz = data[o + 5], cx = data[o + 6], cy = data[o + 7], cz = data[o + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) return set(ax, ay, az);
    const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return set(bx, by, bz);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const w = d1 / (d1 - d3); return set(ax + abx * w, ay + aby * w, az + abz * w); }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return set(cx, cy, cz);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return set(ax + acx * w, ay + acy * w, az + acz * w); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return set(bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w); }
    const denom = 1 / (va + vb + vc), vv = vb * denom, ww = vc * denom;
    return set(ax + abx * vv + acx * ww, ay + aby * vv + acy * ww, az + abz * vv + acz * ww);
  }
  function set(x, y, z) { out.x = x; out.y = y; out.z = z; return out; }

  // Nearest solid surface within maxDistance of a point, or null.
  function nearest(px, py, pz, maxDistance) {
    let best = null, bestSq = maxDistance * maxDistance;
    const seen = new Set();
    for (let i = Math.floor((px - maxDistance) / CELL); i <= Math.floor((px + maxDistance) / CELL); i++)
      for (let j = Math.floor((py - maxDistance) / CELL); j <= Math.floor((py + maxDistance) / CELL); j++)
        for (let k = Math.floor((pz - maxDistance) / CELL); k <= Math.floor((pz + maxDistance) / CELL); k++) {
          const list = cells.get(key(i, j, k)); if (!list) continue;
          for (const id of list) {
            if (seen.has(id)) continue; seen.add(id);
            const q = closest(id, px, py, pz), dSq = (q.x - px) ** 2 + (q.y - py) ** 2 + (q.z - pz) ** 2;
            if (dSq < bestSq) { bestSq = dSq; best = { distance: Math.sqrt(dSq), x: q.x, y: q.y, z: q.z }; }
          }
        }
    return best;
  }
  return {
    triangles: data.length / 9,
    nearest,
    // True when a sphere of radius r centred on the point touches any solid triangle.
    hits: (x, y, z, r) => nearest(x, y, z, r) !== null,
  };
}

// Solid scenery = visible, opaque, non-moving meshes. Callers flag anything else with userData.nonSolid.
export function solidMeshes(root) {
  const list = [];
  root.traverse(o => {
    if (o.userData.nonSolid) return;
    if (o.isMesh && !o.isInstancedMesh && o.visible && !(o.material.transparent && o.material.opacity < 1)) {
      let a = o; while (a && !a.userData.nonSolid) a = a.parent;
      if (!a) list.push(o);
    }
  });
  return list;
}
