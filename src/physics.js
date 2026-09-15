import { MAPS } from './maps.js';

const STEP = 2;
// Light air drag, identical in every direction: nothing steers the runner away from walls.
const AIR_DRAG = .025;
// Radius of the runner's body used against real scenery geometry (collider.js).
export const BODY_RADIUS = .6;

const smooth = t => t * t * (3 - 2 * t);

// Centripetal Catmull-Rom keeps tight control points from overshooting into loops.
function spline(points, sub = 24) {
  const pts = points.map(([x, z]) => ({ x, z }));
  const first = pts[0], second = pts[1], last = pts.at(-1), prev = pts.at(-2);
  const ext = [{ x: 2 * first.x - second.x, z: 2 * first.z - second.z }, ...pts, { x: 2 * last.x - prev.x, z: 2 * last.z - prev.z }];
  const knot = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)));
  const lerp = (a, b, ta, tb, t) => { const w = (t - ta) / (tb - ta); return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w }; };
  const out = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    for (let k = 0; k < sub; k++) {
      const t = t1 + (t2 - t1) * k / sub;
      const a1 = lerp(p0, p1, t0, t1, t), a2 = lerp(p1, p2, t1, t2, t), a3 = lerp(p2, p3, t2, t3, t);
      const b1 = lerp(a1, a2, t0, t2, t), b2 = lerp(a2, a3, t1, t3, t);
      out.push(lerp(b1, b2, t1, t2, t));
    }
  }
  out.push(last);
  return out;
}

function elevationAt(keys, s) {
  if (!keys?.length) return 0;
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [s1, y1] = keys[i], [s0, y0] = keys[i - 1];
    if (s <= s1) return y0 + (y1 - y0) * smooth((s - s0) / (s1 - s0));
  }
  return keys.at(-1)[1];
}

export function createCourse(def) {
  const pre = def.pre ?? 80;
  const dense = spline(def.points);
  // Resample at a fixed spacing so distance along the track is an index lookup.
  const xs = [dense[0].x], zs = [dense[0].z];
  let carry = 0;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1], b = dense[i], len = Math.hypot(b.x - a.x, b.z - a.z);
    let d = STEP - carry;
    while (d <= len) { xs.push(a.x + (b.x - a.x) * d / len); zs.push(a.z + (b.z - a.z) * d / len); d += STEP; }
    carry = len - (d - STEP);
  }
  const n = xs.length, total = (n - 1) * STEP;
  const txs = new Float64Array(n), tzs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2), dx = xs[b] - xs[a], dz = zs[b] - zs[a], l = Math.hypot(dx, dz) || 1;
    txs[i] = dx / l; tzs[i] = dz / l; ys[i] = elevationAt(def.elevation, i * STEP - pre);
  }
  const length = def.length ?? Math.floor((total - pre - 160) / 10) * 10;
  const course = { def, n, xs: Float64Array.from(xs), zs: Float64Array.from(zs), ys, txs, tzs, pre, length, total,
    halfWidth: def.halfWidth ?? 22, gravity: def.gravity ?? -34, speedCap: def.speedCap ?? 85, wind: def.wind ?? null };
  const gateCount = def.gates ?? 7;
  course.gates = Array.from({ length: gateCount }, (_, i) => {
    const s = length * (i + 1) / gateCount, lateral = def.gateOffsets?.[i] ?? 0, f = frameAt(course, s);
    return { s, lateral, x: f.x + f.rx * lateral, y: f.y + (def.gateLift ?? 47), z: f.z + f.rz * lateral, tx: f.tx, tz: f.tz, rx: f.rx, rz: f.rz, ground: f.y, radius: def.gateRadius ?? 25, height: def.gateHeight ?? 40 };
  });
  const an = def.anchor, anchors = [];
  for (let i = 0; ; i++) {
    const base = an.first + i * an.spacing;
    if (base > length + 140) break;
    for (const side of [-1, 1]) {
      const s = base + (side > 0 ? an.stagger ?? 0 : 0);
      if (s > total - pre - 4) continue;
      const f = frameAt(course, s), lateral = side * an.lateral;
      anchors.push({ s, side, lateral, ground: f.y, x: f.x + f.rx * lateral, y: f.y + an.heights[i % an.heights.length], z: f.z + f.rz * lateral });
    }
  }
  course.anchors = anchors;
  return course;
}

