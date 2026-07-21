/**
 * POST /api/feedback
 * 「くるまどれかな?」保護者向け感想フォームの受信エンドポイント。
 * Cloudflare Pages Functions + D1 で動作する。
 *
 * 感想はD1へ保存し、同時に運営者メールへ通知する。
 * User-Agent・IPアドレス等のリクエストメタデータは一切読み取らず、保存もしない。
 */

export const ALLOWED_VALUES = {
  independence: ["independent", "some_help", "much_help"],
  replay_interest: ["yes", "unsure", "no"],
  age_group: ["age_2_3", "age_4_5", "age_6_plus"],
  help_areas: ["getting_started", "finding_same_car", "tapping", "waiting", "other"],
};

export const COMMENT_MAX_LENGTH = 300;
export const MAX_HELP_AREAS = 5;
const MAX_BODY_BYTES = 4096;
const FEEDBACK_EMAIL_ENDPOINT = "https://formsubmit.co/ajax/tokiabe@icloud.com";
const ACCEPTED_FIELDS = ["independence", "replay_interest", "age_group", "help_areas", "comment"];

const LABELS = {
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
    getting_started: "遊び始めるところ",
    finding_same_car: "同じ車を見つけるところ",
    tapping: "車をタップするところ",
    waiting: "次の問題を待つところ",
    other: "その他",
  },
};

function stripControlChars(s) {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function validateHelpAreas(value) {
  if (!Array.isArray(value)) return { valid: false };
  if (value.length > MAX_HELP_AREAS) return { valid: false };
  if (!value.every((v) => typeof v === "string" && ALLOWED_VALUES.help_areas.includes(v))) {
    return { valid: false };
  }
  if (new Set(value).size !== value.length) return { valid: false };
  return { valid: true, normalized: value.length === 0 ? null : [...value] };
}

export function validateFeedback(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, fields: ["body"] };
  }

  const unknown = Object.keys(body).filter((key) => !ACCEPTED_FIELDS.includes(key));
  if (unknown.length > 0) {
    return { ok: false, fields: unknown };
  }

  const fields = [];
  const data = {};

  for (const key of ["independence", "replay_interest"]) {
    if (ALLOWED_VALUES[key].includes(body[key])) {
      data[key] = body[key];
    } else {
      fields.push(key);
    }
  }

  if (!("age_group" in body)) {
    data.age_group = null;
  } else if (ALLOWED_VALUES.age_group.includes(body.age_group)) {
    data.age_group = body.age_group;
  } else {
    fields.push("age_group");
  }

  if (!("help_areas" in body)) {
    data.help_areas = null;
  } else {
    const result = validateHelpAreas(body.help_areas);
    if (result.valid) {
      data.help_areas = result.normalized;
    } else {
      fields.push("help_areas");
    }
  }

  if (!("comment" in body)) {
    data.comment = null;
  } else if (typeof body.comment !== "string") {
    fields.push("comment");
  } else {
    const cleaned = stripControlChars(body.comment).trim();
    if (Array.from(cleaned).length > COMMENT_MAX_LENGTH) {
      fields.push("comment");
    } else {
      data.comment = cleaned === "" ? null : cleaned;
    }
  }

  if (fields.length > 0) {
    return { ok: false, fields };
  }
  return { ok: true, data };
}

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

async function sendFeedbackEmail(data) {
  const helpAreas = data.help_areas?.map((value) => LABELS.help_areas[value]).join("、") || "回答なし";
  const payload = {
    _subject: "【くるまどれかな？】新しい感想が届きました",
    _template: "table",
    _captcha: "false",
    _url: "https://kuruma-dorekana.pages.dev/support",
    "送信日時（UTC）": new Date().toISOString(),
    "ひとりで遊べたか": LABELS.independence[data.independence],
    "また遊びたがったか": LABELS.replay_interest[data.replay_interest],
    "年齢": data.age_group ? LABELS.age_group[data.age_group] : "回答なし",
    "手助けが必要だった場所": helpAreas,
    "自由記述": data.comment || "なし",
  };

  const response = await fetch(FEEDBACK_EMAIL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`feedback email failed: HTTP ${response.status}`);
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
  }

  const contentType = (request.headers.get("content-type") ?? "").trim();
  if (!/^application\/json(\s*;.*)?$/i.test(contentType)) {
    return json(415, { ok: false, error: "unsupported_content_type" });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json(400, { ok: false, error: "validation_failed", fields: ["body"] });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json(400, { ok: false, error: "validation_failed", fields: ["body"] });
  }

  const result = validateFeedback(body);
  if (!result.ok) {
    return json(400, { ok: false, error: "validation_failed", fields: result.fields });
  }

  const { data } = result;
  try {
    await env.DB.prepare(
      "INSERT INTO feedback (independence, replay_interest, age_group, help_areas, comment) VALUES (?1, ?2, ?3, ?4, ?5)"
    )
      .bind(
        data.independence,
        data.replay_interest,
        data.age_group,
        data.help_areas === null ? null : JSON.stringify(data.help_areas),
        data.comment
      )
      .run();
  } catch (err) {
    console.error("feedback insert failed:", err);
    return json(500, { ok: false, error: "server_error" });
  }

  context.waitUntil(
    sendFeedbackEmail(data).catch((err) => {
      console.error("feedback email notification failed:", err);
    })
  );

  return json(201, { ok: true });
}
