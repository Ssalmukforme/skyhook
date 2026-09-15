-- Renames the SKYHOOK map boards to the current map names (src/maps.js). Board ids stay the same,
-- so every existing score keeps its board.
update public.boards set name = v.name
from (values
  ('sunset', '퇴근길'),
  ('harbor', '9번 부두'),
  ('canyon', '마른 강'),
  ('aurora', '열두 굽이'),
  ('garden', '고래길'),
  ('jungle', '이끼 계단')
) as v(id, name)
where public.boards.game_id = 'skyhook' and public.boards.id = v.id;
