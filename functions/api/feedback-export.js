const TOKEN_HASH = "098409fbfb7363d04954cab515dc60895bcafb2ef8a9b577bdf9a1f49b005df5";

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

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token");
  if (typeof token !== "string" || (await sha256Hex(token)) !== TOKEN_HASH) {
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
