import {
  buildFeedbackReport,
  previousCompletedJstWeek,
  renderFeedbackReportMarkdown,
  weeklyReportSubject,
} from "../../lib/feedback-report.js";
import { sendFeedbackReportEmail } from "../../lib/feedback-report-mail.js";

const MAX_BODY_BYTES = 2048;
const DEFAULT_TO_EMAIL = "tokiabe@icloud.com";

function responseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    Vary: "Authorization",
  };
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders("application/json; charset=utf-8"),
  });
}

function markdown(markdownBody) {
  return new Response(markdownBody, {
    status: 200,
    headers: responseHeaders("text/markdown; charset=utf-8"),
  });
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function isAuthorized(request, expectedToken) {
  if (typeof expectedToken !== "string" || expectedToken.length < 32) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const supplied = header.slice(7);
  if (supplied.length < 32 || supplied.length > 512) return false;
  const [actualHash, expectedHash] = await Promise.all([digest(supplied), digest(expectedToken)]);
  let difference = actualHash.length ^ expectedHash.length;
  for (let i = 0; i < Math.max(actualHash.length, expectedHash.length); i += 1) {
    difference |= (actualHash[i] ?? 0) ^ (expectedHash[i] ?? 0);
  }
  return difference === 0;
}

async function readJson(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;.*)?$/i.test(contentType)) throw new Error("unsupported_content_type");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error("body_too_large");
  return JSON.parse(raw);
}

async function loadFeedbackRows(db) {
  const result = await db
    .prepare(
      "SELECT id, submitted_at, independence, replay_interest, age_group, help_areas, comment FROM feedback ORDER BY submitted_at ASC, id ASC"
    )
    .all();
  return Array.isArray(result.results) ? result.results : [];
}

