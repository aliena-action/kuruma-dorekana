-- 「くるまどれかな?」保護者向け感想の保存テーブル
--
-- 許可値は functions/api/feedback.js の ALLOWED_VALUES と同期させること。
-- help_areas は JSON 配列文字列 (例: ["getting_started","tapping"]) を保存する。
-- 各要素の許可値検証は API 側 (feedback.js) で行うため、ここに CHECK は置かない。
-- User-Agent / IP アドレス等を保存する列は意図的に存在しない。

CREATE TABLE feedback (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  independence     TEXT NOT NULL
    CHECK (independence IN (
      'independent',
      'some_help',
      'much_help'
    )),
  replay_interest  TEXT NOT NULL
    CHECK (replay_interest IN (
      'yes',
      'unsure',
      'no'
    )),
  age_group         TEXT
    CHECK (
      age_group IS NULL OR
      age_group IN (
        'age_2_3',
        'age_4_5',
        'age_6_plus'
      )
    ),
  help_areas        TEXT,
  comment           TEXT,
  submitted_at      TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
