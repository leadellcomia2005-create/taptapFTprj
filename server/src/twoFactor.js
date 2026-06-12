import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import QRCode from "qrcode";
import { HttpError, validRecordId } from "./security.js";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const backupAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const totpPeriodSeconds = 30;
const setupExpiryMs = 10 * 60 * 1000;
const otpExpiryMs = 10 * 60 * 1000;
const otpResendCooldownMs = 60 * 1000;
const otpSendWindowMs = 60 * 60 * 1000;
const maxOtpSendsPerWindow = 5;
const maxFailures = 3;

function encryptionKey() {
  const value = process.env.TWO_FACTOR_ENCRYPTION_KEY || "";
  let key;
  try {
    key = Buffer.from(value, "base64");
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== 32) {
    throw new HttpError(503, "Two-factor encryption is not configured. Set a 32-byte base64 TWO_FACTOR_ENCRYPTION_KEY.");
  }
  return key;
}

export function twoFactorConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  let bits = 0;
  let current = 0;
  const bytes = [];
  for (const character of value.replace(/=+$/g, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new HttpError(400, "Invalid authenticator secret.");
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64")
  };
}

function decrypt(payload) {
  if (!payload?.iv || !payload?.tag || !payload?.ciphertext) throw new HttpError(500, "Authenticator secret is unavailable.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function totp(secret, counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}

export function verifyTotp(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ""))) return false;
  const counter = Math.floor(now / 1000 / totpPeriodSeconds);
  return [-1, 0, 1].some((window) => timingSafeEqual(
    Buffer.from(totp(secret, counter + window)),
    Buffer.from(String(code))
  ));
}

function hashCode(code, salt = randomBytes(16).toString("base64")) {
  return {
    salt,
    hash: scryptSync(String(code), salt, 32).toString("base64")
  };
}

