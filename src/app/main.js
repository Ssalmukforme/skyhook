// SKYHOOK mobile app: one endless run. Hold the left or right half of the screen to hook that side,
// let go to fly. The course is generated as you go and changes district every 800 m.
import * as THREE from 'three';
import '@fontsource/noto-sans-kr/latin-400.css';
import '@fontsource/noto-sans-kr/latin-700.css';
import '@fontsource/noto-sans-kr/latin-800.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-800.css';
import './app.css';
import { createRunner, animateRunner, cueRunner, resetRunner } from '../runner.js';
import { createPlayer, step, frameAt, headingOf } from '../physics.js';
import { ENVIRONMENTS } from '../worlds.js';
import { MAPS } from '../maps.js';
import { t as tr, localizeMaps } from '../i18n.js';
import { createEndlessTrack, chunkAt, chunkIndexAt, districtAt, districtIndexAt, smoothstep } from './track.js';
import { buildChunk, buildChunkSteps, THEME_BLEND } from './scenery.js';
import { createBurst } from './burst.js';
localizeMaps(MAPS);

const $ = s => document.querySelector(s);
const store = (() => { try { const k = '__skyhook'; localStorage.setItem(k, k); localStorage.removeItem(k); return localStorage; } catch { return null; } })();
const read = (key, fallback) => { try { return store?.getItem(key) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { store?.setItem(key, String(value)); } catch { } };
const THEME_INFO = Object.fromEntries(MAPS.map(m => [m.theme, m]));
const mobile = matchMedia('(pointer: coarse)').matches;

const canvas = $('#world');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' }); }
catch (error) { $('#loading').textContent = tr('3D 화면을 열 수 없습니다.', 'Could not start 3D.'); throw error; }
const pixelRatio = () => Math.min(devicePixelRatio, mobile ? 1.5 : 1.7);
renderer.setPixelRatio(pixelRatio());
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#c89490', .0021);
const camera = new THREE.PerspectiveCamera(59, innerWidth / innerHeight, .2, 1750);
const hemiLight = new THREE.HemisphereLight('#ffcca4', '#6a668f', 2.9); scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight('#ffb474', 3.2);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
Object.assign(sunLight.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 1, far: 520 });
sunLight.shadow.normalBias = .25;
scene.add(sunLight, sunLight.target);
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 20), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false,
  uniforms: { top: { value: new THREE.Color() }, middle: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, aurora: { value: 0 }, time: { value: 0 } },
  vertexShader: 'varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `varying vec3 vPos;uniform vec3 top;uniform vec3 middle;uniform vec3 bottom;uniform float aurora;uniform float time;
