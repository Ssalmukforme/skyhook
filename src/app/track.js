// Endless course for the mobile app. No Three.js here so Node tests can drive it with the real physics.
// The track object has the same shape physics.js reads from a fixed course (xs/zs/ys/txs/tzs sampled every 2 m,
// `pre` metres before the start, anchors, gates, gravity...), but it keeps growing as the runner flies on.
import { frameAt as courseFrame } from '../physics.js';

const STEP = 2;
// One theme district is 5 km. Scenery is built and dropped in smaller chunks (8 per district).
export const DISTRICT_LENGTH = 5000;
export const CHUNK_LENGTH = 625;
export const THEME_ORDER = ['sunset', 'meadow', 'harbor', 'aurora', 'canyon', 'garden', 'jungle'];
// Difficulty steps up by one level each time the district (theme) changes and is hardest from the eighth district on.
export const HARDEST_DISTRICT = THEME_ORDER.length;
// The course never turns more than this from its starting direction, so it can never loop back into itself.
export const MAX_HEADING = 55 * Math.PI / 180;
export const MIN_RADIUS = 110;
const START_STRAIGHT = 150;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => Math.max(0, Math.min(1, t));
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const districtIndexAt = s => Math.max(0, Math.floor(s / DISTRICT_LENGTH));
export const difficulty = s => clamp01(districtIndexAt(s) / HARDEST_DISTRICT);

export function createRandom(seed) {
  let state = (Math.floor(Math.abs(seed)) % 2147483646) + 1;
  const random = () => { state = (state * 16807) % 2147483647; return (state - 1) / 2147483646; };
  return { random, range: (a, b) => a + random() * (b - a), pick: list => list[Math.floor(random() * list.length)] };
}

export function districtAt(index) {
  const s0 = index * DISTRICT_LENGTH;
  return { index, s0, s1: s0 + DISTRICT_LENGTH, theme: THEME_ORDER[index % THEME_ORDER.length] };
}
export const chunkIndexAt = s => Math.max(0, Math.floor(s / CHUNK_LENGTH));
// A scenery chunk: its district's theme, plus corridor width from the difficulty at its middle.
// Physics (gravity, top speed) is the same everywhere and there is no wind.
export function chunkAt(index) {
  const s0 = index * CHUNK_LENGTH, d = difficulty(s0 + CHUNK_LENGTH / 2), district = districtAt(districtIndexAt(s0));
  return { index, s0, s1: s0 + CHUNK_LENGTH, district: district.index, theme: district.theme, d, halfWidth: Math.round(lerp(26, 19, d) * 2) / 2 };
}
// How the course bends at difficulty d, the same in every theme. This is what makes the course harder (there are no
// obstacles): long straights and wide sweeps at first, then ever shorter straights and tighter left-right zigzags.
// Radii shrink geometrically so each step is gradual.
// straight: chance of a straight between two bends; alternate: chance the next bend turns the other way.
const EASIEST_BENDS = { straight: .7, radius: [1400, 2600], length: [120, 260], straightLength: [150, 400], alternate: .5 };
const HARDEST_BENDS = { straight: .05, radius: [110, 140], length: [60, 100], straightLength: [10, 20], alternate: 1 };
const geometric = (easy, hard, d) => easy * Math.pow(hard / easy, d);
export function bendStyle(d) {
  const e = EASIEST_BENDS, h = HARDEST_BENDS;
  return {
    straight: lerp(e.straight, h.straight, d),
    radius: [geometric(e.radius[0], h.radius[0], d), geometric(e.radius[1], h.radius[1], d)],
    length: [lerp(e.length[0], h.length[0], d), lerp(e.length[1], h.length[1], d)],
    straightLength: [lerp(e.straightLength[0], h.straightLength[0], d), lerp(e.straightLength[1], h.straightLength[1], d)],
    alternate: lerp(e.alternate, h.alternate, d),
  };
}

