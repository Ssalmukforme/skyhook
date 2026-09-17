// Scenery for one 625 m chunk of the endless track. Same look as the web maps (src/worlds.js), rebuilt so
// every object is placed relative to the generated centerline and nothing reaches into another stretch of track.
import * as THREE from 'three';
import { frameAt } from '../physics.js';
import { ENVIRONMENTS, mat, glowMat, cube, bake } from '../worlds.js';
import { createCollider, solidMeshes } from '../collider.js';
import { createRandom, smoothstep, districtAt } from './track.js';

// Themes blend over this far on each side of a district boundary: the ground morphs from one to the other,
// the old theme's scenery thins out while the new one's appears, and the sky and light change across the same stretch.
export const THEME_BLEND = 250;
// How much of district k's theme is present at distance s (0..1). Across a boundary the two themes always add up to 1.
export function themePresence(k, s) {
  const { s0, s1 } = districtAt(k);
  return (k > 0 ? smoothstep(s0 - THEME_BLEND, s0 + THEME_BLEND, s) : 1) * (1 - smoothstep(s1 - THEME_BLEND, s1 + THEME_BLEND, s));
}
// Stable 0..1 value per hook, deciding which theme builds the structure holding it inside a blend.
const hookHash = a => { const x = Math.sin(a.row * 12.9898 + a.side * 78.233) * 43758.5453; return x - Math.floor(x); };

