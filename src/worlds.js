import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { frameAt } from './physics.js';
import { createCollider, solidMeshes } from './collider.js';

// Lighting, sky and particle palette per theme. Sunset keeps the original values.
export const ENVIRONMENTS = {
  sunset: { skyTop: '#68647f', skyMiddle: '#e6a198', skyBottom: '#ffd3a0', fog: '#c89490', fogDensity: .0021, hemiSky: '#ffcca4', hemiGround: '#6a668f', hemi: 2.9,
    sunColor: '#ffb474', sun: 3.2, disc: '#ffe0ac', discSize: 47, glow: '#ffc091', glowOpacity: .1, exposure: 1.25, sunDir: [115, 65, -620], lightOffset: [-130, 130, -160],
    gate: '#ffcf8c', gateSoft: '#ffda9c', gateMarker: '#ffe5b3', marker: '#ffdb9d', label: '#ffe4b0', rope: '#ffe0ad',
    particles: { count: 150, color: '#ffe3bc', size: .18, opacity: .45, fall: -.3, drift: [.8, 0, .4] }, stars: 0, aurora: 0 },
  harbor: { skyTop: '#07061a', skyMiddle: '#261a4a', skyBottom: '#7a3470', fog: '#221638', fogDensity: .0023, hemiSky: '#8a7bff', hemiGround: '#2a1a3a', hemi: 1.6,
    sunColor: '#a9b8ff', sun: 1.4, disc: '#f4f1ff', discSize: 24, glow: '#b7a8ff', glowOpacity: .14, exposure: 1.45, sunDir: [-220, 170, -600], lightOffset: [120, 140, -120],
    gate: '#5ff5ff', gateSoft: '#c08bff', gateMarker: '#b9fbff', marker: '#ff8ae6', label: '#c9fbff', rope: '#ffb3f0',
    particles: { count: 240, color: '#ff9bea', size: .24, opacity: .6, fall: -.6, drift: [.5, 0, .3] }, stars: 1, aurora: 0 },
  canyon: { skyTop: '#2f78c4', skyMiddle: '#86bde6', skyBottom: '#f6d9ad', fog: '#e6bf98', fogDensity: .0024, hemiSky: '#cfe6ff', hemiGround: '#b55a35', hemi: 2.1,
    sunColor: '#fff0d2', sun: 3.8, disc: '#fffbee', discSize: 22, glow: '#fff3cf', glowOpacity: .16, exposure: 1.05, sunDir: [260, 280, -600], lightOffset: [90, 170, -60],
    gate: '#43e6d0', gateSoft: '#b8fff3', gateMarker: '#e3fffa', marker: '#fff2c2', label: '#eafffb', rope: '#fff4d8',
    particles: { count: 280, color: '#f2c38e', size: .22, opacity: .5, fall: .2, drift: [3.5, 0, 1.2] }, stars: 0, aurora: 0 },
  aurora: { skyTop: '#030a1e', skyMiddle: '#0e2c4d', skyBottom: '#3a6c8c', fog: '#1f3d57', fogDensity: .0021, hemiSky: '#a8dcff', hemiGround: '#2f3f60', hemi: 1.9,
    sunColor: '#cfe4ff', sun: 1.8, disc: '#f5fbff', discSize: 19, glow: '#bfe3ff', glowOpacity: .15, exposure: 1.45, sunDir: [300, 230, -500], lightOffset: [110, 150, -90],
    gate: '#7dffc8', gateSoft: '#b8ffe3', gateMarker: '#e0fff3', marker: '#d6fff0', label: '#dcfff1', rope: '#e6fff6',
    particles: { count: 1100, color: '#ffffff', size: .34, opacity: .85, fall: 7, drift: [0, 0, 0], wind: 1 }, stars: 1, aurora: 1 },
  garden: { skyTop: '#2f7fe0', skyMiddle: '#8fcaff', skyBottom: '#fff0fa', fog: '#d6ebff', fogDensity: .0016, hemiSky: '#fff6e6', hemiGround: '#b9c9ff', hemi: 2.6,
    sunColor: '#fff1d8', sun: 3.1, disc: '#fffdf2', discSize: 36, glow: '#fff7dd', glowOpacity: .18, exposure: 1.12, sunDir: [-300, 200, -560], lightOffset: [-120, 160, -100],
    gate: '#ff5fa8', gateSoft: '#ffd36e', gateMarker: '#fff3bf', marker: '#ff5fa8', label: '#ff5fa8', rope: '#fff7c8',
    particles: { count: 260, color: '#ffc6e2', size: .3, opacity: .8, fall: 1.2, drift: [1.5, 0, .8] }, stars: 0, aurora: 0 },
};

