import {
  buildFeedbackReport,
  formatJstDate,
} from "./feedback-report.js";

const SOURCE_LABELS = {
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  card: "カード",
  direct_share: "直接共有",
  support: "保護者向けページ",
  unknown: "不明・指定なし",
};

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("invalid_date");
  return date;
}

function asInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizeSession(row) {
  return {
    id: asInteger(row.id),
    firstSeenAt: asDate(row.first_seen_at),
    lastSeenAt: asDate(row.last_seen_at),
    supportViewed: Number(row.support_viewed) === 1,
    supportPlayClicked: Number(row.support_play_clicked) === 1,
    gamePageOpened: Number(row.game_page_opened) === 1,
    gameStarted: Number(row.game_started) === 1,
    firstChoiceTapped: Number(row.first_choice_tapped) === 1,
    correctTapCount: asInteger(row.correct_tap_count),
    wrongTapCount: asInteger(row.wrong_tap_count),
    completedRoundCount: asInteger(row.completed_round_count),
    rareCarShownCount: asInteger(row.rare_car_shown_count),
    rareCarInteractionCount: asInteger(row.rare_car_interaction_count),
    visiblePlayMs: asInteger(row.visible_play_ms),
    interactionSpanMs: asInteger(row.interaction_span_ms),
    returnStatus: row.return_status === "first_time" || row.return_status === "returning" ? row.return_status : null,
    returnIntervalBucket: typeof row.return_interval_bucket === "string" ? row.return_interval_bucket : null,
    sourceCode: Object.hasOwn(SOURCE_LABELS, row.source_code) ? row.source_code : "unknown",
    isTest: Number(row.is_test) === 1,
  };
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + row[key], 0);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function sourceCounts(rows) {
  return Object.entries(SOURCE_LABELS).map(([code, label]) => ({
    code,
    label,
    count: rows.filter((row) => row.sourceCode === code).length,
  }));
}

function metrics(rows) {
  const started = rows.filter((row) => row.gameStarted);
  const interacted = rows.filter((row) => row.firstChoiceTapped);
  return {
    sessionCount: rows.length,
    supportViewed: rows.filter((row) => row.supportViewed).length,
    supportPlayClicked: rows.filter((row) => row.supportPlayClicked).length,
    gamePageOpened: rows.filter((row) => row.gamePageOpened).length,
    gameStarted: started.length,
    firstChoiceTapped: rows.filter((row) => row.firstChoiceTapped).length,
    visibleAtLeast1Minute: started.filter((row) => row.visiblePlayMs >= 60000).length,
    visibleAtLeast3Minutes: started.filter((row) => row.visiblePlayMs >= 180000).length,
    visibleAtLeast5Minutes: started.filter((row) => row.visiblePlayMs >= 300000).length,
    medianVisiblePlayMs: median(started.map((row) => row.visiblePlayMs)),
    medianInteractionSpanMs: median(interacted.map((row) => row.interactionSpanMs)),
    completedRounds: sum(rows, "completedRoundCount"),
    medianCompletedRounds: median(started.map((row) => row.completedRoundCount)),
    correctTaps: sum(rows, "correctTapCount"),
    wrongTaps: sum(rows, "wrongTapCount"),
    rareCarsShown: sum(rows, "rareCarShownCount"),
    rareCarInteractions: sum(rows, "rareCarInteractionCount"),
    firstTime: started.filter((row) => row.returnStatus === "first_time").length,
    returning: started.filter((row) => row.returnStatus === "returning").length,
    returnUnknown: started.filter((row) => row.returnStatus === null).length,
    returnIntervals: {
      sameDay: started.filter((row) => row.returnIntervalBucket === "same_day").length,
      days1To7: started.filter((row) => row.returnIntervalBucket === "1_7_days").length,
      days8To30: started.filter((row) => row.returnIntervalBucket === "8_30_days").length,
      days31Plus: started.filter((row) => row.returnIntervalBucket === "31_plus_days").length,
      unknown: started.filter((row) => row.returnStatus === "returning" && row.returnIntervalBucket === "unknown").length,
    },
    sources: sourceCounts(rows),
  };
}

