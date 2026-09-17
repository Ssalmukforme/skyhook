import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, step, locate, frameAt, BODY_RADIUS, COURSES } from '../src/physics.js';
import { createEndlessTrack, chunkAt, chunkIndexAt, districtAt, difficulty, DISTRICT_LENGTH, CHUNK_LENGTH, THEME_ORDER, HARDEST_DISTRICT, MAX_HEADING, MIN_RADIUS } from '../src/app/track.js';
import { buildChunk, themePresence, THEME_BLEND } from '../src/app/scenery.js';
import * as THREE from 'three';

const SEEDS = [1, 2, 3, 4, 5, 6];
// Up to every theme at the hardest (twistiest) level.
const DISTRICTS = HARDEST_DISTRICT + THEME_ORDER.length;
const LENGTH = DISTRICTS * DISTRICT_LENGTH;
const heading = (c, i) => Math.atan2(c.txs[i], -c.tzs[i]);
const turnPerKm = (c, s0, s1) => { let turn = 0; for (let i = Math.round((s0 + c.pre) / 2); i < Math.round((s1 + c.pre) / 2); i++) turn += Math.abs(heading(c, i + 1) - heading(c, i)); return turn / ((s1 - s0) / 1000); };

// The app's input is only the two hooks: steer by holding the hook that pulls away from the side the runner drifts to.
// The runner starts like at the launch pad, at any distance along the course.
function autopilot(track, { start = 0, distance, world = null, horizon = 1.4, threshold = .35 }) {
  track.ensure(start + distance + 2500);
  const p = createPlayer(track), f = frameAt(track, start);
  Object.assign(p, { x: f.x, y: f.y + 57, z: f.z, vx: f.tx * 23, vy: 3, vz: f.tz * 23, s: start, trackIndex: Math.round((start + track.pre) / 2) });
  let airborne = 0, focusAt = -Infinity;
  for (let i = 0; i < 120 * 900 && !p.dead && p.s < start + distance; i++) {
    if (p.s > focusAt + 50) { track.focus(p.s); focusAt = p.s; world?.sync(p.s); }
    if (p.releaseReady && airborne <= 0) airborne = .5;
    const held = airborne <= 0; airborne -= 1 / 120;
    const ahead = locate(track, p.x + p.vx * horizon, p.z + p.vz * horizon, p.trackIndex).lateral, limit = chunkAt(chunkIndexAt(p.s)).halfWidth * threshold;
    step(p, { leftHook: held && ahead > -limit, rightHook: held && ahead < limit }, 1 / 120, world);
  }
  return p;
}
const SETTINGS = [[1.4, .35], [1, .35], [.8, .3], [1.2, .4]].map(([horizon, threshold]) => ({ horizon, threshold }));

test('the same seed gives the same course however far ahead it is generated', () => {
  const whole = createEndlessTrack(42).ensure(12000), stepwise = createEndlessTrack(42);
  for (let s = 0; s < 12000; s += 37) stepwise.ensure(s);
  for (let i = 0; i < 5900; i += 50) { assert.equal(whole.xs[i], stepwise.xs[i]); assert.equal(whole.ys[i], stepwise.ys[i]); }
  const hooks = t => t.allAnchors.filter(a => a.s < 11000).map(a => [a.s, a.side, a.y]);
  assert.deepEqual(hooks(stepwise), hooks(whole));
  assert.notEqual(createEndlessTrack(43).ensure(3000).xs[1500], whole.xs[1500], 'another seed is another course');
});