const cube = new THREE.BoxGeometry(1, 1, 1);
const materialCache = new Map();
export function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, ...extra }));
  return materialCache.get(key);
}
const glowMat = (color, intensity = 1) => mat(color, { emissive: color, emissiveIntensity: intensity });
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function createKit(course, seedValue) {
  const statics = new THREE.Group(), root = new THREE.Group();
  let seed = seedValue;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const range = (a, b) => a + random() * (b - a);
  const pick = list => list[Math.floor(random() * list.length)];
  const material = color => typeof color === 'string' ? mat(color) : color;
  function box(x, y, z, w, h, d, color, parent = statics, shadow = false) {
    const m = new THREE.Mesh(cube, material(color)); m.position.set(x, y, z); m.scale.set(w, h, d); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
  }
  function shape(geometry, color, x, y, z, parent = statics, shadow = true) {
    const m = new THREE.Mesh(geometry, material(color)); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
  }
  function cylinder(x, y, z, rt, rb, h, color, parent = statics, sides = 7) { return shape(new THREE.CylinderGeometry(rt, rb, h, sides), color, x, y, z, parent); }
  // A group whose local x is the track's right side and local -z is forward.
  function at(s, lateral = 0, y = 0, parent = statics) {
    const f = frameAt(course, s), g = new THREE.Group();
    g.position.set(f.x + f.rx * lateral, f.y + y, f.z + f.rz * lateral); g.rotation.y = f.heading; parent.add(g); return g;
  }
  const instanceLists = new Map();
  function instance(name, parent, x, y, z, w, h, d) {
    if (!instanceLists.has(name)) instanceLists.set(name, []);
    const o = new THREE.Object3D(); o.position.set(x, y, z); o.scale.set(w, h, d); o.updateMatrix();
    instanceLists.get(name).push({ parent, matrix: o.matrix });
  }
  function windows(parent, x, z, w, d, h, bright = .8, names = ['dark', 'bright']) {
    for (let y = 4; y < h - 3; y += 4.4) {
      for (let xx = x - w / 2 + 2.2; xx < x + w / 2 - 1; xx += 3.8) {
        const n = random() > bright ? names[1] : names[0];
        instance(n, parent, xx, y, z + d / 2 + .04, 1.5, 2.1, .05); instance(n, parent, xx, y, z - d / 2 - .04, 1.5, 2.1, .05);
      }
      for (let zz = z - d / 2 + 2.2; zz < z + d / 2 - 1; zz += 3.8) {
        const n = random() > bright ? names[1] : names[0];
        instance(n, parent, x - w / 2 - .04, y, zz, .05, 2.1, 1.5); instance(n, parent, x + w / 2 + .04, y, zz, .05, 2.1, 1.5);
      }
    }
  }
  // Strip mesh swept along the track: profile returns [lateral, height, color] points across the course.
  function ribbon(from, to, stepSize, profile, { shadow = false, receive = true, extra = {} } = {}) {
    const positions = [], colors = [], index = [], color = new THREE.Color();
    let rows = 0, cols = 0;
    for (let s = from; s <= to + .001; s += stepSize, rows++) {
      const f = frameAt(course, s), pts = profile(s, f); cols = pts.length;
      for (const [lat, y, c] of pts) { positions.push(f.x + f.rx * lat, f.y + y, f.z + f.rz * lat); color.set(c); colors.push(color.r, color.g, color.b); }
    }
    for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) {
      const a = r * cols + k, b = a + 1, c = a + cols, d = c + 1; index.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(index); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat('#ffffff', { vertexColors: true, side: THREE.DoubleSide, ...extra })); m.castShadow = shadow; m.receiveShadow = receive; root.add(m); return m;
  }
  const bounds = (() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < course.n; i++) { minX = Math.min(minX, course.xs[i]); maxX = Math.max(maxX, course.xs[i]); minZ = Math.min(minZ, course.zs[i]); maxZ = Math.max(maxZ, course.zs[i]); minY = Math.min(minY, course.ys[i]); maxY = Math.max(maxY, course.ys[i]); }
    return { minX, maxX, minZ, maxZ, minY, maxY, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  })();
  // Coarse nearest-track query for scenery that must stay clear of the flight corridor.
  function nearest(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < course.n; i += 3) { const d = (course.xs[i] - x) ** 2 + (course.zs[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    return { d: Math.sqrt(bd), ground: course.ys[best], s: best * 2 - course.pre };
  }
  const movers = [], updaters = [];
  return { statics, root, random, range, pick, box, shape, cylinder, at, instance, instanceLists, windows, ribbon, bounds, nearest, movers, updaters, course };
}

function bake(kit, instanceMaterials) {
  const { statics, root } = kit;
  statics.updateMatrixWorld(true);
  for (const [name, list] of kit.instanceLists) {
    const mesh = new THREE.InstancedMesh(cube, instanceMaterials[name], list.length), m = new THREE.Matrix4();
    list.forEach((item, i) => mesh.setMatrixAt(i, m.multiplyMatrices(item.parent.matrixWorld, item.matrix)));
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); root.add(mesh);
  }
  // Merge immobile scenery by material and district, preserving culling and reducing draw calls.
  const batches = new Map(), originals = new Set(), v = new THREE.Vector3();
  statics.traverse(o => {
    if (!o.isMesh) return;
    o.getWorldPosition(v);
    const key = o.material.uuid + ':' + o.castShadow + ':' + Math.floor(v.x / 220) + ':' + Math.floor(v.z / 220);
    if (!batches.has(key)) batches.set(key, { material: o.material, shadow: o.castShadow, geometries: [] });
    let g = o.geometry.clone(); if (g.index) { const expanded = g.toNonIndexed(); g.dispose(); g = expanded; }
    g.applyMatrix4(o.matrixWorld); batches.get(key).geometries.push(g);
    if (o.geometry !== cube) originals.add(o.geometry);
  });
  for (const batch of batches.values()) {
    const g = mergeGeometries(batch.geometries); batch.geometries.forEach(x => x.dispose());
    const m = new THREE.Mesh(g, batch.material); m.castShadow = batch.shadow; m.receiveShadow = true; root.add(m);
  }
  originals.forEach(g => g.dispose()); statics.clear();
}

function makeLabel(text, color) {
  // Without a DOM (node tests building worlds for collision) labels are simply blank.
  const c = typeof document === 'undefined' ? null : document.createElement('canvas'), ctx = c?.getContext('2d');
  if (c) { c.width = 512; c.height = 128; }
  if (ctx) { ctx.font = '600 64px Arial'; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 64); }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: c ? new THREE.CanvasTexture(c) : null, transparent: true, depthWrite: false })); sprite.scale.set(16, 4, 1); return sprite;
}

function birds(kit, count, color, heightMin, heightMax) {
  const { course, range, root } = kit, material = mat(color), list = [];
  for (let i = 0; i < count; i++) {
    const b = new THREE.Group();
    for (const s of [-1, 1]) { const wing = new THREE.Mesh(cube, material); wing.position.x = s * .75; wing.scale.set(1.5, .06, .38); wing.rotation.z = s * .2; b.add(wing); }
    const f = frameAt(course, range(0, course.length)), side = Math.random() > .5 ? 1 : -1;
    const center = new THREE.Vector3(f.x + f.rx * side * range(60, 160), f.y + range(heightMin, heightMax), f.z + f.rz * side * range(60, 160));
    b.userData = { center, radius: range(20, 70), speed: range(.08, .2) * (i % 2 ? 1 : -1), phase: range(0, 6.28) };
    b.userData.nonSolid = true; root.add(b); list.push(b);
  }
  kit.updaters.push((dt, t) => list.forEach((b, i) => {
    const u = b.userData, a = u.phase + t * u.speed;
    b.position.set(u.center.x + Math.cos(a) * u.radius, u.center.y + Math.sin(t * .7 + i) * 2, u.center.z + Math.sin(a) * u.radius);
    b.rotation.y = -a + (u.speed > 0 ? 0 : Math.PI);
    b.children[0].rotation.z = Math.sin(t * 3 + i) * .25; b.children[1].rotation.z = -Math.sin(t * 3 + i) * .25;
  }));
}

function launchPad(kit, colors) {
  const g = kit.at(-19, 0, 0);
  kit.box(0, 26.5, 0, 22, 53, 22, colors.body, g, true); kit.box(0, 53.3, 0, 23, .6, 23, colors.top, g, true); kit.box(0, 53.7, 1, 7, .12, 19, colors.strip, g);
  for (let i = 0; i < 3; i++) { const chevron = kit.shape(new THREE.ConeGeometry(1.3, 2.1, 3), colors.chevron, 0, 53.86, -i * 4, g, false); chevron.rotation.x = -Math.PI / 2; chevron.scale.z = .07; }
  return g;
}
function goalPad(kit, colors) {
  const g = kit.at(kit.course.length + 40, 0, 0);
  kit.box(0, 13, 0, 40, 26, 42, colors.body, g, true); kit.box(0, 26.3, 0, 41, .6, 43, colors.top, g);
  for (let x = -18; x < 19; x += 3) for (let z = -6; z < 7; z += 3) kit.box(x, 26.65, z, 3, .04, 3, (Math.round(x / 3) + Math.round(z / 3)) % 2 ? '#efe0bb' : colors.check, g);
  return g;
}

