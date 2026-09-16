import * as THREE from 'three';
import { createRunner, animateRunner, cueRunner, resetRunner } from './runner.js';
import './style.css';
import 'virtual:skyhook-fonts';
import { MAPS } from './maps.js';
import { COURSES, createPlayer, step, formatTime, cleanRecords, frameAt, headingOf, locate } from './physics.js';
import { buildWorld } from './worlds.js';
import { fetchBoard, submitRun, describeError } from './leaderboard.js';
import { t as tr, localizeMaps } from './i18n.js';
import { adblockActive } from './adblock.js';
import { PLATFORM, ready, store, gameplayStart, gameplayStop, loadingStart, loadingStop, happytime, midgameAd, rewardedAd, playerName, onMuteSetting } from './platform.js';
localizeMaps(MAPS);
import './ads.js';

const $ = s => document.querySelector(s);
const canvas = $('#world');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (error) { $('#loading').textContent = tr('3D 화면을 열 수 없습니다. 브라우저의 하드웨어 가속을 켜고 다시 열어 주세요.', 'Could not start 3D. Turn on hardware acceleration in your browser and reload.'); throw error; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
// The canvas is sized by CSS (full screen, or between the side ads); the renderer follows its box.
const viewSize = () => [canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight];
renderer.setSize(...viewSize(), false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#c89490', .0021);
const camera = new THREE.PerspectiveCamera(59, viewSize()[0] / viewSize()[1], .2, 1750);
const hemiLight = new THREE.HemisphereLight('#ffcca4', '#6a668f', 2.9); scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight('#ffb474', 3.2);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 1, far: 520 });
sunLight.shadow.normalBias = .25;
scene.add(sunLight, sunLight.target);
// Gradient sky with optional animated aurora curtains for night maps.
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
})); const rope = ropes.right;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const streakPositions = [];
for (let i = 0; i < 24; i++) { const angle = i / 24 * Math.PI * 2, x = Math.cos(angle) * 12, y = Math.sin(angle) * 7; streakPositions.push(x, y, -18, x, y, -24 - Math.random() * 5); }
const streakGeometry = new THREE.BufferGeometry(); streakGeometry.setAttribute('position', new THREE.Float32BufferAttribute(streakPositions, 3));
const streaks = new THREE.LineSegments(streakGeometry, new THREE.LineBasicMaterial({ color: '#ffe1b5', transparent: true, opacity: 0, depthWrite: false })); camera.add(streaks); scene.add(camera);
const hookPulse = new THREE.Mesh(new THREE.TorusGeometry(1.7, .09, 5, 24), new THREE.MeshBasicMaterial({ color: '#ffe0ad', transparent: true, opacity: 0, depthWrite: false })); scene.add(hookPulse);
let hookFlash = 0;
// Weather particles wrap around the camera so snow, dust or petals always fill the view.
const PARTICLE_BOX = 160, particleGeo = new THREE.BufferGeometry();
let particleBase = new Float32Array(0), particles = null;

let mapIndex = 0, map = MAPS[0], course = COURSES[map.id], world = null, env = null;
// Menu framing: sunset keeps its original street-side shot, curved maps look down the corridor.
const menuCamera = () => map.id === 'sunset' ? [-91, 58, 65, 165, -14, 43] : [-78, 16, 72, 150, -8, 44];
function worldPoint(s, lateral, y, out = new THREE.Vector3()) { const f = frameAt(course, s); return out.set(f.x + f.rx * lateral, f.y + y, f.z + f.rz * lateral); }
function applyEnvironment() {
  scene.fog.color.set(env.fog); scene.fog.density = env.fogDensity;
  hemiLight.color.set(env.hemiSky); hemiLight.groundColor.set(env.hemiGround); hemiLight.intensity = env.hemi;
  sunLight.color.set(env.sunColor); sunLight.intensity = env.sun;
  renderer.toneMappingExposure = env.exposure;
  const u = sky.material.uniforms; u.top.value.set(env.skyTop); u.middle.value.set(env.skyMiddle); u.bottom.value.set(env.skyBottom); u.aurora.value = env.aurora;
  sun.material.color.set(env.disc); sun.scale.setScalar(env.discSize); glow.material.color.set(env.glow); glow.material.opacity = env.glowOpacity; glow.scale.setScalar(env.discSize);
  stars.visible = !!env.stars; hookPulse.material.color.set(env.rope); streaks.material.color.set(env.rope);
  const p = env.particles;
  particleBase = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count * 3; i++) particleBase[i] = Math.random() * PARTICLE_BOX;
  particleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.count * 3), 3));
  if (particles) { scene.remove(particles); particles.material.dispose(); }
  particles = new THREE.Points(particleGeo, new THREE.PointsMaterial({ color: p.color, size: p.size, transparent: true, opacity: p.opacity, depthWrite: false }));
  particles.frustumCulled = false; scene.add(particles);
  document.documentElement.style.setProperty('--accent', map.accent);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', env.fog);
}
function loadMap(index) {
  mapIndex = (index + MAPS.length) % MAPS.length; map = MAPS[mapIndex]; course = COURSES[map.id];
  if (world) { scene.remove(world.root); world.dispose(); }
  world = buildWorld(map, course); env = world.env; scene.add(world.root);
  applyEnvironment(); loadRecords(); renderMapCard(); updateWorldInfo(); player = createPlayer(course);
  menuAnchor = course.anchors.find(a => a.side > 0 && a.s > 60) ?? course.anchors[0];
  const [cs, cl, cy, ls, ll, ly] = menuCamera(); worldPoint(cs, cl, cy, camera.position); camera.lookAt(worldPoint(ls, ll, ly)); worldPoint(48, 3, 52, hero.position);
  try { store.setItem('skyhook.selectedMap', map.id); } catch { }
}