void main(){vec3 d=normalize(vPos);float h=d.y;vec3 c=mix(bottom,middle,smoothstep(-.05,.28,h));c=mix(c,top,smoothstep(.22,.85,h));
if(aurora>0.){float az=atan(d.z,d.x);float band=smoothstep(.08,.28,h)*smoothstep(.75,.35,h);
float w=sin(az*3.+time*.12+sin(az*7.-time*.21)*.9);float curtain=pow(max(0.,sin(h*14.+w*2.6-time*.3)),3.)*band;
float rays=.55+.45*sin(az*60.+sin(az*9.+time*.4)*4.);vec3 green=vec3(.2,1.,.62),violet=vec3(.55,.3,1.);
c+=mix(green,violet,smoothstep(.3,.62,h))*curtain*rays*.55*aurora;}
gl_FragColor=vec4(c,1.);
#include <colorspace_fragment>
}`
})); scene.add(sky);
const sun = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: '#ffe0ac', fog: false, toneMapped: false }));
const glow = new THREE.Mesh(new THREE.CircleGeometry(1.3, 64), new THREE.MeshBasicMaterial({ color: '#ffc091', fog: false, toneMapped: false, transparent: true, opacity: .1, depthWrite: false }));
scene.add(sun, glow);
const starPositions = new Float32Array(1600 * 3);
for (let i = 0; i < 1600; i++) { const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, y = Math.abs(u) * .95 + .05, r = Math.sqrt(1 - y * y); starPositions.set([Math.cos(a) * r * 1400, y * 1400, Math.sin(a) * r * 1400], i * 3); }
const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: .85, depthWrite: false })); scene.add(stars);

const runner = createRunner();
const { hero, cableOutlet } = runner; scene.add(hero);
const cableOrigin = new THREE.Vector3();
const ropes = Object.fromEntries(['left', 'right'].map(side => {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#fff1d9', transparent: true, opacity: .93 })); line.frustumCulled = false; scene.add(line); return [side, line];
}));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const streakPositions = [];
for (let i = 0; i < 24; i++) { const angle = i / 24 * Math.PI * 2, x = Math.cos(angle) * 12, y = Math.sin(angle) * 7; streakPositions.push(x, y, -18, x, y, -24 - Math.random() * 5); }
const streakGeometry = new THREE.BufferGeometry(); streakGeometry.setAttribute('position', new THREE.Float32BufferAttribute(streakPositions, 3));
const streaks = new THREE.LineSegments(streakGeometry, new THREE.LineBasicMaterial({ color: '#ffe1b5', transparent: true, opacity: 0, depthWrite: false })); camera.add(streaks); scene.add(camera);
const hookPulse = new THREE.Mesh(new THREE.TorusGeometry(1.7, .09, 5, 24), new THREE.MeshBasicMaterial({ color: '#ffe0ad', transparent: true, opacity: 0, depthWrite: false })); scene.add(hookPulse);
let hookFlash = 0;
// Crash: the runner bursts apart and the camera shakes briefly (no shake with reduced motion).
const burst = createBurst(scene, { reducedMotion });
let shake = 0;
const shakeOffset = new THREE.Vector3();
const PARTICLE_BOX = 160, particleGeo = new THREE.BufferGeometry();
let particleBase = new Float32Array(0), particles = null, particleTheme = null;

/* ---------------------------------------------------------------- endless world */
let track = null, player = null;
const chunks = new Map();
let pending = null; // { index, steps } for the district being built a phase per frame
// Collide against every district that is currently built.
const world = {
  hits(x, y, z, r) { for (const c of chunks.values()) if (c.collider.hits(x, y, z, r)) return true; return false; },
  nearest(x, y, z, max) { let best = null; for (const c of chunks.values()) { const n = c.collider.nearest(x, y, z, best ? best.distance : max); if (n && (!best || n.distance < best.distance)) best = n; } return best; },
};
function disposeChunk(index) { const c = chunks.get(index); if (!c) return; scene.remove(c.root); c.dispose(); chunks.delete(index); }
function addChunk(chunk) { chunks.set(chunk.chunk.index, chunk); scene.add(chunk.root); }
function resetWorld(seed) {
  pending = null;
  for (const index of [...chunks.keys()]) disposeChunk(index);
  track = createEndlessTrack(seed);
  addChunk(buildChunk(track, chunkAt(0)));
  player = createPlayer(track);
}
// Keep the chunk the runner is in plus what lies within about 700 m ahead built, and drop what is well behind.
function syncChunks(s) {
  const here = chunkIndexAt(s), ahead = chunkIndexAt(s + 700);
  for (const index of [...chunks.keys()]) if (index < here - 1 || (index === here - 1 && s - chunkAt(here).s0 > 300)) disposeChunk(index);
  if (!chunks.has(here)) { if (pending?.index === here) pending = null; addChunk(buildChunk(track, chunkAt(here))); }
  if (pending) {
    const { value, done } = pending.steps.next();
    if (done) { addChunk(value); pending = null; }
    return;
  }
  for (let index = here + 1; index <= ahead + 1; index++) if (!chunks.has(index)) { pending = { index, steps: buildChunkSteps(track, chunkAt(index)) }; return; }
}

/* ---------------------------------------------------------------- environment blending between districts */
const mixColor = (a, b, t, out) => out.set(a).lerp(tmpColor.set(b), t);
const tmpColor = new THREE.Color(), c1 = new THREE.Color();
function applyEnvironment(s) {
  const index = districtIndexAt(s), district = districtAt(index);
  let a = district, b = district, t = 0;
  // Sky, fog and light change across the same stretch where the scenery blends (THEME_BLEND each side of the boundary).
  if (s > district.s1 - THEME_BLEND) { b = districtAt(index + 1); t = smoothstep(district.s1 - THEME_BLEND, district.s1 + THEME_BLEND, s); }
  else if (index > 0 && s < district.s0 + THEME_BLEND) { a = districtAt(index - 1); t = smoothstep(district.s0 - THEME_BLEND, district.s0 + THEME_BLEND, s); }
  const A = ENVIRONMENTS[a.theme], B = ENVIRONMENTS[b.theme], n = (key) => A[key] + (B[key] - A[key]) * t;
  mixColor(A.fog, B.fog, t, scene.fog.color); scene.fog.density = n('fogDensity');
  mixColor(A.hemiSky, B.hemiSky, t, hemiLight.color); mixColor(A.hemiGround, B.hemiGround, t, hemiLight.groundColor); hemiLight.intensity = n('hemi');
  mixColor(A.sunColor, B.sunColor, t, sunLight.color); sunLight.intensity = n('sun');
  renderer.toneMappingExposure = n('exposure');
  const u = sky.material.uniforms;
  mixColor(A.skyTop, B.skyTop, t, u.top.value); mixColor(A.skyMiddle, B.skyMiddle, t, u.middle.value); mixColor(A.skyBottom, B.skyBottom, t, u.bottom.value); u.aurora.value = n('aurora');
  mixColor(A.disc, B.disc, t, sun.material.color); sun.scale.setScalar(n('discSize'));
  mixColor(A.glow, B.glow, t, glow.material.color); glow.material.opacity = n('glowOpacity'); glow.scale.setScalar(n('discSize'));
  stars.material.opacity = .85 * n('stars'); stars.visible = stars.material.opacity > .01;
  mixColor(A.rope, B.rope, t, c1); hookPulse.material.color.copy(c1); streaks.material.color.copy(c1);
  env.sunDir = t < .5 ? A.sunDir : B.sunDir; env.lightOffset = t < .5 ? A.lightOffset : B.lightOffset; env.rope = `#${c1.getHexString()}`;
  const near = t < .5 ? a : b;
  if (near.theme !== particleTheme) setParticles(near.theme);
  if (near.theme !== env.theme) {
    env.theme = near.theme;
    document.documentElement.style.setProperty('--accent', THEME_INFO[near.theme].accent);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', ENVIRONMENTS[near.theme].fog);
  }
}
const env = { theme: null, sunDir: [0, 1, 0], lightOffset: [0, 100, 0], rope: '#ffe0ad' };
function setParticles(theme) {
  particleTheme = theme;
  const p = ENVIRONMENTS[theme].particles;
  particleBase = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count * 3; i++) particleBase[i] = Math.random() * PARTICLE_BOX;
  particleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.count * 3), 3));
  if (particles) { scene.remove(particles); particles.material.dispose(); }
  particles = new THREE.Points(particleGeo, new THREE.PointsMaterial({ color: p.color, size: p.size, transparent: true, opacity: p.opacity, depthWrite: false }));
  particles.frustumCulled = false; scene.add(particles);
}

