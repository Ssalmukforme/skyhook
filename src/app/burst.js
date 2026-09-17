// Crash burst: a bright flash, a shockwave ring, tumbling pieces of the runner's gear and a spray of sparks.
// Everything is allocated once and reused for every crash.
import * as THREE from 'three';

const PIECES = 36, SPARKS = 90, DURATION = 1.4;
// The runner's own colours (jacket, helmet, cargo trousers, boots), so it reads as the runner breaking apart.
const PIECE_COLORS = ['#368c83', '#28675f', '#e6a34d', '#42434a', '#e8dcc3'];

export function createBurst(scene, { reducedMotion = false } = {}) {
  const group = new THREE.Group(); group.visible = false; scene.add(group);
  const glow = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false };
  const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: '#fff4d8', ...glow }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, .08, 8, 64), new THREE.MeshBasicMaterial({ color: '#ffd9a0', ...glow }));
  const pieces = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: .8, flatShading: true }), PIECES);
  pieces.frustumCulled = false;
  const color = new THREE.Color();
  for (let i = 0; i < PIECES; i++) pieces.setColorAt(i, color.set(PIECE_COLORS[i % PIECE_COLORS.length]));
  const sparkGeo = new THREE.BufferGeometry(); sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: '#ffd28a', size: .55, ...glow }));
  sparks.frustumCulled = false;
  group.add(flash, ring, pieces, sparks);

  const origin = new THREE.Vector3(), piece = [], spark = [], matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < PIECES; i++) piece.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), spin: new THREE.Vector3(), size: 1 });
  for (let i = 0; i < SPARKS; i++) spark.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3() });
  let age = Infinity;
  const randomDir = out => { const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u); return out.set(Math.cos(a) * r, u, Math.sin(a) * r); };

  return {
    get active() { return age < DURATION; },
    // x, y, z: where the crash happened; velocity: the runner's velocity, so the debris carries on the way it was flying.
    trigger(x, y, z, velocity, tint = '#ffd9a0') {
      age = 0; group.visible = true; origin.set(x, y, z);
      ring.material.color.set(tint); sparks.material.color.set(tint);
      const carry = .25;
      piece.forEach(b => {
        b.pos.copy(origin); randomDir(b.vel).multiplyScalar(8 + Math.random() * 16);
        b.vel.x += velocity.x * carry; b.vel.y += velocity.y * carry + 6; b.vel.z += velocity.z * carry;
        b.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); randomDir(b.spin).multiplyScalar(4 + Math.random() * 8);
        b.size = .25 + Math.random() * .45;
      });
      spark.forEach(b => { b.pos.copy(origin); randomDir(b.vel).multiplyScalar(18 + Math.random() * 30); b.vel.addScaledVector(velocity, .15); });
      pieces.instanceColor.needsUpdate = true;
    },
    update(dt, camera) {
      if (age >= DURATION) return;
      age += dt;
      if (age >= DURATION) { group.visible = false; return; }
      const t = age / DURATION;
      // Flash swells and fades in the first quarter second; the ring races outward facing the camera.
      const f = Math.min(1, age / .25);
      flash.position.copy(origin); flash.scale.setScalar(1.5 + 9 * Math.sqrt(f)); flash.material.opacity = (1 - f) * .95;
      const r = Math.min(1, age / .6);
      ring.position.copy(origin); ring.quaternion.copy(camera.quaternion); ring.scale.setScalar(2 + 22 * (1 - (1 - r) ** 3)); ring.material.opacity = (1 - r) * .9;
      ring.visible = !reducedMotion || r < .5;
      piece.forEach((b, i) => {
        b.vel.y -= 30 * dt; b.vel.multiplyScalar(Math.exp(-.6 * dt)); b.pos.addScaledVector(b.vel, dt); b.rot.addScaledVector(b.spin, dt);
        const size = b.size * (t < .7 ? 1 : 1 - (t - .7) / .3);
        matrix.compose(p.copy(b.pos), q.setFromEuler(e.set(b.rot.x, b.rot.y, b.rot.z)), s.setScalar(Math.max(.001, size)));
        pieces.setMatrixAt(i, matrix);
      });
      pieces.instanceMatrix.needsUpdate = true;
      const arr = sparkGeo.attributes.position.array;
      spark.forEach((b, i) => { b.vel.multiplyScalar(Math.exp(-3 * dt)); b.vel.y -= 9 * dt; b.pos.addScaledVector(b.vel, dt); arr.set([b.pos.x, b.pos.y, b.pos.z], i * 3); });
      sparkGeo.attributes.position.needsUpdate = true;
      sparks.material.opacity = Math.max(0, 1 - age / .8);
    },
    reset() { age = Infinity; group.visible = false; },
  };
}
