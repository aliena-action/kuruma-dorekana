const TOKEN_HASH = "8a43f0f1c61dd6636881fcbd033eaa07802061f7883cbf81d4248451dc8c4505";

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false });
  }

  if (typeof body?.token !== "string" || (await sha256Hex(body.token)) !== TOKEN_HASH) {
    return json(404, { ok: false });
  }

  const result = await env.DB.prepare(
    "SELECT rowid AS id, submitted_at, independence, replay_interest, age_group, help_areas, comment FROM feedback ORDER BY submitted_at ASC, rowid ASC"
  ).all();

  return json(200, { ok: true, count: result.results.length, feedback: result.results });
}

export function onRequest() {
  return json(405, { ok: false });
}
