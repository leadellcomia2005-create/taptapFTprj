const resendEndpoint = "https://api.resend.com/emails";

export function resendConfiguration(environment = process.env) {
  const apiKey = String(environment.RESEND_API_KEY || "").trim();
  const from = String(environment.RESEND_FROM_EMAIL || "").trim();
  return {
    enabled: environment.ENABLE_RESEND === "true" && Boolean(apiKey && from),
    apiKey,
    from
  };
}

export async function sendResendEmail({ to, subject, text, html, fetchImpl = fetch }) {
  const config = resendConfiguration();
  if (!config.enabled || !to || !subject || (!text && !html)) {
    const error = new Error("Email delivery is not configured.");
    error.code = "resend-unavailable";
    throw error;
  }

  const response = await fetchImpl(resendEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: config.from,
      to: [to],
      subject,
      text,
      html
    })
  });

  if (!response.ok) {
    const error = new Error("Email delivery failed.");
    error.code = "resend-delivery-failed";
    throw error;
  }
  return response.json();
}