function createKit(track, chunk, ownFrom, ownTo) {
  const statics = new THREE.Group(), root = new THREE.Group(), hw = chunk.halfWidth;
  const { random, range, pick } = createRandom(track.seed * 131 + chunk.index * 977 + 1);
  const district = districtAt(chunk.district), blendIn = chunk.s0 === district.s0 && district.index > 0, blendOut = chunk.s1 === district.s1;
  // Scenery reaches into the neighbouring district across a blend; this theme's own ground stops where the blend starts.
  const from = blendIn ? ownFrom - THEME_BLEND : ownFrom, to = blendOut ? ownTo + THEME_BLEND : ownTo;
  const groundFrom = blendIn ? ownFrom + THEME_BLEND : ownFrom, groundTo = blendOut ? ownTo - THEME_BLEND : ownTo;
  const presence = s => themePresence(district.index, s);
  const material = color => typeof color === 'string' ? mat(color) : color;
  function box(x, y, z, w, h, d, color, parent = statics, shadow = false) {
    const m = new THREE.Mesh(cube, material(color)); m.position.set(x, y, z); m.scale.set(w, h, d); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
  }
  function shape(geometry, color, x, y, z, parent = statics, shadow = true) {
    const m = new THREE.Mesh(geometry, material(color)); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
  }
  const cylinder = (x, y, z, rt, rb, h, color, parent = statics, sides = 7) => shape(new THREE.CylinderGeometry(rt, rb, h, sides), color, x, y, z, parent);
  // A group whose local x is the track's right side and local -z is forward. Inside a blend it is kept with a chance
  // that follows this theme's presence there (square-rooted, so both themes stay visible well into the mix);
  // a dropped group is never added to the scene, so whatever is built on it vanishes. Hook holders and the launch pad pass keep = true.
  function at(s, lateral = 0, y = 0, parent = statics, keep = false) {
    const f = frameAt(track, s), g = new THREE.Group();
    g.position.set(f.x + f.rx * lateral, f.y + y, f.z + f.rz * lateral); g.rotation.y = f.heading;
    if (keep || random() < Math.sqrt(presence(s))) parent.add(g);
    return g;
  }
  const worldAt = (s, lateral) => { const f = frameAt(track, s); return [f.x + f.rx * lateral, f.z + f.rz * lateral, f]; };
  // Free space check for anything set back from the corridor: no stretch of track (this district or any other)
  // may come closer than the object's own centerline does, or pass within its footprint plus a flying margin.
  function clear(s, lateral, radius) {
    const [x, z] = worldAt(s, lateral);
    return track.distanceTo(x, z, s - 900, s + 900) >= Math.min(Math.abs(lateral) - 2, 26 + radius + 20);
  }
  const instanceLists = new Map();
  function instance(name, parent, x, y, z, w, h, d) {
    if (!parent.parent) return; // built on a dropped group
    if (!instanceLists.has(name)) instanceLists.set(name, []);
    instanceLists.get(name).push({ parent, matrix: new THREE.Matrix4().makeScale(w, h, d).setPosition(x, y, z) });
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
  // Strip mesh swept along this district: profile returns [lateral, height, color] points across the course.
  function ribbon(stepSize, profile, { shadow = false, extra = {}, start = groundFrom, end = groundTo } = {}) {
    const positions = [], colors = [], index = [], color = new THREE.Color();
    let rows = 0, cols = 0;
    for (let s = start; ; s += stepSize) {
      s = Math.min(s, end);
      const f = frameAt(track, s), pts = profile(s, f); cols = pts.length; rows++;
      for (const [lat, y, c] of pts) { positions.push(f.x + f.rx * lat, f.y + y, f.z + f.rz * lat); color.set(c); colors.push(color.r, color.g, color.b); }
      if (s >= end) break;
    }
    for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) {
      const a = r * cols + k, b = a + 1, c = a + cols, d = c + 1; index.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(index); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat('#ffffff', { vertexColors: true, side: THREE.DoubleSide, ...extra })); m.castShadow = shadow; m.receiveShadow = true; root.add(m); return m;
  }
  // Moving or soft decoration (cars, boats, sails, vines...) lives here: drawn, but never collided with.
  const soft = new THREE.Group(); soft.userData.nonSolid = true; root.add(soft);
  // nearAnchors: every hook this chunk's scenery reaches. anchors: the ones whose holding structure this theme builds.
  const nearAnchors = track.allAnchors.filter(a => a.s >= from && a.s < to), anchors = nearAnchors.filter(a => hookHash(a) < presence(a.s));
  const bounds = (() => {
    let minY = Infinity, maxY = -Infinity;
    for (let s = from; s <= to; s += 10) { const y = frameAt(track, s).y; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return { minY, maxY };
  })();
  const updaters = [];
  // Walls and ridges sink into the ground where this theme's own ground ends at a blend (0 beyond it).
  const edgeTaper = s => (blendIn ? smoothstep(groundFrom, groundFrom + 150, s) : 1) * (blendOut ? smoothstep(groundTo, groundTo - 150, s) : 1);
  return { track, chunk, district, blendIn, blendOut, hw, from, to, ownFrom, ownTo, groundFrom, groundTo, presence, statics, root, soft, random, range, pick, box, shape, cylinder, at, worldAt, clear, instance, instanceLists, windows, ribbon, anchors, nearAnchors, bounds, updaters, edgeTaper };
}

// Non-solid objects that drift along the course (cars, boats) follow the centerline within this district.
function cruise(kit, objects) {
  const { track, groundFrom: from, groundTo: to } = kit, span = to - from - 40;
  kit.updaters.push((dt, t) => objects.forEach((o, i) => {
    o.s += o.speed * dt;
    if (o.s > to - 20) o.s -= span; if (o.s < from + 20) o.s += span;
    const f = frameAt(track, o.s);
    o.obj.position.set(f.x + f.rx * o.lateral, f.y + (o.y ?? 0) + (o.bob ? Math.sin(t * 1.3 + i) * .12 : 0), f.z + f.rz * o.lateral);
    o.obj.rotation.y = f.heading + (o.speed < 0 ? Math.PI : 0);
  }));
}
function birds(kit, count, color, heightMin, heightMax) {
  const { range, random } = kit, material = mat(color), list = [];
  for (let i = 0; i < count; i++) {
    const b = new THREE.Group();
    for (const s of [-1, 1]) { const wing = new THREE.Mesh(cube, material); wing.position.x = s * .75; wing.scale.set(1.5, .06, .38); wing.rotation.z = s * .2; b.add(wing); }
    const [x, z, f] = kit.worldAt(range(kit.from, kit.to), (random() > .5 ? 1 : -1) * range(60, 160));
    b.userData = { center: new THREE.Vector3(x, f.y + range(heightMin, heightMax), z), radius: range(20, 70), speed: range(.08, .2) * (i % 2 ? 1 : -1), phase: range(0, 6.28) };
    kit.soft.add(b); list.push(b);
  }
  kit.updaters.push((dt, t) => list.forEach((b, i) => {
    const u = b.userData, a = u.phase + t * u.speed;
    b.position.set(u.center.x + Math.cos(a) * u.radius, u.center.y + Math.sin(t * .7 + i) * 2, u.center.z + Math.sin(a) * u.radius);
    b.rotation.y = -a + (u.speed > 0 ? 0 : Math.PI);
    b.children[0].rotation.z = Math.sin(t * 3 + i) * .25; b.children[1].rotation.z = -Math.sin(t * 3 + i) * .25;
  }));
}
function launchPad(kit, colors) {
  const g = kit.at(-19, 0, 0, kit.statics, true);
  kit.box(0, 26.5, 0, 22, 53, 22, colors.body, g, true); kit.box(0, 53.3, 0, 23, .6, 23, colors.top, g, true); kit.box(0, 53.7, 1, 7, .12, 19, colors.strip, g);
}

/* ---------------------------------------------------------------- MARIGOLD AVENUE */
function sunset(kit) {
  const { box, cylinder, at, random, range, pick, hw, anchors, nearAnchors, from, to, clear } = kit;
  const facades = ['#9d777d', '#bd8e86', '#bb9c94', '#c48775', '#82788c', '#ceab93', '#a49b9f'];
  function building(g, x, w, d, h, color, detailed = true) {
    box(x, h / 2, 0, w, h, d, color, g, detailed);
    box(x, h + .3, 0, w + .55, .6, d + .55, '#b9a09c', g);
    if (detailed) {
      kit.windows(g, x, 0, w, d, h);
      box(x - w * .19, h + 1.4, d * .14, w * .28, 1.7, d * .26, '#998d93', g);
      if (random() > .6) { cylinder(x, h + 4, 0, 2.1, 2.1, 3, '#ad887c', g); cylinder(x, h + 5.85, 0, 0, 2.4, .9, '#6c6170', g); }
      box(x, 1.7, d / 2 + .12, w - 2, 3, .2, '#5e566e', g);
    }
  }
  kit.ribbon(4, () => {
    const row = [[-(hw + 90), -30, '#5f5868'], [-(hw + 90), 0, '#847b83'], [-(hw + 2), 0, '#c8aaa0'], [-(hw - 1), .15, '#c8aaa0'], [-(hw - 2), .02, '#686878'], [-.6, .02, '#686878'], [-.3, .09, '#e4bf92'], [.3, .09, '#e4bf92'], [.6, .02, '#686878'], [hw - 2, .02, '#686878'], [hw - 1, .15, '#c8aaa0'], [hw + 2, 0, '#c8aaa0'], [hw + 90, 0, '#847b83'], [hw + 90, -30, '#5f5868']];
    return row;
  });
  for (let s = from + 6; s < to; s += 104) { const g = at(s, 0, 0); for (let x = -hw + 3; x < hw - 2; x += 3.6) box(x, .12, 0, 1.8, .025, 3.4, '#cbb5a3', g); }
  anchors.forEach((a, i) => {
    const g = at(a.s, 0, 0, undefined, true), side = a.side, lat = Math.abs(a.lateral), h = a.y - a.ground - 2.5;
    building(g, side * (lat + 11), 22, 29, h, facades[(a.row + (side > 0 ? 3 : 0)) % facades.length]);
    box(side * lat, h + 1, 0, .3, 2.5, .3, '#e6c0a0', g);
  });
  for (let s = from + 20; s < to; s += 51) for (const side of [-1, 1]) {
    if (!nearAnchors.some(a => a.side === side && Math.abs(a.s - s) < 34)) building(at(s, 0, 0), side * (hw + 16), 24, 30, range(38, 68), pick(facades));
    for (let row = 1; row <= 2; row++) {
      const lateral = side * (hw + 16 + row * 42 + range(-4, 4));
      if (clear(s, lateral, 20)) building(at(s + range(-5, 5), 0, 0), lateral, range(22, 31), range(28, 36), range(34, 108), pick(facades), false);
    }
  }
  for (let s = from + 30; s < to; s += 60) for (const side of [-1, 1]) {
    const lateral = side * range(190, 280);
    if (clear(s, lateral, 22)) building(at(s, 0, 0), lateral, range(18, 34), range(20, 40), range(40, 150), '#8e849b', false);
  }
  const crown = new THREE.IcosahedronGeometry(2.8, 0), lampGlow = mat('#ffdd9c', { emissive: '#ffa965', emissiveIntensity: .65 });
  for (let s = from + 4, k = 0; s < to; s += 26, k++) for (const side of [-1, 1]) {
    const g = at(s, side * (hw - 1), 0);
    cylinder(0, 1.5, 0, .19, .3, 3, '#826b72', g);
    kit.shape(crown, random() > .5 ? '#b4a084' : '#899082', 0, 4, 0, g, false).scale.set(1, 1.25, 1);
    if (k % 2 === 0) { box(side, 4.2, -9, .14, 8.4, .14, '#726879', g); box(0, 8.4, -9, 1.7, .14, .14, '#726879', g); box(-side * .7, 8.3, -9, .6, .14, .4, lampGlow, g); }
  }
  const cars = [];
  for (let i = 0; i < 16; i++) {
    const car = new THREE.Group(), side = i % 2 ? 1 : -1, color = ['#d6ab85', '#8b929a', '#af777a', '#d6bf9d', '#677b89'][i % 5];
    box(0, 0, 0, 2, 1, 4.4, color, car); box(0, .65, .15, 1.8, .8, 2.3, '#69677a', car);
    kit.soft.add(car); cars.push({ obj: car, s: range(from + 20, to - 20), lateral: side * (i % 3 ? 8 : 13) * hw / 22, speed: -range(3, 8) * side, y: .7 });
  }
  cruise(kit, cars);
  if (from < 0) launchPad(kit, { body: '#a88482', top: '#cfaaa0', strip: '#6c6477' });
  birds(kit, 8, '#696276', 95, 140);
  return { dark: mat('#666679'), bright: mat('#e4b686', { emissive: '#ffbe77', emissiveIntensity: .3 }) };
}

/* ---------------------------------------------------------------- HAYSTACK LANE */
function meadow(kit) {
  const { box, shape, cylinder, at, random, range, pick, hw, anchors, from, to, clear } = kit;
  const blob = new THREE.IcosahedronGeometry(1, 0), cone = new THREE.ConeGeometry(1, 1, 8);
  const crops = ['#d9b54a', '#8fbf4f', '#c9a23c', '#a7cc62', '#e2c566', '#7fae45'], wood = '#7a5a3e';
  kit.ribbon(4, s => {
    const block = Math.floor((s + 100) / 60), left = crops[(block + 3) % crops.length], right = crops[block % crops.length];
    return [[-(hw + 110), -30, '#6f9a45'], [-(hw + 110), -.3, left], [-(hw + 12), 0, left], [-(hw + 9), .04, '#6f9a45'], [-6, .06, '#6f9a45'], [-4, .1, '#b89468'], [4, .1, '#b89468'], [6, .06, '#6f9a45'], [hw + 9, .04, '#6f9a45'], [hw + 12, 0, right], [hw + 110, -.3, right], [hw + 110, -30, '#6f9a45']];
  });
  for (let s = from + 2; s < to; s += 8) for (const side of [-1, 1]) {
    const g = at(s, side * (hw + 8), 0);
    box(0, .7, 0, .25, 1.4, .25, wood, g); box(0, 1.1, -4, .12, .14, 8.2, '#8a6a4a', g); box(0, .55, -4, .12, .14, 8.2, '#8a6a4a', g);
  }
  const sail = new THREE.BoxGeometry(.3, 14, 2.8); sail.translate(0, 8.5, 0);
  const sailMat = mat('#f7f1e3'), spinners = [], dome = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  anchors.forEach(a => {
    const h = a.y - a.ground, g = at(a.s, 0, 0, undefined, true), side = a.side, lat = Math.abs(a.lateral), kind = ['windmill', 'poplar', 'silo'][(a.row + (side > 0 ? 1 : 0)) % 3];
    const light = () => box(side * lat, h - 1.4, 0, .9, 1.4, .9, glowMat('#ffd27a', 1.4), g);
    if (kind === 'windmill') {
      const x = side * (lat + 10), top = h + 14, radius = y => 6.5 - 2.3 * y / top;
      cylinder(x, top / 2, 0, radius(top), radius(0), top, pick(['#f3ead8', '#efe2c8', '#e8d9bd']), g, 8);
      shape(cone, pick(['#b5523b', '#9c4a3a', '#6d5a48']), x, top + 4.5, 0, g, true).scale.set(radius(top) + 1, 9, radius(top) + 1);
      box(x - side * (radius(0) - .2), 2.4, 0, .5, 4.8, 3, '#6b4a33', g);
      box(side * (lat + 3.6), h, 0, 8, .9, .9, wood, g, true); light();
      const hub = at(a.s, side * (lat + 10 + radius(top - 8) + 1.2), top - 8, kit.soft, true), rotor = new THREE.Group(); hub.add(rotor);
      for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(sail, sailMat); m.rotation.x = k * Math.PI / 2; m.castShadow = true; rotor.add(m); }
      rotor.userData.speed = range(.5, .9) * (random() > .5 ? 1 : -1); rotor.rotation.x = range(0, 6.28); spinners.push(rotor);
    } else if (kind === 'poplar') {
      const x = side * (lat + range(11, 14)), top = h + range(12, 22);
      cylinder(x, top * .45, 0, .9, 1.8, top * .9, '#6a4e38', g, 7);
      for (let y = top * .22; y < top; y += 9) {
        const r = 5.4 * Math.sin(Math.PI * Math.min(.95, (y - top * .12) / (top * .95))) + 1.4;
        shape(blob, pick(['#4f8a3a', '#5e9a44', '#447a33']), x + range(-.6, .6), y, range(-.6, .6), g, true).scale.set(r, 7, r);
      }
      box((x + side * lat) / 2, h, 0, Math.abs(x) - lat + 1, 1.1, 1.1, '#5b4330', g, true); light();
    } else {
      const x = side * (lat + range(12, 15)), top = h + range(6, 12), r = 6.2, metal = pick(['#c9cfd3', '#b8c2c8', '#d5d0c4']);
      cylinder(x, top / 2, 0, r, r, top, metal, g, 12);
      for (let y = 8; y < top; y += 9) cylinder(x, y, 0, r + .25, r + .25, .5, '#9aa3a8', g, 12);
      shape(dome, metal, x, top, 0, g, true).scale.setScalar(r);
      box(side * (lat + (Math.abs(x) - r - lat) / 2), h, 0, Math.abs(x) - r - lat + 1, .9, .9, wood, g, true); light();
    }
  });
  kit.updaters.push(dt => spinners.forEach(r => { r.rotation.x += r.userData.speed * dt; }));
  const bale = new THREE.CylinderGeometry(1.5, 1.5, 2.2, 10);
  for (let s = from; s < to; s += 18) for (const side of [-1, 1]) {
    if (random() > .55) continue;
    const g = at(s + range(-6, 6), side * range(hw + 32, hw + 100), 0);
    for (let k = 0; k < 1 + Math.floor(random() * 3); k++) shape(bale, '#d8b45c', range(-5, 5), 1.5, range(-5, 5), g, true).rotation.set(0, range(0, 3), Math.PI / 2);
  }
  for (let s = from + 10; s < to; s += 24) for (const side of [-1, 1]) {
    if (random() > .45) continue;
    const lateral = side * range(hw + 34, hw + 100);
    if (!clear(s, lateral, 8)) continue;
    const g = at(s, lateral, 0), th = range(6, 10);
    cylinder(0, th / 2, 0, .5, .8, th, '#6a4e38', g, 6);
    shape(blob, pick(['#4f8a3a', '#5e9a44', '#447a33']), 0, th + range(3, 5), 0, g, true).scale.set(range(5, 8), range(5, 7), range(5, 8));
  }
  for (let i = 0; i < 24; i++) {
    const g = at(range(from, to), (random() > .5 ? 1 : -1) * range(hw + 25, hw + 100), 0); g.rotation.y += range(0, 6.28);
    box(0, 1.1, 0, 1.4, 1.1, 2.2, '#f4f1ea', g, true); box(0, 1.5, 1.4, .7, .7, .8, '#3b3533', g);
  }
  for (const t of [.2, .55, .85]) {
    const s = from + (to - from) * t, side = t < .5 ? 1 : -1, lateral = side * (hw + 95);
    if (!clear(s, lateral, 20)) continue;
    const g = at(s, lateral, 0), red = pick(['#b8473a', '#a63f35']);
    box(0, 7, 0, 18, 14, 26, red, g, true);
    for (const k of [-1, 1]) box(k * 5, 16.5, 0, 12.4, 1, 27.5, '#5a4a44', g, true).rotation.z = -k * .62;
    box(0, 5, 13.1, 7, 9, .2, '#f2ede2', g);
    cylinder(-side * 15, 11, 6, 3, 3, 22, '#c9c2b4', g, 10);
  }
  // Rolling hills far out on both sides.
  for (let s = from + 60; s < to; s += 130) for (const side of [-1, 1]) {
    const lateral = side * range(380, 520);
    if (!clear(s, lateral, 150)) continue;
    const [x, z, f] = kit.worldAt(s, lateral);
    shape(blob, pick(['#7fa94c', '#8db552', '#6e9a45']), x, f.y - 20, z, kit.statics, false).scale.set(range(110, 160), range(40, 75), range(110, 160));
  }
  if (from < 0) launchPad(kit, { body: '#c9a878', top: '#e8d6ae', strip: '#7a5a3e' });
  birds(kit, 10, '#4a4440', 60, 130);
  return {};
}

