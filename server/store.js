import { readFile } from 'node:fs/promises';

// Each player's best run on a map; ties go to whoever set the time first.
const BEST = `SELECT DISTINCT ON (player_id) player_id, time_ms, falls, created_at
  FROM runs WHERE map_id = $1
  ORDER BY player_id, time_ms, created_at`;

const iso = value => new Date(value).toISOString();

// `db` needs query(text, params) -> { rows } and exec(text) for multi-statement SQL,
// which both node-postgres pools and PGlite provide.
export function createStore(db) {
  async function standing(mapId, playerId) {
    const { rows } = await db.query(`WITH best AS (${BEST}), me AS (SELECT * FROM best WHERE player_id = $2::uuid)
      SELECT (SELECT COUNT(*) FROM best b WHERE b.time_ms < me.time_ms OR (b.time_ms = me.time_ms AND b.created_at < me.created_at)) + 1 AS rank,
        me.time_ms, me.falls, me.created_at, (SELECT COUNT(*) FROM best) AS total
      FROM me`, [mapId, playerId]);
    const row = rows[0];
    return row ? { rank: Number(row.rank), timeMs: Number(row.time_ms), falls: Number(row.falls), at: iso(row.created_at), total: Number(row.total) } : null;
  }
  return {
    async migrate() {
      await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    },
    async ping() {
      await db.query('SELECT 1', []);
    },
    async submit({ mapId, playerId, name, timeMs, falls }) {
      await db.query(`INSERT INTO players (id, name) VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`, [playerId, name]);
      const previous = (await db.query('SELECT MIN(time_ms) AS best FROM runs WHERE map_id = $1 AND player_id = $2', [mapId, playerId])).rows[0].best;
      await db.query('INSERT INTO runs (map_id, player_id, time_ms, falls) VALUES ($1, $2, $3, $4)', [mapId, playerId, timeMs, falls]);
      const previousMs = previous == null ? null : Number(previous);
      return { improved: previousMs === null || timeMs < previousMs, previousMs, standing: await standing(mapId, playerId) };
    },
    async leaderboard(mapId, limit, playerId = null) {
      const { rows } = await db.query(`WITH best AS (${BEST})
        SELECT p.name, b.time_ms, b.falls, b.created_at, COALESCE(b.player_id = $3::uuid, false) AS you
        FROM best b JOIN players p ON p.id = b.player_id
        ORDER BY b.time_ms, b.created_at LIMIT $2`, [mapId, limit, playerId]);
      const total = Number((await db.query('SELECT COUNT(DISTINCT player_id) AS total FROM runs WHERE map_id = $1', [mapId])).rows[0].total);
      return {
        total,
        entries: rows.map((r, i) => ({ rank: i + 1, name: r.name, timeMs: Number(r.time_ms), falls: Number(r.falls), at: iso(r.created_at), you: r.you === true })),
        you: playerId ? await standing(mapId, playerId) : null,
      };
    },
  };
}
