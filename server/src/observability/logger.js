const sensitiveKeyPattern = /authorization|cookie|password|secret|token|api.?key|email|phone|address|landmark|location|proof|dataurl|otp|signature/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /(?:\+?63|0)9\d{9}\b/g;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const dataUrlPattern = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gi;
const tokenQueryPattern = /([?&](?:token|key|signature)=)[^&\s]+/gi;

function sanitizeText(value) {
  return String(value)
    .replace(dataUrlPattern, "[REDACTED_DATA_URL]")
    .replace(bearerPattern, "Bearer [REDACTED]")
    .replace(emailPattern, "[REDACTED_EMAIL]")
    .replace(phonePattern, "[REDACTED_PHONE]")
    .replace(tokenQueryPattern, "$1[REDACTED]")
    .slice(0, 2_000);
}

function errorDetails(error) {
  if (!(error instanceof Error)) return { error: sanitizeText(error) };
  return {
    errorName: error.name,
    errorMessage: sanitizeText(error.message),
    ...(error.code ? { errorCode: error.code } : {})
  };
}

function sanitizeValue(value, key = "", seen = new WeakSet()) {
  if (sensitiveKeyPattern.test(key)) return "[REDACTED]";
  if (value instanceof Error) return errorDetails(value);
  if (typeof value === "string") return sanitizeText(value);
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return sanitizeText(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, key, seen));
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeValue(childValue, childKey, seen)]));
}

export function sanitizeLogDetails(details) {
  return sanitizeValue(details);
}

export function createLogger({ service = "taptap-api", sink = console } = {}) {
  const write = (level, event, details = {}) => {
    const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
    const normalized = details instanceof Error ? errorDetails(details) : sanitizeLogDetails(details);
    sink[method](JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service,
      event,
      ...normalized
    }));
  };
  return {
    info: (event, details) => write("info", event, details),
    warn: (event, details) => write("warn", event, details),
    error: (event, details) => write("error", event, details)
  };
}

export function createNoopLogger() {
  return { info() {}, warn() {}, error() {} };
}