// Frame at a distance along the track: centerline point, forward tangent, right vector and ground height.
export function frameAt(c, s) {
  const f = Math.max(0, Math.min(c.n - 1.0001, (s + c.pre) / STEP)), i = Math.floor(f), u = f - i;
  let tx = c.txs[i] + (c.txs[i + 1] - c.txs[i]) * u, tz = c.tzs[i] + (c.tzs[i + 1] - c.tzs[i]) * u;
  const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  const extra = s + c.pre < 0 ? s + c.pre : s + c.pre > (c.n - 1) * STEP ? s + c.pre - (c.n - 1) * STEP : 0;
  return { x: c.xs[i] + (c.xs[i + 1] - c.xs[i]) * u + tx * extra, z: c.zs[i] + (c.zs[i + 1] - c.zs[i]) * u + tz * extra,
    y: c.ys[i] + (c.ys[i + 1] - c.ys[i]) * u, tx, tz, rx: -tz, rz: tx, heading: Math.atan2(-tx, -tz) };
}

// Project a world position onto the track. The hint keeps hairpins from snapping to the other leg.
export function locate(c, x, z, hint = -1) {
  let best = -1, bd = Infinity;
  const scan = (a, b) => { for (let i = Math.max(0, a); i <= Math.min(c.n - 1, b); i++) { const d = (c.xs[i] - x) ** 2 + (c.zs[i] - z) ** 2; if (d < bd) { bd = d; best = i; } } };
  if (hint >= 0) scan(hint - 45, hint + 45);
  if (best < 0 || bd > (c.halfWidth * 2.5) ** 2) { bd = Infinity; scan(0, c.n - 1); }
  let seg = best, u = 0, pick = Infinity;
  for (const i of [best - 1, best]) {
    if (i < 0 || i >= c.n - 1) continue;
    const dx = c.xs[i + 1] - c.xs[i], dz = c.zs[i + 1] - c.zs[i], l2 = dx * dx + dz * dz;
    let w = ((x - c.xs[i]) * dx + (z - c.zs[i]) * dz) / l2;
    if (i > 0) w = Math.max(0, w);
    if (i < c.n - 2) w = Math.min(1, w);
    const d = (c.xs[i] + dx * w - x) ** 2 + (c.zs[i] + dz * w - z) ** 2;
    if (d < pick) { pick = d; seg = i; u = w; }
  }
  const s = (seg + u) * STEP - c.pre, f = frameAt(c, s);
  return { s, i: best, lateral: (x - f.x) * f.rx + (z - f.z) * f.rz, ground: f.y, tx: f.tx, tz: f.tz, rx: f.rx, rz: f.rz };
}

export const COURSES = Object.fromEntries(MAPS.map(m => [m.id, createCourse(m)]));
const DEFAULT = COURSES.sunset;
export const LENGTH = DEFAULT.length;
export const GATES = DEFAULT.gates;
export const ANCHORS = DEFAULT.anchors;

