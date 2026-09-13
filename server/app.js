import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { COURSES } from '../src/physics.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_TIME_MS = 60 * 60 * 1000;

// No run can beat covering the course at the map's speed cap, plus 3 s for every recovery.
export function minTimeMs(mapId, falls = 0) {
  const c = COURSES[mapId];
  return Math.floor(c.length / c.speedCap * 1000) + falls * 3000;
}

export function cleanName(value) {
  if (typeof value !== 'string') return null;
  const chars = [...value.normalize('NFC').replace(/\s+/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').trim()];
  return chars.length ? chars.slice(0, 16).join('') : null;
}

export function validateRun(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' };
  const { mapId, playerId, time, falls = 0 } = body;
  if (typeof mapId !== 'string' || !Object.hasOwn(COURSES, mapId)) return { error: 'unknown_map' };
  if (typeof playerId !== 'string' || !UUID.test(playerId)) return { error: 'invalid_player' };
  const name = cleanName(body.name);
  if (!name) return { error: 'invalid_name' };
  if (!Number.isInteger(falls) || falls < 0 || falls > 999) return { error: 'invalid_falls' };
  if (typeof time !== 'number' || !Number.isFinite(time)) return { error: 'invalid_time' };
  const timeMs = Math.floor(time * 1000);
  if (timeMs < minTimeMs(mapId, falls) || timeMs > MAX_TIME_MS) return { error: 'implausible_time' };
  return { run: { mapId, playerId: playerId.toLowerCase(), name, timeMs, falls } };
}

export function createLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map();
  return key => {
    const t = now();
    let entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) { entry = { start: t, count: 0 }; hits.set(key, entry); }
    entry.count++;
    if (hits.size > 10000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
    return entry.count <= limit;
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

async function readJson(req, maxBytes = 4096) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw new HttpError(413, 'body_too_large'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { throw new HttpError(400, 'invalid_json'); }
}

export function createApp({ store, staticDir = null, corsOrigin = null, trustProxy = false, submitLimit = 12, playerLimit = 6, windowMs = 60_000, log = console }) {
  const ipLimiter = createLimiter({ limit: submitLimit, windowMs }), playerLimiter = createLimiter({ limit: playerLimit, windowMs });
  const root = staticDir ? path.resolve(staticDir) : null;
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const clientIp = req => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';

  async function api(req, res, url) {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      try { await store.ping(); return send(res, 200, { ok: true }); } catch { return send(res, 503, { ok: false, error: 'db_unavailable' }); }
    }
    const board = url.pathname.match(/^\/api\/maps\/([a-z0-9-]{1,32})\/leaderboard$/);
    if (board && req.method === 'GET') {
      if (!Object.hasOwn(COURSES, board[1])) throw new HttpError(404, 'unknown_map');
      const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
      const header = req.headers['x-player-id'], playerId = typeof header === 'string' && UUID.test(header) ? header.toLowerCase() : null;
      return send(res, 200, { mapId: board[1], ...(await store.leaderboard(board[1], limit, playerId)) });
    }
    if (url.pathname === '/api/runs' && req.method === 'POST') {
      if (!ipLimiter(clientIp(req))) throw new HttpError(429, 'rate_limited');
      const { run, error } = validateRun(await readJson(req));
      if (error) throw new HttpError(422, error);
      if (!playerLimiter(run.playerId)) throw new HttpError(429, 'rate_limited');
      return send(res, 201, { mapId: run.mapId, timeMs: run.timeMs, ...(await store.submit(run)) });
    }
    throw new HttpError(404, 'not_found');
  }

  async function serveStatic(req, res, url) {
    if (!root || !['GET', 'HEAD'].includes(req.method)) return send(res, 404, { error: 'not_found' });
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'bad_path' }); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) return send(res, 404, { error: 'not_found' });
    let data;
    try { data = await readFile(file); } catch { return send(res, 404, { error: 'not_found' }); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (corsOrigin && url.pathname.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Player-Id');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await serveStatic(req, res, url);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (error instanceof HttpError) return send(res, error.status, { error: error.code });
      log.error('[skyhook] request failed:', error);
      send(res, 503, { error: 'server_unavailable' });
    }
  };
}
