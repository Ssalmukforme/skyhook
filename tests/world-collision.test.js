import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/maps.js';
import { COURSES, createPlayer, step, frameAt, locate, BODY_RADIUS } from '../src/physics.js';
import { buildWorld } from '../src/worlds.js';

// Build every real map (the same geometry the game draws) once and collide against it.
const worlds = Object.fromEntries(MAPS.map(m => [m.id, buildWorld(m, COURSES[m.id])]));
// A hook point past the start area (the launch platform behind the start line is solid too).
const firstHook = c => c.anchors.find(a => a.s > 150);
const point = (c, s, lateral, height) => { const f = frameAt(c, s); return [f.x + f.rx * lateral, f.y + height, f.z + f.rz * lateral]; };

test('start and every checkpoint respawn are clear of scenery', () => {
  for (const map of MAPS) {
    const c = COURSES[map.id], { collider } = worlds[map.id];
    assert.ok(collider.triangles > 1000, `${map.id} collides with its drawn geometry`);
    for (const [s, lateral] of [[0, 0], ...c.gates.map(g => [g.s + 8, g.lateral])]) {
      assert.equal(collider.hits(...point(c, s, lateral, 57), BODY_RADIUS + .5), false, `${map.id}: respawn at s=${s.toFixed(0)} is inside an object`);
    }
  }
});

test('flying outward from the course centre, the first crash is the drawn object, with nothing invisible before it', () => {
  // [track distance, side, height above floor, where the visible surface is (min, max lateral)]
  const probes = {
    // Sunset: front face of the first anchor building (x = ±26), well above street trees and lamps.
    sunset: c => { const a = firstHook(c); return [a.s, a.side, 20, 25, 26]; },
    // Harbor: first neon tower, front face 4 m outside its hook point.
    harbor: c => { const a = firstHook(c), lat = Math.abs(a.lateral); return [a.s, a.side, 20, lat + 3, lat + 4]; },
    // Canyon: the striped cliff face at 50 m up, which wanders a few metres around halfWidth + 9..14.
    canyon: c => [400, 1, 50, c.halfWidth + 3, c.halfWidth + 20],
    // Aurora: trunk of the giant pine carrying the first hook (trunk centre 10 m outside the hook).
    aurora: c => { const a = firstHook(c), lat = Math.abs(a.lateral); return [a.s, a.side, 10, lat + 3, lat + 10]; },
    // Garden: white pillar under the first hook (centre 14 m outside it, about 1.5–1.9 m thick).
    garden: c => { const a = firstHook(c), lat = Math.abs(a.lateral); return [a.s, a.side, a.y - a.ground - 10, lat + 11, lat + 14]; },
  };
  for (const map of MAPS) {
    const c = COURSES[map.id], { collider } = worlds[map.id], [s, side, height, min, max] = probes[map.id](c);
    let first = null;
    for (let lateral = 0; lateral <= max + 2 && first === null; lateral += .1) if (collider.hits(...point(c, s, side * lateral, height), BODY_RADIUS)) first = lateral;
    assert.ok(first !== null, `${map.id}: never hit the object`);
    assert.ok(first + BODY_RADIUS >= min - .2 && first + BODY_RADIUS <= max + .2, `${map.id}: first contact at ${(first + BODY_RADIUS).toFixed(1)} m, object surface expected ${min}-${max} m`);
    // Open course centre and the gate opening are air (gates and hook markers are see-through helpers).
    assert.equal(collider.hits(...point(c, c.gates[2].s, 0, 60), BODY_RADIUS), false, `${map.id}: open course centre collides`);
    assert.equal(collider.hits(...point(c, c.gates[2].s, c.gates[2].lateral, c.gates[2].y - c.gates[2].ground), BODY_RADIUS), false, `${map.id}: flying through a gate collides`);
  }
});
test('crashing into a real object during a run sends the runner back to the checkpoint', () => {
  const c = COURSES.sunset, a = c.anchors.find(x => x.s > 320 && x.side > 0);
  const p = createPlayer(c);
  // Fly sideways straight at the building face next to checkpoint 02.
  Object.assign(p, { gate: 2, x: 20, y: 40, z: a.z, vx: 60, vy: 0, vz: 0, trackIndex: Math.round((-a.z + c.pre) / 2) });
  let result = null;
  for (let i = 0; i < 60 && !result; i++) result = step(p, {}, 1 / 120, worlds.sunset.collider);
  assert.equal(result, 'recover'); assert.equal(p.recoverReason, 'obstacle');
});

test('every map can be finished with the real geometry by steering with the hooks', () => {
  for (const map of MAPS) {
    const c = COURSES[map.id], collider = worlds[map.id].collider;
    const finished = [[1.4, .35], [1, .35], [.8, .3], [1.2, .4]].some(([horizon, threshold]) => {
      const p = createPlayer(c); let airborne = 0;
      for (let i = 0; i < 120 * 240 && !p.done && p.falls < 60; i++) {
        if (p.releaseReady && airborne <= 0) airborne = .5;
        const held = airborne <= 0; airborne -= 1 / 120;
        const ahead = locate(c, p.x + p.vx * horizon, p.z + p.vz * horizon, p.trackIndex).lateral, limit = c.halfWidth * threshold;
        step(p, { leftHook: held && ahead > -limit, rightHook: held && ahead < limit, forward: true }, 1 / 120, collider);
      }
      return p.done && p.gate === c.gates.length;
    });
    assert.ok(finished, `${map.id}: no steering setting finished`);
  }
});
