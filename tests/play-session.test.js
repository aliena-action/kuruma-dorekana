import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BODY_BYTES,
  UPSERT_PLAY_SESSION_SQL,
  onRequest,
  validatePlaySession,
} from "../functions/api/play-session.js";

function validSession(overrides = {}) {
  return {
    session_id: "123e4567-e89b-42d3-a456-426614174000",
    support_viewed: true,
    support_play_clicked: true,
    game_page_opened: true,
    game_started: true,
    first_choice_tapped: true,
    correct_tap_count: 4,
    wrong_tap_count: 7,
    completed_round_count: 4,
    rare_car_shown_count: 1,
    rare_car_interaction_count: 1,
    visible_play_ms: 215000,
    interaction_span_ms: 191000,
    return_status: "returning",
    return_interval_bucket: "1_7_days",
    source_code: "x",
    is_test: false,
    client_version: "analytics-v1",
    ...overrides,
  };
}

function values(data) {
  const result = validatePlaySession(data);
  assert.equal(result.ok, true);
  const d = result.data;
  return [
    d.session_id,
    d.support_viewed,
    d.support_play_clicked,
    d.game_page_opened,
    d.game_started,
    d.first_choice_tapped,
    d.correct_tap_count,
    d.wrong_tap_count,
    d.completed_round_count,
    d.rare_car_shown_count,
    d.rare_car_interaction_count,
    d.visible_play_ms,
    d.interaction_span_ms,
    d.return_status,
    d.return_interval_bucket,
    d.source_code,
    d.is_test,
    d.client_version,
  ];
}

test("正常な匿名セッションを検証し、許可外sourceをunknownへ変換する", () => {
  assert.equal(validatePlaySession(validSession()).ok, true);
  const unknown = validatePlaySession(validSession({ source_code: "https://example.com/private" }));
  assert.equal(unknown.ok, true);
  assert.equal(unknown.data.source_code, "unknown");
});

test("不正UUID、未知項目、数値上限超過を拒否する", () => {
  assert.equal(validatePlaySession(validSession({ session_id: "visitor-1" })).ok, false);
  assert.equal(validatePlaySession(validSession({ email: "child@example.com" })).ok, false);
  assert.equal(validatePlaySession(validSession({ wrong_tap_count: 10001 })).ok, false);
  assert.equal(validatePlaySession(validSession({ visible_play_ms: 86400001 })).ok, false);
});

test("D1 UPSERTは重複累計を加算せず、値を減らさず、trueをfalseへ戻さない", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0004_create_play_sessions.sql", import.meta.url), "utf8"));
  const statement = db.prepare(UPSERT_PLAY_SESSION_SQL);
  statement.run(...values(validSession()));
  statement.run(
    ...values(
      validSession({
        support_viewed: false,
        game_started: false,
        correct_tap_count: 2,
        wrong_tap_count: 3,
        completed_round_count: 1,
        visible_play_ms: 1000,
        return_status: null,
        return_interval_bucket: null,
        source_code: "unknown",
      })
    )
  );
  let row = db.prepare("SELECT * FROM play_sessions").get();
  assert.equal(row.support_viewed, 1);
  assert.equal(row.game_started, 1);
  assert.equal(row.correct_tap_count, 4);
  assert.equal(row.wrong_tap_count, 7);
  assert.equal(row.completed_round_count, 4);
  assert.equal(row.visible_play_ms, 215000);
  assert.equal(row.return_status, "returning");
  assert.equal(row.source_code, "x");

  statement.run(...values(validSession({ correct_tap_count: 9, visible_play_ms: 300000, is_test: true })));
  row = db.prepare("SELECT * FROM play_sessions").get();
  assert.equal(row.correct_tap_count, 9);
  assert.equal(row.visible_play_ms, 300000);
  assert.equal(row.is_test, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM play_sessions").get().count, 1);
});

function mockEnv() {
  const calls = [];
  return {
    calls,
    env: {
      DB: {
        prepare(sql) {
          return {
            bind(...bound) {
              return {
                async run() {
                  calls.push({ sql, bound });
                  return { success: true };
                },
              };
            },
          };
        },
      },
    },
  };
}

function request(body, { origin = "https://example.com", contentType = "application/json" } = {}) {
  return new Request("https://example.com/api/play-session", {
    method: "POST",
    headers: { "Content-Type": contentType, Origin: origin, "Sec-Fetch-Site": origin === "https://example.com" ? "same-origin" : "cross-site" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("正常なPOSTは1回UPSERTして204を返す", async () => {
  const { env, calls } = mockEnv();
  const response = await onRequest({ request: request(validSession()), env });
  assert.equal(response.status, 204);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ON CONFLICT\(session_id\) DO UPDATE/);
});

test("Content-Type、同一オリジン、body上限を検証する", async () => {
  const { env, calls } = mockEnv();
  assert.equal((await onRequest({ request: request(validSession(), { contentType: "text/plain" }), env })).status, 415);
  assert.equal((await onRequest({ request: request(validSession(), { origin: "https://other.example" }), env })).status, 403);
  const oversized = `${JSON.stringify(validSession()).slice(0, -1)},"padding":"${"a".repeat(MAX_BODY_BYTES)}"}`;
  assert.equal((await onRequest({ request: request(oversized), env })).status, 413);
  assert.equal(calls.length, 0);
});