function verifyHash(code, record) {
  if (!record?.salt || !record?.hash) return false;
  const actual = scryptSync(String(code), record.salt, 32);
  const expected = Buffer.from(record.hash, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function backupCode() {
  const bytes = randomBytes(8);
  const value = [...bytes].map((byte) => backupAlphabet[byte % backupAlphabet.length]).join("");
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function normalizeBackupCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function transactionWithInitial(ref, initialValue, update) {
  let firstCall = true;
  return ref.transaction((currentValue) => {
    const value = firstCall && currentValue === null && initialValue != null
      ? JSON.parse(JSON.stringify(initialValue))
      : currentValue;
    firstCall = false;
    return update(value);
  }, undefined, false);
}

function maskPhone(value = "") {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : "";
}

function maskEmail(value = "") {
  const [name, domain] = String(value).split("@");
  if (!name || !domain) return "";
  return `${name.slice(0, 2)}${"*".repeat(Math.max(2, name.length - 2))}@${domain}`;
}

export function allowedTwoFactorMethods(role) {
  return role === "customer" ? ["totp", "sms", "email"] : ["totp"];
}

async function audit(db, userId, action, details = {}) {
  await db.ref("auditLogs").push({
    action: `2fa_${action}`,
    userId,
    actorId: details.actorId || userId,
    actorName: details.actorName || "",
    method: details.method || null,
    createdAt: Date.now()
  });
}

async function passwordUpdatedAt(idToken) {
  if (!process.env.FIREBASE_WEB_API_KEY || !idToken) return 0;
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_WEB_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  if (!response.ok) return 0;
  const payload = await response.json();
  return Number(payload.users?.[0]?.passwordUpdatedAt || 0);
}

async function profileFor(db, user) {
  return (await db.ref(`users/${user.uid}`).once("value")).val() || {};
}

async function configurationFor(db, userId) {
  return (await db.ref(`twoFactor/${userId}`).once("value")).val() || {};
}

async function recordFailure(db, user, method, idToken) {
  const ref = db.ref(`twoFactor/${user.uid}`);
  const initialConfig = (await ref.once("value")).val() || {};
  let locked = false;
  const passwordVersion = await passwordUpdatedAt(idToken);
  await transactionWithInitial(ref, initialConfig, (currentValue) => {
    const current = currentValue || {};
    const failedAttempts = Number(current.failedAttempts || 0) + 1;
    locked = failedAttempts >= maxFailures;
    return {
      ...current,
      failedAttempts,
      locked,
      lockedAt: locked ? Date.now() : current.lockedAt || null,
      lockedPasswordUpdatedAt: locked ? passwordVersion : current.lockedPasswordUpdatedAt || null
    };
  });
  await audit(db, user.uid, locked ? "lockout" : "failure", { method });
  if (locked) await getAuth().revokeRefreshTokens(user.uid);
  throw new HttpError(locked ? 423 : 401, locked
    ? "Account locked after three failed 2FA attempts. Ask an owner to unlock it."
    : "The verification code is invalid or expired.");
}

async function issueSessionToken(db, user) {
  const profile = await profileFor(db, user);
  const role = user.role || profile.role || "customer";
  return getAuth().createCustomToken(user.uid, { mfaSession: true, role });
}

async function completeSuccess(db, user, method) {
  await db.ref(`twoFactor/${user.uid}`).update({
    failedAttempts: 0,
    locked: false,
    lockedAt: null,
    lastVerifiedAt: Date.now()
  });
  await audit(db, user.uid, "success", { method });
  return issueSessionToken(db, user);
}

export async function twoFactorStatus(db, user, smsAvailable, emailAvailable, idToken) {
  const [profile, initialConfig] = await Promise.all([profileFor(db, user), configurationFor(db, user.uid)]);
  let config = initialConfig;
  const role = user.role || profile.role || "customer";
  if (config.locked && Number(config.lockedPasswordUpdatedAt || 0) > 0) {
    const currentPasswordVersion = await passwordUpdatedAt(idToken);
    if (currentPasswordVersion > Number(config.lockedPasswordUpdatedAt)) {
      await db.ref(`twoFactor/${user.uid}`).update({
        failedAttempts: 0,
        locked: false,
        lockedAt: null,
        lockedPasswordUpdatedAt: null,
        unlockedAt: Date.now(),
        unlockedBy: "password-reset"
      });
      await audit(db, user.uid, "password_reset_unlock");
      config = { ...config, failedAttempts: 0, locked: false };
    }
  }
  return {
    uid: user.uid,
    name: profile.name || user.name || user.email,
    role,
    emailVerified: user.email_verified === true,
    enabled: Boolean(config.enabled),
    method: config.method || null,
    locked: Boolean(config.locked),
    failedAttempts: Number(config.failedAttempts || 0),
    phoneConfigured: Boolean(profile.phone),
    phoneMasked: maskPhone(profile.phone),
    smsAvailable: Boolean(role === "customer" && smsAvailable && profile.phone),
    emailOtpAvailable: Boolean(role === "customer" && emailAvailable && user.email && user.email_verified === true),
    emailMasked: maskEmail(user.email),
    allowedMethods: allowedTwoFactorMethods(role),
    totpAvailable: twoFactorConfigured()
  };
}

export async function beginTotpSetup(db, user) {
  const config = await configurationFor(db, user.uid);
  if (config.locked) throw new HttpError(423, "This account is locked.");
  const secret = base32Encode(randomBytes(20));
  const label = encodeURIComponent(user.email || user.uid);
  const issuer = encodeURIComponent("Taptap Foodtrip POS");
  const uri = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  await db.ref(`twoFactor/${user.uid}/pendingTotp`).set({
    secret: encrypt(secret),
    expiresAt: Date.now() + setupExpiryMs
  });
  await audit(db, user.uid, "setup_started", { method: "totp" });
  return {
    qrDataUrl: await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 240 }),
    manualKey: secret,
    expiresAt: Date.now() + setupExpiryMs
  };
}

export async function sendSmsCode(db, user, sendSms, purpose = "challenge") {
  const [profile, config] = await Promise.all([profileFor(db, user), configurationFor(db, user.uid)]);
  const role = user.role || profile.role || "customer";
  if (config.locked) throw new HttpError(423, "This account is locked.");
  if (role !== "customer") throw new HttpError(403, "Operational accounts must use an authenticator app.");
  if (!profile.phone) throw new HttpError(400, "Add a phone number to this account before choosing SMS.");
  if (purpose === "challenge" && (!config.enabled || config.method !== "sms")) {
    throw new HttpError(409, "SMS is not the enrolled 2FA method.");
  }
  const code = String(randomInt(100000, 1000000));
  const record = hashCode(code);
  await db.ref(`twoFactor/${user.uid}/pendingSms`).set({
    ...record,
    purpose,
    expiresAt: Date.now() + otpExpiryMs
  });
  await sendSms(profile.phone, code);
  await audit(db, user.uid, "sms_sent", { method: "sms" });
  return { sent: true, phoneMasked: maskPhone(profile.phone), expiresAt: Date.now() + otpExpiryMs };
}

export async function sendEmailCode(db, user, sendEmail, purpose = "challenge", now = Date.now()) {
  const [profile, config] = await Promise.all([profileFor(db, user), configurationFor(db, user.uid)]);
  const role = user.role || profile.role || "customer";
  if (config.locked) throw new HttpError(423, "This account is locked.");
  if (role !== "customer") throw new HttpError(403, "Email OTP is available only to customer accounts.");
  if (user.email_verified !== true || !user.email) throw new HttpError(403, "Verify your email address before using email OTP.");
  if (purpose === "challenge" && (!config.enabled || config.method !== "email")) {
    throw new HttpError(409, "Email OTP is not the enrolled 2FA method.");
  }

  const previous = config.pendingEmail || {};
  if (Number(previous.sentAt || 0) + otpResendCooldownMs > now) {
    throw new HttpError(429, "Wait one minute before requesting another email code.");
  }
  const sameWindow = Number(previous.windowStartedAt || 0) + otpSendWindowMs > now;
  const sendCount = sameWindow ? Number(previous.sendCount || 0) + 1 : 1;
  if (sendCount > maxOtpSendsPerWindow) {
    throw new HttpError(429, "Too many email codes requested. Try again in one hour.");
  }

  const code = String(randomInt(100000, 1000000));
  const record = {
    ...hashCode(code),
    purpose,
    expiresAt: now + otpExpiryMs,
    sentAt: now,
    windowStartedAt: sameWindow ? Number(previous.windowStartedAt) : now,
    sendCount
  };
  await db.ref(`twoFactor/${user.uid}/pendingEmail`).set(record);
  try {
    await sendEmail(user.email, code);
  } catch (error) {
    await db.ref(`twoFactor/${user.uid}/pendingEmail`).remove();
    throw error;
  }
  await audit(db, user.uid, "email_sent", { method: "email" });
  return { sent: true, emailMasked: maskEmail(user.email), expiresAt: record.expiresAt };
}

export async function finishEnrollment(db, user, method, code, idToken) {
  const [profile, config] = await Promise.all([profileFor(db, user), configurationFor(db, user.uid)]);
  const role = user.role || profile.role || "customer";
  if (config.locked) throw new HttpError(423, "This account is locked.");
  if (!allowedTwoFactorMethods(role).includes(method)) {
    throw new HttpError(403, "Operational accounts must enroll with an authenticator app.");
  }
  let secret;
  let valid = false;
  if (method === "totp") {
    if (!config.pendingTotp || Number(config.pendingTotp.expiresAt) < Date.now()) {
      throw new HttpError(410, "Authenticator setup expired. Generate a new QR code.");
    }
    secret = decrypt(config.pendingTotp.secret);
    valid = verifyTotp(secret, code);
  } else if (method === "sms") {
    valid = config.pendingSms?.purpose === "setup" &&
      Number(config.pendingSms.expiresAt) >= Date.now() &&
      verifyHash(code, config.pendingSms);
  } else if (method === "email") {
    valid = config.pendingEmail?.purpose === "setup" &&
      Number(config.pendingEmail.expiresAt) >= Date.now() &&
      verifyHash(code, config.pendingEmail);
  } else {
    throw new HttpError(400, "Unsupported 2FA method.");
  }
  if (!valid) return recordFailure(db, user, method, idToken);

  const backupCodes = Array.from({ length: 8 }, backupCode);
  const customToken = await issueSessionToken(db, user);
  await db.ref(`twoFactor/${user.uid}`).set({
    enabled: true,
    method,
    ...(method === "totp" ? { totpSecret: encrypt(secret) } : {}),
    backupCodes: backupCodes.map((value) => hashCode(normalizeBackupCode(value))),
    failedAttempts: 0,
    locked: false,
    enabledAt: Date.now(),
    lastVerifiedAt: Date.now()
  });
  await audit(db, user.uid, "enabled", { method });
  return {
    customToken,
    backupCodes
  };
}

export async function verifyChallenge(db, user, input = {}, idToken) {
  const config = await configurationFor(db, user.uid);
  if (!config.enabled) throw new HttpError(409, "Two-factor authentication must be enrolled.");
  if (config.locked) throw new HttpError(423, "Account locked after three failed 2FA attempts.");

  if (input.backupCode) {
    const normalized = normalizeBackupCode(input.backupCode);
    let matched = false;
    const transaction = await transactionWithInitial(
      db.ref(`twoFactor/${user.uid}/backupCodes`),
      config.backupCodes || [],
      (recordsValue) => {
      const records = Array.isArray(recordsValue) ? recordsValue : Object.values(recordsValue || {});
      const matchedIndex = records.findIndex((record) => verifyHash(normalized, record));
      if (matchedIndex < 0) return undefined;
      matched = true;
      return records.filter((_, index) => index !== matchedIndex);
      }
    );
    if (!transaction.committed || !matched) return recordFailure(db, user, "backup", idToken);
    return { customToken: await completeSuccess(db, user, "backup") };
  }

  let valid = false;
  if (config.method === "totp") {
    valid = verifyTotp(decrypt(config.totpSecret), input.code);
  } else if (config.method === "sms") {
    valid = config.pendingSms?.purpose === "challenge" &&
      Number(config.pendingSms.expiresAt) >= Date.now() &&
      verifyHash(input.code, config.pendingSms);
  } else if (config.method === "email") {
    valid = config.pendingEmail?.purpose === "challenge" &&
      Number(config.pendingEmail.expiresAt) >= Date.now() &&
      verifyHash(input.code, config.pendingEmail);
  }
  if (!valid) return recordFailure(db, user, config.method, idToken);
  await db.ref(`twoFactor/${user.uid}`).update({ pendingSms: null, pendingEmail: null });
  return { customToken: await completeSuccess(db, user, config.method) };
}

export async function resetTwoFactor(db, actor, userId) {
  if (!validRecordId(userId)) throw new HttpError(400, "Invalid user UID.");
  await db.ref(`twoFactor/${userId}`).set({
    enabled: false,
    failedAttempts: 0,
    locked: false,
    resetAt: Date.now(),
    resetBy: actor.uid
  });
  await getAuth().revokeRefreshTokens(userId);
  await audit(db, userId, "reset", { actorId: actor.uid, actorName: actor.name });
}

export async function unlockTwoFactor(db, actor, userId) {
  if (!validRecordId(userId)) throw new HttpError(400, "Invalid user UID.");
  await db.ref(`twoFactor/${userId}`).update({
    failedAttempts: 0,
    locked: false,
    lockedAt: null,
    lockedPasswordUpdatedAt: null,
    pendingEmail: null,
    pendingSms: null,
    unlockedAt: Date.now(),
    unlockedBy: actor.uid
  });
  await audit(db, userId, "unlocked", { actorId: actor.uid, actorName: actor.name });
}
