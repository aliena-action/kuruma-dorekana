import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUsageReport,
  renderUsageReportMarkdown,
  weeklyUsageReportSubject,
} from "../functions/lib/usage-report.js";

function session(id, firstSeen, overrides = {}) {
  return {
    id,
    first_seen_at: firstSeen,
    last_seen_at: firstSeen,
    support_viewed: 1,
    support_play_clicked: 1,
    game_page_opened: 1,
    game_started: 1,
    first_choice_tapped: 1,
    correct_tap_count: 4,
    wrong_tap_count: 2,
    completed_round_count: 4,
    rare_car_shown_count: 1,
    rare_car_interaction_count: 1,
    visible_play_ms: 215000,
    interaction_span_ms: 191000,
    return_status: "first_time",
    return_interval_bucket: "first_time",
    source_code: "x",
    is_test: 0,
    ...overrides,
  };
}

function report(rows, options = {}) {
  return buildUsageReport(rows, [], {
    periodStart: new Date("2026-07-26T15:00:00.000Z"),
    periodEnd: new Date("2026-08-02T15:00:00.000Z"),
    generatedAt: new Date("2026-08-03T00:15:00.000Z"),
    periodName: "今週",
    measurementStartedAt: "2026-07-19T15:00:00.000Z",
    ...options,
  });
}

test("実利用セッションだけを今週と累計へ集計する", () => {
  const result = report([
    session(1, "2026-07-27T01:00:00.000Z"),
    session(2, "2026-07-28T01:00:00.000Z", { visible_play_ms: 320000, return_status: "returning" }),
    session(3, "2026-07-28T02:00:00.000Z", { is_test: 1, visible_play_ms: 999999 }),
  ]);
  assert.equal(result.metrics.period.sessionCount, 2);
  assert.equal(result.metrics.period.gameStarted, 2);
  assert.equal(result.metrics.period.visibleAtLeast3Minutes, 2);
  assert.equal(result.metrics.period.visibleAtLeast5Minutes, 1);
  assert.equal(result.metrics.period.completedRounds, 8);
  assert.equal(result.metrics.period.firstTime, 1);
  assert.equal(result.metrics.period.returning, 1);
  assert.equal(result.excludedTestSessionCount, 1);
});

test("0件と計測開始前を区別する", () => {
  const afterStart = report([], { measurementStartedAt: "2026-07-20T00:00:00.000Z" });
  assert.equal(afterStart.period.beforeMeasurement, false);
  assert.match(renderUsageReportMarkdown(afterStart), /今週は新しい利用セッションがありませんでした/);

  const beforeStart = report([], { measurementStartedAt: "2026-08-04T00:00:00.000Z" });
  assert.equal(beforeStart.period.beforeMeasurement, true);
  assert.match(renderUsageReportMarkdown(beforeStart), /計測開始前のためデータなし/);
});

test("少数データで傾向を断定せず、人間向けの冒頭を生成する", () => {
  const result = report([session(1, "2026-07-27T01:00:00.000Z")]);
  const markdown = renderUsageReportMarkdown(result);
  assert.match(markdown, /## 【今週の利用】/);
  assert.match(markdown, /ゲームページ表示：1回/);
  assert.match(markdown, /黄色い車を押して開始：1回/);
  assert.match(markdown, /実利用セッションは累計1件のため、傾向判断は保留/);
  assert.doesNotMatch(markdown, /夢中|遊びたがらなかった|操作が分からなかった|男児|女児/);
});

test("週間利用レポート件名を日本時間の日付で作る", () => {
  assert.equal(
    weeklyUsageReportSubject(report([])),
    "【くるまどれかな？】週間利用レポート 2026-07-27〜2026-08-02"
  );
});