/* ---------------------------------------------------------------- LANTERN HARBOR */
function harbor(kit) {
  const { box, shape, cylinder, at, random, range, pick, hw, anchors, nearAnchors, from, to, clear } = kit;
  const neon = ['#ff4fd8', '#3ff3ff', '#9b6bff', '#ffcc4a'];
  kit.ribbon(6, () => {
    const row = [];
    for (const side of [-1, 1]) {
      const pts = [[hw + 4, -1.5, '#24203a'], [hw + 4, 1.4, '#3a3552'], [hw + 5, 1.4, '#5ff5ff'], [hw + 6, 1.4, '#34304a'], [hw + 70, 1.4, '#2c2842'], [hw + 70, -3, '#1d1a30']];
      const mapped = pts.map(([l, y, c]) => [side * l, y, c]);
      row.push(...(side < 0 ? mapped.reverse() : mapped));
      if (side < 0) row.push([0, -40, '#16123a']);
    }
    return row;
  });
  const water = { roughness: .22, metalness: .5 };
  kit.ribbon(6, () => [[-(hw + 4), -.6, '#16123a'], [hw + 4, -.6, '#16123a']], { extra: water });
  for (const side of [-1, 1]) kit.ribbon(10, () => side < 0 ? [[-420, -.6, '#16123a'], [-(hw + 70), -.6, '#16123a']] : [[hw + 70, -.6, '#16123a'], [420, -.6, '#16123a']], { extra: water });
  const lists = { dark: mat('#3a3658'), bright: mat('#ffd27a', { emissive: '#ffb14a', emissiveIntensity: .8 }), cyan: mat('#7ff9ff', { emissive: '#3ff3ff', emissiveIntensity: 1 }) };
  anchors.forEach(a => {
    const h = a.y - a.ground, g = at(a.s, 0, 0, undefined, true), side = a.side, lat = Math.abs(a.lateral);
    if ((a.row + (side > 0 ? 2 : 0)) % 4 < 2) {
      const x = side * (lat + 13), w = 18, d = 22, color = pick(neon);
      box(x, h / 2 - 1, 0, w, h, d, '#262240', g, true);
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) box(x + cx * w / 2, h / 2, cz * d / 2, .45, h, .45, glowMat(color, 1.2), g);
      for (let y = 14; y < h - 6; y += 16) box(x, y, 0, w + .2, .35, d + .2, glowMat(pick(neon), .9), g);
      kit.windows(g, x, 0, w, d, h - 4, .72, ['dark', random() > .5 ? 'bright' : 'cyan']);
      box(x, h - .6, 0, w + .6, .8, d + .6, '#403a5e', g);
      box(x - side * (w / 2 - 1.5), h + 3.5, 0, .5, 7, d * .8, glowMat(color, 1.4), g);
      box(side * (lat + 1.5), h + .5, 0, 7, .8, 1.2, '#4a4468', g);
      box(x - side * (w / 2 + 3), -.45, 0, 10, .05, 1.2, mat(color, { emissive: color, emissiveIntensity: .7, transparent: true, opacity: .35 }), g);
    } else {
      const x = side * (lat + 16), top = h + 2;
      for (const lx of [-3, 3]) for (const lz of [-3, 3]) box(x + lx, top / 2, lz, .9, top, .9, '#e0a63a', g, true);
      for (let y = 8; y < top; y += 9) { box(x, y, -3, 6.9, .45, .45, '#c48a2c', g); box(x, y, 3, 6.9, .45, .45, '#c48a2c', g); }
      box(x, top + 1.2, 0, 8, 2.4, 8, '#e0a63a', g, true);
      box(x + side * 2, top + 4, 0, 4, 3.4, 4, '#3b3350', g);
      const jibStart = side * (lat + 28), jibEnd = side * (lat - 3);
      box((jibStart + jibEnd) / 2, top + 3, 0, Math.abs(jibStart - jibEnd), 1.3, 1.6, '#e8b24a', g, true);
      box(jibStart, top + 1.5, 0, 4, 3.5, 3, '#3b3350', g);
      box(side * lat, (top + 3 + h) / 2, 0, .12, top + 3 - h, .12, '#8f8aa8', g);
      box(jibEnd, top + 4, 0, .8, .8, .8, glowMat('#ff3355', 2), g);
    }
  });
  const containerColors = ['#b8404f', '#2f7fa8', '#d49a36', '#3d8f6b', '#6b4fa8'];
  for (let s = from + 10; s < to - 10; s += 26) for (const side of [-1, 1]) {
    if (nearAnchors.some(a => a.side === side && Math.abs(a.s - s) < 18)) continue;
    const g = at(s + range(-4, 4), 0, 1.4), x = side * range(hw + 34, hw + 56), stacks = 1 + Math.floor(random() * 4);
    for (let k = 0; k < stacks; k++) box(x + (random() - .5) * .8, 1.3 + k * 2.65, 0, 2.6, 2.6, 12, pick(containerColors), g, k === stacks - 1);
    if (random() > .6) box(side * (hw + 20), 7, 0, 14, 14, 20, '#302b48', g, true);
  }
  for (let s = from; s < to; s += 34) for (const side of [-1, 1]) {
    const lateral = side * range(120, 240), h = range(50, 190), w = range(16, 34), color = pick(neon);
    if (!clear(s, lateral, w)) continue;
    const g = at(s, lateral, 0);
    box(0, h / 2, 0, w, h, w, '#1d1934', g);
    box(0, h + 1, 0, w * .7, 2, w * .7, glowMat(color, 1.1), g);
  }
  for (let s = from; s < to; s += 10) for (const side of [-1, 1]) box(0, .6, 0, .5, 1.2, .5, glowMat(Math.round(s) % 20 < 10 ? '#3ff3ff' : '#ff4fd8', 1.5), at(s, side * (hw + 8), 1.4));
  // A slowly turning ferris wheel far off one bank.
  const wheelS = from + (to - from) * range(.3, .7), wheelLat = (random() > .5 ? 1 : -1) * 170;
  if (clear(wheelS, wheelLat, 70)) {
    const wheel = at(wheelS, wheelLat, 0, kit.soft), hub = new THREE.Group(); wheel.rotation.y += Math.PI / 2; hub.position.y = 78; wheel.add(hub);
    hub.add(new THREE.Mesh(new THREE.TorusGeometry(62, .9, 6, 48), glowMat('#ff4fd8', 1.3)));
    hub.add(new THREE.Mesh(new THREE.TorusGeometry(58, .5, 6, 48), glowMat('#3ff3ff', 1.1)));
    for (let k = 0; k < 16; k++) {
      const angle = k / 16 * Math.PI * 2, spoke = new THREE.Mesh(cube, mat('#8b86b0')); spoke.scale.set(.5, 62, .5); spoke.position.set(Math.cos(angle) * 31, Math.sin(angle) * 31, 0); spoke.rotation.z = angle - Math.PI / 2; hub.add(spoke);
      const cab = new THREE.Mesh(cube, glowMat(neon[k % 4], .8)); cab.scale.set(4, 4, 4); cab.position.set(Math.cos(angle) * 62, Math.sin(angle) * 62 - 3, 0); cab.userData.cab = true; hub.add(cab);
    }
    kit.updaters.push((dt, t) => { hub.rotation.z = t * .05; hub.children.forEach(c => { if (c.userData.cab) c.rotation.z = -hub.rotation.z; }); });
  }
  const boats = [];
  for (let i = 0; i < 10; i++) {
    const b = new THREE.Group(), color = pick(neon);
    box(0, 0, 0, 3.4, 1.3, 10, '#e9e4f5', b); box(0, 1.2, .8, 2.6, 1.3, 4.5, '#2b2744', b); box(0, .1, -5.05, 3.5, .25, .1, glowMat(color, 2), b);
    kit.soft.add(b); boats.push({ obj: b, s: range(from + 20, to - 20), lateral: (i % 2 ? 1 : -1) * range(6, hw * .6), speed: (i % 2 ? -1 : 1) * range(5, 11), y: .2, bob: true });
  }
  cruise(kit, boats);
  if (from < 0) launchPad(kit, { body: '#2d2847', top: '#4a4468', strip: '#3ff3ff' });
  birds(kit, 6, '#b8b2e6', 90, 140);
  return lists;
}

