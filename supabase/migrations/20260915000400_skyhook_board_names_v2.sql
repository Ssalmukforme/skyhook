-- Renames the SKYHOOK map boards again, to the current map names (src/maps.js).
-- Board ids stay the same, so every existing score keeps its board.
update public.boards set name = v.name
from (values
  ('sunset', '메리골드 애비뉴'),
  ('harbor', '랜턴 하버'),
  ('canyon', '러스트 캐니언'),
  ('aurora', '전나무 설원'),
  ('garden', '뭉게구름 정원'),
  ('jungle', '몬순 정글')
) as v(id, name)
where public.boards.game_id = 'skyhook' and public.boards.id = v.id;