function periodInsights(periodMetrics, beforeMeasurement) {
  if (beforeMeasurement) return ["対象期間は計測開始前のためデータがありません。"];
  if (periodMetrics.sessionCount === 0) return ["今週は新しい利用セッションがありませんでした。"];
  const insights = [
    `${periodMetrics.gamePageOpened}回ゲームページが開かれ、そのうち${periodMetrics.gameStarted}回でゲームが開始されました。`,
    `${periodMetrics.firstChoiceTapped}セッションで選択肢まで操作されました。`,
  ];
  if (periodMetrics.visibleAtLeast5Minutes > 0) {
    insights.push(`${periodMetrics.visibleAtLeast5Minutes}セッションは5分以上、画面表示中の状態でした。`);
  } else if (periodMetrics.returning > 0) {
    insights.push(`同じ端末で過去の利用記録がある状態のセッションが${periodMetrics.returning}回ありました。`);
  } else {
    insights.push(`完了した問題は合計${periodMetrics.completedRounds}問でした。`);
  }
  return insights.slice(0, 3);
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
}

function feedbackLines(feedback) {
  if (feedback.counts.period === 0) return ["今週、新しい感想の送信はありません。"];
  const lines = [`今週、実利用者から${feedback.counts.period}件の感想が届きました。`, ""];
  for (const entry of feedback.entries) {
    lines.push(
      `- ID ${entry.id}（${entry.submittedAt}）`,
      `  - ひとりで遊べたか: ${entry.independence}`,
      `  - また遊びたがったか: ${entry.replayInterest}`,
      `  - 手助けが必要だった場所: ${entry.helpAreas.join("、")}`,
      `  - 自由記述: ${entry.comment}`
    );
  }
  return lines;
}

export function buildUsageReport(
  rawSessions,
  rawFeedback,
  { periodStart, periodEnd, generatedAt = new Date(), periodName = "対象期間", measurementStartedAt = null }
) {
  const start = asDate(periodStart);
  const end = asDate(periodEnd);
  const generated = asDate(generatedAt);
  if (start >= end) throw new RangeError("invalid_period");

  const normalized = rawSessions
    .map(normalizeSession)
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.id - b.id);
  const allSessions = normalized.filter((row) => !row.isTest);
  const periodSessions = allSessions.filter((row) => row.firstSeenAt >= start && row.firstSeenAt < end);
  const periodLength = end.getTime() - start.getTime();
  const previousStart = new Date(start.getTime() - periodLength);
  const previousSessions = allSessions.filter((row) => row.firstSeenAt >= previousStart && row.firstSeenAt < start);
  const measurementStart = measurementStartedAt
    ? asDate(measurementStartedAt)
    : allSessions.length === 0
      ? null
      : allSessions[0].firstSeenAt;
  const periodBeforeMeasurement = measurementStart === null || measurementStart >= end;
  const previousComparable = measurementStart !== null && measurementStart <= previousStart;
  const periodMetrics = metrics(periodSessions);
  const cumulativeMetrics = metrics(allSessions);
  const feedback = buildFeedbackReport(rawFeedback, {
    periodStart: start,
    periodEnd: end,
    generatedAt: generated,
    periodName,
  });

  return {
    generatedAt: generated.toISOString(),
    timezone: "Asia/Tokyo",
    measurementStart: measurementStart?.toISOString() ?? null,
    periodBeforeMeasurement,
    period: {
      name: periodName,
      start: start.toISOString(),
      endExclusive: end.toISOString(),
      beforeMeasurement: periodBeforeMeasurement,
    },
    metrics: {
      period: periodMetrics,
      cumulative: cumulativeMetrics,
      previous: previousComparable ? metrics(previousSessions) : null,
    },
    insights: periodInsights(periodMetrics, periodBeforeMeasurement),
    feedback,
    excludedTestSessionCount: normalized.length - allSessions.length,
  };
}

function sourceTable(items) {
  const used = items.filter((item) => item.count > 0);
  if (used.length === 0) return "流入元データはありません。";
  return ["| 流入元 | セッション数 |", "| --- | ---: |", ...used.map((item) => `| ${item.label} | ${item.count} |`)].join("\n");
}