/* ---------------------------------------------------------------- 01 SUNSET AVENUE */
function sunset(kit) {
  const { box, cylinder, random, range, course, root } = kit, ANCHORS = course.anchors;
  const facades = ['#9d777d', '#bd8e86', '#bb9c94', '#c48775', '#82788c', '#ceab93', '#a49b9f'];
  const statics = kit.statics;
  function building(x, z, w, d, h, color, detailed = true) {
    box(x, h / 2, z, w, h, d, color, statics, detailed);
    box(x, h + .3, z, w + .55, .6, d + .55, '#b9a09c');
    box(x, h + .65, z, w - 1, .12, d - 1, '#776b7b');
    if (detailed) {
      kit.windows(statics, x, z, w, d, h);
      box(x - w * .19, h + 1.4, z + d * .14, w * .28, 1.7, d * .26, '#998d93');
      if (random() > .58) {
        for (const a of [-1, 1]) for (const b of [-1, 1]) box(x + a * 1.2, h + 1.5, z + b * 1.2, .15, 3, .15, '#706271');
        cylinder(x, h + 4, z, 2.1, 2.1, 3, '#ad887c'); cylinder(x, h + 5.85, z, 0, 2.4, .9, '#6c6170');
      }
      if (random() > .6) { box(x + w * .35, h + 4, z - d * .25, .13, 8, .13, '#665d70'); box(x + w * .35, h + 6, z - d * .25, 3, .1, .1, '#665d70'); }
      box(x, 1.7, z + d / 2 + .12, w - 2, 3, .2, '#5e566e');
      if (h > 55) box(x, h * .5, z, w + .14, .23, d + .14, '#d1aca0');
    }
  }
  box(0, -1, -500, 1100, 2, 2400, '#847b83');
  box(0, .02, -520, 48, .1, 1500, '#686878');
  for (const side of [-1, 1]) { box(side * 23, .13, -520, 2, .22, 1500, '#c8aaa0'); box(side * 18, .09, -520, .18, .02, 1500, '#d2bba5'); }
  for (let z = 140; z > -1260; z -= 13) { box(-.3, .09, z, .16, .02, 5, '#e4bf92'); box(.3, .09, z, .16, .02, 5, '#e4bf92'); }
  for (let z = 100; z > -1200; z -= 104) {
    box(0, .035, z, 440, .09, 12, '#6f6c7b');
    for (const side of [-1, 1]) for (let x = -19; x < 20; x += 3.6) box(x, .12, z + side * 8, 1.8, .025, 3.4, '#cbb5a3');
  }
  ANCHORS.forEach((a, i) => {
    const side = Math.sign(a.x), h = a.y - 2.5;
    building(side * 37, a.z, 22, 29, h, facades[i % facades.length]);
    box(a.x, h + 1, a.z, .3, 2.5, .3, '#e6c0a0');
  });
  for (let i = 0; i < 26; i++) {
    const z = 90 - i * 51;
    for (const side of [-1, 1]) {
      const occupied = ANCHORS.some(a => Math.sign(a.x) === side && Math.abs(a.z - z) < 34);
      if (!occupied) building(side * 38, z, 24, 30, range(38, 68), facades[Math.floor(random() * facades.length)]);
      for (let row = 1; row <= 3; row++) building(side * (38 + row * 42) + range(-4, 4), z + range(-5, 5), range(22, 31), range(28, 38), range(34, 108), facades[Math.floor(random() * facades.length)], row < 2);
    }
  }
  for (let i = 0; i < 75; i++) building(range(-460, 460), range(-1700, -1330), range(16, 34), range(20, 40), range(30, 140), '#8e849b', false);
  for (let z = 100; z > -1200; z -= 26) for (const side of [-1, 1]) {
    cylinder(side * 21, 1.5, z, .19, .3, 3, '#826b72');
    const tree = new THREE.Mesh(new THREE.IcosahedronGeometry(2.8, 0), mat(random() > .5 ? '#b4a084' : '#899082')); tree.position.set(side * 21, 4, z); tree.scale.set(1, 1.25, 1); statics.add(tree);
    if (Math.round(z / 26) % 2 === 0) { box(side * 20, 4.2, z + 9, .14, 8.4, .14, '#726879'); box(side * 19.2, 8.4, z + 9, 1.7, .14, .14, '#726879'); box(side * 18.5, 8.3, z + 9, .6, .14, .4, mat('#ffdd9c', { emissive: '#ffa965', emissiveIntensity: .65 })); }
  }
  const cars = [];
  for (let i = 0; i < 30; i++) {
    const car = new THREE.Group(), side = i % 2 ? 1 : -1, color = ['#d6ab85', '#8b929a', '#af777a', '#d6bf9d', '#677b89'][i % 5];
    box(0, 0, 0, 2, 1, 4.4, color, car); box(0, .65, .15, 1.8, .8, 2.3, '#69677a', car);
    for (const x of [-1, 1]) for (const z of [-1.3, 1.3]) box(x, -.3, z, .22, .6, .65, '#454455', car);
    car.position.set(side * (i % 3 ? 8 : 13), .7, range(-1250, 140)); car.userData = { speed: range(3, 8) * side }; car.userData.nonSolid = true; root.add(car); cars.push(car);
  }
  kit.updaters.push(dt => cars.forEach(c => { c.position.z += c.userData.speed * dt; if (c.position.z > 140) c.position.z = -1250; if (c.position.z < -1250) c.position.z = 140; }));
  box(93, 62, -240, 2, 124, 2, '#b58b78'); box(70, 121, -240, 72, 1.5, 1.5, '#c79b7b'); box(41, 106, -240, .12, 30, .12, '#8b6c72');
  for (let i = 0; i < 9; i++) box(93, 15 + i * 12, -240, 4, .3, 4, '#ad8376');
  launchPad(kit, { body: '#a88482', top: '#cfaaa0', strip: '#6c6477', chevron: '#ffc881' });
  goalPad(kit, { body: '#bd9a90', top: '#d7b7a0', check: '#685d75' });
  birds(kit, 12, '#696276', 95, 140);
  return { dark: mat('#666679'), bright: mat('#e4b686', { emissive: '#ffbe77', emissiveIntensity: .3 }) };
}

