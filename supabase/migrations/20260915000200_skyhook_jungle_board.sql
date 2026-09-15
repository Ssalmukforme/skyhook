-- Adds SKYHOOK map 06 (Emerald Ruins) to the shared ssalmuk_ranking leaderboard.
-- min_value = course length 1540 m / speed cap 85 m/s; keep in sync with src/maps.js (`npm test` checks it).
insert into public.boards (game_id, id, name, higher_is_better, min_value, max_value, penalty_key, penalty_per) values
  ('skyhook', 'jungle', '에메랄드 정글', false, 18117, 3600000, 'falls', 3000)
on conflict (game_id, id) do update set
  name = excluded.name, higher_is_better = excluded.higher_is_better, min_value = excluded.min_value,
  max_value = excluded.max_value, penalty_key = excluded.penalty_key, penalty_per = excluded.penalty_per;
