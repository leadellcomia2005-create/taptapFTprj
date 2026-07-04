import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "./security.js";

const weakPasswords = new Set([
  "password",
  "password123",
  "password123!",
  "admin123",
  "admin123!",
  "qwerty123",
  "qwerty123!",
  "customer123",
  "customer123!",
  "taptap123",
  "taptap123!"
]);

const rateWindowMs = 15 * 60 * 1000;
const maxAttemptsPerWindow = 5;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function hashValue(value = "") {
  return createHash("sha256").update(String(value)).digest("hex");
}

function clientIp(req = {}) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown";
}

function registrationSource(req = {}, email = "") {
  const userAgent = cleanText(req.headers?.["user-agent"] || "", 220);
  const ipHash = hashValue(`${clientIp(req)}|${userAgent}`).slice(0, 40);
  const emailHash = hashValue(email.toLowerCase()).slice(0, 40);
  return { ipHash, emailHash, userAgent };
}

function auditPayload(action, details = {}) {
  return {
    action,
    actorId: details.uid || "public-registration",
    actorName: details.name || "Customer registration",
    actorRole: "customer",
    createdAt: Date.now(),
    ...details
  };
}

async function writeRegistrationAudit(db, action, details = {}) {
  const now = Date.now();
  const key = `REG-${now}-${randomUUID().slice(0, 8)}`;
  await db.ref(`auditLogs/${key}`).set(auditPayload(action, { ...details, createdAt: now })).catch(() => {});
}

export function passwordChecklist(password = "") {
  const value = String(password);
  return {
    length: value.length >= 12,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
    number: /\d/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
    common: !weakPasswords.has(value.toLowerCase())
  };
}

export function validateCustomerRegistration(input = {}) {
  const name = cleanText(input.name, 80);
  const email = cleanText(input.email, 254).toLowerCase();
  const password = String(input.password || "");
  const confirmPassword = String(input.confirmPassword || "");
  const botField = cleanText(input.botField, 200);
  const turnstileToken = typeof input.turnstileToken === "string" ? input.turnstileToken.trim() : "";

  if (botField) throw new HttpError(400, "We could not create this account. Please check your details and try again.");
  if (name.length < 2 || name.length > 80 || !/^[A-Za-z\u00d1\u00f1 .'-]+$/.test(name)) {
    throw new HttpError(400, "Enter a valid full name.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  if (password !== confirmPassword) {
    throw new HttpError(400, "Passwords do not match.");
  }
  const passwordStatus = passwordChecklist(password);
  if (!Object.values(passwordStatus).every(Boolean)) {
    throw new HttpError(400, "Use a stronger password.");
  }
  if (input.termsAccepted !== true || input.privacyAccepted !== true) {
    throw new HttpError(400, "Accept the Terms and Privacy Notice before creating an account.");
  }

  return {
    name,
    email,
    password,
    turnstileToken,
    termsAccepted: true,
    privacyAccepted: true
  };
}

export async function verifyTurnstileToken({ secret, token, req }) {
  const cleanSecret = typeof secret === "string" ? secret.trim() : "";
  const cleanToken = typeof token === "string" ? token.trim() : "";
  if (!cleanSecret) return { configured: false };
  if (!cleanToken) throw new HttpError(400, "Complete the security check before creating an account.");

  const body = new URLSearchParams();
  body.set("secret", cleanSecret);
  body.set("response", cleanToken);
  const remoteIp = clientIp(req);
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

  let payload;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body
    });
    payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new HttpError(503, "Security check is unavailable. Please try again.");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "Security check is unavailable. Please try again.");
  }

  if (payload?.success !== true) {
    throw new HttpError(400, "Complete the security check before creating an account.");
  }

  return {
    configured: true,
    hostname: cleanText(payload.hostname || "", 120),
    action: cleanText(payload.action || "", 80),
    challengeTs: cleanText(payload.challenge_ts || "", 80)
  };
}

