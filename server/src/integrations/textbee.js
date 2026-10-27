import { createHmac, timingSafeEqual } from "node:crypto";

const defaultBaseUrl = "https://api.textbee.dev/api/v1";
const defaultTimeoutMs = 8_000;
const defaultHeartbeatMaxAgeMs = 45 * 60 * 1000;

export class TextBeeError extends Error {
  constructor(message, { code = "TEXTBEE_ERROR", status = 503, retryable = true } = {}) {
    super(message);
    this.name = "TextBeeError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function normalizePhilippineMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  return "";
}

export function textBeeConfiguration(environment = process.env) {
  const apiKey = String(environment.TEXTBEE_API_KEY || "").trim();
  const deviceId = String(environment.TEXTBEE_DEVICE_ID || "").trim();
  const webhookSecret = String(environment.TEXTBEE_WEBHOOK_SECRET || "").trim();
  const enabled = environment.ENABLE_TEXTBEE === "true" && Boolean(apiKey);
  return {
    enabled,
    apiKey,
    deviceId,
    webhookSecret,
    baseUrl: String(environment.TEXTBEE_BASE_URL || defaultBaseUrl).replace(/\/$/, ""),
    timeoutMs: Number(environment.TEXTBEE_TIMEOUT_MS || defaultTimeoutMs),
    heartbeatMaxAgeMs: Number(environment.TEXTBEE_HEARTBEAT_MAX_AGE_MS || defaultHeartbeatMaxAgeMs)
  };
}

function payloadData(payload) {
  return payload?.data ?? payload;
}

async function textBeeRequest(path, { configuration = textBeeConfiguration(), fetchImpl = fetch, method = "GET", body } = {}) {
  if (!configuration.enabled || !configuration.apiKey) {
    throw new TextBeeError("SMS is temporarily unavailable. Use email verification instead.", {
      code: "SMS_PROVIDER_DISABLED",
      retryable: false
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs || defaultTimeoutMs);
  try {
    const response = await fetchImpl(`${configuration.baseUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": configuration.apiKey
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new TextBeeError("SMS could not be sent right now. Use email verification or try again later.", {
        code: response.status === 429 ? "SMS_RATE_LIMITED" : "SMS_PROVIDER_REJECTED",
        status: response.status === 429 ? 429 : 503,
        retryable
      });
    }
    return payloadData(payload);
  } catch (error) {
    if (error instanceof TextBeeError) throw error;
    const timedOut = error?.name === "AbortError";
    throw new TextBeeError(
      timedOut
        ? "SMS delivery took too long. Use email verification instead."
        : "SMS is temporarily unavailable. Use email verification instead.",
      { code: timedOut ? "SMS_PROVIDER_TIMEOUT" : "SMS_PROVIDER_UNAVAILABLE" }
    );
  } finally {
    clearTimeout(timeout);
  }
}

function deviceList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.devices)) return payload.devices;
  return payload && typeof payload === "object" ? [payload] : [];
}

function heartbeatTime(device) {
  const value = device?.lastHeartbeat || device?.lastHeartbeatAt || device?.updatedAt;
  const parsed = typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function healthyTextBeeDevice({ configuration = textBeeConfiguration(), fetchImpl = fetch, now = Date.now() } = {}) {
  const path = configuration.deviceId
    ? `/gateway/devices/${encodeURIComponent(configuration.deviceId)}`
    : "/gateway/devices";
  const payload = await textBeeRequest(path, { configuration, fetchImpl });
  const devices = deviceList(payload).filter((device) => device?.gatewayEnabled !== false && device?.enabled !== false);
  const selected = configuration.deviceId
    ? devices.find((device) => String(device?._id || device?.id) === configuration.deviceId) || devices[0]
    : devices.find((device) => device?.isDefault) || devices.sort((left, right) => heartbeatTime(right) - heartbeatTime(left))[0];
  const lastHeartbeat = heartbeatTime(selected);
  if (!selected || !lastHeartbeat || now - lastHeartbeat > configuration.heartbeatMaxAgeMs) {
    throw new TextBeeError("The SMS gateway phone is offline. Use email verification instead.", {
      code: "SMS_GATEWAY_OFFLINE"
    });
  }
  return {
    id: String(selected._id || selected.id || configuration.deviceId || ""),
    lastHeartbeat
  };
}

export async function sendTextBeeSms({
  to,
  message,
  requireHealthyDevice = false,
  configuration = textBeeConfiguration(),
  fetchImpl = fetch,
  now = Date.now()
}) {
  const recipient = normalizePhilippineMobile(to);
  if (!recipient) {
    throw new TextBeeError("Enter a valid Philippine mobile number.", {
      code: "INVALID_PHONE_NUMBER",
      status: 400,
      retryable: false
    });
  }
  const content = String(message || "").trim();
  if (!content || content.length > 480) {
    throw new TextBeeError("The SMS message is invalid.", {
      code: "INVALID_SMS_MESSAGE",
      status: 400,
      retryable: false
    });
  }
  let deviceId = configuration.deviceId;
  if (requireHealthyDevice) {
    const device = await healthyTextBeeDevice({ configuration, fetchImpl, now });
    deviceId = device.id;
  }
  const payload = await textBeeRequest("/gateway/send-sms", {
    configuration,
    fetchImpl,
    method: "POST",
    body: {
      recipients: [recipient],
      message: content,
      ...(deviceId ? { deviceId } : {})
    }
  });
  const smsBatchId = String(payload?.smsBatchId || payload?._id || payload?.id || "");
  if (!smsBatchId) {
    throw new TextBeeError("The SMS provider returned an invalid response.", {
      code: "SMS_PROVIDER_INVALID_RESPONSE"
    });
  }
  return {
    provider: "textbee",
    smsBatchId,
    recipientCount: Number(payload?.recipientCount || 1),
    deviceId: String(deviceId || payload?.deviceId || ""),
    status: "pending"
  };
}

export function verifyTextBeeWebhookSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = String(signature).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
}

export function textBeeWebhookState(event = {}) {
  const states = {
    MESSAGE_SENT: "sent",
    MESSAGE_DELIVERED: "delivered",
    MESSAGE_FAILED: "failed",
    UNKNOWN_STATE: "unknown"
  };
  return states[event.webhookEvent] || "ignored";
}

export function textBeeStateRank(state) {
  return { pending: 0, sent: 1, unknown: 1, delivered: 3, failed: 3 }[state] ?? -1;
}