let player = createPlayer(course), mode = 'menu', previousMode = 'playing', countdown = 3, accumulator = 0, last = performance.now(), worldTime = 0, toastUntil = 0, menuAnchor = null;
const keys = new Set(), touchKeys = new Map(); let records = [], storageWorks = true, savedLocal = false, submitted = false, runBest = Infinity;
function loadRecords() {
  try { records = cleanRecords(JSON.parse(store.getItem(map.recordKey) || '[]')); storageWorks = true; } catch { records = []; storageWorks = false; }
  refreshBest();
}
function refreshBest() { const best = records.length ? formatTime(records[0].time) : '--:--.---'; $('#best').textContent = best; $('#best-hud').textContent = 'BEST ' + best + (worldRecord ? tr(' · 1위 ', ' · #1 ') + formatTime(worldRecord) : ''); }
// Top-down route sketch generated from the real centerline.
function drawRoute(svg, c, width, height, detailed) {
  const pts = []; for (let s = -20; s <= c.length + 20; s += 10) { const f = frameAt(c, s); pts.push([f.x, f.z]); }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  pts.forEach(([x, z]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); });
  // Long straight courses read better rotated to run left-to-right like the original sketch.
  const rotate = maxZ - minZ > (maxX - minX) * 1.4, proj = ([x, z]) => rotate ? [-z, x] : [x, z];
  let a = Infinity, b = -Infinity, cMin = Infinity, d = -Infinity;
  pts.map(proj).forEach(([u, v]) => { a = Math.min(a, u); b = Math.max(b, u); cMin = Math.min(cMin, v); d = Math.max(d, v); });
  const margin = detailed ? 15 : 5, scale = Math.min((width - margin * 2) / Math.max(1, b - a), (height - margin * 1.6) / Math.max(1, d - cMin));
  const ox = width / 2 - (a + b) / 2 * scale, oy = height / 2 - (cMin + d) / 2 * scale;
  const toSvg = p => { const [u, v] = proj(p); return [(u * scale + ox).toFixed(1), (v * scale + oy).toFixed(1)]; };
  const path = pts.map((p, i) => (i ? 'L' : 'M') + toSvg(p).join(' ')).join('');
  svg.replaceChildren();
  const el = (tag, attrs) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) node.setAttribute(k, attrs[k]); svg.append(node); return node; };
  if (detailed) el('path', { d: path, class: 'map-route-shadow' });
  el('path', { d: path, class: 'map-route' });
  const [sx, sy] = toSvg(pts[2]), last = c.gates.at(-1), [fx, fy] = toSvg([last.x, last.z]);
  if (detailed) c.gates.slice(0, -1).forEach(g => { const [x, y] = toSvg([g.x, g.z]); el('circle', { cx: x, cy: y, r: 2.4, class: 'map-gate' }); });
  el('circle', { cx: sx, cy: sy, r: detailed ? 5 : 2.2, class: 'map-start' });
  el('circle', { cx: fx, cy: fy, r: detailed ? 4.5 : 2.2, class: 'map-finish' });
}
// Korean start label needs 로/으로 after the map name; English just says "Race <map>".
const withDirection = name => { const code = name.charCodeAt(name.length - 1) - 0xAC00, final = code >= 0 && code < 11172 ? code % 28 : 0; return name + (final === 0 || final === 8 ? '로' : '으로'); };
function storedBest(m) { try { return cleanRecords(JSON.parse(store.getItem(m.recordKey) || '[]'))[0]?.time; } catch { return undefined; } }
const starText = m => '★'.repeat(m.difficulty) + '☆'.repeat(Math.max(0, 3 - m.difficulty));
// In the CrazyGames Full Launch build (npm run build:crazygames:full) the last map is locked. It opens for good when the
// player watches one rewarded ad, or, without any ad (the portal requires a non-ad way), once every other map has been finished.
// Basic Launch has no ads, so that build and the own site lock nothing.
const LOCKED_MAPS = new Set(PLATFORM === 'crazygames' && import.meta.env?.VITE_MAP_LOCKS === 'on' ? ['jungle'] : []);
function flag(key) { try { return store.getItem(key) === '1'; } catch { return false; } }
// A map counts as finished once a run reached its goal (or a time for it was saved before this flag existed).
const isCleared = m => flag(`skyhook.cleared.${m.id}`) || storedBest(m) !== undefined;
const clearProgress = () => { const others = MAPS.filter(m => !LOCKED_MAPS.has(m.id)); return [others.filter(isCleared).length, others.length]; };
function isLocked(m) {
  if (!LOCKED_MAPS.has(m.id) || flag(`skyhook.unlocked.${m.id}`)) return false;
  const [done, total] = clearProgress();
  return done < total;
}
function renderMapCard() {
  $('#map-count').textContent = `${map.no} / ${pad(MAPS.length)}`; $('#map-total').textContent = pad(MAPS.length); $('#footer-map-count').textContent = pad(MAPS.length);
  $('#map-name').textContent = map.name; $('#map-en').textContent = map.en; $('#map-tagline').textContent = map.tagline; $('#map-trait').textContent = map.trait;
  $('#map-length').replaceChildren(document.createTextNode((course.length / 1000).toFixed(2)), Object.assign(document.createElement('span'), { textContent: ' km' }));
  $('#map-gates').replaceChildren(document.createTextNode(course.gates.length), Object.assign(document.createElement('span'), { textContent: ' GATES' }));
  $('#map-difficulty').replaceChildren(document.createTextNode('★'.repeat(map.difficulty)), Object.assign(document.createElement('span'), { textContent: ' ☆'.repeat(Math.max(0, 3 - map.difficulty)) }));
  drawRoute($('#map-svg'), course, 300, 120, true); $('#map-svg').setAttribute('aria-label', tr(`${map.name} 코스 약도`, `${map.name} route map`));
  $('#start-label').textContent = isLocked(map) ? tr('🔒 광고 보고 열기', '🔒 Unlock with an ad') : tr(`${withDirection(map.name)} 출발`, `Race ${map.name}`);
  $('#hud-district').textContent = 'DISTRICT ' + map.no; $('#hud-name').textContent = map.name;
  $('#result-course').textContent = map.name + tr(' · 완주 기록', ' · Finish time');
  $('#remaining').replaceChildren(document.createTextNode(course.length.toLocaleString() + ' '), Object.assign(document.createElement('small'), { textContent: 'm' }));
  mapTiles.forEach((tile, i) => tile.el.setAttribute('aria-selected', String(i === mapIndex)));
  refreshLocks();
}
function refreshLocks() {
  for (const t of mapTiles) { const locked = isLocked(t.map); t.el.classList.toggle('locked', locked); t.go.textContent = locked ? tr('🔒 열기', '🔒 Unlock') : tr('출발 ↗', 'Race ↗'); }
}

