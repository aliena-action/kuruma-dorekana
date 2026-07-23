const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendFeedbackReportEmail({
  apiKey,
  from,
  to,
  subject,
  markdown,
  idempotencyKey,
  fetchImpl = fetch,
}) {
  if (!apiKey || !from || !to) throw new Error("email_configuration_missing");

  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text: markdown,
    }),
  });

  if (!response.ok) throw new Error(`email_provider_${response.status}`);
  const result = await response.json().catch(() => ({}));
  return { id: typeof result.id === "string" ? result.id : null };
}
