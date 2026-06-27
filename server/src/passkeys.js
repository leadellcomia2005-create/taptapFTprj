import {
  createHash,
  createPublicKey,
  createVerify,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { HttpError } from "./security.js";

const challengeExpiryMs = 5 * 60 * 1000;
const backupAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value = "") {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64");
}

function cleanName(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function hashCode(code, salt = randomBytes(16).toString("base64")) {
  return { salt, hash: scryptSync(String(code), salt, 32).toString("base64") };
}

function backupCode() {
  const value = [...randomBytes(8)].map((byte) => backupAlphabet[byte % backupAlphabet.length]).join("");
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function cborRead(buffer, start = 0) {
  let offset = start;
  const readLength = (additional) => {
    if (additional < 24) return additional;
    if (additional === 24) return buffer[offset++];
    if (additional === 25) {
      const value = buffer.readUInt16BE(offset);
      offset += 2;
      return value;
    }
    if (additional === 26) {
      const value = buffer.readUInt32BE(offset);
      offset += 4;
      return value;
    }
    throw new HttpError(400, "Unsupported passkey data.");
  };
  const readItem = () => {
    const initial = buffer[offset++];
    const major = initial >> 5;
    const additional = initial & 31;
    const length = readLength(additional);
    if (major === 0) return length;
    if (major === 1) return -1 - length;
    if (major === 2) {
      const value = buffer.subarray(offset, offset + length);
      offset += length;
      return value;
    }
    if (major === 3) {
      const value = buffer.subarray(offset, offset + length).toString("utf8");
      offset += length;
      return value;
    }
    if (major === 4) return Array.from({ length }, readItem);
    if (major === 5) {
      const map = new Map();
      for (let index = 0; index < length; index += 1) map.set(readItem(), readItem());
      return map;
    }
    if (major === 6) return readItem();
    if (major === 7) {
      if (additional === 20) return false;
      if (additional === 21) return true;
      if (additional === 22) return null;
    }
    throw new HttpError(400, "Unsupported passkey data.");
  };
  const value = readItem();
  return { value, offset };
}

function requestContext(req) {
  const origin = req.headers.origin || "";
  if (!origin) throw new HttpError(400, "Passkeys require a browser origin.");
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpError(400, "Invalid passkey origin.");
  }
  return { origin, rpId: parsed.hostname };
}

async function profileFor(db, user) {
  return (await db.ref(`users/${user.uid}`).once("value")).val() || {};
}

async function customerProfile(db, user) {
  const profile = await profileFor(db, user);
  const role = user.role || profile.role || "customer";
  if (role !== "customer") throw new HttpError(403, "Passkeys are available only for customer accounts.");
  if (user.email_verified !== true) throw new HttpError(403, "Verify your email before setting up a passkey.");
  return profile;
}

async function issueSessionToken(db, user) {
  const profile = await profileFor(db, user);
  return getAuth().createCustomToken(user.uid, { mfaSession: true, role: profile.role || user.role || "customer" });
}

async function audit(db, user, action, details = {}) {
  await db.ref("auditLogs").push({
    action: `passkey_${action}`,
    userId: user.uid,
    actorId: user.uid,
    method: "passkey",
    ...details,
    createdAt: Date.now()
  });
}

function verifyClientData(encoded, expectedType, expectedChallenge, context) {
  const clientDataJSON = fromBase64url(encoded);
  const clientData = JSON.parse(clientDataJSON.toString("utf8"));
  if (clientData.type !== expectedType) throw new HttpError(400, "Invalid passkey response.");
  if (clientData.challenge !== expectedChallenge) throw new HttpError(400, "Passkey challenge expired. Try again.");
  if (clientData.origin !== context.origin) throw new HttpError(400, "Passkey origin does not match this site.");
  return {
    clientData,
    clientDataHash: createHash("sha256").update(clientDataJSON).digest()
  };
}

function verifyAuthenticatorData(authenticatorData, rpId, requireAttestedCredential = false) {
  if (authenticatorData.length < 37) throw new HttpError(400, "Invalid passkey response.");
  const rpIdHash = createHash("sha256").update(rpId).digest();
  const actualRpIdHash = authenticatorData.subarray(0, 32);
  if (actualRpIdHash.length !== rpIdHash.length || !timingSafeEqual(actualRpIdHash, rpIdHash)) {
    throw new HttpError(400, "Passkey was not created for this site.");
  }
  const flags = authenticatorData[32];
  if ((flags & 0x01) !== 0x01) throw new HttpError(400, "Passkey user presence was not confirmed.");
  if ((flags & 0x04) !== 0x04) throw new HttpError(400, "Use fingerprint, Face ID, PIN, or screen lock to confirm.");
  if (requireAttestedCredential && (flags & 0x40) !== 0x40) throw new HttpError(400, "Passkey credential data is missing.");
  return { flags, signCount: authenticatorData.readUInt32BE(33) };
}

function parseAttestedCredential(authenticatorData) {
  let offset = 37 + 16;
  const credentialIdLength = authenticatorData.readUInt16BE(offset);
  offset += 2;
  const credentialId = authenticatorData.subarray(offset, offset + credentialIdLength);
  offset += credentialIdLength;
  const { value: coseKey } = cborRead(authenticatorData, offset);
  if (!(coseKey instanceof Map)) throw new HttpError(400, "Invalid passkey public key.");
  if (coseKey.get(1) !== 2 || coseKey.get(3) !== -7 || coseKey.get(-1) !== 1) {
    throw new HttpError(400, "This passkey type is not supported yet.");
  }
  const x = coseKey.get(-2);
  const y = coseKey.get(-3);
  if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) {
    throw new HttpError(400, "Invalid passkey public key.");
  }
  return {
    credentialId: base64url(credentialId),
    publicKeyJwk: { kty: "EC", crv: "P-256", x: base64url(x), y: base64url(y), ext: true },
    coseAlg: -7
  };
}