test('a district is 5 km of one theme; the difficulty steps up at every theme change and holds within a district', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, k) => districtAt(k).theme), [...THEME_ORDER, THEME_ORDER[0]]);
  assert.equal(DISTRICT_LENGTH % CHUNK_LENGTH, 0, 'chunk edges line up with district edges');
  for (let k = 0; k < DISTRICTS; k++) {
    const { s0, s1 } = districtAt(k);
    assert.equal(difficulty(s0), difficulty(s1 - 1), `district ${k} keeps one difficulty`);
    if (k) {
      if (k <= HARDEST_DISTRICT) assert.ok(difficulty(s0) > difficulty(s0 - 1), `district ${k} is harder than the one before`);
      else assert.equal(difficulty(s0), 1);
      assert.ok(chunkAt(chunkIndexAt(s0)).halfWidth <= chunkAt(chunkIndexAt(s0 - 1)).halfWidth, 'the corridor never widens');
    }
    for (let i = chunkIndexAt(s0); i < chunkIndexAt(s1); i++) assert.equal(chunkAt(i).theme, districtAt(k).theme);
  }
  assert.equal(difficulty(0), 0);
  assert.equal(chunkAt(0).halfWidth, 26); assert.equal(chunkAt(chunkIndexAt(HARDEST_DISTRICT * DISTRICT_LENGTH)).halfWidth, 19);
});

test('the course bends smoothly, gets twistier district by district, never turns back on itself and never climbs for long', () => {
  for (const seed of SEEDS) {
    const c = createEndlessTrack(seed).ensure(LENGTH);
    for (let i = 1; i < c.n; i++) {
      const h = heading(c, i);
      assert.ok(Math.abs(h) <= MAX_HEADING + 1e-9, `seed ${seed}: heading ${h} at sample ${i}`);
      assert.ok(Math.abs(h - heading(c, i - 1)) <= 2 / MIN_RADIUS + 1e-9, `seed ${seed}: bend tighter than ${MIN_RADIUS} m at sample ${i}`);
    }
    const turns = Array.from({ length: HARDEST_DISTRICT + 1 }, (_, k) => turnPerKm(c, districtAt(k).s0, districtAt(k).s1));
    for (let k = 2; k < turns.length; k += 2) assert.ok(turns[k] > turns[k - 2], `seed ${seed}: district ${k} should bend more than district ${k - 2} (${turns.map(t => (t * 57.3).toFixed(0)).join('/')}°/km)`);
    assert.ok(turns[HARDEST_DISTRICT] > 15 * turns[0], `seed ${seed}: the hardest district bends far more than the first (${turns.map(t => (t * 57.3).toFixed(0)).join('/')}°/km)`);
    // Stretches far apart along the course stay far apart on the ground, so scenery never reaches another stretch.
    for (let i = 0; i < c.n; i += 10) for (let j = i + 250; j < c.n; j += 10)
      assert.ok(Math.hypot(c.xs[i] - c.xs[j], c.zs[i] - c.zs[j]) > 280, `seed ${seed}: samples ${i} and ${j} come within 280 m`);
    // At most about 60 m of climbing in any 400 m (no W to push uphill).
    for (let i = 0; i + 200 < c.n; i += 5) assert.ok(c.ys[i + 200] - c.ys[i] < 60, `seed ${seed}: climbs ${(c.ys[i + 200] - c.ys[i]).toFixed(0)} m after s=${i * 2 - c.pre}`);
    // Harbor districts are open water: flat from end to end.
    for (let k = 0; k < DISTRICTS; k++) {
      const district = districtAt(k); if (district.theme !== 'harbor') continue;
      const ys = []; for (let s = district.s0; s <= district.s1; s += 10) ys.push(frameAt(c, s).y);
      assert.ok(Math.max(...ys) - Math.min(...ys) < 1.5, `seed ${seed}: harbor district ${k} is not flat`);
    }
  }
});

test('hook rows sit on both corridor edges and spread out with difficulty', () => {
  for (const seed of SEEDS) {
    const c = createEndlessTrack(seed).ensure(LENGTH), hooks = c.allAnchors.filter(a => a.s < LENGTH - 1000);
    for (let i = 1; i < hooks.length; i++) assert.ok(hooks[i].s >= hooks[i - 1].s, 'hooks are listed in course order');
    for (const a of hooks) {
      assert.equal(Math.abs(a.lateral), chunkAt(chunkIndexAt(a.s)).halfWidth + 4);
      assert.ok(a.y - a.ground > 74 - 1e-6 && a.y - a.ground < 86 + 1e-6);
    }
    // Rows are at most about 57 m apart; staggering can stretch one side's gap a little further.
    const gaps = side => hooks.filter(a => a.side === side).map((a, i, list) => i ? a.s - list[i - 1].s : 0).slice(1);
    for (const side of [-1, 1]) assert.ok(Math.max(...gaps(side)) < 70, `seed ${seed}: a ${Math.max(...gaps(side)).toFixed(0)} m hook gap`);
    const perKm = k => hooks.filter(a => a.side < 0 && a.s >= districtAt(k).s0 && a.s < districtAt(k).s0 + 1000).length;
    assert.ok(perKm(0) > perKm(HARDEST_DISTRICT), 'hook points are sparser in harder districts');
  }
});

