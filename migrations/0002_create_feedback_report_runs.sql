-- 感想レポートの生成・送信履歴。
-- 感想本文や認証情報は保存せず、対象期間と実行結果だけを記録する。

CREATE TABLE feedback_report_runs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  report_key           TEXT NOT NULL UNIQUE,
  run_type             TEXT NOT NULL
    CHECK (run_type IN ('weekly', 'on_demand')),
  period_start         TEXT NOT NULL,
  period_end           TEXT NOT NULL,
  format               TEXT NOT NULL
    CHECK (format IN ('markdown', 'json')),
  status               TEXT NOT NULL
    CHECK (status IN ('pending', 'generated', 'sent', 'failed')),
  generated_at         TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at              TEXT,
  provider_message_id  TEXT,
  error_code           TEXT,
  updated_at           TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_feedback_report_runs_generated_at
  ON feedback_report_runs (generated_at DESC);
