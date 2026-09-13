-- SKYHOOK global leaderboard. Applied automatically on server start; safe to run repeatedly.
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  name VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every submitted finish is kept; rankings use each player's best run per map.
CREATE TABLE IF NOT EXISTS runs (
  id BIGSERIAL PRIMARY KEY,
  map_id VARCHAR(32) NOT NULL,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  time_ms INTEGER NOT NULL CHECK (time_ms > 0),
  falls SMALLINT NOT NULL DEFAULT 0 CHECK (falls >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runs_board_idx ON runs (map_id, player_id, time_ms, created_at);
