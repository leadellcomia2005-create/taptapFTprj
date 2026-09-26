import { createHash, randomUUID } from "node:crypto";
import { resolveMx } from "node:dns/promises";
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
const emailDomainCache = new Map();
const positiveEmailDomainCacheMs = 6 * 60 * 60 * 1000;
const negativeEmailDomainCacheMs = 15 * 60 * 1000;
const disposableEmailDomains = new Set([
  "10minutemail.com",
  "getnada.com",
  "guerrillamail.com",
  "mailinator.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com"
]);
const commonEmailDomainTypos = new Map([
  ["gamil.com", "gmail.com"],
  ["gmail.co", "gmail.com"],
  ["gmail.cm", "gmail.com"],
  ["gmail.con", "gmail.com"],
  ["gmial.com", "gmail.com"],
  ["hotmial.com", "hotmail.com"],
  ["outlok.com", "outlook.com"],
  ["yaho.com", "yahoo.com"]
]);
const repeatedPublicSuffix = /\.(com|net|org|edu|gov)\.\1$/i;
const accountRecoveryMessage = "An account may already use this email. Try signing in, resetting your password, or continuing email verification.";
const resendWindowMs = 24 * 60 * 60 * 1000;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function hashValue(value = "") {
  return createHash("sha256").update(String(value)).digest("hex");
}

function registrationEmailParts(value = "") {
  const email = cleanText(value, 254).toLowerCase();
  if (email.length < 6 || email.includes("..")) return null;
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.startsWith(".") || local.endsWith(".") || local.length > 64 || domain.length > 253) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  if (labels.at(-1).length < 2) return null;
  return { email, domain };
}

function cachedEmailDomainResult(domain, now) {
  const cached = emailDomainCache.get(domain);
  if (!cached || cached.expiresAt <= now) {
    emailDomainCache.delete(domain);
    return null;
  }
  return cached.result;
}

function cacheEmailDomainResult(domain, result, now) {
  const ttl = result.eligible ? positiveEmailDomainCacheMs : negativeEmailDomainCacheMs;
  emailDomainCache.set(domain, { result, expiresAt: now + ttl });
  return result;
}

async function resolveMxOverHttps(domain, fetchImpl) {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", domain);
  url.searchParams.set("type", "MX");
  const response = await fetchImpl(url, { headers: { Accept: "application/dns-json" } });
  if (!response.ok) throw Object.assign(new Error("Email domain lookup failed."), { code: "EDOH" });
  const payload = await response.json();
  if (payload?.Status === 3) return [];
  if (payload?.Status !== 0) throw Object.assign(new Error("Email domain lookup failed."), { code: "EDOH" });
  return (Array.isArray(payload.Answer) ? payload.Answer : [])
    .filter((answer) => answer?.type === 15 && typeof answer?.data === "string")
    .map((answer) => {
      const match = answer.data.trim().match(/^\d+\s+(.+?)\.?$/);
      return match ? { exchange: match[1] } : null;
    })
    .filter(Boolean);
}

async function resolveRegistrationMx(domain, { resolveMxImpl, fetchImpl }) {
  try {
    return await resolveMxImpl(domain);
  } catch (error) {
    if (["ENODATA", "ENOTFOUND"].includes(error?.code)) return [];
    return resolveMxOverHttps(domain, fetchImpl);
  }
}

export async function checkRegistrationEmail(email, {
  resolveMxImpl = resolveMx,
  fetchImpl = fetch,
  timeoutMs = 3500,
  now = Date.now()
} = {}) {
  const parsed = registrationEmailParts(email);
  if (!parsed) {
    return { eligible: false, code: "invalid_format", message: "Enter a valid email address." };
  }
  const suggestion = commonEmailDomainTypos.get(parsed.domain);
  if (suggestion) {
    return {
      eligible: false,
      code: "domain_typo",
      message: `Check the email domain. Did you mean ${suggestion}?`,
      suggestion
    };
  }
  if (repeatedPublicSuffix.test(parsed.domain)) {
    return { eligible: false, code: "repeated_domain", message: "Check the email domain and remove the repeated ending." };
  }
  if (disposableEmailDomains.has(parsed.domain)) {
    return { eligible: false, code: "disposable_domain", message: "Temporary email addresses are not allowed." };
  }
  const cached = cachedEmailDomainResult(parsed.domain, now);
  if (cached) return cached;

  try {
    const records = await Promise.race([
      resolveRegistrationMx(parsed.domain, { resolveMxImpl, fetchImpl }),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("Email domain check timed out."), { code: "ETIMEOUT" })), timeoutMs))
    ]);
    const eligible = Array.isArray(records) && records.some((record) => typeof record?.exchange === "string" && record.exchange.trim());
    return cacheEmailDomainResult(parsed.domain, eligible
      ? { eligible: true, code: "deliverable_domain", message: "Email domain accepted." }
      : { eligible: false, code: "no_mail_server", message: "This email domain cannot receive verification mail." }, now);
  } catch (error) {
    if (["ENODATA", "ENOTFOUND"].includes(error?.code)) {
      return cacheEmailDomainResult(parsed.domain, {
        eligible: false,
        code: "no_mail_server",
        message: "This email domain cannot receive verification mail."
      }, now);
    }
    throw new HttpError(503, "The email domain could not be checked. Please try again.");
  }
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