test('on an endless track a fall or crash ends the run instead of returning to a checkpoint, and there is no wind', () => {
  const c = createEndlessTrack(9), p = createPlayer(c);
  Object.assign(p, { y: p.ground + 2 });
  assert.equal(step(p, {}, 1 / 120), 'dead'); assert.equal(p.deathReason, 'fall'); assert.equal(p.falls, 0);
  const x = p.x; assert.equal(step(p, { leftHook: true }, 1 / 120), null); assert.equal(p.x, x, 'a dead runner no longer moves');
  const q = createPlayer(c);
  assert.equal(step(q, {}, 1 / 120, { hits: () => true }), 'dead'); assert.equal(q.deathReason, 'obstacle');
  assert.equal(c.ensure(40000).wind, null);
  // Fixed web maps keep their checkpoint returns.
  const web = createPlayer(COURSES.sunset); Object.assign(web, { y: 2 });
  assert.equal(step(web, {}, 1 / 120), 'recover');
});

test('the hooks alone (no W) carry the runner through the hard part of every difficulty step', () => {
  for (const seed of [1, 2, 3]) {
    const track = createEndlessTrack(seed);
    for (let k = 0; k <= HARDEST_DISTRICT; k++) {
      const start = districtAt(k).s0 + 3000, results = [];
      for (const setting of SETTINGS) { const p = autopilot(track, { start, distance: 1500, ...setting }); results.push(p); if (!p.dead) break; }
      assert.ok(!results.at(-1).dead, `seed ${seed}, district ${k}: died after ${results.map(p => `${(p.s - start).toFixed(0)} m (${p.deathReason})`).join(', ')}`);
    }
  }
});

test('themes blend into each other across every boundary instead of switching at a line', () => {
  const track = createEndlessTrack(8).ensure(LENGTH), v = new THREE.Vector3();
  for (let k = 1; k <= HARDEST_DISTRICT; k++) {
    const B = districtAt(k).s0;
    // Presence fades over the blend, and the two themes always add up to one.
    for (let s = B - THEME_BLEND - 100; s <= B + THEME_BLEND + 100; s += 25) assert.ok(Math.abs(themePresence(k - 1, s) + themePresence(k, s) - 1) < 1e-9);
    assert.equal(themePresence(k - 1, B - THEME_BLEND), 1); assert.equal(themePresence(k, B + THEME_BLEND), 1); assert.equal(themePresence(k, B), .5);
    const before = buildChunk(track, chunkAt(chunkIndexAt(B) - 1)), after = buildChunk(track, chunkAt(chunkIndexAt(B)));
    assert.equal(before.reach.to, B + THEME_BLEND); assert.equal(after.reach.from, B - THEME_BLEND);
    // The ground runs on without a gap (next to the cloud garden it sinks away below, but it is still there).
    for (let s = B - THEME_BLEND; s <= B + THEME_BLEND; s += 10) {
      const f = frameAt(track, s), probe = [f.x + f.rx * 10, f.y, f.z + f.rz * 10];
      assert.ok(before.collider.nearest(...probe, 62) || after.collider.nearest(...probe, 62), `boundary ${k}: no ground at s=${s}`);
    }
    // Each theme's scenery shows up on the other theme's side of the line.
    const decorAcross = (chunk, lo, hi) => {
      let found = 0; chunk.root.updateMatrixWorld(true);
      chunk.root.traverse(o => {
        if (!o.isMesh || o.isInstancedMesh || found > 3) return;
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count && found <= 3; i += Math.max(1, Math.floor(pos.count / 60))) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          const loc = locate(track, v.x, v.z, Math.round((B + track.pre) / 2));
          if (loc.s > lo && loc.s < hi && v.y - loc.ground > 3) found++;
        }
      });
      return found > 3;
    };
    assert.ok(decorAcross(before, B + 20, B + THEME_BLEND), `${districtAt(k - 1).theme} scenery continues past boundary ${k}`);
    assert.ok(decorAcross(after, B - THEME_BLEND, B - 20), `${districtAt(k).theme} scenery starts before boundary ${k}`);
    before.dispose(); after.dispose();
  }
});