/* ---------------------------------------------------------------- 02 NEON HARBOR */
function harbor(kit) {
  const { box, shape, cylinder, at, random, range, pick, course, root, bounds } = kit, hw = course.halfWidth, end = course.total - course.pre;
  const neon = ['#ff4fd8', '#3ff3ff', '#9b6bff', '#ffcc4a'];
  // Dark glossy water under the whole district.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(bounds.maxX - bounds.minX + 1600, bounds.maxZ - bounds.minZ + 1600), mat('#16123a', { roughness: .22, metalness: .5 }));
  water.rotation.x = -Math.PI / 2; water.position.set(bounds.cx, -.6, bounds.cz); water.receiveShadow = true; root.add(water);
  // Quays on both banks of the curving canal, with a lit edge.
  kit.ribbon(-80, end, 6, (s) => {
    const row = [];
    for (const side of [-1, 1]) {
      const pts = [[hw + 4, -1.5, '#24203a'], [hw + 4, 1.4, '#3a3552'], [hw + 5, 1.4, '#5ff5ff'], [hw + 6, 1.4, '#34304a'], [hw + 70, 1.4, '#2c2842'], [hw + 70, -3, '#1d1a30']];
      const mapped = pts.map(([l, y, c]) => [side * l, y, c]);
      row.push(...(side < 0 ? mapped.reverse() : mapped));
      if (side < 0) row.push([0, -40, '#16123a']);
    }
    return row;
  });
  const lists = { dark: mat('#3a3658'), bright: mat('#ffd27a', { emissive: '#ffb14a', emissiveIntensity: .8 }), cyan: mat('#7ff9ff', { emissive: '#3ff3ff', emissiveIntensity: 1 }) };
  course.anchors.forEach((a, i) => {
    const h = a.y - a.ground, g = at(a.s, 0, 0), side = a.side, lat = Math.abs(a.lateral);
    if (i % 4 < 2) {
      // Neon tower with a beam reaching over the canal.
      const x = side * (lat + 13), w = 18, d = 22, color = pick(neon);
      box(x, h / 2 - 1, 0, w, h, d, '#262240', g, true);
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) box(x + cx * w / 2, h / 2, cz * d / 2, .45, h, .45, glowMat(color, 1.2), g);
      for (let y = 14; y < h - 6; y += 16) box(x, y, 0, w + .2, .35, d + .2, glowMat(pick(neon), .9), g);
      kit.windows(g, x, 0, w, d, h - 4, .72, ['dark', random() > .5 ? 'bright' : 'cyan']);
      box(x, h - .6, 0, w + .6, .8, d + .6, '#403a5e', g);
      box(x - side * (w / 2 - 1.5), h + 3.5, 0, .5, 7, d * .8, glowMat(color, 1.4), g);
      box(side * (lat + 1.5), h + .5, 0, 7, .8, 1.2, '#4a4468', g);
      box(x + side * 3, h + 7, 5, .25, 14, .25, '#5a5478', g); box(x + side * 3, h + 14.2, 5, .8, .8, .8, glowMat('#ff3355', 2), g);
      // Mirrored neon streaks in the water.
      box(x - side * (w / 2 + 3), -.45, 0, 10, .05, 1.2, mat(color, { emissive: color, emissiveIntensity: .7, transparent: true, opacity: .35 }), g);
    } else {
      // Gantry crane: lattice legs on the quay and a jib carrying the hook point.
      const x = side * (lat + 16), top = h + 2;
      for (const lx of [-3, 3]) for (const lz of [-3, 3]) box(x + lx, top / 2, lz, .9, top, .9, '#e0a63a', g, true);
      for (let y = 8; y < top; y += 9) { box(x, y, -3, 6.9, .45, .45, '#c48a2c', g); box(x, y, 3, 6.9, .45, .45, '#c48a2c', g); }
      box(x, top + 1.2, 0, 8, 2.4, 8, '#e0a63a', g, true);
      box(x + side * 2, top + 4, 0, 4, 3.4, 4, '#3b3350', g); box(x + side * 1.2, top + 4.3, -2.05, 2.8, 1.5, .1, glowMat('#ffe08a', .8), g);
      const jibStart = side * (lat + 28), jibEnd = side * (lat - 3);
      box((jibStart + jibEnd) / 2, top + 3, 0, Math.abs(jibStart - jibEnd), 1.3, 1.6, '#e8b24a', g, true);
      box(jibStart, top + 1.5, 0, 4, 3.5, 3, '#3b3350', g);
      box(side * lat, (top + 3 + h) / 2, 0, .12, top + 3 - h, .12, '#8f8aa8', g);
      box(jibEnd, top + 4, 0, .8, .8, .8, glowMat('#ff3355', 2), g);
    }
  });
  // Container stacks and warehouses crowd the quays.
  const containerColors = ['#b8404f', '#2f7fa8', '#d49a36', '#3d8f6b', '#6b4fa8'];
  for (let s = -40; s < end - 20; s += 26) for (const side of [-1, 1]) {
    if (course.anchors.some(a => a.side === side && Math.abs(a.s - s) < 18)) continue;
    const g = at(s + range(-4, 4), 0, 1.4), x = side * range(hw + 34, hw + 56), stacks = 1 + Math.floor(random() * 4);
    for (let k = 0; k < stacks; k++) box(x + (random() - .5) * .8, 1.3 + k * 2.65, 0, 2.6, 2.6, 12, pick(containerColors), g, k === stacks - 1);
    if (random() > .6) box(side * (hw + 20), 7, 0, 14, 14, 20, '#302b48', g, true);
  }
  // Distant skyline with glowing crowns.
  for (let s = -80; s < end; s += 34) for (const side of [-1, 1]) {
    const g = at(s, 0, 0), x = side * range(110, 230), h = range(50, 190), w = range(16, 34), color = pick(neon);
    box(x, h / 2, 0, w, h, w, '#1d1934', g);
    box(x, h + 1, 0, w * .7, 2, w * .7, glowMat(color, 1.1), g);
    if (random() > .5) box(x + w / 2 + .1, h * .6, 0, .3, h * .8, .6, glowMat(pick(neon), .9), g);
  }
  // Canal-side bollard lights.
  for (let s = -60; s < end; s += 10) for (const side of [-1, 1]) { const g = at(s, side * (hw + 8), 1.4); box(0, .6, 0, .5, 1.2, .5, glowMat(s % 20 ? '#3ff3ff' : '#ff4fd8', 1.5), g); }
  // A slowly turning ferris wheel on the outside of the big bend.
  const wheelFrame = frameAt(course, course.length * .36), wheel = new THREE.Group(), hub = new THREE.Group();
  wheel.position.set(wheelFrame.x - wheelFrame.rx * 150, 0, wheelFrame.z - wheelFrame.rz * 150); wheel.rotation.y = wheelFrame.heading + Math.PI / 2; root.add(wheel); wheel.userData.nonSolid = true;
  hub.position.y = 78; wheel.add(hub);
  hub.add(new THREE.Mesh(new THREE.TorusGeometry(62, .9, 6, 48), glowMat('#ff4fd8', 1.3)));
  hub.add(new THREE.Mesh(new THREE.TorusGeometry(58, .5, 6, 48), glowMat('#3ff3ff', 1.1)));
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, spoke = new THREE.Mesh(cube, mat('#8b86b0')); spoke.scale.set(.5, 62, .5); spoke.position.set(Math.cos(a) * 31, Math.sin(a) * 31, 0); spoke.rotation.z = a - Math.PI / 2; hub.add(spoke);
    const cab = new THREE.Mesh(cube, glowMat(neon[k % 4], .8)); cab.scale.set(4, 4, 4); cab.position.set(Math.cos(a) * 62, Math.sin(a) * 62 - 3, 0); cab.userData.cab = true; hub.add(cab);
  }
  for (const s of [-1, 1]) { const leg = new THREE.Mesh(cube, mat('#4a4468')); leg.scale.set(2, 82, 2); leg.position.set(s * 16, 38, 0); leg.rotation.z = s * .2; wheel.add(leg); }
  kit.updaters.push((dt, t) => { hub.rotation.z = t * .05; hub.children.forEach(c => { if (c.userData.cab) c.rotation.z = -hub.rotation.z; }); });
  // Water taxis cruising the canal.
  const boats = [];
  for (let i = 0; i < 16; i++) {
    const b = new THREE.Group(), color = pick(neon);
    box(0, 0, 0, 3.4, 1.3, 10, '#e9e4f5', b, true); box(0, 1.2, .8, 2.6, 1.3, 4.5, '#2b2744', b); box(0, .1, -5.05, 3.5, .25, .1, glowMat(color, 2), b);
    box(0, 1.2, -1.5, 2.7, .3, .1, glowMat(color, 1.5), b);
    b.userData.nonSolid = true; root.add(b); boats.push({ obj: b, s: range(-60, end - 40), lateral: (i % 2 ? 1 : -1) * range(6, 14), speed: (i % 2 ? -1 : 1) * range(5, 11) });
  }
  kit.updaters.push((dt, t) => boats.forEach((b, i) => {
    b.s += b.speed * dt; if (b.s > end - 30) b.s = -60; if (b.s < -60) b.s = end - 30;
    const f = frameAt(course, b.s); b.obj.position.set(f.x + f.rx * b.lateral, .2 + Math.sin(t * 1.3 + i) * .12, f.z + f.rz * b.lateral); b.obj.rotation.y = f.heading + (b.speed < 0 ? Math.PI : 0);
  }));
  launchPad(kit, { body: '#2d2847', top: '#4a4468', strip: '#3ff3ff', chevron: '#ff4fd8' });
  goalPad(kit, { body: '#2d2847', top: '#5ff5ff', check: '#ff4fd8' });
  birds(kit, 8, '#b8b2e6', 90, 140);
  return lists;
}