/* ---------------------------------------------------------------- FIRWOOD PASS */
function aurora(kit) {
  const { box, shape, cylinder, at, random, range, hw, anchors, nearAnchors, from, to, clear, edgeTaper } = kit;
  const noise = (s, lat) => Math.sin(s * .011 + lat * .02) * Math.cos(lat * .013) + Math.sin((s + lat) * .027) * .5;
  // Snowfield rising into low ridges beyond the corridor, flattening out where it blends into the next theme.
  const rise = (s, lat) => edgeTaper(s) * (smoothstep(hw + 40, hw + 90, Math.abs(lat)) * (10 + noise(s, lat) * 3) + smoothstep(hw + 90, hw + 190, Math.abs(lat)) * (28 + noise(lat, s) * 10));
  const snowColor = (s, lat, y) => y > 30 && noise(s * 2, lat) > .1 ? '#5b6a86' : y > 12 && noise(s * 4, lat) > .6 ? '#8a99b3' : '#eef6ff';
  const laterals = [0, 10, hw, hw + 40, hw + 65, hw + 90, hw + 130, hw + 190, hw + 260];
  kit.ribbon(6, s => {
    const row = [];
    for (const side of [-1, 1]) {
      const pts = laterals.map(l => { const lat = side * l, y = rise(s, lat); return [lat, y, snowColor(s, lat, y)]; });
      pts.push([side * (hw + 260), -30, '#5b6a86']);
      row.push(...(side < 0 ? pts.reverse() : pts.slice(1)));
    }
    return row;
  });
  const cone = new THREE.ConeGeometry(1, 1, 8);
  function pine(g, x, y, height, big = false) {
    const trunkH = height * .35;
    cylinder(x, y + trunkH / 2, 0, height * .025, height * .04, trunkH, '#4a3328', g, 6);
    const tiers = big ? 6 : 3;
    for (let t = 0; t < tiers; t++) {
      const r = big ? 9 - t * 1.2 : height * (.24 - t * .06), ty = y + trunkH * .7 + t * (height * .65 / tiers), th = height * (big ? .2 : .32);
      shape(cone, t % 2 ? '#1d4b47' : '#235a50', x, ty + th / 2, 0, g, true).scale.set(r, th, r);
      shape(cone, '#f1f8ff', x, ty + th * .72, 0, g, false).scale.set(r * .62, th * .45, r * .62);
    }
  }
  anchors.forEach(a => {
    const h = a.y - a.ground, g = at(a.s, 0, 0, undefined, true), side = a.side, lat = Math.abs(a.lateral);
    pine(g, side * (lat + 10), -2, h + 20, true);
    box(side * (lat + 5), h, 0, 10, .9, .9, '#4a3328', g);
    box(side * lat, h - 1.4, 0, .9, 1.4, .9, glowMat('#ffc36b', 1.6), g);
  });
  for (let s = from; s < to; s += 9) for (const side of [-1, 1]) {
    if (random() > .5 || nearAnchors.some(a => a.side === side && Math.abs(a.s - s) < 12)) continue;
    const lateral = side * (hw + 16 + Math.pow(random(), 1.6) * 170), height = range(16, 42);
    if (!clear(s, lateral, height * .25)) continue;
    pine(at(s, lateral, 0), 0, rise(s, lateral) - 1, height);
  }
  const crystal = new THREE.OctahedronGeometry(1, 0), ice = mat('#aee8ff', { emissive: '#5cc8ff', emissiveIntensity: .7, roughness: .3 });
  for (let s = from + 10; s < to; s += 36) for (const side of [-1, 1]) {
    const m = shape(crystal, ice, 0, 3, 0, at(s, side * (hw + 4), 0), false);
    m.scale.set(1.2, range(3, 6), 1.2); m.rotation.set(range(-.3, .3), range(0, 3), range(-.3, .3));
  }
  if (from < 0) launchPad(kit, { body: '#5b4030', top: '#eef6ff', strip: '#7dffc8' });
  return {};
}

