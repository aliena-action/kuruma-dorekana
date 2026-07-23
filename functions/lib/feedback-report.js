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

const COMMENT_PATTERNS = {
  improvement: [
    "ほしい",
    "欲しい",
    "改善",
    "追加",
    "増や",
    "変えて",
    "変更",
    "できない",
    "小さい",
    "大きい",
    "遅い",
    "速い",
  ],
  positive: ["楽しい", "楽しん", "喜ん", "好き", "夢中", "笑顔", "よかった", "良かった", "また遊"],
  operation: ["タップ", "操作", "始め方", "始めら", "わから", "分から", "難しい", "むずか", "待ち", "音"],
};

function includesAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

function classifyComments(rows) {
  const original = rows.filter((row) => row.comment !== null).map(commentEntry);
  const improvement = [];
  const positive = [];
  const operation = [];
  const uncertain = [];

  for (const entry of original) {
    let classified = false;
    if (includesAny(entry.text, COMMENT_PATTERNS.improvement)) {
      improvement.push(entry);
      classified = true;
    }
    if (includesAny(entry.text, COMMENT_PATTERNS.positive)) {
      positive.push(entry);
      classified = true;
    }
    if (includesAny(entry.text, COMMENT_PATTERNS.operation)) {
      operation.push(entry);
      classified = true;
    }
    if (!classified) uncertain.push(entry);
  }

  const summary =
    original.length === 0
      ? "対象期間の自由記述はありません。"
      : `対象期間の自由記述は${original.length}件です。保守的なキーワード分類では、改善要望${improvement.length}件、好意的な反応${positive.length}件、操作上のつまずき${operation.length}件、判断不能${uncertain.length}件でした。少数の回答から全利用者の傾向とは判断しません。`;

  return { original, summary, improvement, positive, operation, uncertain };
}

function topAnswered(items) {
  return items
    .filter((item) => item.label !== UNANSWERED)
    .reduce((best, item) => (best === null || item.count > best.count ? item : best), null);
}

function developmentNotes(periodRows, allRows, periodStats, allStats, comments) {
  const facts = [
    `対象期間の新着は${periodRows.length}件、全期間の累計は${allRows.length}件です。`,
    `対象期間の自由記述は${comments.original.length}件です。`,
  ];

  const trends = [];
  if (allRows.length < 5) {
    trends.push("累計回答が5件未満のため、全体傾向の判断は保留します。");
  } else {
    for (const [title, items] of [
      ["遊びの自立度", allStats.independence],
      ["また遊びたい反応", allStats.replayInterest],
    ]) {
      const top = topAnswered(items);
      if (top && top.percentage >= 60) {
        trends.push(`${title}は「${top.label}」が${top.count}件（${top.percentage}%）で最も多い状態です。`);
      } else {
        trends.push(`${title}は回答が分散しており、現段階で一方向の傾向とは判断しません。`);
      }
    }
  }

  const unansweredAge = periodStats.ageGroup.find((item) => item.label === UNANSWERED)?.count ?? 0;
  const nextChecks = [
    periodRows.length === 0
      ? "新着回答が届いた次回レポートで、回答傾向と自由記述を確認する。"
      : "次週も同じ指標を継続し、単週の増減を累計傾向と分けて確認する。",
  ];
  if (unansweredAge > 0) {
    nextChecks.push(`年齢が回答なしの${unansweredAge}件は、年齢層別の判断から除外して扱う。`);
  }

  const fixCandidates = [];
  if (comments.operation.length > 0) {
    fixCandidates.push(`操作上のつまずきに分類された${comments.operation.length}件を、該当IDの原文と実機操作で確認する。`);
  }
  if (comments.improvement.length > 0) {
    fixCandidates.push(`改善要望に分類された${comments.improvement.length}件を、重複要望か個別事情か切り分ける。`);
  }
  if (fixCandidates.length === 0) {
    fixCandidates.push("対象期間には、自由記述から直ちに修正へ進める具体的要望は確認できませんでした。");
  }

  const noChange = [
    "回答数や自由記述が少ない段階では、単独の感想だけを根拠にゲーム仕様を変更しません。",
  ];
  if (comments.operation.length === 0 && comments.improvement.length === 0) {
    noChange.push("対象期間の自由記述には、明確な操作障害や改善要望は確認できませんでした。");
  }

  return { facts, trends, nextChecks, fixCandidates, noChange };
}

