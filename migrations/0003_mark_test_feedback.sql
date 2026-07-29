-- 本番レポートからテスト回答を明示的に除外する。
-- 通常の感想フォーム投稿は DEFAULT 0 の実利用者回答として保存される。

ALTER TABLE feedback
ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0
  CHECK (is_test IN (0, 1));

UPDATE feedback
SET is_test = 1
WHERE id IN (1, 2, 3);

CREATE INDEX IF NOT EXISTS idx_feedback_is_test_submitted_at
ON feedback (is_test, submitted_at);