/* ---------------------------------------------------------------- RUST CANYON */
function canyon(kit) {
  const { box, shape, cylinder, at, random, range, pick, hw, anchors, from, to, clear, edgeTaper } = kit;
  const wave = (s, k) => Math.sin(s * .037 + k * 1.7) * 2.6 + Math.sin(s * .113 + k * 4.1) * 1.4 + Math.sin(s * .21 + k) * .7;
  const strata = ['#8f3a24', '#b8502e', '#d67a45', '#a8442a', '#e4a266', '#c0603a', '#dc9458'];
  const band = y => strata[Math.min(strata.length - 1, Math.floor(Math.max(0, y) / 16))];
  kit.ribbon(4, s => {
    const r = Math.sin(s * .012) * 5;
    return [[-(hw + 9), 0, '#c98a55'], [r - 7, .2, '#d9a066'], [r - 5, -.3, '#3fa7b0'], [r, -.4, '#56bcc0'], [r + 5, -.3, '#3fa7b0'], [r + 7, .2, '#d9a066'], [hw + 9, 0, '#c98a55']];
  });
  // Striped walls lean back as they rise; they sink into the floor at both ends of the district.
  for (const side of [-1, 1]) kit.ribbon(4, s => {
    const k = side * 3, e = edgeTaper(s);
    const pts = [[hw + 9, 0], [hw + 7 + wave(s, k), 14], [hw + 10 + wave(s, k + 1), 30], [hw + 9 + wave(s, k + 2), 46], [hw + 14 + wave(s, k + 3), 62], [hw + 12 + wave(s, k + 4), 80], [hw + 17 + wave(s, k + 5), 96], [hw + 24 + wave(s, k + 6), 112], [hw + 40, 117], [hw + 90, 118], [hw + 120, 118]];
    const row = pts.map(([l, y]) => [side * l, y * e, band(y + wave(s * .5, k) * 2)]);
    return side < 0 ? row.reverse() : row;
  }, { shadow: true });
  const slab = new THREE.IcosahedronGeometry(1, 0);
  anchors.forEach(a => {
    const h = a.y - a.ground, g = at(a.s, 0, 0, undefined, true), side = a.side, lat = Math.abs(a.lateral);
    const rock = shape(slab, pick(['#a8472c', '#b9582f', '#96402a']), side * (lat + 7), h + 2, 0, g); rock.scale.set(8, 3.6, 8); rock.rotation.set(range(-.2, .2), range(0, 3), range(-.15, .15));
    box(side * lat, h + .6, 0, .5, 1.6, .5, '#5a2d20', g);
    // Where the wall has sunk away near a district edge, a rock column holds the overhang up.
    if (edgeTaper(a.s) < .95) cylinder(side * (lat + 9), h / 2, 0, 3.2, 4.6, h, pick(strata), g, 6);
  });
  for (let s = from; s < to; s += 22) for (const side of [-1, 1]) {
    if (random() > .55) continue;
    const s2 = s + range(-6, 6), e = edgeTaper(s2);
    if (e < .98) continue;
    const g = at(s2, side * range(hw + 45, hw + 85), 118);
    if (random() > .5) { const h = range(6, 11); cylinder(0, h / 2, 0, .8, 1, h, '#4f8a45', g, 6); }
    else { let y = 0; for (let k = 0; k < 3; k++) { const r = range(2, 4) * (1 - k * .2), h = range(5, 9); cylinder(0, y + h / 2, 0, r * .8, r, h, pick(strata), g, 5); y += h; } }
  }
  for (let s = from + 40; s < to; s += 110) for (const side of [-1, 1]) {
    const lateral = side * range(260, 420), r = range(25, 60), h = range(40, 130);
    if (edgeTaper(s) < .98 || !clear(s, lateral, r)) continue;
    const g = at(s, lateral, 118);
    cylinder(0, h / 2, 0, r * .85, r, h, pick(['#b8502e', '#c9693c', '#a8442a']), g, 6);
    cylinder(0, h + 2, 0, r * .82, r * .86, 4, '#e0a066', g, 6);
  }
  // Where the walls have sunk away toward a neighbouring theme, striped rock spires and cacti stand on open ground
  // instead, so the canyon arrives (and leaves) gradually.
  for (let s = from; s < to; s += 16) for (const side of [-1, 1]) {
    if (edgeTaper(s) > .6 || random() > .6) continue;
    const lateral = side * range(hw + 24, hw + 110), h = range(14, 46);
    if (!clear(s, lateral, 8)) continue;
    const g = at(s + range(-5, 5), lateral, 0);
    if (random() > .35) { let y = 0; for (let k = 0; k < 4 && y < h; k++) { const r = range(3, 6) * (1 - k * .18), hh = range(6, 13); cylinder(0, y + hh / 2, 0, r * .8, r, hh, pick(strata), g, 6); y += hh; } }
    else { const ch = range(6, 11); cylinder(0, ch / 2, 0, .8, 1, ch, '#4f8a45', g, 6); box(1.6, ch * .55, 0, 2.2, .8, .8, '#4f8a45', g); box(2.4, ch * .55 + 1.6, 0, .8, 3.2, .8, '#4f8a45', g); }
  }
  birds(kit, 7, '#4a2e28', 70, 150);
  return {};
}

