import { z } from "zod";

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  APP_VERSION: z.string().trim().min(1).optional(),
  FIREBASE_DATABASE_URL: z.string().trim().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().trim().optional(),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().trim().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().trim().optional(),
  NODE_ENV: z.string().trim().default("development"),
  TURNSTILE_SECRET_KEY: z.string().trim().optional(),
  TURNSTILE_BYPASS: z.enum(["true", "false"]).default("false"),
  TURNSTILE_EXPECTED_ACTION: z.string().trim().min(1).max(80).default("customer_registration"),
  TURNSTILE_ALLOWED_HOSTNAMES: z.string().trim().optional(),
  ENABLE_PAYMONGO: z.enum(["true", "false"]).default("false"),
  PAYMONGO_MODE: z.enum(["test", "live"]).default("test"),
  PAYMONGO_SECRET_KEY: z.string().trim().optional(),
  PAYMONGO_WEBHOOK_SECRET: z.string().trim().optional(),
  TRUST_PROXY: z.string().trim().optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000)
}).passthrough().superRefine((environment, context) => {
  if (environment.NODE_ENV === "production" && environment.TURNSTILE_BYPASS === "true") {
    context.addIssue({
      code: "custom",
      path: ["TURNSTILE_BYPASS"],
      message: "Turnstile bypass cannot be enabled in production."
    });
  }
  if (environment.ENABLE_PAYMONGO !== "true") return;
  const expectedPrefix = environment.PAYMONGO_MODE === "live" ? "sk_live_" : "sk_test_";
  if (!environment.PAYMONGO_SECRET_KEY?.startsWith(expectedPrefix)) {
    context.addIssue({
      code: "custom",
      path: ["PAYMONGO_SECRET_KEY"],
      message: `${environment.PAYMONGO_MODE} mode requires an ${expectedPrefix} key.`
    });
  }
  if (!environment.PAYMONGO_WEBHOOK_SECRET?.startsWith("whsk_")) {
    context.addIssue({
      code: "custom",
      path: ["PAYMONGO_WEBHOOK_SECRET"],
      message: "A PayMongo webhook secret is required when online payment is enabled."
    });
  }
});

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
  const turnstileAllowedHostnames = (env.TURNSTILE_ALLOWED_HOSTNAMES
    ? env.TURNSTILE_ALLOWED_HOSTNAMES.split(",")
    : allowedOrigins.map((origin) => new URL(origin).hostname))
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
  return {
    port: env.PORT,
    apiVersion: env.APP_VERSION || environment.npm_package_version || "local",
    allowedOrigins,
    appBaseUrl: allowedOrigins[0],
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    turnstileSecret: env.TURNSTILE_SECRET_KEY || "",
    turnstile: {
      secret: env.TURNSTILE_SECRET_KEY || "",
      bypass: env.TURNSTILE_BYPASS === "true",
      expectedAction: env.TURNSTILE_EXPECTED_ACTION,
      allowedHostnames: [...new Set(turnstileAllowedHostnames)]
    },
    firebase: {
      databaseUrl: env.FIREBASE_DATABASE_URL || "",
      storageBucket: (env.FIREBASE_STORAGE_BUCKET || env.VITE_FIREBASE_STORAGE_BUCKET || "").replace(/^gs:\/\//, ""),
      credentialsPath: env.GOOGLE_APPLICATION_CREDENTIALS || ""
    }
  };
}