function passkeysFrom(config = {}) {
  return config.passkeys && typeof config.passkeys === "object" ? config.passkeys : {};
}

export async function beginPasskeyRegistration(db, user, req) {
  const context = requestContext(req);
  const profile = await customerProfile(db, user);
  const config = (await db.ref(`twoFactor/${user.uid}`).once("value")).val() || {};
  if (config.locked) throw new HttpError(423, "This account is locked.");
  const challenge = base64url(randomBytes(32));
  await db.ref(`twoFactor/${user.uid}/pendingPasskeyRegistration`).set({
    challenge,
    rpId: context.rpId,
    origin: context.origin,
    expiresAt: Date.now() + challengeExpiryMs
  });
  const excludeCredentials = Object.keys(passkeysFrom(config)).map((id) => ({ type: "public-key", id }));
  return {
    publicKey: {
      challenge,
      rp: { name: "Taptap Foodtrip", id: context.rpId },
      user: {
        id: base64url(Buffer.from(user.uid)),
        name: user.email || profile.email || user.uid,
        displayName: profile.name || user.name || user.email || "Customer"
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 60_000,
      attestation: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required"
      },
      excludeCredentials
    }
  };
}

export async function verifyPasskeyRegistration(db, user, input = {}, req) {
  const context = requestContext(req);
  const profile = await customerProfile(db, user);
  const configRef = db.ref(`twoFactor/${user.uid}`);
  const config = (await configRef.once("value")).val() || {};
  const pending = config.pendingPasskeyRegistration || {};
  if (!pending.challenge || Number(pending.expiresAt || 0) < Date.now()) throw new HttpError(410, "Passkey setup expired. Try again.");
  if (pending.origin !== context.origin || pending.rpId !== context.rpId) throw new HttpError(400, "Passkey setup must finish on the same site.");
  verifyClientData(input.response?.clientDataJSON, "webauthn.create", pending.challenge, context);
  const attestation = cborRead(fromBase64url(input.response?.attestationObject)).value;
  const authenticatorData = attestation.get("authData");
  if (!Buffer.isBuffer(authenticatorData)) throw new HttpError(400, "Invalid passkey response.");
  const { signCount } = verifyAuthenticatorData(authenticatorData, context.rpId, true);
  const credential = parseAttestedCredential(authenticatorData);
  if (credential.credentialId !== input.rawId) throw new HttpError(400, "Passkey credential mismatch.");
  const backupCodes = Array.from({ length: 8 }, backupCode);
  const createdAt = Date.now();
  await configRef.set({
    enabled: true,
    method: "passkey",
    passkeys: {
      [credential.credentialId]: {
        name: cleanName(input.name, `${profile.name || "Customer"} passkey`),
        credentialId: credential.credentialId,
        publicKeyJwk: credential.publicKeyJwk,
        coseAlg: credential.coseAlg,
        signCount,
        createdAt,
        lastUsedAt: createdAt
      }
    },
    backupCodes: backupCodes.map((value) => hashCode(value.replace(/-/g, ""))),
    failedAttempts: 0,
    locked: false,
    enabledAt: createdAt,
    lastVerifiedAt: createdAt,
    pendingPasskeyRegistration: null,
    pendingPasskeyAuthentication: null
  });
  await audit(db, user, "registered", { credentialId: credential.credentialId });
  return { customToken: await issueSessionToken(db, user), backupCodes };
}