/* ---------------------------------------------------------------- CUMULUS GARDEN */
function garden(kit) {
  const { box, shape, cylinder, at, random, range, pick, hw, anchors, from, to, clear, bounds } = kit;
  const puff = new THREE.IcosahedronGeometry(1, 1), cloudMat = mat('#ffffff', { emissive: '#e3ecff', emissiveIntensity: .35 });
  const cloudSpots = [];
  for (let i = 0; i < 260; i++) {
    const s = range(from - 60, to + 60), [x, z, f] = kit.worldAt(s, range(-700, 700));
    if (random() > kit.presence(s)) continue;
    // The cloud sea drops below this spot's ground so it never covers a neighbouring theme's lower ground.
    cloudSpots.push([x, Math.min(bounds.minY, f.y) - 32 + range(-8, 6), z, range(40, 95), range(9, 20), range(40, 95)]);
  }
  for (let i = 0; i < 40; i++) {
    const s = range(from, to), lateral = (random() > .5 ? 1 : -1) * range(hw + 60, 400), [x, z, f] = kit.worldAt(s, lateral);
    if (random() > kit.presence(s)) continue;
    cloudSpots.push([x, f.y + range(20, 150), z, range(14, 34), range(6, 12), range(14, 34)]);
  }
  const clouds = new THREE.InstancedMesh(puff, cloudMat, cloudSpots.length), o = new THREE.Object3D();
  cloudSpots.forEach(([x, y, z, sx, sy, sz], i) => { o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.y = i; o.updateMatrix(); clouds.setMatrixAt(i, o.matrix); });
  clouds.computeBoundingSphere(); kit.root.add(clouds);
  const coneDown = new THREE.ConeGeometry(1, 1, 7), crystal = new THREE.OctahedronGeometry(1, 0), blob = new THREE.IcosahedronGeometry(1, 0);
  const water = mat('#bfe8ff', { transparent: true, opacity: .55, emissive: '#a6dcff', emissiveIntensity: .4 });
  function island(g, x, y, r, trees = 2) {
    const rock = shape(coneDown, pick(['#9b7f9a', '#8d7aa3', '#a88a8f']), x, y - r * .9, 0, g, true); rock.scale.set(r, r * 1.8, r); rock.rotation.x = Math.PI;
    cylinder(x, y + .5, 0, r * 1.02, r * 1.02, 1.6, '#86d06a', g, 7);
    for (let k = 0; k < trees; k++) {
      const tx = x + range(-r * .6, r * .6), tz = range(-r * .6, r * .6), th = range(3, 7);
      cylinder(tx, y + th / 2, tz, .35, .5, th, '#8a6a5a', g, 5);
      shape(blob, pick(['#ffb3d1', '#b9f08a', '#ffd9a8', '#c9b3ff']), tx, y + th + 2, tz, g, true).scale.setScalar(range(2.4, 3.6));
    }
    if (random() > .55) box(x + r * .7, y - 22, 0, 2.4, 44, .6, water, g);
  }
  anchors.forEach(a => {
    const h = a.y - a.ground, g = at(a.s, 0, 0, undefined, true), side = a.side, lat = Math.abs(a.lateral), x = side * (lat + 14);
    island(g, x, h - 48, range(9, 13), 2);
    const top = h + 3;
    cylinder(x, (h - 48 + top) / 2, 0, 1.5, 1.9, top - h + 48, '#f4ecff', g, 6);
    for (let y = h - 40; y < top; y += 11) cylinder(x, y, 0, 2.1, 2.1, .7, '#f2c84b', g, 6);
    box((x + side * lat) / 2, h + .5, 0, Math.abs(x - side * lat), .7, .7, '#e8b94a', g);
    shape(crystal, glowMat(a.row % 2 ? '#8fe8ff' : '#ffa8e0', 1.1), x, top + 3, 0, g, false).scale.set(2, 3.4, 2);
  });
  for (let s = from; s < to; s += 30) for (const side of [-1, 1]) {
    if (random() > .6) continue;
    const lateral = side * range(hw + 45, hw + 140), r = range(8, 22);
    if (clear(s, lateral, r)) island(at(s, lateral, range(-30, 40)), 0, 0, r, 1 + Math.floor(random() * 4));
  }
  const lantern = glowMat('#ffe9a8', 1.6);
  for (let s = from + 8; s < to; s += 32) for (const side of [-1, 1]) {
    const g = at(s, side * (hw + 2), 0);
    shape(blob, lantern, 0, 22, 0, g, false).scale.setScalar(.9); shape(blob, lantern, 0, 74, 0, g, false).scale.setScalar(.9);
  }
  // A giant world tree off to one side.
  const treeS = from + (to - from) * range(.35, .65), treeLat = (random() > .5 ? 1 : -1) * 300;
  if (clear(treeS, treeLat, 90)) {
    const tree = at(treeS, treeLat, 0);
    const base = shape(coneDown, '#8d7aa3', 0, -60, 0, tree, true); base.scale.set(75, 130, 75); base.rotation.x = Math.PI;
    cylinder(0, 3, 0, 77, 77, 6, '#86d06a', tree, 9);
    cylinder(0, 60, 0, 9, 16, 120, '#8a6a5a', tree, 8);
    for (let k = 0; k < 9; k++) { const angle = k / 9 * Math.PI * 2; shape(blob, pick(['#ffb3d1', '#ffc9e0', '#f7a3c8']), Math.cos(angle) * range(20, 34), range(105, 150), Math.sin(angle) * range(20, 34), tree, true).scale.setScalar(range(22, 34)); }
  }
  const whales = [];
  for (let i = 0; i < 2; i++) {
    const w = new THREE.Group(), body = new THREE.Mesh(blob, mat('#9cc7f2')); body.scale.set(9, 7, 26); w.add(body);
    const belly = new THREE.Mesh(blob, mat('#e9f4ff')); belly.scale.set(7, 4, 20); belly.position.y = -3.4; w.add(belly);
    const tail = new THREE.Group(); tail.position.z = 24; w.add(tail);
    const fluke = new THREE.Mesh(cube, mat('#8ab8e6')); fluke.scale.set(16, .8, 6); fluke.position.z = 3; tail.add(fluke);
    const [cx, cz, f] = kit.worldAt(from + (to - from) * (.3 + i * .4), (i ? 1 : -1) * 260);
    w.userData = { cx, cz, radius: 200 + i * 60, y: f.y + 170 + i * 25, speed: .03 + i * .008, phase: i * 2.1, tail };
    kit.soft.add(w); whales.push(w);
  }
  kit.updaters.push((dt, t) => whales.forEach(w => {
    const u = w.userData, angle = u.phase + t * u.speed;
    w.position.set(u.cx + Math.cos(angle) * u.radius, u.y + Math.sin(t * .4 + u.phase) * 6, u.cz + Math.sin(angle) * u.radius);
    w.rotation.y = -angle; u.tail.rotation.x = Math.sin(t * 1.2 + u.phase) * .25;
  }));
  if (from < 0) { const launch = at(-19, 0, 0, undefined, true); island(launch, 0, 38, 18, 0); cylinder(0, 46, 0, 9, 11, 16, '#f4ecff', launch, 8); cylinder(0, 53.3, 0, 12, 12, .8, '#f2c84b', launch, 8); }
  birds(kit, 10, '#ffffff', 40, 130);
  return {};
}