/* ---------------------------------------------------------------- 03 RED CANYON */
function canyon(kit) {
  const { box, shape, cylinder, at, random, range, pick, course, root, bounds } = kit, hw = course.halfWidth, end = course.total - course.pre;
  const wave = (s, k) => Math.sin(s * .037 + k * 1.7) * 2.6 + Math.sin(s * .113 + k * 4.1) * 1.4 + Math.sin(s * .21 + k) * .7;
  const strata = ['#8f3a24', '#b8502e', '#d67a45', '#a8442a', '#e4a266', '#c0603a', '#dc9458'];
  const band = y => strata[Math.min(strata.length - 1, Math.floor(Math.max(0, y) / 16))];
  // Canyon floor with a winding river.
  kit.ribbon(-90, end, 4, (s) => {
    const r = Math.sin(s * .012) * 5;
    return [[-(hw + 9), 0, '#c98a55'], [r - 7, .2, '#d9a066'], [r - 5, -.3, '#3fa7b0'], [r, -.4, '#56bcc0'], [r + 5, -.3, '#3fa7b0'], [r + 7, .2, '#d9a066'], [hw + 9, 0, '#c98a55']];
  });
  // Striped walls lean back as they rise so anchors hang from overhangs.
  for (const side of [-1, 1]) kit.ribbon(-90, end, 4, (s) => {
    const k = side * 3, pts = [[hw + 9, 0], [hw + 7 + wave(s, k), 14], [hw + 10 + wave(s, k + 1), 30], [hw + 9 + wave(s, k + 2), 46], [hw + 14 + wave(s, k + 3), 62], [hw + 12 + wave(s, k + 4), 80], [hw + 17 + wave(s, k + 5), 96], [hw + 24 + wave(s, k + 6), 112], [hw + 40, 117], [hw + 90, 118]];
    const row = pts.map(([l, y]) => [side * l, y, band(y + wave(s * .5, k) * 2)]);
    return side < 0 ? row.reverse() : row;
  }, { shadow: true });
  const desert = new THREE.Mesh(new THREE.PlaneGeometry(bounds.maxX - bounds.minX + 2400, bounds.maxZ - bounds.minZ + 2400), mat('#d69a62'));
  desert.rotation.x = -Math.PI / 2; desert.position.set(bounds.cx, bounds.minY + 20, bounds.cz); desert.receiveShadow = true; root.add(desert);
  // Rock overhangs carry the hook points.
  const slab = new THREE.IcosahedronGeometry(1, 0);
  course.anchors.forEach(a => {
    const h = a.y - a.ground, g = at(a.s, 0, 0), side = a.side, lat = Math.abs(a.lateral);
    const rock = shape(slab, pick(['#a8472c', '#b9582f', '#96402a']), side * (lat + 7), h + 2, 0, g); rock.scale.set(8, 3.6, 8); rock.rotation.set(range(-.2, .2), range(0, 3), range(-.15, .15));
    box(side * lat, h + .6, 0, .5, 1.6, .5, '#5a2d20', g);
  });
  // Natural arches spanning the canyon high above the flight path.
  for (const t of [.22, .5, .78]) {
    const g = at(course.length * t, 0, 0);
    const arch = shape(new THREE.TorusGeometry(hw + 24, 6.5, 5, 18, Math.PI), '#b4532f', 0, 84, 0, g); arch.scale.z = 1.4;
  }
  // Mesas, hoodoos and cacti on the rim.
  for (let i = 0; i < 70; i++) {
    const x = range(bounds.minX - 700, bounds.maxX + 700), z = range(bounds.minZ - 700, bounds.maxZ + 700), near = kit.nearest(x, z);
    if (near.d < 200) continue;
    const r = range(25, 70), h = range(50, 190), base = bounds.minY + 20;
    cylinder(x, base + h / 2, z, r * .85, r, h, pick(['#b8502e', '#c9693c', '#a8442a']), kit.statics, 6);
    cylinder(x, base + h + 2, z, r * .82, r * .86, 4, '#e0a066', kit.statics, 6);
  }
  for (let s = -40; s < end; s += 22) for (const side of [-1, 1]) {
    if (random() > .55) continue;
    const g = at(s + range(-6, 6), side * range(hw + 45, hw + 85), 118);
    if (random() > .5) {
      const h = range(6, 11); cylinder(0, h / 2, 0, .8, 1, h, '#4f8a45', g, 6);
      for (const d of [-1, 1]) if (random() > .3) { const y = range(2.5, h - 2); box(d * 1.6, y, 0, 2.2, .8, .8, '#4f8a45', g); box(d * 2.4, y + 1.6, 0, .8, 3.2, .8, '#4f8a45', g); }
    } else {
      let y = 0; for (let k = 0; k < 3; k++) { const r = range(2, 4) * (1 - k * .2), h = range(5, 9); cylinder(0, y + h / 2, 0, r * .8, r, h, pick(strata), g, 5); y += h; }
    }
  }
  // Launch scaffold rising from the canyon floor.
  const launch = at(-19, 0, 0);
  for (const x of [-9, 9]) for (const z of [-9, 9]) box(x, 26, z, 1.4, 52, 1.4, '#6e4a33', launch, true);
  for (let y = 8; y < 52; y += 11) { box(0, y, -9, 18, .8, .8, '#7d5638', launch); box(0, y, 9, 18, .8, .8, '#7d5638', launch); }
  box(0, 53, 0, 23, 1.2, 23, '#9c6a44', launch, true); box(0, 53.7, 1, 7, .12, 19, '#43e6d0', launch);
  goalPad(kit, { body: '#a8502e', top: '#e4a266', check: '#6b2f1f' });
  birds(kit, 9, '#4a2e28', 70, 150);
  return {};
}