/* ---------------------------------------------------------------- state, input */
let mode = 'menu', previousMode = 'playing', countdown = 3, accumulator = 0, last = performance.now(), worldTime = 0, toastUntil = 0, deathTimer = 0;
let best = Number(read('skyhook.app.best', 0)) || 0, runDistance = 0, districtShown = -1, seenRelease = false;
let tutorial = read('skyhook.app.tutorial', '') !== 'done';
const keys = new Set(), touches = new Map();
const held = side => [...touches.values()].includes(side) || (side === 'left' ? keys.has('a') || keys.has('arrowleft') : keys.has('d') || keys.has('arrowright'));
const show = id => $(id).classList.remove('hidden'), hide = id => $(id).classList.add('hidden');
const formatDistance = m => Math.floor(m).toLocaleString();
function setDistance(el, meters) { el.replaceChildren(document.createTextNode(formatDistance(meters)), Object.assign(document.createElement('small'), { textContent: ' m' })); }
function clearInput() { keys.clear(); touches.clear(); document.querySelectorAll('.touch-half').forEach(h => h.classList.remove('held')); }
function toast(text, seconds = 2) { $('#toast').textContent = text; toastUntil = worldTime + seconds; $('#toast').style.opacity = 1; }

const touchLayer = $('#touch-layer');
touchLayer.addEventListener('pointerdown', e => {
  e.preventDefault(); try { touchLayer.setPointerCapture(e.pointerId); } catch { }
  const side = e.clientX < innerWidth / 2 ? 'left' : 'right'; touches.set(e.pointerId, side);
  touchLayer.querySelector(`[data-side="${side}"]`).classList.add('held');
});
const lift = e => { const side = touches.get(e.pointerId); touches.delete(e.pointerId); if (side && ![...touches.values()].includes(side)) touchLayer.querySelector(`[data-side="${side}"]`).classList.remove('held'); };
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => touchLayer.addEventListener(type, lift));
touchLayer.addEventListener('contextmenu', e => e.preventDefault());
const eventKey = e => e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
window.addEventListener('keydown', e => {
  const k = eventKey(e);
  if (k === 'escape') { if (mode === 'paused') resume(); else pause(); return; }
  if (k === 'enter' && !e.repeat && (mode === 'menu' || mode === 'over')) { begin(); return; }
  if (['arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  keys.add(k);
});
window.addEventListener('keyup', e => keys.delete(eventKey(e)));
window.addEventListener('blur', () => { clearInput(); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

/* ---------------------------------------------------------------- run flow */
function begin() {
  ['#menu', '#over', '#pause'].forEach(hide);
  // Every run is a new random course. The menu course is reused for the very first run.
  if (player.s !== 0 || player.dead || mode === 'over') resetWorld(Math.floor(Math.random() * 2147483000));
  resetRunner(runner); clearInput(); accumulator = 0; runDistance = 0; districtShown = -1; seenRelease = false; deathTimer = 0;
  hero.visible = true; burst.reset(); shake = 0;
  mode = 'countdown'; countdown = 3;
  show('#hud'); show('#countdown'); show('#touch-layer'); $('#countdown').textContent = '3'; document.body.classList.add('playing');
  touchLayer.classList.toggle('hint', tutorial);
  $('#hud-best').classList.remove('beaten'); $('#hud-best').textContent = `BEST ${formatDistance(best)} m`;
  worldPoint(-18, 0, 64, camera.position); camera.lookAt(worldPoint(60, 0, 57)); const f = frameAt(track, 0); camForward.set(f.tx, 0, f.tz);
  wakeAudio();
}
function home() {
  mode = 'menu'; clearInput(); ['#hud', '#pause', '#over', '#countdown', '#touch-layer'].forEach(hide); show('#menu'); document.body.classList.remove('playing');
  hero.visible = true; burst.reset(); shake = 0;
  if (player.dead || player.s > 5) resetWorld(Math.floor(Math.random() * 2147483000));
  setDistance($('#menu-best'), best);
}
function pause() { if (!['playing', 'countdown'].includes(mode)) return; previousMode = mode; mode = 'paused'; clearInput(); hide('#countdown'); show('#pause'); }
function resume() { mode = previousMode; clearInput(); hide('#pause'); if (mode === 'countdown') show('#countdown'); last = performance.now(); }
const REASONS = { fall: tr('추락했어요', 'You fell'), obstacle: tr('부딪혔어요', 'You crashed') };
function die() {
  mode = 'dying'; deathTimer = 1.3; clearInput(); hide('#touch-layer'); $('#wall-warning').hidden = true;
  // The runner bursts where it hit (a wall, or the ground after a fall); the result screen waits for the burst to play out.
  hero.visible = false; ropes.left.visible = false; ropes.right.visible = false;
  burst.trigger(player.x, player.y, player.z, { x: player.vx, y: player.vy, z: player.vz }, env.rope); shake = reducedMotion ? 0 : 1.4;
  navigator.vibrate?.(mobile ? [60, 30, 90] : 0); $('#flash').style.opacity = .3; chime(1, 180);
}
function showResult() {
  mode = 'over'; hide('#hud'); document.body.classList.remove('playing');
  const newBest = runDistance > best;
  if (newBest) { best = Math.floor(runDistance); write('skyhook.app.best', best); }
  $('#over-eyebrow').textContent = newBest ? 'NEW BEST' : 'RUN OVER';
  $('#over-reason').textContent = REASONS[player.deathReason] ?? REASONS.fall;
  setDistance($('#over-distance'), runDistance);
  $('#over-new').classList.toggle('hidden', !newBest);
  $('#over-best').textContent = tr(`최고 ${formatDistance(best)} m`, `Best ${formatDistance(best)} m`);
  const district = districtAt(districtIndexAt(runDistance));
  $('#over-zone').textContent = tr(`DISTRICT ${String(district.index + 1).padStart(2, '0')} · ${THEME_INFO[district.theme].name}에서 멈췄어요`, `Stopped in DISTRICT ${String(district.index + 1).padStart(2, '0')} · ${THEME_INFO[district.theme].name}`);
  show('#over'); $('#again').focus();
}
$('#start').addEventListener('click', begin); $('#again').addEventListener('click', begin);
$('#resume').addEventListener('click', resume); $('#pause-button').addEventListener('click', pause);
document.querySelectorAll('.home-button').forEach(b => b.addEventListener('click', home));

let audioCtx = null, soundOn = read('skyhook.app.sound', '0') === '1';
function wakeAudio() { if (soundOn) { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume().catch(() => { }); } }
function chime(level = 1, base = 440) { if (!soundOn || !audioCtx) return; for (let i = 0; i < level; i++) { const osc = audioCtx.createOscillator(), gain = audioCtx.createGain(); osc.type = 'sine'; osc.frequency.value = base * Math.pow(1.25, i); gain.gain.setValueAtTime(0, audioCtx.currentTime); gain.gain.linearRampToValueAtTime(.08, audioCtx.currentTime + .015 + i * .1); gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + .35 + i * .1); osc.connect(gain).connect(audioCtx.destination); osc.start(audioCtx.currentTime + i * .1); osc.stop(audioCtx.currentTime + .4 + i * .1); } }
function renderSound() { $('#sound').textContent = soundOn ? tr('소리 ON', 'SOUND ON') : tr('소리 OFF', 'SOUND OFF'); $('#sound').setAttribute('aria-label', soundOn ? tr('사운드 끄기', 'Mute sound') : tr('사운드 켜기', 'Turn sound on')); }
$('#sound').addEventListener('click', () => { soundOn = !soundOn; write('skyhook.app.sound', soundOn ? 1 : 0); renderSound(); wakeAudio(); chime(); });
renderSound();

/* ---------------------------------------------------------------- per-frame updates */
const heroTarget = new THREE.Vector3(), camTarget = new THREE.Vector3(), lookTarget = new THREE.Vector3(), camForward = new THREE.Vector3(0, 0, -1), tmp = new THREE.Vector3();
function worldPoint(s, lateral, y, out = new THREE.Vector3()) { const f = frameAt(track, s); return out.set(f.x + f.rx * lateral, f.y + y, f.z + f.rz * lateral); }
function setRope(line, x, y, z, ax, ay, az) { line.geometry.attributes.position.array.set([x, y, z, ax, ay, az]); line.geometry.attributes.position.needsUpdate = true; }
const menuAnchor = () => track.allAnchors.find(a => a.side > 0 && a.s > 60);
function updateHero(dt) {
  if (mode === 'menu') {
    const phase = worldTime * .65, swing = Math.sin(phase);
    worldPoint(48 - swing * 6, 3 + swing * 3, 52 - Math.cos(phase * 2) * 2, hero.position); hero.scale.setScalar(1.75);
    animateRunner(runner, { x: 0, vx: Math.cos(phase) * 7, vy: Math.sin(phase * 2) * 18, vz: -30, anchor: { x: 26 }, tension: .7 }, dt, worldTime, { menu: true });
    hero.rotation.y += frameAt(track, 48).heading;
    const a = menuAnchor(); cableOutlet.getWorldPosition(cableOrigin); setRope(ropes.right, cableOrigin.x, cableOrigin.y, cableOrigin.z, a.x, a.y, a.z);
    ropes.right.visible = true; ropes.left.visible = false; ropes.right.material.color.set(env.rope);
    return;
  }
  heroTarget.set(player.x, player.y, player.z); hero.position.lerp(heroTarget, 1 - Math.exp(-24 * dt)); hero.scale.setScalar(1.2);
  const { hx, hz } = headingOf(player), rx = -hz, rz = hx, vf = player.vx * hx + player.vz * hz;
  const anchor = player.anchor ? { x: (player.anchor.x - player.x) * rx + (player.anchor.z - player.z) * rz } : null;
  animateRunner(runner, { x: 0, vx: 0, vy: player.vy, vz: -vf, anchor, hooks: player.hooks, tension: player.tension }, dt, worldTime, { ready: mode === 'countdown' });
  hero.rotation.y += Math.atan2(-hx, -hz);
  for (const side of ['left', 'right']) {
    const hook = player.hooks[side], line = ropes[side]; line.visible = !!hook;
    if (hook) { const a = hook.anchor; runner.cableOutlets[side].getWorldPosition(cableOrigin); setRope(line, cableOrigin.x, cableOrigin.y, cableOrigin.z, a.x, a.y, a.z); line.material.color.set(player.releaseReady ? '#9affd0' : side === 'left' ? '#9be2e4' : env.rope); }
  }
}
function updateCamera(dt) {
  // Take back last frame's shake before following, so the shake never drifts the camera.
  camera.position.sub(shakeOffset); shakeOffset.set(0, 0, 0);
  if (mode === 'menu') {
    const t = worldTime * .085, portrait = camera.aspect < 1;
    worldPoint((portrait ? -40 : -78) + Math.cos(t) * 4, (portrait ? 10 : 16) + Math.sin(t) * 5, (portrait ? 64 : 72) + Math.cos(t) * 2, camTarget); worldPoint(portrait ? 120 : 150, portrait ? -2 : -8, portrait ? 50 : 44, lookTarget);
    camera.position.lerp(camTarget, 1 - Math.exp(-2 * dt)); camera.lookAt(lookTarget); camera.fov = portrait ? 70 : 53;
  } else {
    const { hx, hz } = headingOf(player), speed = Math.hypot(player.vx, player.vy, player.vz);
    tmp.set(hx, 0, hz); camForward.lerp(tmp, 1 - Math.exp(-4 * dt)).normalize();
    // Upright phones see a narrow slice sideways: widen the view so the hook points on both sides stay visible.
    const portrait = camera.aspect < 1, sideFov = portrait ? Math.min(92, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(25)) / camera.aspect))) : 60;
    const back = (17 + Math.min(8, speed * .11)) * (portrait ? 1.15 : 1);
    camTarget.set(player.x - camForward.x * back, player.y + 7, player.z - camForward.z * back);
    const horizontal = 1 - Math.exp(-7 * dt);
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, camTarget.x, horizontal);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, camTarget.y, 1 - Math.exp(-(reducedMotion ? 7 : 2.8) * dt));
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, camTarget.z, horizontal);
    const vl = player.vx * -camForward.z + player.vz * camForward.x;
    lookTarget.set(player.x + camForward.x * 35, player.y + 1 + (reducedMotion ? 0 : player.vy * .24), player.z + camForward.z * 35); camera.lookAt(lookTarget);
    if (!reducedMotion) camera.rotateZ(THREE.MathUtils.clamp(-vl * .003, -.055, .055));
    camera.fov = THREE.MathUtils.lerp(camera.fov, Math.max(sideFov, 60) + (reducedMotion ? 5 : Math.min(24, speed * .36) * (portrait ? .4 : 1)), 1 - Math.exp(-3 * dt));
  }
  streaks.material.opacity = mode === 'playing' && !reducedMotion ? Math.max(0, Math.min(.24, (Math.hypot(player.vx, player.vy, player.vz) - 28) / 180)) : 0;
  if (shake > 0) { shakeOffset.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(shake * shake); camera.position.add(shakeOffset); shake = Math.max(0, shake - dt * 2); }
  camera.updateProjectionMatrix(); sky.position.copy(camera.position); stars.position.copy(camera.position);
  tmp.fromArray(env.sunDir).normalize().multiplyScalar(620);
  sun.position.copy(camera.position).add(tmp); sun.quaternion.copy(camera.quaternion); glow.position.copy(sun.position).addScaledVector(tmp, .002); glow.quaternion.copy(camera.quaternion);
  const focusS = mode === 'menu' ? 80 : player.s, f = frameAt(track, focusS), [lx, ly, lz] = env.lightOffset;
  const fx = mode === 'menu' ? f.x : player.x, fz = mode === 'menu' ? f.z : player.z;
  sunLight.position.set(fx + lx, (mode === 'menu' ? f.y : player.y) + ly, fz + lz); sunLight.target.position.set(fx, f.y + 15, fz);
}
const particleOffset = new THREE.Vector3();
function updateParticles(dt) {
  if (!particles) return;
  const p = ENVIRONMENTS[particleTheme].particles, arr = particleGeo.attributes.position.array, t = worldTime, half = PARTICLE_BOX / 2;
  particleOffset.x += p.drift[0] * dt; particleOffset.y -= p.fall * dt; particleOffset.z += p.drift[2] * dt;
  const dx = particleOffset.x, dy = particleOffset.y, dz = particleOffset.z, cx = camera.position.x - half, cy = camera.position.y - half, cz = camera.position.z - half;
  for (let i = 0; i < arr.length; i += 3) {
    const sway = Math.sin(t * .7 + i) * 1.5;
    arr[i] = cx + (((particleBase[i] + dx + sway - cx) % PARTICLE_BOX) + PARTICLE_BOX) % PARTICLE_BOX;
    arr[i + 1] = cy + (((particleBase[i + 1] + dy - cy) % PARTICLE_BOX) + PARTICLE_BOX) % PARTICLE_BOX;
    arr[i + 2] = cz + (((particleBase[i + 2] + dz - cz) % PARTICLE_BOX) + PARTICLE_BOX) % PARTICLE_BOX;
  }
  particleGeo.attributes.position.needsUpdate = true;
}
let hudClock = 0;
function updateHud(dt) {
  hudClock += dt; if (hudClock < .05) return; hudClock = 0;
  setDistance($('#distance'), runDistance);
  if (runDistance > best && best > 0 && !$('#hud-best').classList.contains('beaten')) { $('#hud-best').classList.add('beaten'); $('#hud-best').textContent = tr('최고 기록 갱신 중!', 'NEW BEST!'); navigator.vibrate?.(mobile ? [20, 40, 20] : 0); chime(2); }
  $('#speed').textContent = Math.round(Math.hypot(player.vx, player.vy, player.vz) * 3.6);
  for (const side of ['left', 'right']) {
    const hooked = !!player.hooks[side], waiting = held(side) && !hooked, el = $(`#${side}-hook-state`);
    el.classList.toggle('connected', hooked); el.classList.toggle('waiting', waiting);
  }
  const near = world.nearest(player.x, player.y, player.z, 6.6), warn = $('#wall-warning');
  warn.hidden = !near;
  if (near) { const { hx, hz } = headingOf(player), right = (near.x - player.x) * -hz + (near.z - player.z) * hx > 0; warn.textContent = right ? tr('충돌 주의 ▶', 'WATCH OUT ▶') : tr('◀ 충돌 주의', '◀ WATCH OUT'); warn.classList.toggle('right', right); warn.classList.toggle('left', !right); warn.classList.toggle('danger', near.distance < 3.1); }
  $('#meter-fill').style.background = player.releaseReady ? '#9affd0' : ''; $('#meter-fill').style.width = (player.tension * 100) + '%';
}
function announceDistrict() {
  const index = districtIndexAt(Math.max(0, player.s));
  if (index === districtShown) return;
  districtShown = index;
  const info = THEME_INFO[districtAt(index).theme], no = `DISTRICT ${String(index + 1).padStart(2, '0')}`;
  $('#zone-no').textContent = no; $('#zone-name').textContent = info.name;
  if (index > 0) { toast(`${no}\n${info.name}`, 2.4); chime(2); }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, .1); last = now;
  if (mode !== 'paused') worldTime += dt;
  if (mode === 'countdown') {
    countdown -= dt; $('#countdown').textContent = Math.max(1, Math.ceil(countdown));
    if (countdown <= 0) { mode = 'playing'; hide('#countdown'); toast(mobile ? tr('GO! 화면을 눌러 훅을 걸어요', 'GO! Hold the screen to hook') : tr('GO! A / D로 훅을 걸어요', 'GO! Hook with A / D'), 2); chime(); }
  }
  if (mode === 'playing') {
    accumulator += dt;
    const input = { leftHook: held('left'), rightHook: held('right') };
    while (accumulator >= 1 / 120 && mode === 'playing') {
      const event = step(player, input, 1 / 120, world); accumulator -= 1 / 120;
      runDistance = Math.max(runDistance, player.s);
      if (player.attached) {
        navigator.vibrate?.(mobile ? 12 : 0); cueRunner(runner, 'catch'); hookFlash = 1; const a = (player.hooks.right || player.hooks.left).anchor; hookPulse.position.set(a.x, a.y, a.z);
        if (tutorial) touchLayer.classList.remove('hint');
      }
      if (player.released && !player.anchor) cueRunner(runner, 'release');
      if (player.releaseReady && !seenRelease) { seenRelease = true; if (tutorial) { toast(tr('지금 손을 떼면 멀리 날아가요!', 'Let go now to fly far!'), 1.8); tutorial = false; write('skyhook.app.tutorial', 'done'); } }
      if (event === 'dead') die();
    }
    track.ensure(player.s + 2000).focus(player.s);
    announceDistrict();
  }
  if (mode === 'dying') {
    deathTimer -= dt; $('#flash').style.opacity = Math.max(0, (deathTimer - 1) * 1.2);
    if (deathTimer <= 0) showResult();
  }
  if (mode !== 'paused') {
    const s = mode === 'menu' ? 0 : player.s;
    syncChunks(Math.max(0, s)); applyEnvironment(Math.max(0, s));
    if (hero.visible) updateHero(dt);
    updateCamera(dt); updateParticles(dt); burst.update(dt, camera);
    sky.material.uniforms.time.value = worldTime;
    hookFlash = Math.max(0, hookFlash - dt * 2.5); hookPulse.visible = mode === 'playing' && hookFlash > 0; hookPulse.material.opacity = hookFlash; hookPulse.scale.setScalar(1 + (1 - hookFlash) * 3); hookPulse.quaternion.copy(camera.quaternion);
    for (const c of chunks.values()) {
      c.update(dt, worldTime);
      for (const m of c.markers) { m.mesh.rotation.y = worldTime; m.mesh.scale.setScalar(player.hooks.left?.anchor === m.anchor || player.hooks.right?.anchor === m.anchor ? 1.8 : 1); }
    }
  }
  if (['playing', 'countdown'].includes(mode)) updateHud(dt);
  if (worldTime > toastUntil) $('#toast').style.opacity = 0;
  renderer.render(scene, camera);
}
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setPixelRatio(pixelRatio()); renderer.setSize(innerWidth, innerHeight, false); });
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); pause(); $('#loading').textContent = tr('3D 화면 연결이 끊겼습니다. 앱을 다시 열어 주세요.', 'Lost the 3D display. Please reopen the app.'); show('#loading'); });

resetWorld(Math.floor(Math.random() * 2147483000));
setDistance($('#menu-best'), best);
applyEnvironment(0);
hide('#loading'); requestAnimationFrame(frame);
// Dev server only: lets scripts read the run state.
if (import.meta.env?.DEV) window.__skyhookApp = { state: () => ({ mode, player, track, chunks, runDistance, best }), burst, hero };
