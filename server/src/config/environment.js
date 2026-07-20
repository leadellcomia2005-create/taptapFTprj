import { z } from "zod";

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  APP_VERSION: z.string().trim().min(1).optional(),
  FIREBASE_DATABASE_URL: z.string().trim().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().trim().optional(),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().trim().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().trim().optional(),
  TURNSTILE_SECRET_KEY: z.string().trim().optional(),
  TRUST_PROXY: z.string().trim().optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000)
}).passthrough();

function parseAllowedOrigins(value) {
  const origins = String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) throw new Error("CLIENT_ORIGIN must include at least one website origin.");
  for (const origin of origins) {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin.replace(/\/$/, "")) {
      throw new Error("CLIENT_ORIGIN entries must be complete HTTP or HTTPS origins without paths.");
    }
  }
  return origins.map((origin) => origin.replace(/\/$/, ""));
}
function parseTrustProxy(value) {
  if (!value || value === "false" || value === "0") return false;
  if (value === "true") return 1;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 1 || hops > 5) {
    throw new Error("TRUST_PROXY must be false, true, or a hop count from 1 to 5.");
  }
  return hops;
}

export function loadServerConfig(environment = process.env) {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "environment"))];
    throw new Error(`Invalid server configuration: ${fields.join(", ")}.`);
  }
  const env = result.data;
  const allowedOrigins = parseAllowedOrigins(env.CLIENT_ORIGIN);
  return {
    port: env.PORT,
    apiVersion: env.APP_VERSION || environment.npm_package_version || "local",
    allowedOrigins,
    appBaseUrl: allowedOrigins[0],
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    turnstileSecret: env.TURNSTILE_SECRET_KEY || "",
    firebase: {
      databaseUrl: env.FIREBASE_DATABASE_URL || "",
      storageBucket: (env.FIREBASE_STORAGE_BUCKET || env.VITE_FIREBASE_STORAGE_BUCKET || "").replace(/^gs:\/\//, ""),
      credentialsPath: env.GOOGLE_APPLICATION_CREDENTIALS || ""
    }
  };
}