async function enforceRegistrationRateLimit(db, source) {
  const now = Date.now();
  const keys = [`ip-${source.ipHash}`, `email-${source.emailHash}`];
  for (const key of keys) {
    const ref = db.ref(`security/registrationRate/${key}`);
    const current = (await ref.once("value")).val() || {};
    const windowStart = Number(current.windowStart || 0);
    const count = now - windowStart < rateWindowMs ? Number(current.count || 0) : 0;
    if (count >= maxAttemptsPerWindow) {
      throw new HttpError(429, "Too many registration attempts. Please wait 15 minutes, then try again.");
    }
    await ref.set({
      windowStart: count ? windowStart : now,
      count: count + 1,
      lastAt: now,
      expiresAt: now + rateWindowMs
    });
  }
}

export async function createCustomerRegistration({ db, auth, input, req, sendVerificationEmail, appBaseUrl, verifyHuman }) {
  const values = validateCustomerRegistration(input);
  const source = registrationSource(req, values.email);
  await enforceRegistrationRateLimit(db, source);

  const humanCheck = verifyHuman ? await verifyHuman(values.turnstileToken, req) : { configured: false };
  if (humanCheck.configured) {
    await writeRegistrationAudit(db, "registration_security_check_passed", {
      emailHash: source.emailHash,
      ipHash: source.ipHash,
      provider: "turnstile",
      hostname: humanCheck.hostname
    });
  }

  await writeRegistrationAudit(db, "registration_started", {
    emailHash: source.emailHash,
    ipHash: source.ipHash
  });

  let userRecord;
  const now = Date.now();
  try {
    userRecord = await auth.createUser({
      email: values.email,
      password: values.password,
      displayName: values.name,
      emailVerified: false,
      disabled: false
    });

    await db.ref(`users/${userRecord.uid}`).set({
      name: values.name,
      email: values.email,
      role: "customer",
      phone: "",
      phoneVerified: false,
      phoneVerifiedAt: null,
      smsNotifications: false,
      smsNotificationsRequested: false,
      address: "",
      landmark: "",
      deliveryLocation: null,
      securitySetupRequired: true,
      consent: {
        termsAccepted: true,
        termsAcceptedAt: now,
        privacyAccepted: true,
        privacyAcceptedAt: now
      },
      registration: {
        source: "server",
        emailHash: source.emailHash,
        ipHash: source.ipHash,
        userAgent: source.userAgent,
        botProtection: humanCheck.configured ? "turnstile" : "honeypot-rate-limit",
        botProtectionVerified: humanCheck.configured === true,
        createdAt: now
      },
      createdAt: now,
      updatedAt: now
    });

    let verificationSent = false;
    if (sendVerificationEmail) {
      try {
        const baseUrl = String(appBaseUrl || "http://localhost:5173").replace(/\/$/, "");
        const verificationLink = await auth.generateEmailVerificationLink(values.email, {
          url: `${baseUrl}/?emailVerified=1`,
          handleCodeInApp: false
        });
        await sendVerificationEmail(values.email, verificationLink, values.name);
        verificationSent = true;
      } catch {
        verificationSent = false;
      }
    }

    await writeRegistrationAudit(db, "account_created", {
      uid: userRecord.uid,
      name: values.name,
      emailHash: source.emailHash,
      ipHash: source.ipHash,
      verificationSent
    });

    return {
      uid: userRecord.uid,
      email: values.email,
      profilePath: `users/${userRecord.uid}`,
      verificationSent
    };
  } catch (error) {
    if (userRecord?.uid) {
      await Promise.all([
        auth.deleteUser(userRecord.uid).catch(() => {}),
        db.ref(`users/${userRecord.uid}`).remove().catch(() => {})
      ]);
    }
    await writeRegistrationAudit(db, "registration_failed", {
      emailHash: source.emailHash,
      ipHash: source.ipHash,
      reason: error?.code || error?.message || "registration_failed"
    });
    if (error?.code === "auth/email-already-exists") {
      throw new HttpError(409, "We could not create this account. Please check your details or try signing in.");
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, "The account could not be created. Please try again.");
  }
}