// Full map browser: a scrollable, searchable grid so the menu card stays one map tall however many maps exist.
const el = (tag, className, text) => Object.assign(document.createElement(tag), className ? { className } : {}, text !== undefined ? { textContent: text } : {});
const mapTiles = MAPS.map((m, i) => {
  const c = COURSES[m.id], tile = el('div', 'map-tile'); tile.setAttribute('role', 'option'); tile.style.setProperty('--tile-accent', m.accent);
  const pick = el('button', 'tile-pick'); pick.type = 'button'; pick.setAttribute('aria-label', tr(`${m.name} 선택`, `Select ${m.name}`));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 200 80'); svg.setAttribute('class', 'tile-route'); svg.setAttribute('aria-hidden', 'true'); drawRoute(svg, c, 200, 80, false);
  const head = el('span', 'tile-head'); head.append(el('span', 'tile-no', m.no), el('span', 'tile-stars', starText(m)));
  const title = el('span', 'tile-title'); title.append(el('strong', '', m.name), el('small', '', m.en));
  const facts = el('span', 'tile-facts', `${(c.length / 1000).toFixed(2)} km · ${c.gates.length} GATES`);
  const times = el('span', 'tile-times'); const mine = el('span', 'tile-best'), top = el('span', 'tile-world', tr('전체 1위 …', 'World #1 …')); times.append(mine, top);
  pick.append(svg, head, title, el('span', 'tile-trait', m.trait), facts, times);
  const go = el('button', 'tile-go', tr('출발 ↗', 'Race ↗')); go.type = 'button'; go.setAttribute('aria-label', tr(`${m.name} 바로 출발`, `Race ${m.name} now`));
  tile.append(pick, go); $('#map-grid').append(tile);
  pick.addEventListener('click', () => { closeBrowser(); if (i !== mapIndex) loadMap(i); $('#start').focus(); });
  go.addEventListener('click', () => { closeBrowser(); if (i !== mapIndex) loadMap(i); begin(); });
  return { el: tile, pick, go, map: m, mine, top, loaded: false };
});
const browserFilter = { text: '', difficulty: 0 };
function visibleTiles() { return mapTiles.filter(t => !t.el.hidden); }
function applyBrowserFilter() {
  const q = browserFilter.text.trim().toLowerCase();
  for (const t of mapTiles) {
    const m = t.map, matchText = !q || [m.name, m.en, m.trait, m.no].some(v => v.toLowerCase().includes(q));
    t.el.hidden = !(matchText && (!browserFilter.difficulty || m.difficulty === browserFilter.difficulty));
  }
  const count = visibleTiles().length;
  $('#browser-count').textContent = `${count} / ${MAPS.length}`; $('#map-grid-empty').classList.toggle('hidden', count > 0);
  document.querySelectorAll('[data-difficulty]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.difficulty) === browserFilter.difficulty)));
}
// Personal bests are local; world #1 is fetched only for tiles scrolled into view, so a long list stays cheap.
const tileObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) loadTileWorld(mapTiles.find(t => t.el === entry.target)); }), { root: $('#map-grid') }) : null;
function loadTileWorld(t, fresh = false) {
  if (!t || (t.loaded && !fresh)) return; t.loaded = true;
  fetchBoard(t.map.id, { fresh }).then(data => { const e = data.entries[0]; t.top.textContent = e ? tr(`전체 1위 ${formatTime(e.timeMs / 1000)}`, `World #1 ${formatTime(e.timeMs / 1000)}`) : tr('전체 1위 아직 없음', 'World #1 none yet'); })
    .catch(() => { t.loaded = false; t.top.textContent = tr('전체 랭킹 연결 안 됨', 'Leaderboard offline'); });
}
function openBrowser() {
  for (const t of mapTiles) { const best = t.map === map ? records[0]?.time : storedBest(t.map); t.mine.textContent = best ? tr(`내 기록 ${formatTime(best)}`, `My best ${formatTime(best)}`) : tr('내 기록 없음', 'No run yet'); }
  applyBrowserFilter(); show('#map-browser');
  if (tileObserver) mapTiles.forEach(t => tileObserver.observe(t.el)); else mapTiles.forEach(t => loadTileWorld(t));
  const selected = mapTiles[mapIndex]; (selected.el.hidden ? visibleTiles()[0] : selected)?.pick.focus(); selected.el.scrollIntoView({ block: 'nearest' });
}
function closeBrowser() { hide('#map-browser'); if (tileObserver) tileObserver.disconnect(); }
$('#map-browse').addEventListener('click', openBrowser);
$('#map-prev').addEventListener('click', () => loadMap(mapIndex - 1)); $('#map-next').addEventListener('click', () => loadMap(mapIndex + 1));
$('#map-search').addEventListener('input', e => { browserFilter.text = e.target.value; applyBrowserFilter(); });
document.querySelectorAll('[data-difficulty]').forEach(b => b.addEventListener('click', () => { browserFilter.difficulty = Number(b.dataset.difficulty); applyBrowserFilter(); }));
// Arrow keys walk the grid by its actual column count, so it works for any window width or number of maps.
$('#map-grid').addEventListener('keydown', e => {
  const tiles = visibleTiles(), index = tiles.findIndex(t => t.el.contains(document.activeElement));
  if (index < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  const columns = getComputedStyle($('#map-grid')).gridTemplateColumns.split(' ').length;
  const next = { ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - columns, ArrowDown: index + columns, Home: 0, End: tiles.length - 1 }[e.key];
  const target = tiles[Math.max(0, Math.min(tiles.length - 1, next))]; target.pick.focus(); target.el.scrollIntoView({ block: 'nearest' });
});function hide(id) { $(id).classList.add('hidden'); } function show(id) { $(id).classList.remove('hidden'); }
function clearInput() { keys.clear(); touchKeys.clear(); document.querySelectorAll('.touch-hook').forEach(b => b.dataset.push = ''); }
// A held touch pad presses its key, plus W or S while the thumb is slid up or down from where it landed.
function pressed(key) { return keys.has(key) || [...touchKeys.values()].some(t => t.key === key || t.push === key); }
function eventKey(e) { return e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase(); }
const pad = n => String(n).padStart(2, '0');
// A new run. On CrazyGames a midgame ad may play at this break (restart, next attempt) but never during a run;
// the SDK itself limits how often. The very first run starts straight away.
let runsStarted = 0, adBreak = false;
function begin() {
  if (adBreak) return;
  if (adblocked) { showAdblock(); return; }
  if (isLocked(map)) { openUnlock(); return; }
  if (PLATFORM !== 'crazygames' || runsStarted === 0) { startRun(); return; }
  adBreak = true; pause(); clearInput(); gameplayStop();
  midgameAd({ onStart: () => audioCtx?.suspend(), onEnd: wakeAudio }).then(() => { adBreak = false; startRun(); });
}
function startRun() {
  runsStarted++;
  clearInput(); player = createPlayer(course); resetRunner(runner); savedLocal = false; submitted = false; runBest = records[0]?.time ?? Infinity; accumulator = 0; mode = 'countdown'; countdown = 3;
  ['#menu', '#pause', '#result', '#records', '#help'].forEach(hide); show('#hud'); show('#countdown'); $('#countdown').textContent = '3'; document.body.classList.add('playing');
  world.gates.forEach(g => g.visible = true); worldPoint(-18, 0, 64, camera.position); camera.lookAt(worldPoint(60, 0, 57)); camForward.set(frameAt(course, 0).tx, 0, frameAt(course, 0).tz);
  $('#save-form button').disabled = false; $('#save-form button').textContent = tr('랭킹 등록', 'Submit'); $('#submit-status').textContent = '';
  toast(`${map.name}\n${map.trait}`, 3.5); wakeAudio(); gameplayStart();
}
function home() { gameplayStop(); mode = 'menu'; clearInput(); ['#hud', '#pause', '#result', '#countdown'].forEach(hide); $('#wall-warning').hidden = true; show('#menu'); document.body.classList.remove('playing'); world.gates.forEach(g => g.visible = true); refreshBest(); updateWorldInfo(); }
function pause() { if (!['playing', 'countdown'].includes(mode)) return; gameplayStop(); previousMode = mode; mode = 'paused'; clearInput(); hide('#countdown'); show('#pause'); }
function resume() { if (adBreak) return; gameplayStart(); mode = previousMode; clearInput(); hide('#pause'); if (mode === 'countdown') show('#countdown'); last = performance.now(); }
function finish() {
  gameplayStop(); if (player.time < runBest) happytime();
  const wasLocked = MAPS.filter(isLocked);
  try { store.setItem(`skyhook.cleared.${map.id}`, '1'); } catch { }
  const opened = wasLocked.filter(m => !isLocked(m));
  mode = 'result'; clearInput(); hide('#hud'); show('#result'); $('#final-time').textContent = formatTime(player.time);
  $('#result-eyebrow').textContent = player.time < runBest ? 'NEW PERSONAL BEST' : 'COURSE COMPLETE';
  $('#result-message').textContent = player.falls ? tr(`완주! 복귀 ${player.falls}회 · 추가 시간 ${player.falls * 3}초 포함`, `Finished! ${player.falls} reset${player.falls > 1 ? 's' : ''} · includes +${player.falls * 3}s penalty`) : tr('한 번의 추락도 없이 완주했어요.', 'A clean run with no resets.');
  if (opened.length) { refreshLocks(); $('#result-message').textContent += tr(` · 모든 맵 완주! ${opened.map(m => m.name).join(', ')} 해금`, ` · Every map finished! ${opened.map(m => m.name).join(', ')} unlocked`); }
  try { $('#nickname').value = store.getItem('skyhook.nickname') || $('#nickname').value; } catch { }
  $('#share-status').textContent = ''; $('#share-status').className = 'submit-status';
  boards.result.mapId = map.id; renderBoard('result'); chime(3);
}
function toast(text, seconds = 2) { $('#toast').textContent = text; toastUntil = worldTime + seconds; $('#toast').style.opacity = 1; }
function emptyNote(root, text) { root.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: text })); }
function rankRow(rank, name, time, { you = false } = {}) {
  const row = document.createElement('div'); row.className = 'rank-row' + (rank <= 3 ? ' podium podium-' + rank : '') + (you ? ' you' : '');
  const label = Object.assign(document.createElement('span'), { textContent: name });
  if (you) label.append(Object.assign(document.createElement('em'), { textContent: 'YOU' }));
  row.append(Object.assign(document.createElement('span'), { textContent: pad(rank) }), label, Object.assign(document.createElement('strong'), { textContent: formatTime(time) }));
  return row;
}
function localRecordsFor(m) { if (m === map) return records; try { return cleanRecords(JSON.parse(store.getItem(m.recordKey) || '[]')); } catch { return []; } }
// Two ranking panels (records dialog, result screen) share one renderer: global board or this browser's runs.
const boards = { records: { mapId: map.id, tab: 'global', token: 0, list: '#ranks', standing: '#records-standing', caption: '#records-course' }, result: { mapId: map.id, tab: 'global', token: 0, list: '#result-ranks', standing: '#result-standing' } };
async function renderBoard(key, { fresh = false } = {}) {
  const b = boards[key], m = MAPS.find(x => x.id === b.mapId), root = $(b.list), standing = $(b.standing), token = ++b.token;
  document.querySelectorAll(`.board-tabs[data-board="${key}"] [data-tab]`).forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === b.tab)));
  if (key === 'records') document.querySelectorAll('#board-maps button').forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.map === m.id)));
  if (b.caption) $(b.caption).textContent = b.tab === 'global' ? tr(`${m.name} · 모든 플레이어의 최고 기록`, `${m.name} · Best times from all players`) : tr(`${m.name} · 이 브라우저에 저장된 기록`, `${m.name} · Runs saved in this browser`);
  root.replaceChildren(); standing.textContent = '';
  if (b.tab === 'local') {
    const list = localRecordsFor(m);
    if (!list.length) emptyNote(root, tr('아직 기록이 없어요.\n첫 번째 완주 기록을 남겨보세요.', 'No runs yet.\nFinish the course to set your first time.'));
    list.forEach((r, i) => root.append(rankRow(i + 1, r.name, r.time)));
    return;
  }
  root.classList.add('loading'); emptyNote(root, tr('랭킹을 불러오는 중…', 'Loading leaderboard…'));
  try {
    const data = await fetchBoard(m.id, { fresh });
    if (token !== b.token) return;
    root.replaceChildren();
    if (!data.entries.length) emptyNote(root, tr('아직 아무도 완주하지 않았어요.\n첫 번째 1위가 되어 보세요.', 'Nobody has finished yet.\nBe the first #1.'));
    data.entries.forEach(e => root.append(rankRow(e.rank, e.name, e.timeMs / 1000, { you: e.you })));
    const you = data.you;
    standing.textContent = you ? tr(`내 순위 ${you.rank}위 · ${formatTime(you.timeMs / 1000)} · 참가 ${data.total}명`, `Your rank #${you.rank} · ${formatTime(you.timeMs / 1000)} · ${data.total} players`) : data.total ? tr(`참가 ${data.total}명 · 완주 후 랭킹에 등록해 보세요`, `${data.total} players · Finish a run to get ranked`) : '';
  } catch (error) {
    if (token !== b.token) return;
    root.replaceChildren(); emptyNote(root, `${describeError(error)}\n${tr('내 기록 탭에서 이 브라우저의 기록은 볼 수 있어요.', 'Your runs in this browser are under My runs.')}`);
  } finally { if (token === b.token) root.classList.remove('loading'); }
}
let worldToken = 0, worldRecord = null;
async function updateWorldInfo({ fresh = false } = {}) {
  const token = ++worldToken, id = map.id;
  worldRecord = null; $('#world-best').textContent = '--:--.---'; $('#world-best').classList.remove('muted'); $('#world-label').textContent = tr('전체 1위', 'World #1'); $('#best-label').textContent = 'MY BEST'; refreshBest();
  try {
    const data = await fetchBoard(id, { fresh });
    if (token !== worldToken) return;
    const top = data.entries[0];
    worldRecord = top ? top.timeMs / 1000 : null;
    $('#world-best').textContent = top ? formatTime(worldRecord) : tr('아직 없음', 'None yet'); $('#world-best').classList.toggle('muted', !top);
    $('#world-label').textContent = top ? tr(`전체 1위 · ${top.name}`, `World #1 · ${top.name}`) : tr('전체 1위', 'World #1');
    if (data.you) $('#best-label').textContent = tr(`MY BEST · ${data.you.rank}위/${data.total}명`, `MY BEST · #${data.you.rank} of ${data.total}`);
    refreshBest();
  } catch (error) { if (token === worldToken) { $('#world-best').textContent = error.code === 'not_configured' ? tr('랭킹 미설정', 'Not set up') : tr('랭킹 서버 연결 안 됨', 'Leaderboard offline'); $('#world-best').classList.add('muted'); } }
}
$('#start').addEventListener('click', begin); $('#again').addEventListener('click', begin); $('#restart-pause').addEventListener('click', begin); $('#resume').addEventListener('click', resume); $('#pause-button').addEventListener('click', pause);
document.querySelectorAll('.home-button').forEach(b => b.addEventListener('click', home));
MAPS.forEach(m => {
  const chip = Object.assign(document.createElement('button'), { type: 'button', textContent: m.name }); chip.dataset.map = m.id; chip.style.setProperty('--row-accent', m.accent);
  chip.addEventListener('click', () => { boards.records.mapId = m.id; renderBoard('records'); });
  $('#board-maps').append(chip);
});
document.querySelectorAll('.board-tabs').forEach(tabs => tabs.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]'); if (!tab) return;
  boards[tabs.dataset.board].tab = tab.dataset.tab; renderBoard(tabs.dataset.board);
}));
$('#records-toggle').addEventListener('click', () => { boards.records.mapId = map.id; renderBoard('records'); show('#records'); });
$('#help-open').addEventListener('click', () => show('#help')); $('#help-done').addEventListener('click', () => hide('#help'));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => hide('#' + b.dataset.close)));
// Ads pay for the own site, so a blocker holds the game at the menu until it is switched off. There is no close button.
let adblocked = false;
function showAdblock() { $('#adblock-status').textContent = ''; show('#adblock'); $('#adblock-recheck').focus(); }
async function checkAdblock() {
  adblocked = await adblockActive();
  if (adblocked) showAdblock();
  else hide('#adblock');
  return adblocked;
}
$('#adblock-recheck').addEventListener('click', async () => {
  const button = $('#adblock-recheck'); button.disabled = true; $('#adblock-status').textContent = tr('확인하는 중…', 'Checking…');
  const still = await checkAdblock();
  button.disabled = false;
  if (still) $('#adblock-status').textContent = tr('아직 광고 차단기가 켜져 있어요. 끄고 다시 확인해 주세요.', 'The ad blocker is still on. Turn it off and check again.');
});
$('#adblock-reload').addEventListener('click', () => location.reload());
const shareLink = () => { const url = new URL(location.href); url.search = `?map=${map.id}`; url.hash = ''; return url.toString(); };
function shareLine() { return tr(`SKYHOOK · ${map.name} ${formatTime(player.time)} · 이 기록 이길 수 있어?`, `SKYHOOK · ${map.name} ${formatTime(player.time)} · Can you beat this time?`); }
if (PLATFORM !== 'web') $('#share').hidden = true;
$('#share').addEventListener('click', async () => {
  const status = $('#share-status'), text = shareLine(), url = shareLink();
  status.className = 'submit-status';
  try {
    if (navigator.share) { await navigator.share({ title: 'SKYHOOK', text, url }); return; }
    await navigator.clipboard.writeText(`${text}
${url}`);
    status.classList.add('ok'); status.textContent = tr('기록과 링크를 복사했어요. 붙여넣기로 공유하세요.', 'Time and link copied. Paste it anywhere to share.');
  } catch (error) {
    if (error?.name === 'AbortError') return;  // the player closed the share sheet
    status.classList.add('error'); status.textContent = `${text} ${url}`;
  }
});
// Unlock dialog: watching is optional (the skip button looks the same), and nothing unlocks if the ad fails.
let unlocking = false;
function openUnlock() {
  $('#unlock-name').textContent = map.name;
  const [done, total] = clearProgress();
  $('#unlock-text').textContent = tr(`짧은 광고 하나를 보면 이 맵이 계속 열려 있어요. 광고 없이도 다른 맵 ${total}개를 모두 완주하면 열립니다. (완주 ${done} / ${total})`, `Watch one short ad to unlock this map for good. Or unlock it without ads by finishing all ${total} other maps. (${done} / ${total} finished)`);
  $('#unlock-status').textContent = ''; $('#unlock-watch').disabled = false; $('#unlock-other').disabled = false;
  closeBrowser(); show('#unlock'); $('#unlock-watch').focus();
}
function closeUnlock() { if (!unlocking) hide('#unlock'); }
$('#unlock-other').addEventListener('click', () => { closeUnlock(); openBrowser(); });
$('#unlock-watch').addEventListener('click', async () => {
  if (unlocking) return; unlocking = true; $('#unlock-watch').disabled = true; $('#unlock-other').disabled = true; $('#unlock-status').textContent = tr('광고를 불러오는 중…', 'Loading the ad…');
  const rewarded = await rewardedAd({ onStart: () => audioCtx?.suspend(), onEnd: wakeAudio });
  unlocking = false; $('#unlock-other').disabled = false;
  if (!rewarded) { $('#unlock-watch').disabled = false; $('#unlock-status').textContent = tr('광고를 불러오지 못해 열리지 않았어요. 잠시 후 다시 시도해 주세요.', 'The ad could not be shown, so the map stays locked. Please try again later.'); return; }
  try { store.setItem(`skyhook.unlocked.${map.id}`, '1'); } catch { }
  hide('#unlock'); renderMapCard(); happytime(); startRun();
});
$('#save-form').addEventListener('submit', async e => {
  e.preventDefault(); if (submitted || !player.done) return;
  const button = $('#save-form button'), status = $('#submit-status'), name = $('#nickname').value.trim() || 'PLAYER', run = { mapId: map.id, name, time: player.time, falls: player.falls };
  try { store.setItem('skyhook.nickname', name); } catch { }
  if (!savedLocal) {
    records = cleanRecords([...records, { name, time: player.time, falls: player.falls }]);
    try { store.setItem(map.recordKey, JSON.stringify(records)); storageWorks = true; } catch { storageWorks = false; }
    savedLocal = true; refreshBest();
  }
  button.disabled = true; button.textContent = tr('등록 중…', 'Submitting…'); status.className = 'submit-status'; status.textContent = tr('전체 랭킹에 등록하는 중…', 'Submitting to the world leaderboard…');
  try {
    const result = await submitRun(run), s = result.standing;
    submitted = true; button.textContent = tr('등록됨', 'Submitted');
    status.classList.add('ok');
    status.textContent = result.improved ? tr(`전체 ${s.rank}위 / ${s.total}명 · 이 맵 개인 최고 기록 갱신!`, `World #${s.rank} of ${s.total} · New personal best on this map!`) : tr(`등록 완료 · 내 최고 기록은 전체 ${s.rank}위 / ${s.total}명`, `Submitted · Your best is #${s.rank} of ${s.total}`);
    boards.result.tab = 'global'; renderBoard('result', { fresh: true }); updateWorldInfo();
  } catch (error) {
    button.disabled = false; button.textContent = tr('다시 등록', 'Retry'); status.classList.add('error');
    status.textContent = `${describeError(error)} ${tr('기록은 이 브라우저에 저장했어요.', 'Your time was saved in this browser.')}`;
    if (error.code === 'implausible_score') { button.disabled = true; button.textContent = tr('등록 불가', 'Not eligible'); }
    if (boards.result.tab === 'local') renderBoard('result');
  }
  if (!storageWorks) $('#result-message').textContent = tr('이 브라우저가 저장을 차단해 이번 실행 동안만 기록이 유지됩니다.', 'This browser blocks storage, so times are kept only until you close the page.');
});
window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) { if (eventKey(e) === 'escape' && e.target.id === 'map-search') closeBrowser(); return; }
  const k = eventKey(e);
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k) && ['playing', 'countdown', 'paused'].includes(mode)) e.preventDefault();
  if (k === 'escape') { if (mode === 'paused') resume(); else if (['playing', 'countdown'].includes(mode)) pause(); else { hide('#help'); hide('#records'); closeUnlock(); closeBrowser(); } return; }
  if (adblocked) return;
  if (k === 'r' && !e.repeat && ['playing', 'paused', 'countdown'].includes(mode)) { begin(); return; }
  if (mode === 'menu' && (!$('#map-browser').classList.contains('hidden') || !$('#unlock').classList.contains('hidden'))) return;
  if (mode === 'menu' && $('#records').classList.contains('hidden') && $('#help').classList.contains('hidden')) {
    if (k === 'm' && !e.repeat) { openBrowser(); return; }
    if (k === 'enter' && document.activeElement === document.body) { begin(); return; }
    if (k === 'arrowleft') { e.preventDefault(); loadMap(mapIndex - 1); return; }
    if (k === 'arrowright') { e.preventDefault(); loadMap(mapIndex + 1); return; }
  }
  keys.add(k);
});
window.addEventListener('keyup', e => keys.delete(eventKey(e)));
window.addEventListener('blur', () => { clearInput(); pause(); }); document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
// Touch layout shows on touch screens; typing a game key switches back to the keyboard hints.
const coarsePointer = matchMedia('(pointer: coarse)');
const isTouch = () => document.body.classList.contains('touch');
document.body.classList.toggle('touch', coarsePointer.matches);
window.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') document.body.classList.add('touch'); }, { capture: true });
window.addEventListener('keydown', e => { if (!e.repeat && ['a', 'd', 'w', 's'].includes(eventKey(e)) && !(e.target instanceof HTMLInputElement)) document.body.classList.remove('touch'); }, { capture: true });
const PUSH_SLIDE = 28;
for (const b of document.querySelectorAll('[data-key]')) {
  const isPad = b.classList.contains('touch-hook');
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); touchKeys.set(e.pointerId, { key: b.dataset.key, y: e.clientY, push: null }); });
  if (isPad) b.addEventListener('pointermove', e => { const t = touchKeys.get(e.pointerId); if (!t) return; const dy = e.clientY - t.y; t.push = dy < -PUSH_SLIDE ? 'w' : dy > PUSH_SLIDE ? 's' : null; b.dataset.push = t.push ?? ''; });
  const end = e => { touchKeys.delete(e.pointerId); if (isPad) b.dataset.push = ''; };
  b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end); b.addEventListener('lostpointercapture', end); b.addEventListener('contextmenu', e => e.preventDefault());
}
let audioCtx = null, soundOn = false;
function wakeAudio() { if (soundOn) { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume().catch(() => { }); } }
function chime(level = 1) { if (!soundOn || !audioCtx) return; for (let i = 0; i < level; i++) { const osc = audioCtx.createOscillator(), gain = audioCtx.createGain(); osc.type = 'sine'; osc.frequency.value = 440 * Math.pow(1.25, i); gain.gain.setValueAtTime(0, audioCtx.currentTime); gain.gain.linearRampToValueAtTime(.08, audioCtx.currentTime + .015 + i * .1); gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + .35 + i * .1); osc.connect(gain).connect(audioCtx.destination); osc.start(audioCtx.currentTime + i * .1); osc.stop(audioCtx.currentTime + .4 + i * .1); } }
$('#sound').addEventListener('click', () => { soundOn = !soundOn; $('#sound').textContent = soundOn ? tr('소리 ON', 'SOUND ON') : tr('소리 OFF', 'SOUND OFF'); $('#sound').setAttribute('aria-label', soundOn ? tr('사운드 끄기', 'Mute sound') : tr('사운드 켜기', 'Turn sound on')); wakeAudio(); chime(); });

