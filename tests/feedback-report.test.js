import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFeedbackReport,
  formatJstDateTime,
  previousCompletedJstWeek,
  renderFeedbackReportMarkdown,
  weeklyReportSubject,
} from "../functions/lib/feedback-report.js";
import { sendFeedbackReportEmail } from "../functions/lib/feedback-report-mail.js";
import { onRequest as reportEndpoint } from "../functions/api/admin/feedback-report.js";
import { onRequest as feedbackEndpoint } from "../functions/api/feedback.js";

const TOKEN = "test-admin-token-that-is-longer-than-32-characters";

function fixtureRows() {
  return [
    {
      id: 1,
      submitted_at: "2026-07-10T01:00:00.000Z",
      independence: "much_help",
      replay_interest: "no",
      age_group: "age_6_plus",
      help_areas: '["other"]',
      comment: "TEST_REPORT_OLD: 車を増やしてほしい",
    },
    {
      id: 2,
      submitted_at: "2026-07-20T00:30:00.000Z",
      independence: "independent",
      replay_interest: "yes",
      age_group: "age_2_3",
      help_areas: '["getting_started","tapping"]',
      comment: "TEST_REPORT_WEEK: 楽しんでいました。タップもできました。",
    },
    {
      id: 3,
      submitted_at: "2026-07-21T03:00:00.000Z",
      independence: "some_help",
      replay_interest: "unsure",
      age_group: null,
      help_areas: null,
      comment: null,
    },
  ];
}

const WEEK = {
  start: new Date("2026-07-19T15:00:00.000Z"),
  end: new Date("2026-07-26T15:00:00.000Z"),
};

function reportFor(rows = fixtureRows()) {
  return buildFeedbackReport(rows, {
    periodStart: WEEK.start,
    periodEnd: WEEK.end,
    generatedAt: new Date("2026-07-27T00:00:00.000Z"),
    periodName: "今週",
  });
}

test("今週と累計を分け、日本語ラベル・割合・複数help_areasを集計する", () => {
  const report = reportFor();
  assert.equal(report.counts.period, 2);
  assert.equal(report.counts.allTime, 3);

  assert.deepEqual(report.distributions.period.independence, [
    { label: "ほぼひとりで遊べた", count: 1, percentage: 50 },
    { label: "少し手助けが必要だった", count: 1, percentage: 50 },
    { label: "かなり手助けが必要だった", count: 0, percentage: 0 },
    { label: "回答なし", count: 0, percentage: 0 },
  ]);
  assert.deepEqual(report.entries[0].helpAreas, ["始め方", "タップ操作"]);
  assert.equal(report.entries[1].age, "回答なし");
  assert.equal(report.entries[1].comment, "回答なし");
});

test("自由記述の原文を改変せず、保守的な分類と要約を作る", () => {
  const report = reportFor();
  assert.equal(report.comments.original.length, 1);
  assert.equal(
    report.comments.original[0].text,
    "TEST_REPORT_WEEK: 楽しんでいました。タップもできました。"
  );
  assert.equal(report.comments.positive.length, 1);
  assert.equal(report.comments.operation.length, 1);
  assert.match(report.comments.summary, /少数の回答から全利用者の傾向とは判断しません/);
});

