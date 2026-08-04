/**
 * POST /api/play-session
 * 匿名セッションの累計スナップショットだけをD1へ保存する。
 */

export const MAX_BODY_BYTES = 2048;
export const MAX_VALUES = Object.freeze({
  tapCount: 10000,
  completedRounds: 5000,
  rareCount: 2000,
  elapsedMs: 86400000,
});

export const ALLOWED_SOURCES = new Set([
  "x",
  "instagram",
  "facebook",
  "card",
  "direct_share",
  "support",
  "unknown",
]);

const ALLOWED_RETURN_STATUS = new Set(["first_time", "returning"]);
const ALLOWED_RETURN_BUCKETS = new Set([
  "first_time",
  "same_day",
  "1_7_days",
  "8_30_days",
  "31_plus_days",
  "unknown",
]);
const BOOLEAN_FIELDS = [
  "support_viewed",
  "support_play_clicked",
  "game_page_opened",
  "game_started",
  "first_choice_tapped",
];
const NUMBER_LIMITS = {
  correct_tap_count: MAX_VALUES.tapCount,
  wrong_tap_count: MAX_VALUES.tapCount,
  completed_round_count: MAX_VALUES.completedRounds,
  rare_car_shown_count: MAX_VALUES.rareCount,
  rare_car_interaction_count: MAX_VALUES.rareCount,
  visible_play_ms: MAX_VALUES.elapsedMs,
  interaction_span_ms: MAX_VALUES.elapsedMs,
};
const KNOWN_FIELDS = new Set([
  "session_id",
  ...BOOLEAN_FIELDS,
  ...Object.keys(NUMBER_LIMITS),
  "return_status",
  "return_interval_bucket",
  "source_code",
  "is_test",
  "client_version",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isSameOriginBrowserRequest(request) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== expected) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function integer(value, max) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
}

export function validatePlaySession(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  if (Object.keys(body).some((key) => !KNOWN_FIELDS.has(key))) return { ok: false };
  if (typeof body.session_id !== "string" || !UUID_PATTERN.test(body.session_id)) return { ok: false };
  if (typeof body.client_version !== "string" || !/^[a-z0-9._-]{1,32}$/i.test(body.client_version)) {
    return { ok: false };
  }

  const data = {
    session_id: body.session_id.toLowerCase(),
    client_version: body.client_version,
  };
  for (const field of BOOLEAN_FIELDS) {
    if (typeof body[field] !== "boolean") return { ok: false };
    data[field] = body[field] ? 1 : 0;
  }
  for (const [field, max] of Object.entries(NUMBER_LIMITS)) {
    const value = integer(body[field], max);
    if (value === null) return { ok: false };
    data[field] = value;
  }
  if (body.return_status !== null && !ALLOWED_RETURN_STATUS.has(body.return_status)) return { ok: false };
  if (body.return_interval_bucket !== null && !ALLOWED_RETURN_BUCKETS.has(body.return_interval_bucket)) {
    return { ok: false };
  }
  data.return_status = body.return_status;
  data.return_interval_bucket = body.return_interval_bucket;
  data.source_code = ALLOWED_SOURCES.has(body.source_code) ? body.source_code : "unknown";
  if (typeof body.is_test !== "boolean") return { ok: false };
  data.is_test = body.is_test ? 1 : 0;
  return { ok: true, data };
}

export const UPSERT_PLAY_SESSION_SQL = `
INSERT INTO play_sessions (
  session_id, support_viewed, support_play_clicked, game_page_opened, game_started,
  first_choice_tapped, correct_tap_count, wrong_tap_count, completed_round_count,
  rare_car_shown_count, rare_car_interaction_count, visible_play_ms, interaction_span_ms,
  return_status, return_interval_bucket, source_code, is_test, client_version
) VALUES (
  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18
)
ON CONFLICT(session_id) DO UPDATE SET
  last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  support_viewed = MAX(play_sessions.support_viewed, excluded.support_viewed),
  support_play_clicked = MAX(play_sessions.support_play_clicked, excluded.support_play_clicked),
  game_page_opened = MAX(play_sessions.game_page_opened, excluded.game_page_opened),
  game_started = MAX(play_sessions.game_started, excluded.game_started),
  first_choice_tapped = MAX(play_sessions.first_choice_tapped, excluded.first_choice_tapped),
  correct_tap_count = MAX(play_sessions.correct_tap_count, excluded.correct_tap_count),
  wrong_tap_count = MAX(play_sessions.wrong_tap_count, excluded.wrong_tap_count),
  completed_round_count = MAX(play_sessions.completed_round_count, excluded.completed_round_count),
  rare_car_shown_count = MAX(play_sessions.rare_car_shown_count, excluded.rare_car_shown_count),
  rare_car_interaction_count = MAX(play_sessions.rare_car_interaction_count, excluded.rare_car_interaction_count),
  visible_play_ms = MAX(play_sessions.visible_play_ms, excluded.visible_play_ms),
  interaction_span_ms = MAX(play_sessions.interaction_span_ms, excluded.interaction_span_ms),
  return_status = COALESCE(play_sessions.return_status, excluded.return_status),
  return_interval_bucket = COALESCE(play_sessions.return_interval_bucket, excluded.return_interval_bucket),
  source_code = CASE
    WHEN play_sessions.source_code = 'unknown' AND excluded.source_code <> 'unknown' THEN excluded.source_code
    ELSE play_sessions.source_code
  END,
  is_test = MAX(play_sessions.is_test, excluded.is_test),
  client_version = excluded.client_version
`;

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  if (!isSameOriginBrowserRequest(request)) return json(403, { ok: false });
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;.*)?$/i.test(contentType)) return json(415, { ok: false });
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return json(413, { ok: false });

  let raw;
  try {
    raw = await request.text();
  } catch {
    return json(400, { ok: false });
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(413, { ok: false });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(400, { ok: false });
  }
  const validated = validatePlaySession(parsed);
  if (!validated.ok) return json(400, { ok: false });
  const d = validated.data;

  try {
    await env.DB.prepare(UPSERT_PLAY_SESSION_SQL)
      .bind(
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
        d.client_version
      )
      .run();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("play session upsert failed", { name: error?.name ?? "Error" });
    return json(500, { ok: false });
  }
}