const heroTarget = new THREE.Vector3(), camTarget = new THREE.Vector3(), lookTarget = new THREE.Vector3(), camForward = new THREE.Vector3(0, 0, -1), tmp = new THREE.Vector3();
function updateHero(dt) {
  const t = worldTime;
  if (mode === 'menu') {
    const phase = t * .65, swing = Math.sin(phase);
    worldPoint(48 - swing * 6, 3 + swing * 3, 52 - Math.cos(phase * 2) * 2, hero.position); hero.scale.setScalar(1.75);
    const f = frameAt(course, 48); hero.rotation.y = f.heading;
    animateRunner(runner, { x: 0, vx: Math.cos(phase) * 7, vy: Math.sin(phase * 2) * 18, vz: -30, anchor: { x: 26 }, tension: .7 }, dt, t, { menu: true });
    hero.rotation.y += f.heading;
    cableOutlet.getWorldPosition(cableOrigin); setRope(cableOrigin.x, cableOrigin.y, cableOrigin.z, menuAnchor.x, menuAnchor.y, menuAnchor.z); rope.visible = true; ropes.left.visible = false; rope.material.color.set(env.rope);
  } else {
    heroTarget.set(player.x, player.y, player.z); hero.position.lerp(heroTarget, 1 - Math.exp(-24 * dt)); hero.scale.setScalar(1.2);
    // The rig animates relative to where the runner is actually flying (not the course line).
    const { hx, hz } = headingOf(player), rx = -hz, rz = hx, vf = player.vx * hx + player.vz * hz;
    const anchor = player.anchor ? { x: (player.anchor.x - player.x) * rx + (player.anchor.z - player.z) * rz } : null;
    animateRunner(runner, { x: 0, vx: 0, vy: player.vy, vz: -vf, anchor, hooks: player.hooks, tension: player.tension }, dt, t, { ready: mode === 'countdown' });
    hero.rotation.y += Math.atan2(-hx, -hz);
    for (const side of ['left', 'right']) {
      const hook = player.hooks[side], line = ropes[side]; line.visible = !!hook;
      if (hook) { const a = hook.anchor; runner.cableOutlets[side].getWorldPosition(cableOrigin); setRope(cableOrigin.x, cableOrigin.y, cableOrigin.z, a.x, a.y, a.z, line); line.material.color.set(player.releaseReady ? '#9affd0' : side === 'left' ? '#9be2e4' : env.rope); }
    }
  }
}
function setRope(x, y, z, ax, ay, az, line = rope) { line.geometry.attributes.position.array.set([x, y, z, ax, ay, az]); line.geometry.attributes.position.needsUpdate = true; }
function updateCamera(dt) {
  if (mode === 'menu') {
    const t = worldTime * .085;
    const [cs, cl, cy, ls, ll, ly] = menuCamera(); worldPoint(cs + Math.cos(t) * 4, cl + Math.sin(t) * 5, cy + Math.cos(t) * 2, camTarget); worldPoint(ls, ll, ly, lookTarget);
    camera.position.lerp(camTarget, 1 - Math.exp(-2 * dt)); camera.lookAt(lookTarget); camera.fov = 53;
  } else {
    // Chase camera sits behind the runner's own travel direction; it never swings to follow the course.
    const { hx, hz } = headingOf(player), speed = Math.hypot(player.vx, player.vy, player.vz);
    tmp.set(hx, 0, hz); camForward.lerp(tmp, 1 - Math.exp(-4 * dt)).normalize();
    // A phone held upright sees a very narrow slice sideways at the desktop FOV, hiding the hook points:
    // widen the view (and pull back a little) until about 50° of the sides are visible.
    const portrait = camera.aspect < 1, sideFov = portrait ? Math.min(92, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(25)) / camera.aspect))) : 60;
    const back = (17 + Math.min(8, speed * .11)) * (portrait ? 1.15 : 1);
    camTarget.set(player.x - camForward.x * back, player.y + 7, player.z - camForward.z * back);
    const horizontal = 1 - Math.exp(-7 * dt);
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, camTarget.x, horizontal);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, camTarget.y, 1 - Math.exp(-(reducedMotion ? 7 : 2.8) * dt));
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, camTarget.z, horizontal);
    // Sideways slip relative to where the camera points, used only for a slight roll.
    const vl = player.vx * -camForward.z + player.vz * camForward.x;
    lookTarget.set(player.x + camForward.x * 35, player.y + 1 + (reducedMotion ? 0 : player.vy * .24), player.z + camForward.z * 35); camera.lookAt(lookTarget);
    if (!reducedMotion) camera.rotateZ(THREE.MathUtils.clamp(-vl * .003, -.055, .055));
    camera.fov = THREE.MathUtils.lerp(camera.fov, Math.max(sideFov, 60) + (reducedMotion ? 5 : Math.min(24, speed * .36) * (portrait ? .4 : 1)), 1 - Math.exp(-3 * dt));
  }
  streaks.material.opacity = mode === 'playing' && !reducedMotion ? Math.max(0, Math.min(.24, (Math.hypot(player.vx, player.vy, player.vz) - 28) / 180)) : 0;
  camera.updateProjectionMatrix(); sky.position.copy(camera.position); stars.position.copy(camera.position);
  tmp.fromArray(env.sunDir).normalize().multiplyScalar(620);
  sun.position.copy(camera.position).add(tmp); sun.quaternion.copy(camera.quaternion); glow.position.copy(sun.position).addScaledVector(tmp, .002); glow.quaternion.copy(camera.quaternion);
  const focus = mode === 'menu' ? worldPoint(80, 0, 0, tmp) : tmp.set(player.x, player.y, player.z);
  const [lx, ly, lz] = env.lightOffset;
  sunLight.position.set(focus.x + lx, (mode === 'menu' ? frameAt(course, 80).y : player.y) + ly, focus.z + lz); sunLight.target.position.set(focus.x, (mode === 'menu' ? frameAt(course, 80).y : player.ground) + 15, focus.z);
}
const particleOffset = new THREE.Vector3();
function updateParticles(dt) {
  if (!particles) return;
  const p = env.particles, arr = particleGeo.attributes.position.array, t = worldTime, half = PARTICLE_BOX / 2;
  // Snow visibly follows the same crosswind gusts that push the runner.
  const gust = p.wind && course.wind ? Math.sin((mode === 'menu' ? t : player.windPhase) * Math.PI * 2 / course.wind.period) * course.wind.strength * 3 : 0;
  const f = frameAt(course, mode === 'menu' ? 0 : player.s);
  particleOffset.x += (p.drift[0] + gust * f.rx) * dt; particleOffset.y -= p.fall * dt; particleOffset.z += (p.drift[2] + gust * f.rz) * dt;
  const dx = particleOffset.x, dy = particleOffset.y, dz = particleOffset.z;
  const cx = camera.position.x - half, cy = camera.position.y - half, cz = camera.position.z - half;
  for (let i = 0; i < arr.length; i += 3) {
    const sway = Math.sin(t * .7 + i) * 1.5;
    arr[i] = cx + (((particleBase[i] + dx + sway - cx) % PARTICLE_BOX) + PARTICLE_BOX) % PARTICLE_BOX;
    arr[i + 1] = cy + (((particleBase[i + 1] + dy - cy) % PARTICLE_BOX) + PARTICLE_BOX) % PARTICLE_BOX;
    arr[i + 2] = cz + (((particleBase[i + 2] + dz - cz) % PARTICLE_BOX) + PARTICLE_BOX) % PARTICLE_BOX;
  }
  particleGeo.attributes.position.needsUpdate = true;
}
let hudClock = 0;
function updateHookIndicators() {
  for (const [side, key] of [['left', 'a'], ['right', 'd']]) {
    const hooked = !!player.hooks[side], waiting = pressed(key) && !hooked;
    const indicator = $('#' + side + '-hook-state'); indicator.classList.toggle('connected', hooked); indicator.classList.toggle('waiting', waiting);
    indicator.title = hooked ? tr('연결됨 · 키를 떼면 해제', 'Hooked · release the key to let go') : waiting ? tr('앞쪽 연결점 찾는 중', 'Looking for a hook point ahead') : tr('키를 눌러 연결', 'Hold the key to hook');
    const button = document.querySelector('[data-key="' + key + '"]'); button.classList.toggle('connected', hooked); button.setAttribute('aria-pressed', String(pressed(key)));
  }
  for (const key of ['w', 's']) document.querySelector('[data-key="' + key + '"]').setAttribute('aria-pressed', String(pressed(key)));
}
function updateHud(dt) {
  hudClock += dt; if (hudClock < .04) return; hudClock = 0;
  const total = course.gates.length;
  $('#timer').textContent = formatTime(player.time); $('#speed').textContent = Math.round(Math.hypot(player.vx, player.vy, player.vz) * 3.6);
  $('#gate-count').textContent = `GATE ${pad(Math.min(total, player.gate + 1))} / ${pad(total)}`;
  $('#remaining').replaceChildren(document.createTextNode(Math.max(0, Math.round(course.length - player.s)).toLocaleString() + ' '), Object.assign(document.createElement('small'), { textContent: 'm' }));
  const next = course.gates[player.gate]; $('#distance').textContent = next ? Math.max(0, Math.round(next.s - player.s)) + ' m' : 'FINISH';
  // Warn about the nearest real object (building, rock, tree...), on the side where it actually is.
  const near = world.collider.nearest(player.x, player.y, player.z, 6.6), warn = $('#wall-warning');
  warn.hidden = !near; if (near) { const { hx, hz } = headingOf(player), right = (near.x - player.x) * -hz + (near.z - player.z) * hx > 0; warn.textContent = right ? tr('충돌 주의 ▶', 'WATCH OUT ▶') : tr('◀ 충돌 주의', '◀ WATCH OUT'); warn.classList.toggle('right', right); warn.classList.toggle('danger', near.distance < 3.1); }
  $('#progress-fill').style.width = Math.max(0, Math.min(100, player.s / course.length * 100)) + '%';
  $('#web-status').textContent = player.releaseReady ? tr('지금 놓기!  ↗', 'RELEASE NOW!  ↗') : player.anchor ? (player.vy < 0 ? tr('하강 · 속도를 모으는 중', 'Swinging down · building speed') : player.forwardSpeed < 0 ? tr('다시 누르면 앞쪽 연결점에 연결', 'Press again to hook a point ahead') : tr('상승 중 · 조금 더 기다리기', 'Rising · wait a little longer')) : isTouch() ? tr('공중 비행 · 훅 패드를 눌러 연결', 'Flying · hold a hook pad') : tr('공중 비행 · A / D로 연결', 'Flying · hook with A / D');
  $('#web-status').style.color = player.releaseReady ? '#9affd0' : ''; $('#web-meter-fill').style.background = player.releaseReady ? '#9affd0' : ''; $('#web-meter-fill').style.width = (player.tension * 100) + '%';
}
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = (now - last) / 1000, dt = Math.min(elapsed, .1); last = now;
  // A dropped frame may slow simulation, but must never award a faster race time.
  if (mode === 'playing') player.time += Math.max(0, elapsed - dt);
  if (mode !== 'paused') worldTime += dt;
  if (mode === 'countdown') {
    countdown -= dt; $('#countdown').textContent = Math.max(1, Math.ceil(countdown));
    if (countdown <= 0) { mode = 'playing'; hide('#countdown'); toast(isTouch() ? tr('GO! 양쪽 패드로 훅을 걸어.', 'GO! Hook with the pads.') : tr('GO! A / D로 훅을 걸어.', 'GO! Hook with A / D.'), 2); chime(); }
  }
  if (mode === 'playing') {
    accumulator += dt;
    const input = { leftHook: pressed('a') || pressed('arrowleft'), rightHook: pressed('d') || pressed('arrowright'), forward: pressed('w') || pressed('arrowup'), back: pressed('s') || pressed('arrowdown') };
    while (accumulator >= 1 / 120 && mode === 'playing') {
      const event = step(player, input, 1 / 120, world.collider); accumulator -= 1 / 120;
      if (player.attached) { if (isTouch()) navigator.vibrate?.(12); cueRunner(runner, 'catch'); hookFlash = 1; const a = (player.hooks.right || player.hooks.left).anchor; hookPulse.position.set(a.x, a.y, a.z); }
      if (player.released && !player.anchor) cueRunner(runner, 'release');
      if (event === 'gate') { world.gates[player.gate - 1].visible = false; toast(`CHECKPOINT ${pad(player.gate)}  /  ${pad(course.gates.length)}`, 1.7); chime(); }
      if (event === 'recover') { resetRunner(runner); hero.position.set(player.x, player.y, player.z); const f = frameAt(course, player.s); camForward.set(f.tx, 0, f.tz); camera.position.set(player.x - f.tx * 23, player.y + 7, player.z - f.tz * 23); toast(`${({ obstacle: tr('부딪혔어요', 'Crashed'), missed: tr('게이트를 놓쳤어요', 'Missed the gate') })[player.recoverReason] ?? tr('추락', 'Fell')} · ${tr('마지막 체크포인트로 복귀 · +3초', 'back to last checkpoint · +3s')}`, 2.5); }
      if (event === 'finish') { world.gates.at(-1).visible = false; finish(); }
    }
  }
  if (mode !== 'paused') {
    updateHero(dt); updateCamera(dt); updateParticles(dt);
    sky.material.uniforms.time.value = worldTime;
    hookFlash = Math.max(0, hookFlash - dt * 2.5); hookPulse.visible = mode === 'playing' && hookFlash > 0; hookPulse.material.opacity = hookFlash; hookPulse.scale.setScalar(1 + (1 - hookFlash) * 3); hookPulse.quaternion.copy(camera.quaternion);
    world.update(dt, worldTime);
    world.anchorMarkers.forEach((m, i) => { m.rotation.y = worldTime; const current = Object.values(player.hooks).some(h => h?.anchor === course.anchors[i]); m.scale.setScalar(current ? 1.8 : 1); });
  }
  if (['playing', 'countdown'].includes(mode)) { updateHud(dt); updateHookIndicators(); }
  if (worldTime > toastUntil) $('#toast').style.opacity = 0;
  renderer.render(scene, camera);
}
window.addEventListener('resize', () => { const [w, h] = viewSize(); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7)); });
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); pause(); $('#loading').textContent = tr('3D 화면 연결이 끊겼습니다. 페이지를 새로고침해 주세요.', 'Lost the 3D display. Please reload the page.'); show('#loading'); });
// Wait for the portal SDK (instant on the own site) so saved records and settings come from the right storage.
await ready; loadingStart();
let initial = 0;
try { initial = Math.max(0, MAPS.findIndex(m => m.id === store.getItem('skyhook.selectedMap'))); } catch { }
const shared = MAPS.findIndex(m => m.id === new URLSearchParams(location.search).get('map'));
if (shared >= 0) initial = shared;
loadMap(initial);
hide('#loading'); requestAnimationFrame(frame); loadingStop();
// Dev server only (stripped from builds): lets capture scripts read the run, e.g. to autopilot trailer footage.
if (import.meta.env.DEV) window.__skyhook = { state: () => ({ mode, player, course }), locate };
onMuteSetting(muted => { if (muted && soundOn) $('#sound').click(); $('#sound').disabled = muted; });
playerName().then(name => { try { if (name && !store.getItem('skyhook.nickname')) $('#nickname').value = name.slice(0, 16); } catch { } });
// CrazyGames players land directly in a run on the map they last had selected; the menu is one pause away.
if (PLATFORM === 'crazygames') { if (isLocked(map)) loadMap(0); startRun(); }
else checkAdblock();
