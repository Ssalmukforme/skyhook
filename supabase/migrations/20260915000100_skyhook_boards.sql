-- Registers SKYHOOK and its five maps in the shared ssalmuk_ranking leaderboard.
-- Values are finish times in milliseconds (lower wins). min_value = course length / speed cap,
-- plus 3 s per recovery (meta.falls). Keep in sync with src/maps.js; `npm test` checks it.
insert into public.games (id, name) values ('skyhook', 'SKYHOOK')
on conflict (id) do update set name = excluded.name;

insert into public.boards (game_id, id, name, higher_is_better, min_value, max_value, penalty_key, penalty_per) values
  ('skyhook', 'sunset', '선셋 애비뉴', false, 12352, 3600000, 'falls', 3000),
  ('skyhook', 'harbor', '네온 하버', false, 16588, 3600000, 'falls', 3000),
  ('skyhook', 'canyon', '레드 캐니언', false, 15104, 3600000, 'falls', 3000),
  ('skyhook', 'aurora', '오로라 설원', false, 17294, 3600000, 'falls', 3000),
  ('skyhook', 'garden', '구름 정원', false, 15909, 3600000, 'falls', 3000)
on conflict (game_id, id) do update set
  name = excluded.name, higher_is_better = excluded.higher_is_better, min_value = excluded.min_value,
  max_value = excluded.max_value, penalty_key = excluded.penalty_key, penalty_per = excluded.penalty_per;