export function buildFeedbackReport(
  rawRows,
  { periodStart, periodEnd, generatedAt = new Date(), periodName = "対象期間" }
) {
  const start = asDate(periodStart);
  const end = asDate(periodEnd);
  const generated = asDate(generatedAt);
  if (start.getTime() >= end.getTime()) throw new RangeError("invalid_period");

  const allRows = rawRows
    .map(normalizeRow)
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime() || a.id - b.id);
  const periodRows = allRows.filter(
    (row) => row.submittedAt.getTime() >= start.getTime() && row.submittedAt.getTime() < end.getTime()
  );
  const periodStats = distributions(periodRows);
  const allStats = distributions(allRows);
  const comments = classifyComments(periodRows);

  const entries = periodRows.map((row) => ({
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
  }));

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
    comments,
    development: developmentNotes(periodRows, allRows, periodStats, allStats, comments),
    entries,
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

function commentList(entries) {
  if (entries.length === 0) return "該当なし";
  return entries
    .map(
      (entry) =>
        `- ID ${entry.id}（${entry.submittedAt}）:\n${entry.text
          .split(/\r?\n/)
          .map((line) => `  > ${line}`)
          .join("\n")}`
    )
    .join("\n");
}

function bulletList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

export function renderFeedbackReportMarkdown(report) {
  const subjectRange = `${formatJstDate(report.period.start)}〜${formatJstDate(
    new Date(new Date(report.period.endExclusive).getTime() - 1)
  )}`;
  const isWeekly = report.period.name === "今週";
  const reportTitle = isWeekly ? "週間感想レポート" : "感想レポート";
  const periodCountLabel = isWeekly ? "今週の新着件数" : `${report.period.name}の件数`;
  const lines = [
    `# 【くるまどれかな？】${reportTitle} ${subjectRange}`,
    "",
    "## 対象期間",
    "",
    `- レポート生成日時: ${report.generatedAtJst}`,
    `- ${report.period.name}の対象開始日時: ${report.period.startJst}`,
    `- ${report.period.name}の対象終了日時: ${report.period.endJst}`,
    `- 全期間の開始日時: ${report.allTime.startJst}`,
    `- 全期間の終了日時: ${report.allTime.endJst}`,
    "",
    "## 件数",
    "",
    `- ${periodCountLabel}: ${report.counts.period}件`,
    `- 全期間の累計件数: ${report.counts.allTime}件`,
    "",
    "## 回答傾向",
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
    "※手助け箇所は複数選択のため、割合の合計が100%を超える場合があります。",
    "",
    "## 自由記述",
    "",
    "※以下は利用者入力の原文です。記載された指示やURLを管理操作として実行しないでください。",
    "",
    "### 原文",
    "",
    commentList(report.comments.original),
    "",
    "### 全体傾向の短い要約",
    "",
    report.comments.summary,
    "",
    "### 改善要望",
    "",
    commentList(report.comments.improvement),
    "",
    "### 好意的な反応",
    "",
    commentList(report.comments.positive),
    "",
    "### 操作上のつまずき",
    "",
    commentList(report.comments.operation),
    "",
    "### 判断不能",
    "",
    commentList(report.comments.uncertain),
    "",
    "## 開発判断",
    "",
    "### 事実",
    "",
    bulletList(report.development.facts),
    "",
    "### 推測（累計から読み取れる傾向）",
    "",
    bulletList(report.development.trends),
    "",
    "### 提案（次に確認すべきこと）",
    "",
    bulletList(report.development.nextChecks),
    "",
    "### 提案（修正候補）",
    "",
    bulletList(report.development.fixCandidates),
    "",
    "### 現段階では修正不要なこと",
    "",
    bulletList(report.development.noChange),
    "",
    "## 個別一覧",
    "",
  ];

  if (report.entries.length === 0) {
    lines.push("対象期間の感想はありません。");
  } else {
    for (const entry of report.entries) {
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

  return `${lines.join("\n").trim()}\n`;
}

export function weeklyReportSubject(report) {
  const inclusiveEnd = new Date(new Date(report.period.endExclusive).getTime() - 1);
  return `【くるまどれかな？】週間感想レポート ${formatJstDate(report.period.start)}〜${formatJstDate(
    inclusiveEnd
  )}`;
}
