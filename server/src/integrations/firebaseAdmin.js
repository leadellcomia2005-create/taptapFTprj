import { readFileSync } from "node:fs";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";

const publicUnavailableMessage = "Account service is unavailable.";

export function decodeServiceAccount(value) {
  if (!value) return null;
  const decoded = Buffer.from(value, "base64").toString("utf8");
  const serviceAccount = JSON.parse(decoded);
  if (!serviceAccount?.project_id || !serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error("Firebase service account is incomplete.");
  }
  return serviceAccount;
}

export async function initializeFirebaseAdmin(config, logger) {
  if (!config.databaseUrl) {
    return {
      enabled: false,
      publicError: publicUnavailableMessage,
      db: () => null,
      auth: () => null,
      messaging: () => null
    };
  }

  try {
    const inlineServiceAccount = decodeServiceAccount(config.serviceAccountJsonBase64);
    const credential = inlineServiceAccount
      ? cert(inlineServiceAccount)
      : config.credentialsPath
        ? cert(JSON.parse(readFileSync(config.credentialsPath, "utf8")))
        : applicationDefault();
    await credential.getAccessToken();
    const app = initializeApp({
      credential,
      databaseURL: config.databaseUrl,
      ...(config.storageBucket ? { storageBucket: config.storageBucket } : {})
    });
    return {
      enabled: true,
      publicError: null,
      db: () => getDatabase(app),
      auth: () => getAuth(app),
      messaging: () => getMessaging(app)
    };
  } catch (error) {
    logger.error("firebase_admin_initialization_failed", error);
    return {
      enabled: false,
      publicError: publicUnavailableMessage,
      db: () => null,
      auth: () => null,
      messaging: () => null
    };
  }
}