/* ---------------------------------------------------------------- 04 AURORA PASS */
function aurora(kit) {
  const { box, shape, cylinder, at, random, range, pick, course, root, bounds } = kit, hw = course.halfWidth, end = course.total - course.pre;
  const lakeFrame = frameAt(course, course.length * .43), lake = { x: lakeFrame.x - lakeFrame.rx * 190, z: lakeFrame.z - lakeFrame.rz * 190 };
  const noise = (x, z) => Math.sin(x * .011) * Math.cos(z * .013) + Math.sin((x + z) * .027) * .5 + Math.sin(x * .061 - z * .05) * .25;
  const heightAt = (x, z) => {
    const n = kit.nearest(x, z), lakeD = Math.hypot(x - lake.x, z - lake.z);
    let h = n.ground - 2 + smoothstep(hw + 24, hw + 150, n.d) * (40 + noise(x, z) * 26) + smoothstep(260, 700, n.d) * (120 + noise(z, x) * 90) + noise(x * 3, z * 3) * 1.2;
    if (lakeD < 150) h = h + (n.ground - 3 - h) * smoothstep(150, 90, lakeD);
    return h;
  };
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) + 1400, segments = 150;
  const terrain = new THREE.PlaneGeometry(size, size, segments, segments); terrain.rotateX(-Math.PI / 2);
  const pos = terrain.attributes.position, colors = [], c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + bounds.cx, z = pos.getZ(i) + bounds.cz, y = heightAt(x, z), n = kit.nearest(x, z);
    pos.setXYZ(i, x, y, z);
    const rise = y - n.ground, lakeD = Math.hypot(x - lake.x, z - lake.z);
    c.set(lakeD < 95 ? '#8fc9e6' : rise > 70 && noise(x * 2, z * 2) > .1 ? '#5b6a86' : rise > 30 && noise(x * 4, z) > .6 ? '#8a99b3' : '#eef6ff');
    colors.push(c.r, c.g, c.b);
  }
  terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); terrain.computeVertexNormals();
  const ground = new THREE.Mesh(terrain, mat('#ffffff', { vertexColors: true })); ground.receiveShadow = true; root.add(ground);
  // Giant snowy pines hold the hook points on their branches.
  const cone = new THREE.ConeGeometry(1, 1, 8);
  function pine(g, x, y, height, big = false) {
    const trunkH = height * .35;
    cylinder(x, y + trunkH / 2, 0, height * .025, height * .04, trunkH, '#4a3328', g, 6);
    const tiers = big ? 6 : 3;
    for (let t = 0; t < tiers; t++) {
      const r = big ? 9 - t * 1.2 : height * (.24 - t * .06), ty = y + trunkH * .7 + t * (height * .65 / tiers), th = height * (big ? .2 : .32);
      const green = shape(cone, t % 2 ? '#1d4b47' : '#235a50', x, ty + th / 2, 0, g, true); green.scale.set(r, th, r);
      const snow = shape(cone, '#f1f8ff', x, ty + th * .72, 0, g, false); snow.scale.set(r * .62, th * .45, r * .62);
    }
  }
  course.anchors.forEach(a => {
    const h = a.y - a.ground, g = at(a.s, 0, 0), side = a.side, lat = Math.abs(a.lateral);
    pine(g, side * (lat + 10), -2, h + 20, true);
    box(side * (lat + 5), h, 0, 10, .9, .9, '#4a3328', g);
    box(side * lat, h - 1.4, 0, .9, 1.4, .9, glowMat('#ffc36b', 1.6), g);
  });
  for (let s = -60; s < end; s += 8) for (const side of [-1, 1]) {
    if (random() > .5 || course.anchors.some(a => a.side === side && Math.abs(a.s - s) < 12)) continue;
    const lateral = side * (hw + 16 + Math.pow(random(), 1.6) * 170), f = frameAt(course, s), x = f.x + f.rx * lateral, z = f.z + f.rz * lateral;
    if (kit.nearest(x, z).d < hw + 8 || Math.hypot(x - lake.x, z - lake.z) < 100) continue;
    const g = new THREE.Group(); g.position.set(x, 0, z); kit.statics.add(g);
    pine(g, 0, heightAt(x, z) - 1, range(16, 42));
  }
  // Ice crystals mark the corridor edges.
  const crystal = new THREE.OctahedronGeometry(1, 0);
  for (let s = -40; s < end; s += 36) for (const side of [-1, 1]) {
    const g = at(s, side * (hw + 4), 0), m = shape(crystal, mat('#aee8ff', { emissive: '#5cc8ff', emissiveIntensity: .7, roughness: .3 }), 0, 3, 0, g, false);
    m.scale.set(1.2, range(3, 6), 1.2); m.rotation.set(range(-.3, .3), range(0, 3), range(-.3, .3));
  }
  // Cabin with warm light by the start line.
  const cabin = at(-10, -70, heightAt(frameAt(course, -10).x - frameAt(course, -10).rx * 70, frameAt(course, -10).z - frameAt(course, -10).rz * 70) - course.ys[0]);
  box(0, 5, 0, 18, 10, 14, '#6a4631', cabin, true); const roof = box(0, 12, 0, 20, 1, 16.5, '#eef6ff', cabin, true); roof.rotation.z = .02;
  for (const x of [-4.5, 4.5]) box(x, 5, 7.05, 3, 3, .1, glowMat('#ffb862', 1.8), cabin);
  box(5, 13, -3, 2, 6, 2, '#5a3a2a', cabin);
  // Wooden ski-jump launch tower.
  const launch = at(-19, 0, 0);
  for (const x of [-9, 9]) for (const z of [-9, 9]) box(x, 26, z, 1.8, 52, 1.8, '#5b4030', launch, true);
  for (let y = 10; y < 52; y += 12) for (const z of [-9, 9]) box(0, y, z, 18, 1, 1, '#6b4a36', launch);
  box(0, 53, 0, 23, 1.4, 23, '#7a5842', launch, true); box(0, 53.8, 0, 22, .3, 22, '#eef6ff', launch); box(0, 54, 1, 7, .12, 19, '#7dffc8', launch);
  goalPad(kit, { body: '#4d5f7d', top: '#eef6ff', check: '#2a8f78' });
  return {};
}

