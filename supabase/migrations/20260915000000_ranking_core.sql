-- ssalmuk_ranking: shared leaderboard for multiple games.
-- Each game registers itself in `games` and its maps/courses/modes in `boards`; see *_skyhook_boards.sql.
-- Browsers never touch the tables (RLS on, no policies); everything goes through get_leaderboard / submit_score.

create table if not exists public.games (
  id text primary key check (id ~ '^[a-z0-9-]{1,32}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.boards (
  game_id text not null references public.games (id) on delete cascade,
  id text not null check (id ~ '^[a-z0-9-]{1,32}$'),
  name text not null,
  -- false: lower wins (race times). true: higher wins (scores, survival time).
  higher_is_better boolean not null default false,
  -- Plausible range for a submitted value, in the game's own unit (e.g. milliseconds).
  min_value integer not null,
  max_value integer not null,
  -- Optional per-event penalty folded into min_value, e.g. {"key": "falls", "per": 3000}
  -- means a run with meta.falls = 2 cannot be faster than min_value + 6000.
  penalty_key text,
  penalty_per integer not null default 0 check (penalty_per >= 0),
  created_at timestamptz not null default now(),
  primary key (game_id, id),
  check (min_value <= max_value)
);

create table if not exists public.players (
  id uuid primary key,
  name varchar(16) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every submission is kept; rankings use each player's best score per board.
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  game_id text not null,
  board_id text not null,
  player_id uuid not null references public.players (id) on delete cascade,
  value integer not null,
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (game_id, board_id) references public.boards (game_id, id) on delete cascade
);
create index if not exists scores_board_player_idx on public.scores (game_id, board_id, player_id, value, created_at);
create index if not exists scores_player_recent_idx on public.scores (player_id, created_at);

-- Short-lived log for per-client rate limiting; stores a hash, never the raw IP.
create table if not exists public.submit_log (
  client_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists submit_log_client_idx on public.submit_log (client_hash, created_at);

alter table public.games enable row level security;
alter table public.boards enable row level security;
alter table public.players enable row level security;
alter table public.scores enable row level security;
alter table public.submit_log enable row level security;
revoke all on public.games, public.boards, public.players, public.scores, public.submit_log from anon, authenticated;

create or replace function public.get_leaderboard(p_game_id text, p_board_id text, p_limit integer default 20, p_player_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_higher boolean;
  v_result jsonb;
begin
  select b.higher_is_better into v_higher from public.boards b where b.game_id = p_game_id and b.id = p_board_id;
  if v_higher is null then raise exception 'unknown_board' using errcode = 'P0001'; end if;

  with best as (
    select distinct on (s.player_id) s.player_id, s.value, s.meta, s.created_at
    from public.scores s
    where s.game_id = p_game_id and s.board_id = p_board_id
    order by s.player_id, case when v_higher then -s.value::bigint else s.value::bigint end, s.created_at
  ), ranked as (
    -- Ties go to whoever reached the score first.
    select b.*, p.name,
      row_number() over (order by case when v_higher then -b.value::bigint else b.value::bigint end, b.created_at) as rank,
      count(*) over () as total
    from best b join public.players p on p.id = b.player_id
  )
  select jsonb_build_object(
    'gameId', p_game_id,
    'boardId', p_board_id,
    'higherIsBetter', v_higher,
    'total', coalesce((select max(total) from ranked), 0),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('rank', rank, 'name', name, 'value', value, 'meta', meta, 'at', created_at, 'you', coalesce(player_id = p_player_id, false)) order by rank)
      from ranked where rank <= v_limit
    ), '[]'::jsonb),
    'you', (
      select jsonb_build_object('rank', rank, 'value', value, 'meta', meta, 'at', created_at, 'total', total)
      from ranked where player_id = p_player_id
    )
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.submit_score(p_game_id text, p_board_id text, p_player_id uuid, p_name text, p_value integer, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_board public.boards;
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  v_name text;
  v_penalty integer := 0;
  v_previous integer;
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
  v_ip text;
  v_client text;
begin
  select * into v_board from public.boards b where b.game_id = p_game_id and b.id = p_board_id;
  if v_board.id is null then raise exception 'unknown_board' using errcode = 'P0001'; end if;
  if p_player_id is null then raise exception 'invalid_player' using errcode = 'P0001'; end if;

  v_name := left(btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'), '[[:cntrl:]]', '', 'g')), 16);
  if v_name = '' then raise exception 'invalid_name' using errcode = 'P0001'; end if;

  if jsonb_typeof(v_meta) <> 'object' or length(v_meta::text) > 1000 then raise exception 'invalid_meta' using errcode = 'P0001'; end if;
  if v_board.penalty_key is not null then
    -- coalesce: a missing key must fail the check, not slip through as NULL.
    if coalesce(jsonb_typeof(v_meta -> v_board.penalty_key), '') <> 'number' or coalesce(v_meta ->> v_board.penalty_key, '') !~ '^\d{1,3}$' then
      raise exception 'invalid_meta' using errcode = 'P0001';
    end if;
    v_penalty := (v_meta ->> v_board.penalty_key)::integer * v_board.penalty_per;
  end if;

  if p_value is null or p_value > v_board.max_value
    or (not v_board.higher_is_better and p_value < v_board.min_value + v_penalty)
    or (v_board.higher_is_better and p_value < v_board.min_value) then
    raise exception 'implausible_score' using errcode = 'P0001';
  end if;

  if (select count(*) from public.scores s where s.player_id = p_player_id and s.created_at > now() - interval '1 minute') >= 6 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  v_ip := nullif(btrim(split_part(coalesce(v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-forwarded-for', ''), ',', 1)), '');
  if v_ip is not null then
    v_client := md5('ssalmuk-ranking:' || v_ip);
    delete from public.submit_log l where l.created_at < now() - interval '10 minutes';
    if (select count(*) from public.submit_log l where l.client_hash = v_client and l.created_at > now() - interval '1 minute') >= 20 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    insert into public.submit_log (client_hash) values (v_client);
  end if;

  insert into public.players (id, name) values (p_player_id, v_name)
  on conflict (id) do update set name = excluded.name, updated_at = now();
  select case when v_board.higher_is_better then max(s.value) else min(s.value) end into v_previous
    from public.scores s where s.game_id = p_game_id and s.board_id = p_board_id and s.player_id = p_player_id;
  insert into public.scores (game_id, board_id, player_id, value, meta) values (p_game_id, p_board_id, p_player_id, p_value, v_meta);

  return jsonb_build_object(
    'gameId', p_game_id,
    'boardId', p_board_id,
    'value', p_value,
    'improved', v_previous is null or (case when v_board.higher_is_better then p_value > v_previous else p_value < v_previous end),
    'previous', v_previous,
    'standing', public.get_leaderboard(p_game_id, p_board_id, 1, p_player_id) -> 'you'
  );
end;
$$;

revoke all on function public.get_leaderboard(text, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.submit_score(text, text, uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.get_leaderboard(text, text, integer, uuid) to anon, authenticated;
grant execute on function public.submit_score(text, text, uuid, text, integer, jsonb) to anon, authenticated;