function parseBoundary(value, { endOfDay = false } = {}) {
  if (typeof value !== "string" || value.length > 40) throw new Error("invalid_period");
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00+09:00`);
    const [year, month, day] = value.split("-").map(Number);
    const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    if (
      shifted.getUTCFullYear() !== year ||
      shifted.getUTCMonth() + 1 !== month ||
      shifted.getUTCDate() !== day
    ) {
      throw new Error("invalid_period");
    }
    if (endOfDay) date.setTime(date.getTime() + 24 * 60 * 60 * 1000);
    return date;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_period");
  return date;
}

function requestedRange(body, rows, now) {
  const hasFrom = Object.hasOwn(body, "from");
  const hasTo = Object.hasOwn(body, "to");
  if (hasFrom !== hasTo) throw new Error("invalid_period");
  if (hasFrom) {
    const start = parseBoundary(body.from);
    const end = parseBoundary(body.to, { endOfDay: /^\d{4}-\d{2}-\d{2}$/.test(body.to) });
    if (start.getTime() >= end.getTime()) throw new Error("invalid_period");
    return { start, end, name: "指定期間" };
  }
  const first = rows.length > 0 ? new Date(rows[0].submitted_at) : new Date(now.getTime() - 1);
  return { start: first, end: now, name: "全期間" };
}

function reportKeyForWeekly(start, end) {
  return `weekly:${start.toISOString()}:${end.toISOString()}`;
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function claimWeeklyRun(db, key, start, end) {
  const inserted = await db
    .prepare(
      "INSERT OR IGNORE INTO feedback_report_runs (report_key, run_type, period_start, period_end, format, status) VALUES (?1, 'weekly', ?2, ?3, 'markdown', 'pending')"
    )
    .bind(key, start.toISOString(), end.toISOString())
    .run();
  if (changes(inserted) === 1) return { claimed: true };

  const existing = await db
    .prepare("SELECT status FROM feedback_report_runs WHERE report_key = ?1")
    .bind(key)
    .first();
  if (existing?.status === "sent") return { claimed: false, status: "already_sent" };
  if (existing?.status === "failed") {
    const retried = await db
      .prepare(
        "UPDATE feedback_report_runs SET status = 'pending', error_code = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE report_key = ?1 AND status = 'failed'"
      )
      .bind(key)
      .run();
    if (changes(retried) === 1) return { claimed: true };
  }
  return { claimed: false, status: "in_progress" };
}

async function recordOnDemandRun(db, start, end, format) {
  await db
    .prepare(
      "INSERT INTO feedback_report_runs (report_key, run_type, period_start, period_end, format, status) VALUES (?1, 'on_demand', ?2, ?3, ?4, 'generated')"
    )
    .bind(`on-demand:${crypto.randomUUID()}`, start.toISOString(), end.toISOString(), format)
    .run();
}

async function reportHistory(db) {
  const result = await db
    .prepare(
      "SELECT report_key, run_type, period_start, period_end, format, status, generated_at, sent_at, error_code FROM feedback_report_runs ORDER BY id DESC LIMIT 50"
    )
    .all();
  return Array.isArray(result.results) ? result.results : [];
}

async function handleGenerate(body, env, now) {
  const format = body.format ?? "markdown";
  if (!["markdown", "json"].includes(format)) return json(400, { ok: false, error: "invalid_format" });
  const rows = await loadFeedbackRows(env.DB);
  const range = requestedRange(body, rows, now);
  const report = buildFeedbackReport(rows, {
    periodStart: range.start,
    periodEnd: range.end,
    generatedAt: now,
    periodName: range.name,
  });
  await recordOnDemandRun(env.DB, range.start, range.end, format);
  return format === "json" ? json(200, { ok: true, report }) : markdown(renderFeedbackReportMarkdown(report));
}

async function handleWeekly(env, now) {
  const range = previousCompletedJstWeek(now);
  const key = reportKeyForWeekly(range.start, range.end);
  const claim = await claimWeeklyRun(env.DB, key, range.start, range.end);
  if (!claim.claimed) return json(200, { ok: true, status: claim.status, reportKey: key });

  const rows = await loadFeedbackRows(env.DB);
  const report = buildFeedbackReport(rows, {
    periodStart: range.start,
    periodEnd: range.end,
    generatedAt: now,
    periodName: "今週",
  });
  const reportMarkdown = renderFeedbackReportMarkdown(report);

  try {
    const sent = await sendFeedbackReportEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.REPORT_FROM_EMAIL,
      to: env.REPORT_TO_EMAIL || DEFAULT_TO_EMAIL,
      subject: weeklyReportSubject(report),
      markdown: reportMarkdown,
      idempotencyKey: key,
    });
    await env.DB
      .prepare(
        "UPDATE feedback_report_runs SET status = 'sent', sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), provider_message_id = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE report_key = ?1"
      )
      .bind(key, sent.id)
      .run();
    return json(200, {
      ok: true,
      status: "sent",
      reportKey: key,
      newCount: report.counts.period,
      totalCount: report.counts.allTime,
    });
  } catch (error) {
    await env.DB
      .prepare(
        "UPDATE feedback_report_runs SET status = 'failed', error_code = 'email_send_failed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE report_key = ?1"
      )
      .bind(key)
      .run();
    console.error("weekly feedback report email failed", { name: error?.name ?? "Error" });
    return json(502, { ok: false, error: "email_send_failed" });
  }
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { ...responseHeaders("text/plain"), Allow: "POST" } });
  }
  if (!(await isAuthorized(request, env.REPORT_ADMIN_TOKEN))) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  let body;
  try {
    body = await readJson(request);
  } catch {
    return json(400, { ok: false, error: "invalid_request" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return json(400, { ok: false, error: "invalid_request" });
  }

  try {
    const now = env.REPORT_NOW ? new Date(env.REPORT_NOW) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error("invalid_now");
    if (body.action === "generate") return await handleGenerate(body, env, now);
    if (body.action === "send_weekly") return await handleWeekly(env, now);
    if (body.action === "history") return json(200, { ok: true, history: await reportHistory(env.DB) });
    return json(400, { ok: false, error: "invalid_action" });
  } catch (error) {
    if (error?.message === "invalid_period") {
      return json(400, { ok: false, error: "invalid_period" });
    }
    console.error("feedback report request failed", { name: error?.name ?? "Error" });
    return json(500, { ok: false, error: "server_error" });
  }
}