test('scenery keeps the flight corridor open in every theme at every level, and runs survive the real geometry', () => {
  const track = createEndlessTrack(5).ensure(LENGTH), point = (s, lateral, height) => { const f = frameAt(track, s); return [f.x + f.rx * lateral, f.y + height, f.z + f.rz * lateral]; };
  // The start chunk, one from late in each district (so every theme at the twistiest level too), and both sides of every boundary.
  const probes = [0, ...Array.from({ length: DISTRICTS }, (_, k) => chunkIndexAt(districtAt(k).s0 + 3000)),
    ...Array.from({ length: HARDEST_DISTRICT }, (_, k) => [chunkIndexAt(districtAt(k + 1).s0) - 1, chunkIndexAt(districtAt(k + 1).s0)]).flat()];
  for (const index of probes) {
    const info = chunkAt(index), chunk = buildChunk(track, info);
    assert.ok(chunk.collider.triangles > 1000, `${info.theme}: collides with its drawn geometry`);
    assert.equal(chunk.markers.length, track.allAnchors.filter(a => a.s >= chunk.from && a.s < chunk.to).length);
    // Scenery that reaches into a neighbouring theme must keep that stretch of corridor open too.
    for (let s = Math.max(0, chunk.reach.from); s < chunk.reach.to; s += 4) for (const height of [20, 50, 90]) for (const lateral of [0, -(info.halfWidth - 3), info.halfWidth - 3])
      assert.equal(chunk.collider.hits(...point(s, lateral, height), BODY_RADIUS), false, `${info.theme} chunk ${index}: corridor blocked at s=${s} lateral ${lateral} height ${height}`);
    if (index === 0) assert.equal(chunk.collider.hits(...point(0, 0, 57), BODY_RADIUS + .5), false, 'the start is clear');
    chunk.dispose();
  }
  // Fly the hard districts through their real scenery, streaming chunks like the app does.
  const chunks = new Map();
  const world = {
    sync(s) {
      const here = chunkIndexAt(s);
      for (const i of [here, here + 1, here + 2]) if (!chunks.has(i)) chunks.set(i, buildChunk(track, chunkAt(i)));
      for (const i of [...chunks.keys()]) if (i < here - 1) { chunks.get(i).dispose(); chunks.delete(i); }
    },
    hits(x, y, z, r) { for (const c of chunks.values()) if (c.collider.hits(x, y, z, r)) return true; return false; },
  };
  // Every theme at the twistiest level, and straight across every theme boundary where two themes' scenery mix.
  const flights = [
    ...THEME_ORDER.map((_, i) => [districtAt(HARDEST_DISTRICT + i).s0 + 2500, `the hardest ${districtAt(HARDEST_DISTRICT + i).theme}`]),
    ...Array.from({ length: HARDEST_DISTRICT }, (_, i) => [districtAt(i + 1).s0 - 600, `the ${districtAt(i).theme} -> ${districtAt(i + 1).theme} boundary`]),
  ];
  for (const [start, label] of flights) {
    const survived = SETTINGS.some(setting => { for (const i of [...chunks.keys()]) { chunks.get(i).dispose(); chunks.delete(i); } return !autopilot(track, { start, distance: 1200, world, ...setting }).dead; });
    assert.ok(survived, `${label}: no steering setting got through its real scenery`);
  }
});
