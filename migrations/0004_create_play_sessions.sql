-- 匿名の利用状況を同一タブの一時 session_id 単位で保持する。
-- 個人情報、IPアドレス、User-Agent、完全な参照元URLは保存しない。

CREATE TABLE IF NOT EXISTS play_sessions (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id                 TEXT NOT NULL UNIQUE,
  first_seen_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  support_viewed             INTEGER NOT NULL DEFAULT 0 CHECK (support_viewed IN (0, 1)),
  support_play_clicked       INTEGER NOT NULL DEFAULT 0 CHECK (support_play_clicked IN (0, 1)),
  game_page_opened           INTEGER NOT NULL DEFAULT 0 CHECK (game_page_opened IN (0, 1)),
  game_started               INTEGER NOT NULL DEFAULT 0 CHECK (game_started IN (0, 1)),
  first_choice_tapped        INTEGER NOT NULL DEFAULT 0 CHECK (first_choice_tapped IN (0, 1)),
  correct_tap_count          INTEGER NOT NULL DEFAULT 0 CHECK (correct_tap_count BETWEEN 0 AND 10000),
  wrong_tap_count            INTEGER NOT NULL DEFAULT 0 CHECK (wrong_tap_count BETWEEN 0 AND 10000),
  completed_round_count      INTEGER NOT NULL DEFAULT 0 CHECK (completed_round_count BETWEEN 0 AND 5000),
  rare_car_shown_count       INTEGER NOT NULL DEFAULT 0 CHECK (rare_car_shown_count BETWEEN 0 AND 2000),
  rare_car_interaction_count INTEGER NOT NULL DEFAULT 0 CHECK (rare_car_interaction_count BETWEEN 0 AND 2000),
  visible_play_ms            INTEGER NOT NULL DEFAULT 0 CHECK (visible_play_ms BETWEEN 0 AND 86400000),
  interaction_span_ms        INTEGER NOT NULL DEFAULT 0 CHECK (interaction_span_ms BETWEEN 0 AND 86400000),
  return_status              TEXT CHECK (return_status IS NULL OR return_status IN ('first_time', 'returning')),
  return_interval_bucket     TEXT CHECK (return_interval_bucket IS NULL OR return_interval_bucket IN ('first_time', 'same_day', '1_7_days', '8_30_days', '31_plus_days', 'unknown')),
  source_code                TEXT NOT NULL DEFAULT 'unknown' CHECK (source_code IN ('x', 'instagram', 'facebook', 'card', 'direct_share', 'support', 'unknown')),
  is_test                    INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
  client_version             TEXT NOT NULL CHECK (length(client_version) BETWEEN 1 AND 32)
);

CREATE INDEX IF NOT EXISTS idx_play_sessions_real_first_seen
  ON play_sessions (is_test, first_seen_at);

CREATE INDEX IF NOT EXISTS idx_play_sessions_real_last_seen
  ON play_sessions (is_test, last_seen_at);

CREATE TABLE IF NOT EXISTS analytics_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO analytics_metadata (key, value)
VALUES ('measurement_started_at', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
