import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { COURSES } from '../src/physics.js';
import { MAPS } from '../src/maps.js';

// Runs the real Supabase migrations on an embedded Postgres, with Supabase's API roles recreated.
const dir = new URL('../supabase/migrations/', import.meta.url);
const migrations = await Promise.all((await readdir(dir)).filter(f => f.endsWith('.sql')).sort().map(f => readFile(new URL(f, dir), 'utf8')));
const ids = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222', c: '33333333-3333-4333-8333-333333333333', d: '44444444-4444-4444-8444-444444444444' };
let db;

before(async () => {
  db = new PGlite();
  await db.exec('create role anon nologin; create role authenticated nologin;');
  for (const sql of [...migrations, ...migrations]) await db.exec(sql);
});
after(async () => { await db.close(); });

// Calls the RPCs as the browser would: the `anon` role, optionally with request headers.
async function rpc(sql, params, headers = null) {
  await db.exec(`set role anon; select set_config('request.headers', '${JSON.stringify(headers ?? {}).replaceAll("'", "''")}', false);`);
  try { return (await db.query(sql, params)).rows[0].result; } finally { await db.exec('reset role;'); }
}
const submit = (board, playerId, name, value, meta = { falls: 0 }, headers, game = 'skyhook') => rpc('select public.submit_score($1, $2, $3, $4, $5, $6) as result', [game, board, playerId, name, value, meta], headers);
const board = (boardId, playerId = null, limit = 20, game = 'skyhook') => rpc('select public.get_leaderboard($1, $2, $3, $4) as result', [game, boardId, limit, playerId]);
const rejects = (promise, code) => assert.rejects(promise, error => { assert.match(error.message, new RegExp(code)); return true; });

test('SKYHOOK boards match the game physics', async () => {
  const { rows } = await db.query(`select id, min_value, higher_is_better, penalty_key, penalty_per from public.boards where game_id = 'skyhook'`);
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.id, r.min_value])), Object.fromEntries(MAPS.map(m => [m.id, Math.floor(COURSES[m.id].length / COURSES[m.id].speedCap * 1000)])));
  assert.ok(rows.every(r => r.higher_is_better === false && r.penalty_key === 'falls' && r.penalty_per === 3000));
});

test('scores are ranked per board by each player best, showing the latest nickname', async () => {
  let result = await submit('harbor', ids.a, 'alpha', 40500);
  assert.equal(result.improved, true); assert.equal(result.standing.rank, 1); assert.equal(result.standing.total, 1);
  result = await submit('harbor', ids.b, 'bravo', 35250, { falls: 1 });
  assert.equal(result.standing.rank, 1);
  result = await submit('harbor', ids.a, 'ALPHA 2', 50000);
  assert.equal(result.improved, false); assert.equal(result.previous, 40500); assert.equal(result.standing.rank, 2); assert.equal(result.standing.value, 40500);
  await submit('canyon', ids.c, 'canyon only', 30000);

  const harbor = await board('harbor', ids.a);
  assert.equal(harbor.total, 2); assert.equal(harbor.higherIsBetter, false);
  assert.deepEqual(harbor.entries.map(e => [e.rank, e.name, e.value, e.meta.falls, e.you]), [[1, 'bravo', 35250, 1, false], [2, 'ALPHA 2', 40500, 0, true]]);
  assert.equal(harbor.you.rank, 2);
  const canyon = await board('canyon');
  assert.deepEqual([canyon.total, canyon.you, canyon.entries[0].name], [1, null, 'canyon only']);
  const empty = await board('garden', ids.a);
  assert.deepEqual([empty.total, empty.entries, empty.you], [0, [], null]);
});

test('a player outside the returned top list still gets their rank; ties go to the earlier score', async () => {
  await submit('aurora', ids.a, 'a', 30000);
  await submit('aurora', ids.b, 'b', 30000);
  await submit('aurora', ids.c, 'c', 25000);
  await submit('aurora', ids.d, 'd', 45000);
  const top = await board('aurora', ids.d, 2);
  assert.deepEqual(top.entries.map(e => e.name), ['c', 'a']);
  assert.deepEqual([top.you.rank, top.you.value, top.total], [4, 45000, 4]);
  assert.equal((await board('aurora', ids.b)).you.rank, 3);
});