function comparisonLines(current, previous) {
  if (previous === null) return ["計測開始前または期間途中のため、比較可能な前週データはありません。"];
  return [
    `- ゲーム開始: ${previous.gameStarted}回 → ${current.gameStarted}回`,
    `- 選択肢まで操作: ${previous.firstChoiceTapped}回 → ${current.firstChoiceTapped}回`,
    `- 5分以上表示: ${previous.visibleAtLeast5Minutes}回 → ${current.visibleAtLeast5Minutes}回`,
    `- 再利用: ${previous.returning}回 → ${current.returning}回`,
  ];
}

export function renderUsageReportMarkdown(report) {
  const metrics = report.metrics.period;
  const range = `${formatJstDate(report.period.start)}〜${formatJstDate(new Date(new Date(report.period.endExclusive).getTime() - 1))}`;
  const reportTitle = report.period.name === "今週" ? "週間利用レポート" : "利用レポート";
  const lines = [
    `# 【くるまどれかな？】${reportTitle} ${range}`,
    "",
    "## 【今週の利用】",
    "",
  ];

  if (report.period.beforeMeasurement) {
    lines.push("計測開始前のためデータなし", "");
  } else {
    lines.push(
      `サポートページ表示：${metrics.supportViewed}回`,
      `ゲームを開くボタン：${metrics.supportPlayClicked}回`,
      `ゲームページ表示：${metrics.gamePageOpened}回`,
      `黄色い車を押して開始：${metrics.gameStarted}回`,
      `選択肢まで操作：${metrics.firstChoiceTapped}回`,
      "",
      `1分以上表示：${metrics.visibleAtLeast1Minute}回`,
      `3分以上表示：${metrics.visibleAtLeast3Minutes}回`,
      `5分以上表示：${metrics.visibleAtLeast5Minutes}回`,
      "",
      `画面表示中プレイ時間の中央値：${formatDuration(metrics.medianVisiblePlayMs)}`,
      `完了した問題：合計${metrics.completedRounds}問`,
      `1セッションあたりの中央値：${metrics.medianCompletedRounds}問`,
      "",
      `初回利用：${metrics.firstTime}回`,
      `再利用：${metrics.returning}回`,
      ""
    );
  }

  lines.push(
    "## 【今週わかったこと】",
    "",
    ...report.insights.map((item) => `- ${item}`),
    "",
    "## 【注意】",
    "",
    "- 実際に操作したのが子どもか大人かは判定できません。",
    "- 画面表示中の時間であり、画面を見続けていたことまでは保証しません。",
    "- 不正解タップが意図的な遊びだったか、操作上の間違いだったかは判定しません。",
    "",
    "## 流入元別",
    "",
    sourceTable(metrics.sources),
    "",
    "## 操作とレアカー",
    "",
    `- 正解タップ：${metrics.correctTaps}回`,
    `- 不正解タップ：${metrics.wrongTaps}回`,
    `- レアカー表示：${metrics.rareCarsShown}回`,
    `- レアカー操作：${metrics.rareCarInteractions}回`,
    `- 最初から最後の選択肢操作までの中央値：${formatDuration(metrics.medianInteractionSpanMs)}`,
    `- 再利用間隔：同日${metrics.returnIntervals.sameDay}回、1〜7日${metrics.returnIntervals.days1To7}回、8〜30日${metrics.returnIntervals.days8To30}回、31日以上${metrics.returnIntervals.days31Plus}回`,
    "",
    "## 前週との比較",
    "",
    ...comparisonLines(metrics, report.metrics.previous),
    "",
    "## 実利用者からの新しい感想",
    "",
    ...feedbackLines(report.feedback),
    ""
  );

  if (report.metrics.cumulative.sessionCount < 5) {
    lines.push(
      "## 開発判断",
      "",
      `実利用セッションは累計${report.metrics.cumulative.sessionCount}件のため、傾向判断は保留します。`,
      ""
    );
  }
  return `${lines.join("\n").trim()}\n`;
}

export function weeklyUsageReportSubject(report) {
  const inclusiveEnd = new Date(new Date(report.period.endExclusive).getTime() - 1);
  return `【くるまどれかな？】週間利用レポート ${formatJstDate(report.period.start)}〜${formatJstDate(inclusiveEnd)}`;
}