export async function writeRegistrationAudit(db, action, details = {}) {
  const now = Date.now();
  const key = `REG-${now}-${randomUUID().slice(0, 8)}`;
  await db.ref(`auditLogs/${key}`).set(auditPayload(action, { ...details, createdAt: now })).catch(() => {});
}

async function existingUserForEmail(auth, email) {
  if (typeof auth?.getUserByEmail !== "function") return null;
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code === "auth/user-not-found") return null;
    throw error;
  }
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
  if (!registrationEmailParts(email)) {
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

export async function verifyTurnstileToken({
  secret,
  token,
  req,
  expectedAction = "customer_registration",
  allowedHostnames = [],
  fetchImpl = fetch,
  now = Date.now()
}) {
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
    const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
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

  const action = cleanText(payload.action || "", 80);
  const hostname = cleanText(payload.hostname || "", 120).toLowerCase();
  const challengeTs = cleanText(payload.challenge_ts || "", 80);
  const challengeTime = Date.parse(challengeTs);
  const normalizedHostnames = allowedHostnames
    .map((value) => cleanText(value, 120).toLowerCase())
    .filter(Boolean);

  if (
    action !== expectedAction
    || !Number.isFinite(challengeTime)
    || challengeTime > now + 60_000
    || now - challengeTime > 5 * 60_000
    || (normalizedHostnames.length > 0 && !normalizedHostnames.includes(hostname))
  ) {
    throw new HttpError(400, "Complete the security check before creating an account.");
  }

  return {
    configured: true,
    hostname,
    action,
    challengeTs
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
      await writeRegistrationAudit(db, "registration_rate_limited", {
        emailHash: source.emailHash,
        ipHash: source.ipHash,
        reason: "Too many registration attempts"
      });
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

export async function createCustomerRegistration({
  db,
  auth,
  input,
  req,
  sendVerificationEmail,
  appBaseUrl,
  verifyHuman,
  verifyEmail = checkRegistrationEmail,
  verificationTtlMs = 3 * 60 * 1000,
  abandonedTtlMs = 24 * 60 * 60 * 1000
}) {
  const values = validateCustomerRegistration(input);
  const source = registrationSource(req, values.email);
  await enforceRegistrationRateLimit(db, source);

  const emailCheck = await verifyEmail(values.email);
  if (!emailCheck?.eligible) {
    await writeRegistrationAudit(db, "registration_email_rejected", {
      emailHash: source.emailHash,
      ipHash: source.ipHash,
      reason: emailCheck?.code || "email_domain_rejected"
    });
    throw new HttpError(400, emailCheck?.message || "Enter an email address that can receive verification mail.");
  }
  await writeRegistrationAudit(db, "registration_email_accepted", {
    emailHash: source.emailHash,
    ipHash: source.ipHash,
    reason: emailCheck.code || "deliverable_domain"
  });

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

  const existingUser = await existingUserForEmail(auth, values.email);
  if (existingUser) {
    await writeRegistrationAudit(db, "registration_duplicate_prevented", {
      emailHash: source.emailHash,
      ipHash: source.ipHash,
      reason: existingUser.emailVerified ? "existing_verified_account" : "existing_unverified_account"
    });
    throw new HttpError(409, accountRecoveryMessage, { code: "ACCOUNT_RECOVERY_REQUIRED" });
  }

  let userRecord;
  const now = Date.now();
  const verificationExpiresAt = now + verificationTtlMs;
  const cleanupEligibleAt = now + abandonedTtlMs;
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
        createdAt: now,
        verificationExpiresAt,
        verificationSessionExpiresAt: verificationExpiresAt,
        cleanupEligibleAt,
        verificationStatus: "pending",
        verificationSendCount: 0,
        verificationSendWindowStartedAt: now
      },
      createdAt: now,
      updatedAt: now
    });
    await writeRegistrationAudit(db, "registration_profile_created", {
      uid: userRecord.uid,
      emailHash: source.emailHash,
      ipHash: source.ipHash
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
        await db.ref(`users/${userRecord.uid}/registration`).update({
          lastVerificationSentAt: Date.now(),
          verificationSendCount: 1
        }).catch(() => {});
        await writeRegistrationAudit(db, "registration_verification_sent", {
          uid: userRecord.uid,
          emailHash: source.emailHash,
          ipHash: source.ipHash
        });
      } catch (error) {
        verificationSent = false;
        await writeRegistrationAudit(db, "registration_verification_failed", {
          uid: userRecord.uid,
          emailHash: source.emailHash,
          ipHash: source.ipHash,
          reason: error?.code || "email_delivery_failed"
        });
      }
    }

    await writeRegistrationAudit(db, "account_created", {
      uid: userRecord.uid,
      emailHash: source.emailHash,
      ipHash: source.ipHash,
      verificationSent
    });

    return {
      uid: userRecord.uid,
      email: values.email,
      profilePath: `users/${userRecord.uid}`,
      verificationSent,
      verificationExpiresAt,
      cleanupEligibleAt
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
      await writeRegistrationAudit(db, "registration_duplicate_prevented", {
        emailHash: source.emailHash,
        ipHash: source.ipHash,
        reason: "firebase_duplicate_guard"
      });
      throw new HttpError(409, accountRecoveryMessage, { code: "ACCOUNT_RECOVERY_REQUIRED" });
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, "The account could not be created. Please try again.");
  }
}