/* ---------------------------------------------------------------- MONSOON RUINS */
function jungle(kit) {
  const { box, shape, cylinder, at, random, range, pick, hw, anchors, from, to, clear } = kit;
  const stone = ['#7d8a70', '#8a9579', '#6f7c63'], moss = ['#4f7a3f', '#5f8a47', '#3f6a35'], leaves = ['#2f6b35', '#3f8a3f', '#2a5a2e', '#4d9a45'];
  const blob = new THREE.IcosahedronGeometry(1, 0);
  const vine = (g, x, y, z, length) => { const m = new THREE.Mesh(cube, mat(pick(moss))); m.position.set(x, y - length / 2, z); m.scale.set(.18, length, .18); g.add(m); };
  kit.ribbon(4, () => [[-(hw + 120), -30, '#1f3b1f'], [-(hw + 120), -5, '#1f3b1f'], [-(hw + 50), -5, '#1f3b1f'], [-(hw + 16), 0, '#2f5a2c'], [-9, .1, '#4d6a3d'], [-6, .15, '#8a8a6a'], [6, .15, '#8a8a6a'], [9, .1, '#4d6a3d'], [hw + 16, 0, '#2f5a2c'], [hw + 50, -5, '#1f3b1f'], [hw + 120, -5, '#1f3b1f'], [hw + 120, -30, '#1f3b1f']]);
  anchors.forEach(a => {
    const h = a.y - a.ground, g = at(a.s, 0, 0, undefined, true), side = a.side, lat = Math.abs(a.lateral), x = side * (lat + 9);
    cylinder(x, (h + 26) / 2 - 1, 0, 2.2, 3.5, h + 26, '#6b5a48', g, 8);
    box(side * (lat + 4.5), h, 0, 9.5, 1.4, 1.4, '#5b4a3a', g, true);
    for (const dz of [-6, 0, 6]) shape(blob, pick(leaves), x + side * 6, h + 22 + range(-2, 3), dz, g, true).scale.set(range(9, 11), range(6, 8), range(9, 11));
    const v = at(a.s, 0, 0, kit.soft, true);
    for (let k = 0; k < 4; k++) vine(v, side * (lat + range(3, 8)), h, range(-1, 1), range(8, 20));
  });
  for (let s = from; s < to; s += 14) for (const side of [-1, 1]) {
    if (random() > .55) continue;
    const lateral = side * range(hw + 28, hw + 140), h = range(24, 60);
    if (!clear(s, lateral, 12)) continue;
    const g = at(s + range(-5, 5), lateral, 0);
    cylinder(0, h / 2, 0, h * .03, h * .05, h, '#5b4a3a', g, 6);
    for (let k = 0; k < 3; k++) shape(blob, pick(leaves), range(-4, 4), h + range(-4, 4), range(-4, 4), g, true).scale.setScalar(range(6, 11));
  }
  for (let s = from + 20; s < to; s += 60) for (const side of [-1, 1]) {
    if (random() > .6) continue;
    const g = at(s + range(-8, 8), side * range(hw + 14, hw + 24), 0), h = range(6, 22);
    cylinder(0, h / 2, 0, 1.6, 1.8, h, pick(stone), g, 8);
    box(0, h + .5, 0, 4.2, 1, 4.2, '#6f7c63', g);
  }
  for (const t of [.25, .7]) {
    const s = from + (to - from) * t, side = t < .5 ? -1 : 1, lateral = side * (hw + 80);
    if (!clear(s, lateral, 32)) continue;
    const g = at(s, lateral, 0), color = pick(stone);
    for (let k = 0; k < 6; k++) box(0, 4 + k * 8, 0, 44 - k * 6.5, 8, 44 - k * 6.5, k % 2 ? color : '#6f7c63', g, true);
    box(0, 52, 0, 8, 8, 8, '#5f6b54', g, true);
    box(-side * 20, 20, 0, 6, 40, 10, '#8a9579', g);
    box(-side * 23, 18, 0, 3, 36, 1, mat('#bfeaff', { transparent: true, opacity: .5, emissive: '#a6dcff', emissiveIntensity: .35 }), g).castShadow = false;
  }
  birds(kit, 8, '#e2493b', 70, 130);
  return {};
}

