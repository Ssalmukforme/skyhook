// Global leaderboard in the shared ssalmuk_ranking Supabase project (supabase/migrations): this game is
// skyhook and each map is a board. Every call fails soft: local records keep working without Supabase.
const URL_ = import.meta.env?.VITE_SUPABASE_URL;
const KEY = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env?.VITE_SUPABASE_ANON_KEY;
const GAME_ID = 'skyhook';
const CACHE_MS = 20_000;
const cache = new Map();
let clientPromise = null;

export const leaderboardConfigured = Boolean(URL_ && KEY);

// Loaded on first use so the game's first paint doesn't wait on the Supabase bundle.
function client() {
  if (!leaderboardConfigured) return Promise.reject(Object.assign(new Error('not_configured'), { code: 'not_configured' }));
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } }));
  return clientPromise;
}

function randomUuid() {
  // crypto.randomUUID is missing on plain-http origins.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
let sessionId = null;
export function playerId() {
  try {
    let id = localStorage.getItem('skyhook.playerId');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) { id = randomUuid(); localStorage.setItem('skyhook.playerId', id); }
    return id;
  } catch { return sessionId ??= randomUuid(); }
}

const KNOWN = ['unknown_board', 'invalid_player', 'invalid_name', 'invalid_meta', 'implausible_score', 'rate_limited'];
async function rpc(name, args) {
  const supabase = await client(), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  try {
    const { data, error } = await supabase.rpc(name, args).abortSignal(controller.signal);
    if (error) {
      const code = KNOWN.find(k => error.message?.includes(k)) ?? (error.code ? 'server_error' : 'offline');
      throw Object.assign(new Error(error.message), { code });
    }
    return data;
  } catch (error) {
    if (error.code) throw error;
    throw Object.assign(new Error('offline'), { code: 'offline' });
  } finally { clearTimeout(timer); }
}

export function fetchBoard(mapId, { fresh = false } = {}) {
  const hit = cache.get(mapId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  // Values are milliseconds; expose them as timeMs so the UI stays unit-explicit.
  const promise = rpc('get_leaderboard', { p_game_id: GAME_ID, p_board_id: mapId, p_limit: 20, p_player_id: playerId() }).then(board => ({
    ...board, entries: board.entries.map(e => ({ ...e, timeMs: e.value })), you: board.you && { ...board.you, timeMs: board.you.value },
  }));
  cache.set(mapId, { at: Date.now(), promise });
  promise.catch(() => cache.delete(mapId));
  return promise;
}

export async function submitRun({ mapId, name, time, falls }) {
  const result = await rpc('submit_score', { p_game_id: GAME_ID, p_board_id: mapId, p_player_id: playerId(), p_name: name, p_value: Math.floor(time * 1000), p_meta: { falls } });
  cache.delete(mapId);
  return { ...result, standing: result.standing && { ...result.standing, timeMs: result.standing.value } };
}

export function describeError(error) {
  if (error?.code === 'not_configured') return '랭킹이 아직 설정되지 않았어요.';
  if (error?.code === 'rate_limited') return '잠시 후 다시 시도해 주세요.';
  if (error?.code === 'implausible_score') return '기록을 확인할 수 없어 랭킹에 등록되지 않았어요.';
  if (error?.code === 'invalid_name') return '이름을 확인해 주세요.';
  return '랭킹 서버에 연결할 수 없어요.';
}