export async function resendCustomerRegistrationVerification({
  db,
  auth,
  user,
  sendVerificationEmail,
  appBaseUrl,
  verificationTtlMs = 3 * 60 * 1000,
  abandonedTtlMs = 24 * 60 * 60 * 1000,
  cooldownMs = 60 * 1000,
  dailyLimit = 5,
  now = Date.now()
}) {
  if (!user?.uid) throw new HttpError(401, "Sign in again before requesting a verification email.");
  if (typeof sendVerificationEmail !== "function") {
    throw new HttpError(503, "Verification email is temporarily unavailable. Please try again later.");
  }

  const [userRecord, profileSnapshot] = await Promise.all([
    auth.getUser(user.uid),
    db.ref(`users/${user.uid}`).once("value")
  ]);
  const profile = profileSnapshot.val() || {};
  if (userRecord.emailVerified) {
    return { alreadyVerified: true, verificationExpiresAt: null };
  }
  if (profile.role !== "customer" || !userRecord.email) {
    throw new HttpError(403, "This account cannot use customer email verification.");
  }

  let rejection = null;
  let claimedSendCount = 0;
  const verificationExpiresAt = now + verificationTtlMs;
  const claim = await db.ref(`users/${user.uid}/registration`).transaction((current = {}) => {
    const lastSentAt = Number(current.lastVerificationSentAt || 0);
    const retryAfterMs = lastSentAt + cooldownMs - now;
    if (retryAfterMs > 0) {
      rejection = new HttpError(429, `Wait ${Math.ceil(retryAfterMs / 1000)} seconds before requesting another email.`, {
        code: "VERIFICATION_RESEND_COOLDOWN"
      });
      return undefined;
    }

    const storedWindowStart = Number(current.verificationSendWindowStartedAt || 0);
    const windowActive = storedWindowStart > 0 && now - storedWindowStart < resendWindowMs;
    const sendCount = windowActive ? Number(current.verificationSendCount || 0) : 0;
    if (sendCount >= dailyLimit) {
      rejection = new HttpError(429, "The verification email limit was reached. Try again tomorrow.", {
        code: "VERIFICATION_RESEND_LIMIT"
      });
      return undefined;
    }

    claimedSendCount = sendCount + 1;
    return {
      ...current,
      verificationExpiresAt,
      verificationSessionExpiresAt: verificationExpiresAt,
      cleanupEligibleAt: Math.max(Number(current.cleanupEligibleAt || 0), now + abandonedTtlMs),
      lastVerificationSentAt: now,
      verificationSendCount: claimedSendCount,
      verificationSendWindowStartedAt: windowActive ? storedWindowStart : now,
      verificationStatus: "pending"
    };
  });
  if (!claim.committed) {
    throw rejection || new HttpError(409, "A verification email request is already being processed.", {
      code: "VERIFICATION_RESEND_IN_PROGRESS"
    });
  }

  const baseUrl = String(appBaseUrl || "http://localhost:5173").replace(/\/$/, "");
  const verificationLink = await auth.generateEmailVerificationLink(userRecord.email, {
    url: `${baseUrl}/?emailVerified=1`,
    handleCodeInApp: false
  });
  const source = registrationSource({}, userRecord.email);
  try {
    await sendVerificationEmail(userRecord.email, verificationLink, profile.name || userRecord.displayName || "Customer");
  } catch (error) {
    await writeRegistrationAudit(db, "registration_verification_resend_failed", {
      uid: user.uid,
      emailHash: source.emailHash,
      reason: error?.code || "email_delivery_failed"
    });
    throw new HttpError(503, "Verification email is temporarily unavailable. Please try again later.");
  }
  await writeRegistrationAudit(db, "registration_verification_resent", {
    uid: user.uid,
    emailHash: source.emailHash,
    resendCount: claimedSendCount
  });

  return {
    alreadyVerified: false,
    sent: true,
    verificationExpiresAt,
    cooldownSeconds: Math.ceil(cooldownMs / 1000)
  };
}