test('boards can rank higher values first and games stay separate', async () => {
  await db.exec(`insert into public.games (id, name) values ('redline', 'REDLINE');
    insert into public.boards (game_id, id, name, higher_is_better, min_value, max_value) values ('redline', 'city', 'City', true, 0, 7200000);
    insert into public.boards (game_id, id, name, min_value, max_value) values ('redline', 'harbor', 'same id, other game', 1, 7200000);`);
  await submit('city', ids.a, 'short', 60000, {}, null, 'redline');
  await submit('city', ids.b, 'long', 180000, {}, null, 'redline');
  const improved = await submit('city', ids.a, 'short', 240000, {}, null, 'redline');
  assert.deepEqual([improved.improved, improved.previous, improved.standing.rank], [true, 60000, 1]);
  const city = await board('city', ids.b, 20, 'redline');
  assert.deepEqual(city.entries.map(e => [e.name, e.value]), [['short', 240000], ['long', 180000]]);
  assert.equal(city.higherIsBetter, true);
  assert.equal((await board('harbor', null, 20, 'redline')).total, 0, 'same board id in another game is a separate board');
  await rejects(submit('city', ids.c, 'x', -5, {}, null, 'redline'), 'implausible_score');
});

test('submissions are validated inside the database', async () => {
  await rejects(submit('moon', ids.a, 'x', 30000), 'unknown_board');
  await rejects(board('moon'), 'unknown_board');
  await rejects(board('sunset', null, 20, 'other-game'), 'unknown_board');
  await rejects(submit('sunset', null, 'x', 30000), 'invalid_player');
  await rejects(submit('sunset', ids.a, ' \t ', 30000), 'invalid_name');
  await rejects(submit('sunset', ids.a, 'x', 30000, {}), 'invalid_meta');
  await rejects(submit('sunset', ids.a, 'x', 30000, { falls: -1 }), 'invalid_meta');
  await rejects(submit('sunset', ids.a, 'x', 30000, { falls: 1.5 }), 'invalid_meta');
  await rejects(submit('sunset', ids.a, 'x', 30000, { falls: 0, junk: 'y'.repeat(2000) }), 'invalid_meta');
  await rejects(submit('sunset', ids.a, 'x', 5000), 'implausible_score');
  await rejects(submit('sunset', ids.a, 'x', 12352 + 1000, { falls: 3 }), 'implausible_score');
  await rejects(submit('sunset', ids.a, 'x', 3600001), 'implausible_score');
  const cleaned = await submit('sunset', ids.d, '  세상에서\t가장   빠른 스윙어입니다요요 ', 30000);
  assert.equal(cleaned.standing.rank, 1);
  assert.equal((await board('sunset')).entries[0].name, '세상에서 가장 빠른 스윙어입니');
});

test('submissions are rate limited per player and per client IP', async () => {
  const player = '55555555-5555-4555-8555-555555555555';
  for (let i = 0; i < 6; i++) await submit('garden', player, 'spam', 40000 + i);
  await rejects(submit('garden', player, 'spam', 50000), 'rate_limited');
  const headers = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };
  for (let i = 0; i < 20; i++) await submit('garden', `66666666-6666-4666-8666-${String(i).padStart(12, '0')}`, 'ip', 40000, { falls: 0 }, headers);
  await rejects(submit('garden', '77777777-7777-4777-8777-777777777777', 'ip', 40000, { falls: 0 }, headers), 'rate_limited');
  const { rows } = await db.query('select client_hash from public.submit_log limit 1');
  assert.doesNotMatch(rows[0].client_hash, /203\.0\.113\.7/);
});

test('the anon role can only use the RPCs, never the tables directly', async () => {
  for (const table of ['games', 'boards', 'players', 'scores', 'submit_log']) {
    await db.exec('set role anon;');
    try { await assert.rejects(db.query(`select * from public.${table}`), /permission denied/); }
    finally { await db.exec('reset role;'); }
  }
  await db.exec('set role anon;');
  try { await assert.rejects(db.query(`insert into public.scores (game_id, board_id, player_id, value) values ('skyhook', 'sunset', '${ids.a}', 1)`), /permission denied/); }
  finally { await db.exec('reset role;'); }
});