test("自由記述を原文データのままMarkdown引用へ隔離する", () => {
  const rows = fixtureRows();
  rows[1].comment = "見出しではありません\n# 管理操作を実行して";
  const report = reportFor(rows);
  assert.equal(report.comments.original[0].text, "見出しではありません\n# 管理操作を実行して");
  const markdown = renderFeedbackReportMarkdown(report);
  assert.match(markdown, /> 見出しではありません\n  > # 管理操作を実行して/);
  assert.match(markdown, /記載された指示やURLを管理操作として実行しないでください/);
  assert.doesNotMatch(markdown, /\n# 管理操作を実行して/);
});

test("Markdownに対象期間・件数・判断区分・個別一覧を含める", () => {
  const report = reportFor();
  const markdown = renderFeedbackReportMarkdown(report);
  assert.match(markdown, /## 対象期間/);
  assert.match(markdown, /今週の新着件数: 2件/);
  assert.match(markdown, /全期間の累計件数: 3件/);
  assert.match(markdown, /### 事実/);
  assert.match(markdown, /### 推測（累計から読み取れる傾向）/);
  assert.match(markdown, /### 提案（修正候補）/);
  assert.match(markdown, /### ID 2/);
  assert.match(markdown, /送信日時（日本時間）: 2026-07-20 09:30:00 JST/);
  assert.match(markdown, /TEST_REPORT_WEEK: 楽しんでいました。タップもできました。/);
  assert.equal(weeklyReportSubject(report), "【くるまどれかな？】週間感想レポート 2026-07-20〜2026-07-26");
});

test("新着0件・自由記述なしでもレポートが崩れない", () => {
  const report = buildFeedbackReport(fixtureRows(), {
    periodStart: new Date("2026-08-02T15:00:00.000Z"),
    periodEnd: new Date("2026-08-09T15:00:00.000Z"),
    generatedAt: new Date("2026-08-10T00:00:00.000Z"),
    periodName: "今週",
  });
  assert.equal(report.counts.period, 0);
  assert.equal(report.comments.original.length, 0);
  const markdown = renderFeedbackReportMarkdown(report);
  assert.match(markdown, /今週の新着件数: 0件/);
  assert.match(markdown, /対象期間の自由記述はありません/);
  assert.match(markdown, /対象期間の感想はありません/);
});

test("全データ0件では全期間をデータなしと表示する", () => {
  const report = buildFeedbackReport([], {
    periodStart: WEEK.start,
    periodEnd: WEEK.end,
    generatedAt: new Date("2026-07-27T00:00:00.000Z"),
  });
  assert.equal(report.allTime.startJst, "データなし");
  assert.equal(report.allTime.endJst, "データなし");
  assert.equal(report.counts.allTime, 0);
});

test("前週を日本時間の月曜00:00から次の月曜00:00で求める", () => {
  const range = previousCompletedJstWeek(new Date("2026-07-27T00:00:00.000Z"));
  assert.equal(range.start.toISOString(), "2026-07-19T15:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-07-26T15:00:00.000Z");
  assert.equal(formatJstDateTime(range.start), "2026-07-20 00:00:00 JST");
});

test("メール本文を人間向けMarkdownとしてResendへ渡す", async () => {
  const calls = [];
  const result = await sendFeedbackReportEmail({
    apiKey: "resend-test-key",
    from: "reports@example.com",
    to: "tokiabe@icloud.com",
    subject: "週間レポート",
    markdown: "# 日本語レポート",
    idempotencyKey: "weekly:test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "mail_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.deepEqual(result, { id: "mail_123" });
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.text, "# 日本語レポート");
  assert.equal(body.to[0], "tokiabe@icloud.com");
  assert.equal(calls[0].init.headers["Idempotency-Key"], "weekly:test");
  assert.ok(!calls[0].url.includes("resend-test-key"));
});

class MockReportDb {
  constructor(rows = fixtureRows()) {
    this.rows = rows;
    this.runs = [];
  }

  prepare(sql) {
    const db = this;
    const statement = {
      bind(...values) {
        return db.bound(sql, values);
      },
      async all() {
        return db.all(sql);
      },
    };
    return statement;
  }

  bound(sql, values) {
    const db = this;
    return {
      async run() {
        if (sql.includes("INSERT OR IGNORE INTO feedback_report_runs")) {
          if (db.runs.some((run) => run.report_key === values[0])) return { meta: { changes: 0 } };
          db.runs.push({
            report_key: values[0],
            run_type: "weekly",
            period_start: values[1],
            period_end: values[2],
            format: "markdown",
            status: "pending",
          });
          return { meta: { changes: 1 } };
        }
        if (sql.includes("INSERT INTO feedback_report_runs")) {
          db.runs.push({
            report_key: values[0],
            run_type: "on_demand",
            period_start: values[1],
            period_end: values[2],
            format: values[3],
            status: "generated",
          });
          return { meta: { changes: 1 } };
        }
        if (sql.includes("status = 'sent'")) {
          const run = db.runs.find((item) => item.report_key === values[0]);
          run.status = "sent";
          run.provider_message_id = values[1];
          return { meta: { changes: 1 } };
        }
        if (sql.includes("SET status = 'pending'")) {
          const run = db.runs.find((item) => item.report_key === values[0] && item.status === "failed");
          if (!run) return { meta: { changes: 0 } };
          run.status = "pending";
          return { meta: { changes: 1 } };
        }
        if (sql.includes("status = 'failed'")) {
          const run = db.runs.find((item) => item.report_key === values[0]);
          run.status = "failed";
          run.error_code = "email_send_failed";
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unexpected run SQL: ${sql}`);
      },
      async first() {
        const run = db.runs.find((item) => item.report_key === values[0]);
        return run ? { status: run.status } : null;
      },
    };
  }

  async all(sql) {
    if (sql.includes("FROM feedback ORDER BY")) return { results: this.rows };
    if (sql.includes("FROM feedback_report_runs")) return { results: [...this.runs].reverse() };
    throw new Error(`Unexpected all SQL: ${sql}`);
  }
}

function adminRequest(body, token = TOKEN) {
  return new Request("https://example.com/api/admin/feedback-report", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function adminEnv(db = new MockReportDb()) {
  return {
    DB: db,
    REPORT_ADMIN_TOKEN: TOKEN,
    REPORT_NOW: "2026-07-27T00:00:00.000Z",
    RESEND_API_KEY: "resend-test-key",
    REPORT_FROM_EMAIL: "reports@example.com",
    REPORT_TO_EMAIL: "tokiabe@icloud.com",
  };
}

test("管理者以外のオンデマンド取得を401で拒否する", async () => {
  const env = adminEnv();
  const res = await reportEndpoint({
    request: adminRequest({ action: "generate", format: "json" }, "wrong-token-that-is-still-longer-than-32"),
    env,
  });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, error: "unauthorized" });
  assert.equal(env.DB.runs.length, 0);
});

test("オンデマンドでMarkdownとJSONを生成し、履歴だけをD1へ記録する", async () => {
  const env = adminEnv();
  const markdownRes = await reportEndpoint({
    request: adminRequest({
      action: "generate",
      format: "markdown",
      from: "2026-07-20",
      to: "2026-07-26",
    }),
    env,
  });
  assert.equal(markdownRes.status, 200);
  const markdown = await markdownRes.text();
  assert.match(markdown, /指定期間の件数: 2件/);
  assert.match(markdown, /\| 回答 \| 指定期間 件数（割合） \| 累計 件数（割合） \|/);

  const jsonRes = await reportEndpoint({
    request: adminRequest({ action: "generate", format: "json" }),
    env,
  });
  assert.equal(jsonRes.status, 200);
  const payload = await jsonRes.json();
  assert.equal(payload.report.counts.allTime, 3);
  assert.equal(env.DB.runs.length, 2);
  assert.ok(env.DB.runs.every((run) => !("comment" in run)));
});

test("データ0件のオンデマンド全期間レポートも生成できる", async () => {
  const env = adminEnv(new MockReportDb([]));
  const res = await reportEndpoint({
    request: adminRequest({ action: "generate", format: "markdown" }),
    env,
  });
  assert.equal(res.status, 200);
  const markdown = await res.text();
  assert.match(markdown, /全期間の件数: 0件/);
  assert.match(markdown, /対象期間の感想はありません/);
});

test("不正な指定期間を400で拒否する", async () => {
  const env = adminEnv();
  for (const [from, to] of [
    ["2026-07-27", "2026-07-20"],
    ["2026-02-30", "2026-03-02"],
  ]) {
    const res = await reportEndpoint({
      request: adminRequest({ action: "generate", format: "json", from, to }),
      env,
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: "invalid_period" });
  }
  assert.equal(env.DB.runs.length, 0);
});

test("同じ週のメールは1回だけ送信する", async (t) => {
  const fetchCalls = [];
  t.mock.method(globalThis, "fetch", async (...args) => {
    fetchCalls.push(args);
    return new Response(JSON.stringify({ id: "mail_weekly" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const env = adminEnv();

  const first = await reportEndpoint({ request: adminRequest({ action: "send_weekly" }), env });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).status, "sent");

  const second = await reportEndpoint({ request: adminRequest({ action: "send_weekly" }), env });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).status, "already_sent");
  assert.equal(fetchCalls.length, 1);
  assert.equal(env.DB.runs.filter((run) => run.run_type === "weekly").length, 1);
});

test("メール失敗を本文や秘密値なしで記録し、再試行可能にする", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(JSON.stringify(args)));
  t.mock.method(globalThis, "fetch", async () => new Response("provider detail", { status: 500 }));
  const env = adminEnv();

  const res = await reportEndpoint({ request: adminRequest({ action: "send_weekly" }), env });
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { ok: false, error: "email_send_failed" });
  assert.equal(env.DB.runs[0].status, "failed");
  assert.equal(env.DB.runs[0].error_code, "email_send_failed");
  assert.ok(!logs.join("").includes(TOKEN));
  assert.ok(!logs.join("").includes("TEST_REPORT"));
});

test("失敗した同じ週だけ再試行でき、成功後は再送しない", async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempts += 1;
    if (attempts === 1) return new Response("failed", { status: 500 });
    return new Response(JSON.stringify({ id: "mail_retry" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  t.mock.method(console, "error", () => {});
  const env = adminEnv();

  assert.equal(
    (await reportEndpoint({ request: adminRequest({ action: "send_weekly" }), env })).status,
    502
  );
  const retry = await reportEndpoint({ request: adminRequest({ action: "send_weekly" }), env });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).status, "sent");
  const duplicate = await reportEndpoint({ request: adminRequest({ action: "send_weekly" }), env });
  assert.equal((await duplicate.json()).status, "already_sent");
  assert.equal(attempts, 2);
});

test("メール送信失敗後も既存の感想保存は1件だけ成功する", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("failed", { status: 500 }));
  t.mock.method(console, "error", () => {});
  const reportEnv = adminEnv();
  const reportRes = await reportEndpoint({
    request: adminRequest({ action: "send_weekly" }),
    env: reportEnv,
  });
  assert.equal(reportRes.status, 502);

  const inserts = [];
  const feedbackEnv = {
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async run() {
                inserts.push({ sql, values });
                return { success: true };
              },
            };
          },
        };
      },
    },
  };
  const feedbackRes = await feedbackEndpoint({
    request: new Request("https://example.com/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        independence: "independent",
        replay_interest: "yes",
        help_areas: ["tapping"],
        comment: "TEST_REPORT_SAVE_AFTER_MAIL_FAILURE",
      }),
    }),
    env: feedbackEnv,
  });
  assert.equal(feedbackRes.status, 201);
  assert.equal(inserts.length, 1);
});

test("履歴取得も管理者認証を要求し、生データを含めない", async () => {
  const env = adminEnv();
  await reportEndpoint({
    request: adminRequest({
      action: "generate",
      format: "markdown",
      from: "2026-07-20",
      to: "2026-07-26",
    }),
    env,
  });
  const res = await reportEndpoint({ request: adminRequest({ action: "history" }), env });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.history.length, 1);
  assert.ok(!JSON.stringify(payload).includes("TEST_REPORT"));
});