/* ---------------------------------------------------------------- 05 CLOUD GARDEN */
function garden(kit) {
  const { box, shape, cylinder, at, random, range, pick, course, root, bounds } = kit, hw = course.halfWidth, end = course.total - course.pre;
  // Cloud sea below the course.
  const puff = new THREE.IcosahedronGeometry(1, 1), cloudMat = mat('#ffffff', { emissive: '#e3ecff', emissiveIntensity: .35 });
  const cloudSpots = [];
  for (let i = 0; i < 520; i++) {
    const x = range(bounds.minX - 900, bounds.maxX + 900), z = range(bounds.minZ - 900, bounds.maxZ + 900);
    cloudSpots.push([x, bounds.minY - 32 + range(-8, 6), z, range(40, 95), range(9, 20), range(40, 95)]);
  }
  for (let i = 0; i < 70; i++) {
    const x = range(bounds.minX - 500, bounds.maxX + 500), z = range(bounds.minZ - 500, bounds.maxZ + 500), n = kit.nearest(x, z);
    if (n.d < hw + 60) continue;
    cloudSpots.push([x, n.ground + range(20, 150), z, range(14, 34), range(6, 12), range(14, 34)]);
  }
  const clouds = new THREE.InstancedMesh(puff, cloudMat, cloudSpots.length), o = new THREE.Object3D();
  cloudSpots.forEach(([x, y, z, sx, sy, sz], i) => { o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.y = i; o.updateMatrix(); clouds.setMatrixAt(i, o.matrix); });
  clouds.computeBoundingSphere(); root.add(clouds);
  const coneDown = new THREE.ConeGeometry(1, 1, 7), crystal = new THREE.OctahedronGeometry(1, 0), blob = new THREE.IcosahedronGeometry(1, 0);
  const water = mat('#bfe8ff', { transparent: true, opacity: .55, emissive: '#a6dcff', emissiveIntensity: .4 });
  function island(g, x, y, r, trees = 2) {
    const rock = shape(coneDown, pick(['#9b7f9a', '#8d7aa3', '#a88a8f']), x, y - r * .9, 0, g, true); rock.scale.set(r, r * 1.8, r); rock.rotation.x = Math.PI;
    cylinder(x, y + .5, 0, r * 1.02, r * 1.02, 1.6, '#86d06a', g, 7);
    for (let k = 0; k < trees; k++) {
      const tx = x + range(-r * .6, r * .6), tz = range(-r * .6, r * .6), th = range(3, 7);
      cylinder(tx, y + th / 2, tz, .35, .5, th, '#8a6a5a', g, 5);
      const top = shape(blob, pick(['#ffb3d1', '#b9f08a', '#ffd9a8', '#c9b3ff']), tx, y + th + 2, tz, g, true); top.scale.setScalar(range(2.4, 3.6));
    }
    if (random() > .55) { const fall = box(x + r * .7, y - 22, 0, 2.4, 44, .6, water, g); fall.castShadow = false; }
  }
  course.anchors.forEach((a, i) => {
    const h = a.y - a.ground, g = at(a.s, 0, 0), side = a.side, lat = Math.abs(a.lateral), x = side * (lat + 14);
    island(g, x, h - 48, range(9, 13), 2);
    const top = h + 3;
    cylinder(x, (h - 48 + top) / 2, 0, 1.5, 1.9, top - h + 48, '#f4ecff', g, 6);
    for (let y = h - 40; y < top; y += 11) cylinder(x, y, 0, 2.1, 2.1, .7, '#f2c84b', g, 6);
    box((x + side * lat) / 2, h + .5, 0, Math.abs(x - side * lat), .7, .7, '#e8b94a', g);
    const gem = shape(crystal, glowMat(i % 2 ? '#8fe8ff' : '#ffa8e0', 1.1), x, top + 3, 0, g, false); gem.scale.set(2, 3.4, 2);
  });
  for (let s = -40; s < end; s += 30) for (const side of [-1, 1]) {
    if (random() > .6) continue;
    const g = at(s + range(-8, 8), side * range(hw + 45, hw + 140), range(-30, 40)); island(g, 0, 0, range(8, 22), 1 + Math.floor(random() * 4));
  }
  // Floating lanterns outline the corridor.
  const lantern = glowMat('#ffe9a8', 1.6);
  for (let s = -40; s < end; s += 32) for (const side of [-1, 1]) {
    const g = at(s, side * (hw + 2), 0);
    shape(blob, lantern, 0, 22, 0, g, false).scale.setScalar(.9); shape(blob, lantern, 0, 74, 0, g, false).scale.setScalar(.9);
  }
  // Giant world tree in the middle of the spiral.
  let tx = 0, tz = 0, count = 0;
  for (let s = course.length * .15; s < course.length * .75; s += 10) { const f = frameAt(course, s); tx += f.x; tz += f.z; count++; }
  tx /= count; tz /= count;
  const tree = new THREE.Group(); tree.position.set(tx, bounds.minY, tz); kit.statics.add(tree);
  const base = shape(coneDown, '#8d7aa3', 0, -60, 0, tree, true); base.scale.set(75, 130, 75); base.rotation.x = Math.PI;
  cylinder(0, 3, 0, 77, 77, 6, '#86d06a', tree, 9);
  cylinder(0, 60, 0, 9, 16, 120, '#8a6a5a', tree, 8);
  for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, m = shape(blob, pick(['#ffb3d1', '#ffc9e0', '#f7a3c8']), Math.cos(a) * range(20, 34), range(105, 150), Math.sin(a) * range(20, 34), tree, true); m.scale.setScalar(range(22, 34)); }
  shape(blob, '#ffd1e6', 0, 158, 0, tree, true).scale.setScalar(32);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; box(Math.cos(a) * 55, 11, Math.sin(a) * 55, 3, 16, 3, '#f4ecff', tree, true); }
  // Sky whales drift in wide circles; balloons bob over the islands.
  const whales = [];
  for (let i = 0; i < 3; i++) {
    const w = new THREE.Group(), body = new THREE.Mesh(blob, mat('#9cc7f2')); body.scale.set(9, 7, 26); w.add(body);
    const belly = new THREE.Mesh(blob, mat('#e9f4ff')); belly.scale.set(7, 4, 20); belly.position.y = -3.4; w.add(belly);
    const tail = new THREE.Group(); tail.position.z = 24; w.add(tail);
    const fluke = new THREE.Mesh(cube, mat('#8ab8e6')); fluke.scale.set(16, .8, 6); fluke.position.z = 3; tail.add(fluke);
    for (const s of [-1, 1]) { const fin = new THREE.Mesh(cube, mat('#8ab8e6')); fin.scale.set(10, .6, 4); fin.position.set(s * 10, -2, -4); fin.rotation.z = s * -.3; w.add(fin); }
    w.userData = { radius: 260 + i * 90, y: bounds.maxY + 110 + i * 25, speed: .03 + i * .008, phase: i * 2.1, tail };
    w.userData.nonSolid = true; root.add(w); whales.push(w);
  }
  const balloons = [];
  for (let i = 0; i < 10; i++) {
    const b = new THREE.Group(), color = pick(['#ff9ec7', '#ffd36e', '#9fd8ff', '#c6a8ff']);
    const env = new THREE.Mesh(blob, mat(color)); env.scale.set(6, 7.5, 6); env.position.y = 10; b.add(env);
    const basket = new THREE.Mesh(cube, mat('#8a6a5a')); basket.scale.set(2.2, 1.8, 2.2); b.add(basket);
    const f = frameAt(course, range(0, course.length)), side = i % 2 ? 1 : -1, lateral = side * range(hw + 50, hw + 160);
    b.position.set(f.x + f.rx * lateral, f.y + range(30, 110), f.z + f.rz * lateral); b.userData.baseY = b.position.y; b.userData.nonSolid = true; root.add(b); balloons.push(b);
  }
  kit.updaters.push((dt, t) => {
    whales.forEach(w => {
      const u = w.userData, a = u.phase + t * u.speed;
      w.position.set(tx + Math.cos(a) * u.radius, u.y + Math.sin(t * .4 + u.phase) * 6, tz + Math.sin(a) * u.radius);
      w.rotation.y = -a; u.tail.rotation.x = Math.sin(t * 1.2 + u.phase) * .25;
    });
    balloons.forEach((b, i) => { b.position.y = b.userData.baseY + Math.sin(t * .3 + i) * 5; });
  });
  // Launch island.
  const launch = at(-19, 0, 0);
  island(launch, 0, 38, 18, 0);
  cylinder(0, 46, 0, 9, 11, 16, '#f4ecff', launch, 8); cylinder(0, 53.3, 0, 12, 12, .8, '#f2c84b', launch, 8); box(0, 53.8, 1, 5, .12, 17, '#8fd3ff', launch);
  const goal = at(course.length + 40, 0, 0);
  island(goal, 0, 0, 30, 3);
  for (let x = -15; x < 16; x += 3) for (let z = -6; z < 7; z += 3) box(x, 1.5, z, 3, .1, 3, (Math.round(x / 3) + Math.round(z / 3)) % 2 ? '#fff6d4' : '#ff9fd0', goal);
  birds(kit, 14, '#ffffff', 40, 130);
  return {};
}