function place(p, c, s, lateral, lift) {
  const f = frameAt(c, s);
  Object.assign(p, { x: f.x + f.rx * lateral, y: f.y + lift, z: f.z + f.rz * lateral, vx: f.tx * 23, vy: 3, vz: f.tz * 23,
    s, lateral, ground: f.y, trackIndex: Math.round((s + c.pre) / STEP),
    hooks: { left: null, right: null }, anchor: null, hookCount: 0, tension: 0, releaseReady: false, attached: false, released: false });
}
export function createPlayer(course = DEFAULT) {
  const p = { gate: 0, time: 0, falls: 0, done: false, windPhase: 0 };
  Object.defineProperty(p, 'course', { value: course, enumerable: false });
  place(p, course, 0, 0, 57);
  return p;
}
// The runner's own horizontal travel direction. Only when nearly stationary does it fall back to the track.
export function headingOf(p) {
  const speed = Math.hypot(p.vx, p.vz);
  if (speed > 1) return { hx: p.vx / speed, hz: p.vz / speed };
  const f = frameAt(p.course, p.s);
  return { hx: f.tx, hz: f.tz };
}
export function connect(p, side) {
  const c = p.course, dir = side === 'left' ? -1 : 1, { hx, hz } = headingOf(p);
  let best = null, score = Infinity;
  for (const a of c.anchors) {
    // "Ahead" and "left/right" are measured from where the runner is actually flying, not from the course line.
    const dx = a.x - p.x, dz = a.z - p.z, forward = dx * hx + dz * hz, across = dx * -hz + dz * hx;
    if (Math.sign(across) !== dir) continue;
    const dist = Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
    if (forward < 24 || forward > 110 || dist > 145) continue;
    const cost = Math.abs(forward - 65) + Math.abs(across) * .08;
    if (cost < score) { best = a; score = cost; }
  }
  if (best) {
    const rope = Math.hypot(p.x - best.x, p.y - best.y, p.z - best.z);
    p.hooks[side] = { anchor: best, rope, targetRope: Math.min(rope, best.y - best.ground - 15), reelSpeed: 0, tension: 0 };
    p.attached = true;
  }
}
function summarizeHooks(p) {
  const hooks = Object.values(p.hooks).filter(Boolean); p.hookCount = hooks.length;
  if (hooks.length === 2) {
    const [a, b] = hooks.map(h => h.anchor);
    p.anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, s: (a.s + b.s) / 2, ground: (a.ground + b.ground) / 2 };
  } else p.anchor = hooks.length === 1 ? hooks[0].anchor : null;
  return hooks;
}
export function recover(p, reason = 'fall') {
  const c = p.course, gate = p.gate ? c.gates[p.gate - 1] : null;
  place(p, c, gate ? gate.s + 8 : 0, gate ? gate.lateral : 0, 57);
  p.time += 3; p.falls++; p.recoverReason = reason;
}
// world (optional): { hits(x, y, z, radius) } testing the drawn map geometry. There is no invisible corridor wall:
// the runner only crashes into objects that actually exist. Node tests without a world simply fly through open air.
export function step(p, input, dt, world = null) {
  if (p.done) return null;
  const c = p.course;
  p.time += dt;
  const old = { x: p.x, y: p.y, z: p.z };
  p.attached = false; p.released = false;
  let loc = locate(c, p.x, p.z, p.trackIndex);
  p.s = loc.s; p.lateral = loc.lateral;
  for (const side of ['left', 'right']) {
    const held = !!input[side + 'Hook'];
    if (!held && p.hooks[side]) { p.hooks[side] = null; p.released = true; }
    if (held && !p.hooks[side]) connect(p, side);
  }
  const hooks = summarizeHooks(p);
  // A/D apply no lateral movement force: sideward motion comes from the chosen cable.
  const push = (Number(!!input.forward) - Number(!!input.back)) * (p.anchor ? 25 : 18);
  p.windPhase += dt;
  const gust = c.wind ? Math.sin(p.windPhase * Math.PI * 2 / c.wind.period) * c.wind.strength : 0;
  for (const hook of hooks) {
    // Shorten gradually rather than teleporting on attachment or canceling gravity.
    const oldRope = hook.rope;
    hook.rope = Math.max(hook.targetRope, hook.rope - (p.y < loc.ground + 30 ? 42 : 24) * dt);
    hook.reelSpeed = (hook.rope - oldRope) / dt; hook.tension = 0;
  }
  // W/S push along the runner's own travel direction, never along the course, so holding W cannot bend you round a curve.
  // Wind pushes across the pass; drag is the same in every direction.
  const { hx, hz } = headingOf(p), drag = Math.exp(-AIR_DRAG * dt);
  p.vx = (p.vx + (hx * push + loc.rx * gust) * dt) * drag; p.vz = (p.vz + (hz * push + loc.rz * gust) * dt) * drag;
  p.vy += c.gravity * dt;
  const speed = Math.hypot(p.vx, p.vy, p.vz);
  if (speed > c.speedCap) { const scale = c.speedCap / speed; p.vx *= scale; p.vy *= scale; p.vz *= scale; }
  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  p.tension = 0;
  // Iterate both distance constraints; neither side overwrites the other connection.
  for (let iteration = 0; iteration < 6; iteration++) for (const hook of (iteration % 2 ? [...hooks].reverse() : hooks)) {
    const a = hook.anchor, dx = p.x - a.x, dy = p.y - a.y, dz = p.z - a.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > hook.rope) {
      const nx = dx / dist, ny = dy / dist, nz = dz / dist;
      p.x = a.x + nx * hook.rope; p.y = a.y + ny * hook.rope; p.z = a.z + nz * hook.rope;
      const outward = p.vx * nx + p.vy * ny + p.vz * nz;
      if (outward > hook.reelSpeed) { p.vx -= (outward - hook.reelSpeed) * nx; p.vy -= (outward - hook.reelSpeed) * ny; p.vz -= (outward - hook.reelSpeed) * nz; }
      hook.tension = Math.min(1, .3 + Math.hypot(p.vx, p.vy, p.vz) / 85);
    }
  }
  p.tension = Math.max(0, ...hooks.map(h => h.tension));
  loc = locate(c, p.x, p.z, loc.i);
  // Corridor walls follow the curve. Touching one is a crash: no sliding assist, straight back to the last checkpoint.
  p.s = loc.s; p.lateral = loc.lateral; p.ground = loc.ground; p.trackIndex = loc.i;
  p.forwardSpeed = p.vx * loc.tx + p.vz * loc.tz;
  p.releaseReady = !!p.anchor && p.s > p.anchor.s + 12 && p.y > p.ground + 30 && p.vy > 10 && p.forwardSpeed > 8;
  const gate = c.gates[p.gate];
  if (gate) {
    const before = (old.x - gate.x) * gate.tx + (old.z - gate.z) * gate.tz, after = (p.x - gate.x) * gate.tx + (p.z - gate.z) * gate.tz;
    if (before <= 0 && after >= 0) {
      const t = -before / Math.max(.00001, after - before);
      const x = old.x + (p.x - old.x) * t, y = old.y + (p.y - old.y) * t, z = old.z + (p.z - old.z) * t;
      const lateral = (x - gate.x) * gate.rx + (z - gate.z) * gate.rz;
      if ((lateral / gate.radius) ** 2 + ((y - gate.y) / gate.height) ** 2 < 1) {
        p.gate++;
        if (p.gate === c.gates.length) { p.done = true; p.time -= dt * (1 - t); return 'finish'; }
        return 'gate';
      }
    }
  }
  if (gate && p.s > gate.s + 48) { recover(p, 'missed'); return 'recover'; }
  if (p.y < p.ground + 4 || p.y > p.ground + 160 || p.s < -60) { recover(p, 'fall'); return 'recover'; }
  // Sample the midpoint too, so a fast frame cannot skip through a thin pole or beam.
  if (world && (world.hits(p.x, p.y, p.z, BODY_RADIUS) || world.hits((p.x + old.x) / 2, (p.y + old.y) / 2, (p.z + old.z) / 2, BODY_RADIUS))) { recover(p, 'obstacle'); return 'recover'; }
  return null;
}
export function formatTime(seconds) { const ms = Math.max(0, Math.floor(seconds * 1000)); return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; }
export function cleanRecords(value) { if (!Array.isArray(value)) return []; return value.filter(r => r && typeof r.name === 'string' && Number.isFinite(r.time) && r.time > 0 && r.time < 86400).map(r => ({ name: r.name.slice(0, 16), time: r.time, falls: Number.isInteger(r.falls) && r.falls >= 0 ? r.falls : 0 })).sort((a, b) => a.time - b.time).slice(0, 10); }
