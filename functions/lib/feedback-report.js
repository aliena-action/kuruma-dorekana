const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const FEEDBACK_LABELS = {
  independence: {
    independent: "ほぼひとりで遊べた",
    some_help: "少し手助けが必要だった",
    much_help: "かなり手助けが必要だった",
  },
  replay_interest: {
    yes: "また遊びたがった",
    unsure: "どちらともいえない",
    no: "もう一度は遊びたがらなかった",
  },
  age_group: {
    age_2_3: "2〜3歳",
    age_4_5: "4〜5歳",
    age_6_plus: "6歳以上",
  },
  help_areas: {
    getting_started: "始め方",
    finding_same_car: "同じ車を見つける",
    tapping: "タップ操作",
    waiting: "待ち時間",
    other: "その他",
  },
};

const UNANSWERED = "回答なし";

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("invalid_date");
  return date;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function jstParts(value) {
  const shifted = new Date(asDate(value).getTime() + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

export function formatJstDate(value) {
  const p = jstParts(value);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function formatJstDateTime(value) {
  const p = jstParts(value);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} JST`;
}

export function previousCompletedJstWeek(now = new Date()) {
  const current = asDate(now);
  const shifted = new Date(current.getTime() + JST_OFFSET_MS);
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
  const currentMondayJst =
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - daysSinceMonday,
      0,
      0,
      0,
      0
    ) - JST_OFFSET_MS;
  return {
    start: new Date(currentMondayJst - 7 * DAY_MS),
    end: new Date(currentMondayJst),
  };
}

function parseHelpAreas(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function normalizeRow(row) {
  const submittedAt = asDate(row.submitted_at);
  return {
    id: Number(row.id),
    isTest: Number(row.is_test) === 1,
    submittedAt,
    independence: row.independence ?? null,
    replayInterest: row.replay_interest ?? null,
    ageGroup: row.age_group ?? null,
    helpAreas: parseHelpAreas(row.help_areas),
    comment: typeof row.comment === "string" && row.comment.trim() !== "" ? row.comment : null,
  };
}

function metric(count, total) {
  return {
    count,
    percentage: total === 0 ? 0 : Number(((count / total) * 100).toFixed(1)),
  };
}

function singleChoiceDistribution(rows, key, labels) {
  const total = rows.length;
  const items = Object.entries(labels).map(([code, label]) => ({
    label,
    ...metric(rows.filter((row) => row[key] === code).length, total),
  }));
  items.push({
    label: UNANSWERED,
    ...metric(rows.filter((row) => row[key] === null || !(row[key] in labels)).length, total),
  });
  return items;
}

function helpDistribution(rows) {
  const total = rows.length;
  const items = Object.entries(FEEDBACK_LABELS.help_areas).map(([code, label]) => ({
    label,
    ...metric(rows.filter((row) => row.helpAreas.includes(code)).length, total),
  }));
  items.push({
    label: UNANSWERED,
    ...metric(rows.filter((row) => row.helpAreas.length === 0).length, total),
  });
  return items;
}

function distributions(rows) {
  return {
    independence: singleChoiceDistribution(rows, "independence", FEEDBACK_LABELS.independence),
    replayInterest: singleChoiceDistribution(rows, "replayInterest", FEEDBACK_LABELS.replay_interest),
    ageGroup: singleChoiceDistribution(rows, "ageGroup", FEEDBACK_LABELS.age_group),
    helpAreas: helpDistribution(rows),
  };
}

function japaneseLabel(group, code) {
  return code === null ? UNANSWERED : FEEDBACK_LABELS[group][code] ?? UNANSWERED;
}

function commentEntry(row) {
  return {
    id: row.id,
    submittedAt: formatJstDateTime(row.submittedAt),
    text: row.comment,
  };
}

function topAnswered(items) {
  return items
    .filter((item) => item.label !== UNANSWERED)
    .reduce((best, item) => (best === null || item.count > best.count ? item : best), null);
}

function responseSummary(rows, key, labels, lead) {
  const counts = Object.entries(labels)
    .map(([code, label]) => ({
      label,
      count: rows.filter((row) => row[key] === code).length,
    }))
    .filter((item) => item.count > 0);
  const unanswered = rows.filter((row) => row[key] === null || !(row[key] in labels)).length;
  if (unanswered > 0) counts.push({ label: UNANSWERED, count: unanswered });
  if (counts.length === 0) return `${lead}の回答はありませんでした。`;
  if (rows.length === 1 && counts.length === 1) {
    return `${lead}は「${counts[0].label}」という回答でした。`;
  }
  return `${lead}は${counts.map((item) => `「${item.label}」${item.count}件`).join("、")}でした。`;
}

function periodInsights(periodRows) {
  if (periodRows.length === 0) {
    return ["今週は新しい実利用者回答がありませんでした。"];
  }
  return [
    `今週は実利用者から${periodRows.length}件の回答が届きました。`,
    responseSummary(periodRows, "independence", FEEDBACK_LABELS.independence, "ひとりで遊べた程度"),
    responseSummary(periodRows, "replayInterest", FEEDBACK_LABELS.replay_interest, "また遊びたそうだったか"),
  ];
}

function nextChecks(periodRows, allRows) {
  const checks = [];
  if (allRows.length < 5) {
    checks.push(`現在${allRows.length}件のため傾向判断は保留します。`);
  }
  checks.push(
    periodRows.length === 0
      ? "次の実利用者回答が届いたら、遊びやすさとつまずきを確認します。"
      : "同じ回答や手助け箇所が今後も続くかを確認します。"
  );
  return checks.slice(0, 2);
}

function cumulativeTrends(allRows, allStats) {
  if (allRows.length < 5) {
    return [`現在${allRows.length}件のため傾向判断は保留します。`];
  }
  return [
    ["ひとりで遊べた程度", allStats.independence],
    ["また遊びたそうだったか", allStats.replayInterest],
  ].map(([title, items]) => {
    const top = topAnswered(items);
    return top
      ? `${title}は「${top.label}」が${top.count}件（${top.percentage}%）で最も多い回答です。`
      : `${title}はまだ傾向を判断できません。`;
  });
}

function entryFromRow(row) {
  return {
    id: row.id,
    submittedAt: formatJstDateTime(row.submittedAt),
    age: japaneseLabel("age_group", row.ageGroup),
    independence: japaneseLabel("independence", row.independence),
    replayInterest: japaneseLabel("replay_interest", row.replayInterest),
    helpAreas:
      row.helpAreas.length === 0
        ? [UNANSWERED]
        : row.helpAreas.map((code) => FEEDBACK_LABELS.help_areas[code]).filter(Boolean).length > 0
          ? row.helpAreas.map((code) => FEEDBACK_LABELS.help_areas[code]).filter(Boolean)
          : [UNANSWERED],
    comment: row.comment ?? UNANSWERED,
  };
}

export function buildFeedbackReport(
  rawRows,
  { periodStart, periodEnd, generatedAt = new Date(), periodName = "対象期間" }
) {
  const start = asDate(periodStart);
  const end = asDate(periodEnd);
  const generated = asDate(generatedAt);
  if (start.getTime() >= end.getTime()) throw new RangeError("invalid_period");

  const normalizedRows = rawRows
    .map(normalizeRow)
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime() || a.id - b.id);
  const allRows = normalizedRows.filter((row) => !row.isTest);
  const periodRows = allRows.filter(
    (row) => row.submittedAt.getTime() >= start.getTime() && row.submittedAt.getTime() < end.getTime()
  );
  const periodStats = distributions(periodRows);
  const allStats = distributions(allRows);
  const entries = periodRows.map(entryFromRow);
  const allTimeEntries = allRows.map(entryFromRow);

  return {
    generatedAt: generated.toISOString(),
    generatedAtJst: formatJstDateTime(generated),
    timezone: "Asia/Tokyo",
    period: {
      name: periodName,
      start: start.toISOString(),
      endExclusive: end.toISOString(),
      startJst: formatJstDateTime(start),
      endJst: formatJstDateTime(new Date(end.getTime() - 1)),
    },
    allTime: {
      start: allRows.length === 0 ? null : allRows[0].submittedAt.toISOString(),
      end: allRows.length === 0 ? null : allRows.at(-1).submittedAt.toISOString(),
      startJst: allRows.length === 0 ? "データなし" : formatJstDateTime(allRows[0].submittedAt),
      endJst: allRows.length === 0 ? "データなし" : formatJstDateTime(allRows.at(-1).submittedAt),
    },
    counts: {
      period: periodRows.length,
      allTime: allRows.length,
    },
    distributions: {
      period: periodStats,
      allTime: allStats,
    },
    comments: {
      original: periodRows.filter((row) => row.comment !== null).map(commentEntry),
    },
    summary: {
      periodInsights: periodInsights(periodRows),
      nextChecks: nextChecks(periodRows, allRows),
      cumulativeTrends: cumulativeTrends(allRows, allStats),
    },
    entries,
    allTimeEntries,
    excludedTestCount: normalizedRows.length - allRows.length,
  };
}

function metricTable(title, periodName, periodItems, allItems) {
  const allByLabel = new Map(allItems.map((item) => [item.label, item]));
  const lines = [
    `### ${title}`,
    "",
    `| 回答 | ${periodName} 件数（割合） | 累計 件数（割合） |`,
    "| --- | ---: | ---: |",
  ];
  for (const item of periodItems) {
    const total = allByLabel.get(item.label) ?? { count: 0, percentage: 0 };
    lines.push(
      `| ${item.label} | ${item.count}件（${item.percentage}%） | ${total.count}件（${total.percentage}%） |`
    );
  }
  return lines.join("\n");
}

function bulletList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function appendEntries(lines, entries, emptyMessage) {
  if (entries.length === 0) {
    lines.push(emptyMessage, "");
    return;
  }
  for (const entry of entries) {
    lines.push(
      `### ID ${entry.id}`,
      "",
      `- 送信日時（日本時間）: ${entry.submittedAt}`,
      `- 年齢: ${entry.age}`,
      `- ひとりで遊べたか: ${entry.independence}`,
      `- また遊びたがったか: ${entry.replayInterest}`,
      `- 手助けが必要だった場所: ${entry.helpAreas.join("、")}`,
      "- 自由記述:",
      ...entry.comment.split(/\r?\n/).map((line) => `  > ${line}`),
      ""
    );
  }
}

export function renderFeedbackReportMarkdown(report) {
  const subjectRange = `${formatJstDate(report.period.start)}〜${formatJstDate(
    new Date(new Date(report.period.endExclusive).getTime() - 1)
  )}`;
  const isWeekly = report.period.name === "今週";
  const reportTitle = isWeekly ? "週間感想レポート" : "感想レポート";
  const periodCountHeading = isWeekly
    ? "今週の実利用者からの感想"
    : `${report.period.name}の実利用者からの感想`;
  const lines = [
    `# 【くるまどれかな？】${reportTitle} ${subjectRange}`,
    "",
    `## 【${periodCountHeading}】`,
    "",
    `${report.counts.period}件`,
    "",
    "## 【累計の実利用者感想】",
    "",
    `${report.counts.allTime}件`,
    "",
    `## 【${isWeekly ? "今週わかったこと" : `${report.period.name}でわかったこと`}】`,
    "",
    bulletList(report.summary.periodInsights.slice(0, 3)),
    "",
    "## 【次に見ること】",
    "",
    bulletList(report.summary.nextChecks.slice(0, 2)),
    "",
    `## ${isWeekly ? "今週の個別感想" : `${report.period.name}の個別感想`}`,
    "",
  ];

  appendEntries(lines, report.entries, `${report.period.name}の実利用者感想はありません。`);

  if (report.counts.allTime < 5) {
    lines.push("## これまでの全感想", "");
    appendEntries(lines, report.allTimeEntries, "実利用者感想はまだありません。");
  }

  lines.push(
    "## 累計傾向",
    "",
    bulletList(report.summary.cumulativeTrends),
    "",
    "## 詳細集計表",
    "",
    metricTable(
      "ひとりで遊べたか",
      report.period.name,
      report.distributions.period.independence,
      report.distributions.allTime.independence
    ),
    "",
    metricTable(
      "また遊びたがったか",
      report.period.name,
      report.distributions.period.replayInterest,
      report.distributions.allTime.replayInterest
    ),
    "",
    metricTable(
      "年齢層別",
      report.period.name,
      report.distributions.period.ageGroup,
      report.distributions.allTime.ageGroup
    ),
    "",
    metricTable(
      "手助けが必要だった箇所別",
      report.period.name,
      report.distributions.period.helpAreas,
      report.distributions.allTime.helpAreas
    ),
    "",
    "※手助け箇所は複数選択のため、割合の合計が100%を超える場合があります。"
  );

  return `${lines.join("\n").trim()}\n`;
}

export function weeklyReportSubject(report) {
  const inclusiveEnd = new Date(new Date(report.period.endExclusive).getTime() - 1);
  return `【くるまどれかな？】週間感想レポート ${formatJstDate(report.period.start)}〜${formatJstDate(
    inclusiveEnd
  )}`;
}