const THEMES = { sunset, harbor, canyon, aurora, garden };

export function buildWorld(map, course) {
  const env = ENVIRONMENTS[map.theme];
  const kit = createKit(course, map.id === 'sunset' ? 391 : 391 + Number(map.no) * 977);
  const instanceMaterials = THEMES[map.theme](kit, course, map, env) || {};
  bake(kit, instanceMaterials);
  const { root } = kit;
  // Collide with exactly what is drawn: built now, before gates, markers and other see-through helpers are added.
  const collider = createCollider(solidMeshes(root));
  const owned = [];
  const gates = course.gates.map((g, i) => {
    const group = new THREE.Group(); group.position.set(g.x, g.y, g.z); group.rotation.y = Math.atan2(-g.tx, -g.tz); root.add(group);
    const ringMat = new THREE.MeshBasicMaterial({ color: env.gate, transparent: true, opacity: .88 }), softMat = new THREE.MeshBasicMaterial({ color: env.gateSoft, transparent: true, opacity: .4 });
    owned.push(ringMat, softMat);
    group.add(new THREE.Mesh(new THREE.TorusGeometry(g.radius, .18, 6, 64), ringMat));
    group.add(new THREE.Mesh(new THREE.TorusGeometry(g.radius + .7, .045, 4, 64), softMat));
    for (let j = 0; j < 4; j++) { const marker = kit.box(Math.cos(j * Math.PI / 2) * g.radius, Math.sin(j * Math.PI / 2) * g.radius, 0, .65, 3, .6, env.gateMarker, group); marker.rotation.z = j * Math.PI / 2 + Math.PI / 2; }
    group.children.forEach(m => { m.position.y *= g.height / g.radius; m.scale.y *= g.height / g.radius; });
    const label = makeLabel(i === course.gates.length - 1 ? 'FINISH' : String(i + 1).padStart(2, '0'), env.label); label.position.set(0, g.height + 4, 0); group.add(label);
    return group;
  });
  const markerMat = new THREE.MeshBasicMaterial({ color: env.marker }), markerGeo = new THREE.OctahedronGeometry(.7);
  owned.push(markerMat);
  const anchorMarkers = course.anchors.map(a => { const m = new THREE.Mesh(markerGeo, markerMat); m.position.set(a.x, a.y, a.z); root.add(m); return m; });
  return {
    root, env, gates, anchorMarkers, collider,
    update(dt, t) { kit.updaters.forEach(u => u(dt, t)); },
    dispose() {
      root.traverse(o => {
        if (o.geometry && o.geometry !== cube) o.geometry.dispose();
        if (o.material?.map) o.material.map.dispose();
        if (o.isSprite) o.material.dispose();
        if (o.isInstancedMesh) o.dispose();
      });
      owned.forEach(m => m.dispose());
    },
  };
}