const THEMES = { sunset, meadow, harbor, aurora, canyon, garden, jungle };

// Each theme's ground as [height, color] at six points from the centerline outward (see GROUND_LATERALS).
// Across a blend the ground strip morphs between two of these, so roads, verges, water and snow flow into each other.
const GROUND = {
  sunset: [[.09, '#e4bf92'], [.02, '#686878'], [.02, '#686878'], [.15, '#c8aaa0'], [0, '#847b83'], [0, '#847b83']],
  meadow: [[.1, '#b89468'], [.06, '#6f9a45'], [.04, '#6f9a45'], [.04, '#6f9a45'], [0, '#c9a23c'], [-.3, '#a7cc62']],
  harbor: [[-.6, '#16123a'], [-.6, '#16123a'], [-.6, '#16123a'], [1.4, '#5ff5ff'], [1.4, '#34304a'], [1.4, '#2c2842']],
  aurora: [[0, '#eef6ff'], [0, '#eef6ff'], [0, '#eef6ff'], [0, '#eef6ff'], [0, '#eef6ff'], [2, '#dfe9f5']],
  canyon: [[-.4, '#56bcc0'], [.2, '#d9a066'], [0, '#c98a55'], [0, '#c98a55'], [0, '#c98a55'], [0, '#d69a62']],
  // The garden floats over a cloud sea with no ground: next to it the ground sinks away into the clouds.
  garden: [[-45, '#f4ecff'], [-45, '#f4ecff'], [-45, '#e9e4ff'], [-45, '#e9e4ff'], [-50, '#ffffff'], [-60, '#ffffff']],
  jungle: [[.15, '#8a8a6a'], [.1, '#4d6a3d'], [0, '#2f5a2c'], [0, '#2f5a2c'], [-2, '#1f3b1f'], [-5, '#1f3b1f']],
};
const GROUND_LATERALS = hw => [0, 5, hw - 2, hw + 2, hw + 14, hw + 110];
// The half of a boundary's blend strip that lies inside this chunk: from theme a (before the boundary) to theme b.
function blendGround(kit, a, b, boundary, start, end) {
  const A = GROUND[a], B = GROUND[b], ca = new THREE.Color(), cb = new THREE.Color(), laterals = GROUND_LATERALS(kit.hw);
  kit.ribbon(4, s => {
    const t = smoothstep(boundary - THEME_BLEND, boundary + THEME_BLEND, s), side = laterals.map((l, i) => {
      const color = `#${ca.set(A[i][1]).lerp(cb.set(B[i][1]), t).getHexString()}`;
      return [l, A[i][0] + (B[i][0] - A[i][0]) * t, color];
    });
    const edge = side.at(-1), outer = [[edge[0], -30, edge[2]], ...side.slice().reverse()];
    return [...outer.map(([l, y, c]) => [-l, y, c]), ...side.slice(1), [edge[0], -30, edge[2]]];
  }, { start, end });
}

// Build the scenery for one chunk of the endless track in three phases (layout, merge, collision), yielding
// between them so the game can spread the work over several frames. The result is the generator's return value.
export function* buildChunkSteps(track, chunk) {
  track.ensure(chunk.s1 + 1000);
  const from = chunk.index === 0 ? -track.pre : chunk.s0, to = chunk.s1;
  const t0 = performance.now(), kit = createKit(track, chunk, from, to), env = ENVIRONMENTS[chunk.theme];
  const instanceMaterials = THEMES[chunk.theme](kit) || {};
  const { district } = kit;
  if (kit.blendIn) blendGround(kit, districtAt(district.index - 1).theme, chunk.theme, district.s0, district.s0, kit.groundFrom);
  if (kit.blendOut) blendGround(kit, chunk.theme, districtAt(district.index + 1).theme, district.s1, kit.groundTo, district.s1);
  const t1 = performance.now();
  yield 'layout';
  const t2 = performance.now();
  bake(kit, instanceMaterials);
  const { root } = kit, t3 = performance.now();
  yield 'bake';
  const t4 = performance.now();
  // Collide with exactly what is drawn: built before the see-through hook markers are added.
  const collider = createCollider(solidMeshes(root));
  const stats = { layout: t1 - t0, bake: t3 - t2, collider: performance.now() - t4 };
  const markerMat = new THREE.MeshBasicMaterial({ color: env.marker }), markerGeo = new THREE.OctahedronGeometry(.7);
  // Every hook in this chunk's own stretch gets a marker, whichever theme built the structure holding it.
  const markers = track.allAnchors.filter(a => a.s >= from && a.s < to).map(a => { const m = new THREE.Mesh(markerGeo, markerMat); m.position.set(a.x, a.y, a.z); root.add(m); return { mesh: m, anchor: a }; });
  return {
    // from/to: this chunk's own stretch. reach: how far its scenery extends (into a neighbouring theme across a blend).
    chunk, from, to, reach: { from: kit.from, to: kit.to }, root, collider, markers, stats,
    update(dt, t) { kit.updaters.forEach(u => u(dt, t)); },
    dispose() {
      root.traverse(o => {
        if (o.geometry && o.geometry !== cube) o.geometry.dispose();
        if (o.isInstancedMesh) o.dispose();
      });
      markerMat.dispose();
    },
  };
}
export function buildChunk(track, chunk) {
  const steps = buildChunkSteps(track, chunk);
  for (;;) { const { value, done } = steps.next(); if (done) return value; }
}