export async function beginPasskeyAuthentication(db, user, req) {
  const context = requestContext(req);
  await customerProfile(db, user);
  const config = (await db.ref(`twoFactor/${user.uid}`).once("value")).val() || {};
  if (!config.enabled || config.method !== "passkey") throw new HttpError(409, "Passkey is not enabled for this account.");
  if (config.locked) throw new HttpError(423, "This account is locked.");
  const passkeys = passkeysFrom(config);
  const allowCredentials = Object.keys(passkeys).map((id) => ({ type: "public-key", id }));
  if (allowCredentials.length === 0) throw new HttpError(409, "No passkey is registered for this account.");
  const challenge = base64url(randomBytes(32));
  await db.ref(`twoFactor/${user.uid}/pendingPasskeyAuthentication`).set({
    challenge,
    rpId: context.rpId,
    origin: context.origin,
    expiresAt: Date.now() + challengeExpiryMs
  });
  return {
    publicKey: {
      challenge,
      rpId: context.rpId,
      allowCredentials,
      timeout: 60_000,
      userVerification: "required"
    }
  };
}

export async function verifyPasskeyAuthentication(db, user, input = {}, req) {
  const context = requestContext(req);
  await customerProfile(db, user);
  const configRef = db.ref(`twoFactor/${user.uid}`);
  const config = (await configRef.once("value")).val() || {};
  const pending = config.pendingPasskeyAuthentication || {};
  if (!pending.challenge || Number(pending.expiresAt || 0) < Date.now()) throw new HttpError(410, "Passkey request expired. Try again.");
  if (pending.origin !== context.origin || pending.rpId !== context.rpId) throw new HttpError(400, "Passkey request must finish on the same site.");
  const credentialId = String(input.rawId || input.id || "");
  const stored = passkeysFrom(config)[credentialId];
  if (!stored?.publicKeyJwk) throw new HttpError(401, "This passkey is not registered for the account.");
  const { clientDataHash } = verifyClientData(input.response?.clientDataJSON, "webauthn.get", pending.challenge, context);
  const authenticatorData = fromBase64url(input.response?.authenticatorData);
  const { signCount } = verifyAuthenticatorData(authenticatorData, context.rpId);
  const previousCount = Number(stored.signCount || 0);
  if (previousCount > 0 && signCount > 0 && signCount <= previousCount) {
    throw new HttpError(401, "Passkey sign-in was rejected. Try again.");
  }
  const signed = Buffer.concat([authenticatorData, clientDataHash]);
  const verifier = createVerify("SHA256");
  verifier.update(signed);
  verifier.end();
  const valid = verifier.verify(createPublicKey({ key: stored.publicKeyJwk, format: "jwk" }), fromBase64url(input.response?.signature));
  if (!valid) throw new HttpError(401, "Passkey sign-in failed.");
  const now = Date.now();
  await configRef.update({
    failedAttempts: 0,
    locked: false,
    lockedAt: null,
    lastVerifiedAt: now,
    pendingPasskeyAuthentication: null,
    [`passkeys/${credentialId}/signCount`]: signCount,
    [`passkeys/${credentialId}/lastUsedAt`]: now
  });
  await audit(db, user, "verified", { credentialId });
  return { customToken: await issueSessionToken(db, user) };
}
