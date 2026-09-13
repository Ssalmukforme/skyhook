// Client for the global leaderboard API in /server. Every call fails soft: the game keeps
// local records when the server is unreachable.
const BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '');
const CACHE_MS = 20_000;
const cache = new Map();

function randomUuid() {
  // crypto.randomUUID is missing on plain-http origins, which a self-hosted server may use.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
let sessionId = null;
export function playerId() {
  try {
    let id = localStorage.getItem('skyhook.playerId');
    if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) { id = randomUuid(); localStorage.setItem('skyhook.playerId', id); }
    return id;
  } catch { return sessionId ??= randomUuid(); }
}

async function request(path, { method = 'GET', body } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(BASE + path, { method, signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-Player-Id': playerId() }, body: body && JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.error ?? `HTTP ${res.status}`), { status: res.status, code: data?.error ?? 'server_error' });
    return data;
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('offline'), { status: 0, code: 'offline' });
  } finally { clearTimeout(timer); }
}

export function fetchBoard(mapId, { fresh = false } = {}) {
  const hit = cache.get(mapId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = request(`/api/maps/${encodeURIComponent(mapId)}/leaderboard?limit=20`);
  cache.set(mapId, { at: Date.now(), promise });
  promise.catch(() => cache.delete(mapId));
  return promise;
}
export function cachedBoard(mapId) { return cache.get(mapId)?.promise ?? null; }

export async function submitRun({ mapId, name, time, falls }) {
  const result = await request('/api/runs', { method: 'POST', body: { mapId, name, time, falls, playerId: playerId() } });
  cache.delete(mapId);
  return result;
}

export function describeError(error) {
  if (error?.code === 'rate_limited') return '잠시 후 다시 시도해 주세요.';
  if (error?.code === 'implausible_time') return '기록을 확인할 수 없어 랭킹에 등록되지 않았어요.';
  if (error?.code === 'invalid_name') return '이름을 확인해 주세요.';
  return '랭킹 서버에 연결할 수 없어요.';
}