// Ground grade (rise per metre): gentle rolls at first, steeper hills later. Harbor water is dead flat.
// Climbs stay short (see climb in pushSample) since there is no W to push uphill.
function gradeFor(theme, d, random) {
  if (theme === 'harbor' || random() < lerp(.6, .3, d)) return 0;
  return (random() < .5 ? 1 : -1) * lerp(.01, lerp(.02, .06, d), random());
}

export function createEndlessTrack(seed = 1) {
  const pre = 100;
  let cap = 4096;
  const track = {
    endless: true, seed, pre, n: 0, xs: new Float64Array(cap), zs: new Float64Array(cap), ys: new Float64Array(cap), txs: new Float64Array(cap), tzs: new Float64Array(cap),
    // Physics reads these like a fixed course. The generated length only grows; `halfWidth` is the projection tolerance.
    length: Infinity, total: 0, gates: [], halfWidth: 26, gravity: -34, speedCap: 85, wind: null,
    // When the runner strays off the corridor, re-projection searches only this many samples around the last match.
    scanWindow: 600,
    anchors: [], allAnchors: [],
  };
  // Separate random streams: the centerline and the hook rows are generated at different moments, and the same
  // seed must give the same course however far ahead it is generated.
  const rng = createRandom(seed * 7919 + 13), hookRng = createRandom(seed * 104729 + 71);
  const gen = { x: 0, z: pre, y: 0, heading: 0, kappa: 0, grade: 0, section: null, sectionLeft: 0, lastSign: 1, gradeSection: null, gradeLeft: 0, climb: 0,
    nextAnchorRow: 0, nextAnchorBase: -25, focusFrom: 0 };

  function grow() {
    cap *= 2;
    for (const key of ['xs', 'zs', 'ys', 'txs', 'tzs']) { const next = new Float64Array(cap); next.set(track[key]); track[key] = next; }
  }
  function nextSection(s) {
    const { random, range } = rng;
    if (s < START_STRAIGHT) return { length: START_STRAIGHT - s + 20, kappa: 0 };
    const style = bendStyle(difficulty(s));
    // Never two straights in a row: a straight always leads into a bend.
    if (gen.section.kappa !== 0 && random() < style.straight) return { length: range(...style.straightLength), kappa: 0 };
    const radius = Math.max(MIN_RADIUS, range(...style.radius));
    let sign = random() < style.alternate ? -gen.lastSign : gen.lastSign;
    // Past 30° off the main direction, mostly bend back toward it.
    if (Math.abs(gen.heading) > Math.PI / 6 && random() < .8) sign = -Math.sign(gen.heading);
    const room = sign * Math.sign(gen.heading || sign) > 0 ? MAX_HEADING - Math.abs(gen.heading) : MAX_HEADING + Math.abs(gen.heading);
    gen.lastSign = sign;
    return { length: Math.min(range(...style.length), Math.max(30, room * radius * .9)), kappa: sign / radius };
  }
  function nextGrade(s) {
    // Grade follows the district 150 m ahead and eases in over that distance, so a harbor is already flat when its
    // water starts, and sections end 150 m before the next district for the same reason. A harbor stays flat to its end.
    const here = districtAt(districtIndexAt(s)), inHarbor = here.theme === 'harbor', district = inHarbor ? here : districtAt(districtIndexAt(s + 150));
    let grade = s < START_STRAIGHT ? 0 : gradeFor(district.theme, difficulty(s + 150), rng.random);
    // No long climbs: after 45 m of height gained, level out until enough of it has been given back.
    if (grade > 0 && gen.climb > 45) grade = 0;
    const length = rng.range(100, 200);
    return { length: Math.min(length, Math.max(20, district.s1 - (inHarbor ? 0 : 150) - s)), grade };
  }
  function pushSample() {
    if (track.n >= cap) grow();
    const i = track.n, s = i * STEP - pre;
    if (gen.sectionLeft <= 0) { gen.section = nextSection(s); gen.sectionLeft = gen.section.length; }
    if (gen.gradeLeft <= 0) { gen.gradeSection = nextGrade(s); gen.gradeLeft = gen.gradeSection.length; }
    // Curvature and grade ease toward their targets instead of jumping, so the centerline has no kinks.
    gen.kappa += (gen.section.kappa - gen.kappa) * Math.min(1, STEP / 15);
    if (Math.abs(gen.heading) >= MAX_HEADING && Math.sign(gen.kappa) === Math.sign(gen.heading)) gen.kappa = 0;
    gen.grade += (gen.gradeSection.grade - gen.grade) * Math.min(1, STEP / 40);
    if (i > 0) {
      gen.heading = Math.max(-MAX_HEADING, Math.min(MAX_HEADING, gen.heading + gen.kappa * STEP));
      gen.x += Math.sin(gen.heading) * STEP; gen.z -= Math.cos(gen.heading) * STEP;
      const rise = gen.grade * STEP; gen.y += rise;
      gen.climb = Math.max(0, gen.climb + (rise > 0 ? rise : rise < 0 ? rise * 2 : -STEP * .05));
    }
    gen.sectionLeft -= STEP; gen.gradeLeft -= STEP;
    track.xs[i] = gen.x; track.zs[i] = gen.z; track.ys[i] = gen.y;
    track.txs[i] = Math.sin(gen.heading); track.tzs[i] = -Math.cos(gen.heading);
    track.n++; track.total = (track.n - 1) * STEP;
  }
  // Hook points in left/right rows along the corridor edge. Spacing widens and the rows stagger as difficulty rises.
  function pushAnchors(limit) {
    while (gen.nextAnchorBase + 40 < limit) {
      const base = gen.nextAnchorBase, d = difficulty(base), spacing = lerp(46, 54, d) + hookRng.range(-3, 3), stagger = spacing * .5 * smoothstep(.3, .75, d);
      for (const side of [-1, 1]) {
        const s = base + (side > 0 ? stagger : 0), f = frameAt(s), height = hookRng.pick([74, 78, 80, 82, 86]), lateral = chunkAt(chunkIndexAt(s)).halfWidth + 4;
        track.allAnchors.push({ s, side, lateral: side * lateral, ground: f.y, x: f.x + f.rx * side * lateral, y: f.y + height, z: f.z + f.rz * side * lateral, row: gen.nextAnchorRow });
      }
      gen.nextAnchorRow++; gen.nextAnchorBase = base + spacing;
    }
  }
  const frameAt = s => courseFrame(track, s);
  gen.section = { kappa: 0 };

  // Generate the centerline (and its hook points) at least up to distance s.
  track.ensure = s => {
    while (track.n * STEP - pre < s + 200) pushSample();
    pushAnchors(track.total - pre - 120);
    return track;
  };
  // physics.connect() scans every anchor, so keep only the ones near the runner in `anchors`.
  track.focus = s => {
    const list = track.allAnchors;
    let lo = gen.focusFrom;
    while (lo > 0 && list[lo - 1].s >= s - 150) lo--;
    while (lo < list.length && list[lo].s < s - 150) lo++;
    let hi = lo; while (hi < list.length && list[hi].s < s + 700) hi++;
    gen.focusFrom = lo; track.anchors = list.slice(lo, hi);
    return track;
  };
  // Nearest centerline distance in the horizontal plane, looking only between s0 and s1.
  track.distanceTo = (x, z, s0, s1, stride = 2) => {
    const a = Math.max(0, Math.floor((s0 + pre) / STEP)), b = Math.min(track.n - 1, Math.ceil((s1 + pre) / STEP));
    let best = Infinity;
    for (let i = a; i <= b; i += stride) { const d = (track.xs[i] - x) ** 2 + (track.zs[i] - z) ** 2; if (d < best) best = d; }
    return Math.sqrt(best);
  };
  return track.ensure(CHUNK_LENGTH * 3).focus(0);
}
